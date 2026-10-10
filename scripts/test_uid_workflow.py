#!/usr/bin/env python3
"""Exercise upload/download naming from the real workflow for retries and two pilots."""
import os
from pathlib import Path
import subprocess
import unittest

import yaml

WORKFLOW = Path(os.environ.get('UID_WORKFLOW', Path(__file__).resolve().parents[1] / '.github/workflows/uid-parity-reusable.yml'))


class ArtifactsTest(unittest.TestCase):
    def setUp(self):
        self.workflow = yaml.safe_load(WORKFLOW.read_text())
        self.artifacts = {}

    def transfer(self, job, prefix, revision):
        for step in self.workflow['jobs'][job]['steps']:
            action = step.get('uses', '')
            if not action.startswith(('actions/upload-artifact@', 'actions/download-artifact@')):
                continue
            options = step['with']
            name = options['name'].replace('${{ inputs.artifact-prefix }}', prefix)
            if action.startswith('actions/upload-artifact@'):
                if name in self.artifacts and not options.get('overwrite', False):
                    raise ValueError(f'Artifact already exists: {name}')
                self.artifacts[name] = (prefix, revision)
            else:
                self.assertEqual(self.artifacts[name], (prefix, revision), 'Downloaded another pilot or attempt')

    def test_two_pilots_can_interleave_without_cross_downloading(self):
        for job in ('candidate', 'references', 'compare'):
            for pilot in ('phone-uid', 'wear-uid'):
                self.transfer(job, pilot, 'first')
        self.assertEqual(len(self.artifacts), 10)

    def test_rerun_replaces_all_artifacts(self):
        for attempt in ('first', 'retry'):
            for job in ('candidate', 'references', 'compare'):
                self.transfer(job, 'adaptive-uid', attempt)
        self.assertEqual(len(self.artifacts), 5)
        self.assertTrue(all(value == ('adaptive-uid', 'retry') for value in self.artifacts.values()))

    def test_compare_only_retry_reuses_successful_inputs(self):
        for job in ('candidate', 'references', 'compare', 'compare'):
            self.transfer(job, 'adaptive-uid', 'first')

    def test_build_command_preserves_pipefail(self):
        step = next(s for s in self.workflow['jobs']['candidate']['steps'] if s.get('name') == 'Check interactions and render candidate matrix')
        result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', step['run']],
                                env={**os.environ, 'BUILD_COMMAND': 'false | true'}, capture_output=True)
        self.assertNotEqual(result.returncode, 0)

    def test_catalog_artifacts_are_scoped_and_rerunnable(self):
        for attempt in ('first', 'retry'):
            for job in ('candidate', 'references', 'compare', 'catalog', 'publish'):
                for pilot in ('phone', 'tablet'):
                    self.transfer(job, pilot, attempt)
        self.assertEqual(len(self.artifacts), 12)

    def test_only_default_branch_publisher_can_write(self):
        self.assertEqual(self.workflow['permissions'], {'contents': 'read'})
        jobs = self.workflow['jobs']
        for name, job in jobs.items():
            if name != 'publish':
                self.assertNotEqual(job.get('permissions', {}).get('contents'), 'write')
        publish = jobs['publish']
        self.assertEqual(publish['permissions'], {'contents': 'write'})
        self.assertIn("github.event_name == 'push'", publish['if'])
        self.assertIn('github.event.repository.default_branch', publish['if'])
        self.assertNotIn('pull_request', publish['if'])
        for step in publish['steps']:
            if step.get('uses', '').startswith('actions/checkout@'):
                self.assertIn(step['with']['repository'], ('yschimke/design-parity', 'yschimke/compose-ai-tools'))
                self.assertRegex(step['with']['ref'], r'^[0-9a-f]{40}$')
                self.assertFalse(step['with']['persist-credentials'])


if __name__ == '__main__':
    unittest.main()
