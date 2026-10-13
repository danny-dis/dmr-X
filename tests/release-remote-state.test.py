import importlib.util
import pathlib
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('preflight', pathlib.Path(__file__).resolve().parents[1] / 'scripts/release-preflight.py')
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class RemoteReleaseTests(unittest.TestCase):
    def test_published_release_cannot_be_overwritten(self):
        with self.assertRaises(ValueError):
            preflight.assert_draft_or_absent([{'tag_name': 'v0.5.21', 'draft': False, 'id': 1}], 'v0.5.21')

    def test_existing_draft_is_returned_by_exact_id(self):
        draft = {'tag_name': 'v0.5.21', 'draft': True, 'id': 123}
        self.assertEqual(preflight.assert_draft_or_absent([draft], 'v0.5.21'), draft)

    def test_absent_release_is_safe_to_create_as_draft(self):
        self.assertIsNone(preflight.assert_draft_or_absent([], 'v0.5.21'))

    def test_ambiguous_release_identity_is_rejected(self):
        draft = {'tag_name': 'v0.5.21', 'draft': True, 'id': 123}
        with self.assertRaises(ValueError):
            preflight.assert_draft_or_absent([draft, dict(draft, id=124)], 'v0.5.21')

    def test_lightweight_tag_resolves_to_commit(self):
        sha = 'a' * 40
        self.assertEqual(preflight.resolve_remote_object({'type': 'commit', 'sha': sha}, lambda _: None), sha)

    def test_annotated_tag_is_peeled(self):
        sha, annotation = 'a' * 40, 'b' * 40
        self.assertEqual(preflight.resolve_remote_object({'type': 'tag', 'sha': annotation}, lambda _: {'object': {'type': 'commit', 'sha': sha}}), sha)

    def test_noncommit_tag_object_is_rejected(self):
        with self.assertRaises(ValueError):
            preflight.resolve_remote_object({'type': 'tree', 'sha': 'a' * 40}, lambda _: None)

    def test_moved_remote_tag_fails_before_release_lookup(self):
        with patch.object(preflight, 'run', return_value='{"object":{"type":"commit","sha":"' + 'b' * 40 + '"}}'):
            with self.assertRaises(ValueError):
                preflight.validate_remote_state('danny-dis/dmr-X', 'v0.5.21', 'a' * 40)

    def test_missing_remote_tag_fails_closed(self):
        with patch.object(preflight, 'run', side_effect=subprocess.CalledProcessError(1, 'gh')):
            with self.assertRaises(subprocess.CalledProcessError):
                preflight.validate_remote_state('danny-dis/dmr-X', 'v0.5.21', 'a' * 40)


if __name__ == '__main__':
    unittest.main()
