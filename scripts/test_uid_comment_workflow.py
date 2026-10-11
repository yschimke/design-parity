#!/usr/bin/env python3
"""Pin the security shape of the UID parity comment workflow."""
import os
import re
from pathlib import Path
import unittest

import yaml

WORKFLOW = Path(os.environ.get('UID_COMMENT_WORKFLOW', Path(__file__).resolve().parents[1] / '.github/workflows/uid-parity-comment-reusable.yml'))


class CommentWorkflowTest(unittest.TestCase):
    def setUp(self):
        self.workflow = yaml.safe_load(WORKFLOW.read_text())
        self.job = self.workflow['jobs']['comment']
        self.steps = self.job['steps']

    def test_workflow_level_grants_nothing(self):
        self.assertEqual(self.workflow['permissions'], {})

    def test_job_has_only_the_permissions_it_needs(self):
        self.assertEqual(self.job['permissions'], {'actions': 'read', 'contents': 'write', 'pull-requests': 'write'})

    def test_runs_only_for_same_repository_pull_requests(self):
        condition = ' '.join(self.job['if'].split())
        self.assertIn("github.event.workflow_run.event == 'pull_request'", condition)
        self.assertIn('github.event.workflow_run.head_repository.full_name == github.repository', condition)

    def test_tools_come_from_a_pinned_design_parity_commit_never_pr_code(self):
        checkouts = [s for s in self.steps if s.get('uses', '').startswith('actions/checkout@')]
        self.assertEqual(len(checkouts), 1)
        options = checkouts[0]['with']
        self.assertEqual(options['repository'], 'yschimke/design-parity')
        self.assertRegex(options['ref'], r'^[0-9a-f]{40}$')
        self.assertFalse(options['persist-credentials'])
        text = WORKFLOW.read_text()
        self.assertNotRegex(text, r'ref:\s*\$\{\{\s*github\.event\.workflow_run\.head')

    def test_pr_supplied_values_reach_shell_only_through_env(self):
        for step in self.steps:
            run = step.get('run', '')
            self.assertNotRegex(run, r'\$\{\{[^}]*(workflow_run\.(head_branch|display_title|pull_requests)|inputs\.)', step.get('name', run[:40]))


    def test_runs_for_one_pr_and_prefix_never_overlap(self):
        concurrency = self.job['concurrency']
        self.assertTrue(concurrency['cancel-in-progress'])
        for part in ('github.repository', 'inputs.artifact-prefix', 'github.event.workflow_run.head_branch'):
            self.assertIn(part, concurrency['group'])

    def test_thumbnails_use_repository_relative_links(self):
        text = WORKFLOW.read_text()
        self.assertIn('--image-base "../blob/$branch/', text)
        self.assertIn("--image-suffix '?raw=true'", text)
        self.assertNotIn('raw.githubusercontent.com', text)

if __name__ == '__main__':
    unittest.main()
