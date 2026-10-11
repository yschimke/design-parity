import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location('comment', Path(__file__).with_name('comment.py'))
comment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comment)


def sha(label):
    return hashlib.sha256(label.encode()).hexdigest()


SIZE = (400, 200)


def png_for(label):
    """Deterministic PNG bytes per label, so equal labels mean equal digests."""
    import io
    buffer = io.BytesIO()
    Image.new('RGB', SIZE, tuple(hashlib.sha256(label.encode()).digest()[:3])).save(buffer, format='PNG')
    return buffer.getvalue()


def write_evidence(root, captures):
    """captures: {id: (referenceLabel, candidateLabel)}; counts come from the pixels, as evidence.py records them."""
    import io
    for folder in ('previews', 'references', 'diffs'):
        (root / folder).mkdir(parents=True, exist_ok=True)
    report, refs = [], []
    for pid, (ref, cand) in captures.items():
        ref_bytes, cand_bytes = png_for(ref), png_for(cand)
        (root / f'references/{pid}-x.png').write_bytes(ref_bytes)
        (root / f'previews/{pid}.png').write_bytes(cand_bytes)
        Image.new('RGB', SIZE, 'white').save(root / f'diffs/{pid}.png')
        images = [Image.open(io.BytesIO(data)).convert('RGBA') for data in (ref_bytes, cand_bytes)]
        report.append({'previewId': pid, 'referenceSha256': hashlib.sha256(ref_bytes).hexdigest(),
                       'candidateSha256': hashlib.sha256(cand_bytes).hexdigest(),
                       'changedPixels': comment.changed_mask(*images).histogram()[255], 'totalPixels': SIZE[0] * SIZE[1]})
        refs.append({'previewId': pid, 'raster': {'path': f'references/{pid}-x.png'}})
    (root / 'evidence.json').write_text(json.dumps({'schema': comment.SCHEMA, 'captures': report}))
    (root / 'references/index.json').write_text(json.dumps({'references': refs}))


class CommentTest(unittest.TestCase):
    def run_comment(self, pr, base=None, **extra):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            write_evidence(tmp / 'pr', pr)
            args = ['--pr', str(tmp / 'pr'), '--marker', 'uid-parity:adaptive-uid', '--output', str(tmp / 'body.md'),
                    '--image-base', 'https://raw.githubusercontent.com/o/r/abc', '--images-out', str(tmp / 'images')]
            if base is not None:
                write_evidence(tmp / 'base', base)
                args += ['--base', str(tmp / 'base')]
            for key, value in extra.items():
                args += [f'--{key}', str(value)]
            comment.main(args)
            images = sorted(str(p.relative_to(tmp / 'images')) for p in (tmp / 'images').rglob('*.png')) if (tmp / 'images').exists() else []
            return (tmp / 'body.md').read_text(), images

    def test_counts_against_base_and_lists_only_changed_captures(self):
        base = {'a': ('r1', 'c1'), 'b': ('b', 'b'), 'gone': ('g', 'g')}
        pr = {'a': ('c1', 'c1'), 'b': ('b', 'b'), 'new': ('r3', 'c3')}
        text, images = self.run_comment(pr, base)
        self.assertIn('**2/3 exact** (base: 2/3)', text)
        self.assertIn('| `a` | reference | 80,000 → 0 |', text)
        self.assertIn('| `new` | new | 80,000 |', text)
        self.assertIn('| `gone` | removed | — |', text)
        self.assertNotIn('`b`', text)
        self.assertEqual(images, ['a/candidate.png', 'a/diff.png', 'a/reference.png',
                                  'new/candidate.png', 'new/diff.png', 'new/reference.png'])
        self.assertIn('https://raw.githubusercontent.com/o/r/abc/a/reference.png', text)
        self.assertTrue(text.startswith('<!-- uid-parity:adaptive-uid -->'))

    def test_without_base_lists_differing_captures(self):
        text, _ = self.run_comment({'a': ('x', 'x'), 'b': ('r', 'c')})
        self.assertIn('**1/2 exact**.', text)
        self.assertIn('No base evidence', text)
        self.assertIn('| `b` |', text)
        self.assertNotIn('`a`', text)

    def test_unchanged_pr_says_so_and_publishes_nothing(self):
        same = {'a': ('r', 'c')}
        text, images = self.run_comment(same, same)
        self.assertIn('No capture changed against base.', text)
        self.assertEqual(images, [])

    def test_limit_caps_published_images(self):
        pr = {f'c{i}': ('r', 'c') for i in range(5)}
        text, images = self.run_comment(pr, limit=2)
        self.assertEqual(len(images), 6)
        self.assertIn('3 more changed captures', text)

    def test_thumbnails_are_downscaled(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            write_evidence(tmp / 'pr', {'a': ('r', 'c')})
            comment.main(['--pr', str(tmp / 'pr'), '--marker', 'm', '--output', str(tmp / 'b.md'),
                          '--image-base', 'https://x', '--images-out', str(tmp / 'i')])
            with Image.open(tmp / 'i/a/reference.png') as image:
                self.assertEqual(image.width, comment.THUMB_WIDTH)

    def test_rejects_untrusted_ids_and_schema(self):
        for bad in ('../x', 'a b', '<img>'):
            with self.subTest(bad=bad), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / 'evidence.json').write_text(json.dumps({'schema': comment.SCHEMA, 'captures': [
                    {'previewId': bad, 'referenceSha256': 'r', 'candidateSha256': 'c', 'changedPixels': 0, 'totalPixels': 1}]}))
                with self.assertRaises(ValueError):
                    comment.load(root)
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'evidence.json').write_text(json.dumps({'schema': 'other', 'captures': []}))
            with self.assertRaises(ValueError):
                comment.load(Path(tmp))

    def test_missing_evidence_writes_a_pointer_to_the_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            comment.main(['--pr', str(tmp / 'none'), '--marker', 'm', '--output', str(tmp / 'b.md'), '--run-url', 'https://run'])
            self.assertIn('produced no evidence', (tmp / 'b.md').read_text())


    def test_rejects_changed_pixels_above_total(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'evidence.json').write_text(json.dumps({'schema': comment.SCHEMA, 'captures': [
                {'previewId': 'a', 'referenceSha256': 'r', 'candidateSha256': 'c', 'changedPixels': 2, 'totalPixels': 1}]}))
            with self.assertRaises(ValueError):
                comment.load(Path(tmp))

    def test_thin_and_transparent_captures_keep_valid_thumbnails(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            comment.save_thumbnail(Image.new('RGBA', (1800, 1), (0, 0, 0, 0)), tmp / 'out.png')
            with Image.open(tmp / 'out.png') as image:
                self.assertEqual((image.size, image.mode), ((comment.THUMB_WIDTH, 1), 'RGBA'))
                self.assertEqual(image.getpixel((0, 0))[3], 0)

    def test_table_is_capped_for_github_comment_limits(self):
        pr = {f'c{i}': ('r', 'c') for i in range(comment.MAX_ROWS + 5)}
        text, _ = self.run_comment(pr, limit=0)
        self.assertEqual(text.count('| `c'), comment.MAX_ROWS)
        self.assertIn('5 more changed captures are listed', text)
        self.assertLess(len(text), 65536)

    def test_rejects_empty_lists_and_non_integer_or_zero_counts(self):
        cap = {'previewId': 'a', 'referenceSha256': sha('r'), 'candidateSha256': sha('c')}
        for captures in ([], None, [{**cap, 'changedPixels': False, 'totalPixels': True}], [{**cap, 'changedPixels': 0, 'totalPixels': 0}],
                         [{**cap, 'changedPixels': 1.0, 'totalPixels': 2}],
                         [{**cap, 'referenceSha256': None, 'changedPixels': 0, 'totalPixels': 1}],
                         [{**cap, 'candidateSha256': 'not-a-digest', 'changedPixels': 0, 'totalPixels': 1}]):
            with self.subTest(captures=str(captures)[:20]), tempfile.TemporaryDirectory() as tmp:
                (Path(tmp) / 'evidence.json').write_text(json.dumps({'schema': comment.SCHEMA, 'captures': captures}))
                with self.assertRaises(ValueError):
                    comment.load(Path(tmp))

    def test_long_ids_fit_the_comment_limit(self):
        for length in (125, 240):  # filesystems cap names at 255 bytes
            with self.subTest(length=length):
                pr = {f'{i:03d}' + 'x' * length: ('r', 'c') for i in range(comment.MAX_ROWS + 5)}
                text, _ = self.run_comment(pr, limit=12)
                self.assertLessEqual(len(text), comment.MAX_BODY)
                self.assertIn('more changed captures are listed', text)

    def test_omitted_removals_point_at_base_evidence(self):
        base = {f'gone{i}': ('r', 'c') for i in range(comment.MAX_ROWS + 3)}
        base['kept'] = ('r', 'c')
        text, _ = self.run_comment({'kept': ('r', 'c')}, base, limit=0)
        self.assertEqual(text.count('| removed |'), comment.MAX_ROWS)
        self.assertIn("3 more removed captures are only in the base run's evidence.", text)

    def test_rejects_negative_limit(self):
        with self.assertRaises(ValueError):
            self.run_comment({'a': ('r', 'c')}, limit=-1)

    def test_oversized_fixed_content_fails_instead_of_looping(self):
        with self.assertRaises(ValueError):
            self.run_comment({'a': ('r', 'c')}, **{'run-url': 'https://x/' + 'y' * comment.MAX_BODY})

    def test_thumbnails_must_match_recorded_digests_and_diff_is_redrawn(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            write_evidence(tmp / 'pr', {'a': ('r', 'c')})
            args = ['--pr', str(tmp / 'pr'), '--marker', 'm', '--output', str(tmp / 'b.md'), '--image-base', 'https://x', '--images-out', str(tmp / 'i')]
            comment.main(args)
            with Image.open(tmp / 'i/a/diff.png') as diff:
                self.assertEqual(diff.getpixel((0, 0))[:3], (210, 0, 100))  # redrawn: r and c differ everywhere
            (tmp / 'pr/previews/a.png').write_bytes(png_for('swapped'))
            with self.assertRaises(ValueError):
                comment.main(args)

    def test_rejects_recorded_counts_that_disagree_with_the_pixels(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            write_evidence(tmp / 'pr', {'a': ('r', 'c')})
            report = json.loads((tmp / 'pr/evidence.json').read_text())
            report['captures'][0]['changedPixels'] = 0  # forged "exact"
            (tmp / 'pr/evidence.json').write_text(json.dumps(report))
            with self.assertRaises(ValueError):
                comment.main(['--pr', str(tmp / 'pr'), '--marker', 'm', '--output', str(tmp / 'b.md')])

    def test_tall_captures_fit_the_thumbnail_box(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'out.png'
            comment.save_thumbnail(Image.new('RGBA', (1, 1800)), out)
            with Image.open(out) as image:
                self.assertEqual(image.size, (1, 2 * comment.THUMB_WIDTH))

if __name__ == '__main__':
    unittest.main()
