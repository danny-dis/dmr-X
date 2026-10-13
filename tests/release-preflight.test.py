"""Regression tests for release identity, changelog and mandatory CI gates."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("preflight", pathlib.Path(__file__).resolve().parents[1] / "scripts/release-preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class ReleasePreflightTests(unittest.TestCase):
    def test_accepts_stable_tag(self):
        self.assertEqual(preflight.validate_tag("v0.5.21"), "0.5.21")

    def test_rejects_unsafe_or_nonstable_tag(self):
        for tag in ("0.5.21", "v0.5.21;bad", "v0.5.21-rc1", "v0.5.21\n"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                preflight.validate_tag(tag)

    def test_extracts_only_exact_version_section(self):
        notes = "## v0.5.210 - other\n- wrong\n## v0.5.21 - release\n- right\n## v0.5.20\n- old"
        self.assertEqual(preflight.extract_notes(notes, "v0.5.21"), "## v0.5.21 - release\n- right\n")

    def test_missing_or_empty_changelog_fails_closed(self):
        for notes in ("## v0.5.20\n- old", "## v0.5.21\nplaceholder"):
            with self.subTest(notes=notes), self.assertRaises(ValueError):
                preflight.extract_notes(notes, "v0.5.21")

    def test_accepts_completed_green_main_push(self):
        run = dict(head_sha="abc", event="push", head_branch="main", id=1, status="completed", conclusion="success")
        self.assertEqual(preflight.choose_green_ci([run], "abc"), run)

    def test_rejects_failure_inprogress_and_skip(self):
        for conclusion, status in (("failure", "completed"), ("success", "in_progress"), ("skipped", "completed")):
            run = dict(head_sha="abc", event="push", head_branch="main", id=1, status=status, conclusion=conclusion)
            with self.subTest(conclusion=conclusion), self.assertRaises(ValueError):
                preflight.choose_green_ci([run], "abc")

    def test_unrelated_green_run_cannot_qualify(self):
        for overrides in ({"head_sha": "old"}, {"event": "pull_request"}, {"head_branch": "feature"}):
            run = dict(head_sha="abc", event="push", head_branch="main", id=1, status="completed", conclusion="success")
            run.update(overrides)
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                preflight.choose_green_ci([run], "abc")

    def test_newer_red_attempt_overrides_old_green(self):
        run = dict(head_sha="abc", event="push", head_branch="main", id=1, status="completed", conclusion="success")
        later = dict(run, id=2, conclusion="failure")
        with self.assertRaises(ValueError):
            preflight.choose_green_ci([run, later], "abc")


if __name__ == "__main__":
    unittest.main()
