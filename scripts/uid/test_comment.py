import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location('comment', Path(__file__).with_name('comment.py'))
comment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comment)


def write_evidence(root, captures):
    """captures: {id: (referenceSha, candidateSha, changedPixels)}"""
    for folder in ('previews', 'references', 'diffs'):
        (root / folder).mkdir(parents=True, exist_ok=True)
    report, refs = [], []
    for pid, (ref, cand, changed) in captures.items():
        for path in (f'previews/{pid}.png', f'references/{pid}-x.png', f'diffs/{pid}.png'):
            Image.new('RGB', (800, 400), 'white').save(root / path)
        report.append({'previewId': pid, 'referenceSha256': ref, 'candidateSha256': cand, 'changedPixels': changed, 'totalPixels': 320000})
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
        base = {'a': ('r1', 'c1', 10), 'b': ('r2', 'c2', 0), 'gone': ('r', 'c', 0)}
        pr = {'a': ('r1x', 'c1', 0), 'b': ('r2', 'c2', 0), 'new': ('r3', 'c3', 5)}
        text, images = self.run_comment(pr, base)
        self.assertIn('**2/3 exact** (base: 2/3)', text)
        self.assertIn('| `a` | reference | 10 → 0 |', text)
        self.assertIn('| `new` | new | 5 |', text)
        self.assertIn('| `gone` | removed | — |', text)
        self.assertNotIn('`b`', text)
        self.assertEqual(images, ['a/candidate.png', 'a/diff.png', 'a/reference.png',
                                  'new/candidate.png', 'new/diff.png', 'new/reference.png'])
        self.assertIn('https://raw.githubusercontent.com/o/r/abc/a/reference.png', text)
        self.assertTrue(text.startswith('<!-- uid-parity:adaptive-uid -->'))

    def test_without_base_lists_differing_captures(self):
        text, _ = self.run_comment({'a': ('r', 'c', 0), 'b': ('r', 'c', 7)})
        self.assertIn('**1/2 exact**.', text)
        self.assertIn('No base evidence', text)
        self.assertIn('| `b` |', text)
        self.assertNotIn('`a`', text)

    def test_unchanged_pr_says_so_and_publishes_nothing(self):
        same = {'a': ('r', 'c', 0)}
        text, images = self.run_comment(same, same)
        self.assertIn('No capture changed against base.', text)
        self.assertEqual(images, [])

    def test_limit_caps_published_images(self):
        pr = {f'c{i}': ('r', 'c', 1) for i in range(5)}
        text, images = self.run_comment(pr, limit=2)
        self.assertEqual(len(images), 6)
        self.assertIn('3 more changed captures', text)

    def test_thumbnails_are_downscaled(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            write_evidence(tmp / 'pr', {'a': ('r', 'c', 1)})
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


if __name__ == '__main__':
    unittest.main()
