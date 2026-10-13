"""Fail closed before releasing an existing, green, immutable main-branch tag."""
import json
import os
import pathlib
import re
import subprocess


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def validate_tag(tag):
    if not re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+", tag):
        raise ValueError("Release requires an existing vMAJOR.MINOR.PATCH tag")
    return tag[1:]


def extract_notes(text, tag):
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines)
                  if re.match(r"^## " + re.escape(tag) + r"(?:\s|$)", line)), None)
    if start is None:
        raise ValueError("Missing curated changelog entry for " + tag)
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    notes = "\n".join(lines[start:end]).strip()
    if not any(line.startswith("- ") for line in lines[start + 1:end]):
        raise ValueError("Release changelog must describe changes, not just a heading")
    return notes + "\n"


def choose_green_ci(runs, sha):
    matches = [r for r in runs if r.get("head_sha") == sha and
               r.get("event") == "push" and r.get("head_branch") == "main"]
    if not matches:
        raise ValueError("No main-branch CI run exists for this exact release SHA")
    latest = max(matches, key=lambda r: r["id"])
    if latest.get("status") != "completed" or latest.get("conclusion") != "success":
        raise ValueError("Latest exact-SHA main CI is not green: " + str(latest.get("html_url")))
    return latest


def assert_draft_or_absent(releases, tag):
    matches = [release for release in releases if release.get('tag_name') == tag]
    if len(matches) > 1:
        raise ValueError('Ambiguous release identity')
    if matches and matches[0].get('draft') is not True:
        raise ValueError('Refusing to overwrite a published release')
    return matches[0] if matches else None


def resolve_remote_object(obj, fetch_annotation):
    visited = set()
    for _ in range(8):
        sha = obj.get('sha', '')
        if not re.fullmatch(r'[0-9a-f]{40}', sha) or sha in visited:
            raise ValueError('Invalid or cyclic remote tag object')
        if obj.get('type') == 'commit':
            return sha
        if obj.get('type') != 'tag':
            raise ValueError('Release tag does not resolve to a commit')
        visited.add(sha)
        obj = fetch_annotation(sha)['object']
    raise ValueError('Remote tag nesting limit exceeded')


def validate_remote_state(repo, tag, expected_sha):
    validate_tag(tag)
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Invalid repository identity')
    prefix = 'repos/' + repo
    ref = json.loads(run('gh', 'api', prefix + '/git/ref/tags/' + tag))
    actual = resolve_remote_object(ref['object'], lambda sha: json.loads(run('gh', 'api', prefix + '/git/tags/' + sha)))
    if actual != expected_sha:
        raise ValueError('Remote tag moved or does not match tested release SHA')
    pages = json.loads(run('gh', 'api', '--paginate', '--slurp', prefix + '/releases?per_page=100'))
    releases = [release for page in pages for release in page]
    return assert_draft_or_absent(releases, tag)


def main():
    tag = os.environ["RELEASE_TAG"]
    version = validate_tag(tag)
    repo = os.environ["RELEASE_REPOSITORY"]
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        raise ValueError("Invalid repository identity")
    sha = run("git", "rev-parse", "HEAD")
    tagged = run("git", "rev-parse", "refs/tags/" + tag + "^{commit}")
    if sha != tagged:
        raise ValueError("Checkout does not match existing release tag")
    subprocess.run(["git", "merge-base", "--is-ancestor", sha, "origin/main"], check=True)
    validate_remote_state(repo, tag, sha)
    for filename in ("package.json", "apps/gateway/package.json"):
        if json.loads(pathlib.Path(filename).read_text())["version"] != version:
            raise ValueError("Version mismatch in " + filename)
    response = json.loads(run("gh", "api", "repos/" + repo +
                              "/actions/workflows/ci.yml/runs?head_sha=" + sha + "&per_page=100"))
    ci = choose_green_ci(response["workflow_runs"], sha)
    jobs = json.loads(run("gh", "api", "repos/" + repo + "/actions/runs/" + str(ci["id"]) +
                         "/jobs?filter=latest&per_page=100"))
    expected = {"Typecheck", "Lint", "Unit tests", "Catalog sync check", "Build", "Security audit", "E2E (build, smoke)"}
    actual = {job["name"]: job["conclusion"] for job in jobs["jobs"]}
    if jobs["total_count"] != len(jobs["jobs"]) or not expected.issubset(actual):
        raise ValueError("Missing CI gate jobs")
    if any(actual[name] != "success" for name in expected):
        raise ValueError("Failed or skipped mandatory CI gate: " + str(actual))
    notes = extract_notes(pathlib.Path("docs/CHANGELOG.md").read_text(encoding="utf-8"), tag)
    pathlib.Path("release-notes.md").write_text(notes, encoding="utf-8")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write("version=" + tag + "\nsha=" + sha + "\n")
    print(json.dumps({"tag": tag, "sha": sha, "ci": ci["html_url"], "gates": actual}, indent=2))


if __name__ == "__main__":
    main()
