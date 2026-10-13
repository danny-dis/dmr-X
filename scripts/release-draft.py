"""Create/upload only a verified draft, never overwrite a published release."""
import hashlib
import json
import os
import pathlib
import urllib.error
import urllib.parse
import urllib.request

import importlib.util

_spec = importlib.util.spec_from_file_location('release_preflight', pathlib.Path(__file__).with_name('release-preflight.py'))
_preflight = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_preflight)
validate_remote_state = _preflight.validate_remote_state


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, newurl):
        raise urllib.error.HTTPError(request.full_url, code, 'Redirect refused', headers, file)


def request(method, url, token, payload=None, binary=False):
    if urllib.parse.urlparse(url).hostname not in {'api.github.com', 'uploads.github.com'}:
        raise ValueError('Unexpected GitHub API host')
    data = payload if binary else (json.dumps(payload).encode() if payload is not None else None)
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dmrx-release',
               'Content-Type': 'application/octet-stream' if binary else 'application/json'}
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=120) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def main():
    repo, tag, sha = (os.environ[k] for k in ('RELEASE_REPOSITORY', 'RELEASE_TAG', 'RELEASE_SHA'))
    token = os.environ['GH_TOKEN']
    base = 'https://api.github.com/repos/' + repo
    directory = pathlib.Path('apps/gateway/dist/release')
    expected = {'dmrx-linux-x64.tar.gz', 'dmrx-linux-arm64.tar.gz', 'dmrx-darwin-x64.tar.gz',
                'dmrx-darwin-arm64.tar.gz', 'dmrx-windows-x64.zip', 'checksums.txt',
                'release.json', 'container-digests.json', 'sbom.cdx.json'}
    for name in expected:
        if not directory.joinpath(name).is_file() or directory.joinpath(name).stat().st_size == 0:
            raise ValueError('Missing release asset: ' + name)
    existing = validate_remote_state(repo, tag, sha)
    payload = {'tag_name': tag, 'target_commitish': sha, 'name': tag,
               'body': pathlib.Path('release-notes.md').read_text(encoding='utf-8'),
               'draft': True, 'prerelease': False, 'make_latest': 'false'}
    def assert_identity(current, expected_id):
        if current.get('id') != expected_id or current.get('tag_name') != tag or current.get('draft') is not True:
            raise ValueError('Exact release target changed or was published; refusing writes')
        return current

    if existing:
        assert_identity(request('GET', base + '/releases/' + str(existing['id']), token), existing['id'])
        release = request('PATCH', base + '/releases/' + str(existing['id']), token, payload)
    else:
        release = request('POST', base + '/releases', token, payload)
    release_id = release['id']
    assert_identity(release, existing['id'] if existing else release_id)

    def guard():
        current = validate_remote_state(repo, tag, sha)
        if current is None or current['id'] != release_id or current.get('draft') is not True:
            raise ValueError('Release changed or was published; refusing asset writes')
        return assert_identity(request('GET', base + '/releases/' + str(release_id), token), release_id)

    for name in sorted(expected):
        current = guard()
        for asset in current['assets']:
            if asset['name'] == name:
                guard()
                request('DELETE', base + '/releases/assets/' + str(asset['id']), token)
        guard()
        content = directory.joinpath(name).read_bytes()
        url = 'https://uploads.github.com/repos/' + repo + '/releases/' + str(release_id) + '/assets?name=' + urllib.parse.quote(name, safe='')
        uploaded = request('POST', url, token, content, binary=True)
        if uploaded['size'] != len(content):
            raise ValueError('Uploaded asset size mismatch: ' + name)
        digest = uploaded.get('digest')
        if digest and digest != 'sha256:' + hashlib.sha256(content).hexdigest():
            raise ValueError('Uploaded asset digest mismatch: ' + name)
    current = guard()
    names = {asset['name'] for asset in current['assets']}
    if names != expected or current.get('draft') is not True:
        raise ValueError('Draft read-back failed')
    print(json.dumps({'release_id': release_id, 'tag': tag, 'sha': sha, 'draft': True,
                      'assets': sorted(names), 'url': current['html_url']}, indent=2))


if __name__ == '__main__':
    main()
