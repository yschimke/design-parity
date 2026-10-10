import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location('evidence', Path(__file__).with_name('evidence.py'))
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class EvidenceTest(unittest.TestCase):
    def test_audit_stages_only_expected_bounded_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'previews').mkdir()
            captures = []
            for i in range(3):
                Image.new('RGB', (2, 2)).save(root / f'previews/capture_{i}.png')
                captures.append({'previewId': f'capture_{i}', 'widthDp': 1, 'heightDp': 1, 'density': 2})
            plan = root / 'plan.json'
            plan.write_text(json.dumps({'captures': captures}))
            (root / 'untrusted.sh').write_text('do not execute')
            evidence.run(plan, root, root / 'staged')
            self.assertEqual(len(list((root / 'staged').iterdir())), 4)
            (root / 'previews/capture_0.png').unlink()
            with self.assertRaises(FileNotFoundError):
                evidence.run(plan, root, root / 'missing')

    def test_rejects_wrong_dimensions_and_invalid_png(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            Image.new('RGB', (2, 2)).save(root / 'image.png')
            with self.assertRaises(ValueError):
                evidence.png(root, 'image.png', (4, 4))
            (root / 'image.png').write_text('not a png')
            with self.assertRaises(Exception):
                evidence.png(root, 'image.png', (2, 2))

    def test_rejects_paths_and_symlinks_outside_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'evidence'
            root.mkdir()
            outside = Path(tmp) / 'secret'
            outside.write_text('must not be staged')
            (root / 'link').symlink_to(outside)
            for path in ['../secret', 'link', str(outside)]:
                with self.assertRaises(ValueError):
                    evidence.read(root, path)

    def test_plan_drives_arbitrary_capture_counts_and_distinct_pairs(self):
        for duplicate in (None, 'Compose', 'UID'):
            with self.subTest(duplicate=duplicate), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / 'previews').mkdir()
                (root / 'references').mkdir()
                (root / 'references/design.uid').write_text('{}')
                captures, references = [], []
                for i in range(3):
                    pid = f'example-{i}'
                    captures.append({'previewId': pid, 'widthDp': 2, 'heightDp': 2, 'density': 1})
                    for folder, label in [('previews', 'Compose'), ('references', 'UID')]:
                        color = 0 if duplicate == label and i < 2 else i * 50
                        Image.new('RGB', (2, 2), (color, 0, 0)).save(root / f'{folder}/{pid}.png')
                    references.append({'previewId': pid,
                        'raster': {'path': f'references/{pid}.png', 'sha256': evidence.digest((root / f'references/{pid}.png').read_bytes())},
                        'artifact': {'path': 'references/design.uid'},
                        'source': {'revision': 'test', 'attributes': {'documentSha256': hashlib.sha256(b'{}').hexdigest()}}})
                plan = root / 'plan.json'
                plan.write_text(json.dumps({'captures': captures, 'distinctCaptures': [['example-0', 'example-1']]}))
                (root / 'references/index.json').write_text(json.dumps({'references': references}))
                if duplicate:
                    with self.assertRaisesRegex(ValueError, f'{duplicate} states are duplicate'):
                        evidence.run(plan, root)
                else:
                    evidence.run(plan, root)
                    report = json.loads((root / 'evidence.json').read_text())
                    self.assertEqual(len(report['captures']), 3)
                    self.assertTrue(all(c['changedPixels'] == 0 for c in report['captures']))

    def test_invalid_capture_contract_rejected_before_staging(self):
        capture = {'previewId': 'one', 'widthDp': 1, 'heightDp': 1, 'density': 1}
        plans = [{'captures': []}, {'captures': [capture, capture]},
                 {'captures': [{**capture, 'previewId': '../escape'}]},
                 {'captures': [capture], 'distinctCaptures': [['one', 'missing']]},
                 {'captures': [capture], 'distinctCaptures': [['one', 'one']]}]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for data in plans:
                with self.subTest(plan=data):
                    plan = root / 'plan.json'
                    plan.write_text(json.dumps(data))
                    with self.assertRaises(ValueError):
                        evidence.run(plan, root, root / 'staged')
                    self.assertFalse((root / 'staged').exists())


if __name__ == '__main__':
    unittest.main()
