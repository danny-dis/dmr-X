"""Exercise the actual draft orchestrator against stale remote-list observations."""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('draft', pathlib.Path(__file__).resolve().parents[1] / 'scripts/release-draft.py')
draft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(draft)


class DraftOrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.old_cwd = pathlib.Path.cwd()
        os.chdir(self.directory.name)
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(os.chdir, self.old_cwd)
        assets = pathlib.Path('apps/gateway/dist/release')
        assets.mkdir(parents=True)
        for name in ['dmrx-linux-x64.tar.gz', 'dmrx-linux-arm64.tar.gz', 'dmrx-darwin-x64.tar.gz',
                     'dmrx-darwin-arm64.tar.gz', 'dmrx-windows-x64.zip', 'checksums.txt',
                     'release.json', 'container-digests.json', 'sbom.cdx.json']:
            assets.joinpath(name).write_bytes(b'test fixture')
        pathlib.Path('release-notes.md').write_text('- Verification fixture')
        env = patch.dict(os.environ, {'RELEASE_REPOSITORY': 'danny-dis/dmr-X',
                                    'RELEASE_TAG': 'v0.5.21', 'RELEASE_SHA': 'a' * 40,
                                    'GH_TOKEN': 'unit-test-not-a-credential'})
        env.start()
        self.addCleanup(env.stop)
        self.release = {'id': 123, 'tag_name': 'v0.5.21', 'draft': True,
                        'assets': [{'id': 1, 'name': 'checksums.txt'}], 'html_url': 'https://github.com/test'}

    def assert_stale_exact_target_refused(self, changed):
        with patch.object(draft, 'validate_remote_state', return_value=self.release), \
             patch.object(draft, 'request', return_value=changed) as api:
            with self.assertRaises(ValueError):
                draft.main()
            self.assertTrue(api.call_args_list)
            self.assertTrue(all(call.args[0] == 'GET' for call in api.call_args_list), api.call_args_list)

    def test_published_exact_target_blocks_all_writes(self):
        self.assert_stale_exact_target_refused(dict(self.release, draft=False))

    def test_retagged_exact_target_blocks_all_writes(self):
        self.assert_stale_exact_target_refused(dict(self.release, tag_name='v0.5.22'))

    def test_different_exact_id_blocks_all_writes(self):
        self.assert_stale_exact_target_refused(dict(self.release, id=124))

    def test_publication_before_asset_guard_blocks_asset_mutations(self):
        calls = []
        reads = 0
        def request(method, url, token, payload=None, binary=False):
            nonlocal reads
            calls.append((method, url))
            if method == 'GET':
                reads += 1
                return dict(self.release, draft=reads == 1)
            if method == 'PATCH':
                return self.release
            self.fail('Asset mutation despite published exact-ID GET: ' + method)
        with patch.object(draft, 'validate_remote_state', return_value=self.release), \
             patch.object(draft, 'request', side_effect=request):
            with self.assertRaises(ValueError):
                draft.main()
        self.assertEqual([method for method, _ in calls], ['GET', 'PATCH', 'GET'])


if __name__ == '__main__':
    unittest.main()
