import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


scanner = load("comment_scanner_under_test", "comment_scanner.py")
ratchet = load("check_comment_ratchet_under_test", "check-comment-ratchet.py")


class TestPythonCounting(unittest.TestCase):
    def test_counts_line_comments(self):
        self.assertEqual(scanner.count("a.py", "# one\nx = 1  # two\ny = 2\n"), 2)

    def test_counts_a_module_docstring_over_every_line_it_spans(self):
        text = '"""One.\n\nTwo.\n"""\n\nX = 1\n'
        self.assertEqual(scanner.count("a.py", text), 4)

    def test_counts_a_function_docstring(self):
        text = 'def f():\n    """Return one."""\n    return 1\n'
        self.assertEqual(scanner.count("a.py", text), 1)

    def test_a_multi_line_string_value_is_not_a_comment(self):
        text = 'SCHEMA = {\n    "example": """\nline one\nline two\n""",\n}\n'
        self.assertEqual(scanner.count("a.py", text), 0)

    def test_a_hash_inside_a_string_is_not_a_comment(self):
        self.assertEqual(scanner.count("a.py", 'colour = "#ff0000"\n'), 0)

    def test_a_shebang_is_not_counted(self):
        self.assertEqual(scanner.count("a.py", "#!/usr/bin/env python3\nX = 1\n"), 0)

    def test_unparseable_python_falls_back_to_prefixes(self):
        self.assertEqual(scanner.count("a.py", "# one\ndef broken(:\n"), 1)


class TestCurlyCounting(unittest.TestCase):
    def test_counts_line_and_block_comments(self):
        text = "// one\nconst a = 1\n/* two\n   three */\n"
        self.assertEqual(scanner.count("a.ts", text), 3)

    def test_a_url_in_a_string_is_not_a_comment(self):
        self.assertEqual(scanner.count("a.ts", 'const u = "https://example.org/x"\n'), 0)

    def test_a_slash_slash_inside_a_template_literal_is_not_a_comment(self):
        self.assertEqual(scanner.count("a.ts", "const u = `see // here`\n"), 0)

    def test_a_regex_literal_is_not_a_comment(self):
        self.assertEqual(scanner.count("a.ts", "const re = /a\\/\\/b/\nconst b = 2\n"), 0)

    def test_a_jsx_block_comment_counts(self):
        self.assertEqual(scanner.count("a.tsx", "<div>\n  {/* why */}\n</div>\n"), 1)

    def test_css_counts_only_block_comments(self):
        self.assertEqual(scanner.count("a.css", "/* one\n * two */\n.a { color: red }\n"), 2)

    def test_a_css_url_is_not_a_comment(self):
        self.assertEqual(scanner.count("a.css", '.a { background: url("//cdn/x.png") }\n'), 0)


class TestHashCounting(unittest.TestCase):
    def test_counts_shell_comments(self):
        self.assertEqual(scanner.count("a.sh", "# one\necho hi  # two\n"), 2)

    def test_parameter_expansion_is_not_a_comment(self):
        self.assertEqual(scanner.count("a.sh", 'echo "${VAR#prefix}"\n'), 0)

    def test_yaml_comments_count(self):
        self.assertEqual(scanner.count("a.yaml", "# one\nkey: value # two\n"), 2)

    def test_a_hash_inside_a_yaml_string_is_not_a_comment(self):
        self.assertEqual(scanner.count("a.yaml", 'key: "value # not a comment"\n'), 0)


class TestSqlCounting(unittest.TestCase):
    def test_counts_dash_comments(self):
        self.assertEqual(scanner.count("a.sql", "-- one\nselect 1\n"), 1)

    def test_a_dash_inside_a_string_is_not_a_comment(self):
        self.assertEqual(scanner.count("a.sql", "select '-- not a comment'\n"), 0)


class TestSupportedPaths(unittest.TestCase):
    def test_markdown_is_not_scanned(self):
        self.assertFalse(scanner.supports("docs/x.md"))

    def test_json_is_not_scanned(self):
        self.assertFalse(scanner.supports("package.json"))

    def test_a_dockerfile_is_scanned_by_name(self):
        self.assertTrue(scanner.supports("docker/Dockerfile"))
        self.assertTrue(scanner.supports("docker/Dockerfile.dev"))


class TestClassification(unittest.TestCase):
    def test_a_file_absent_from_the_baseline_is_new(self):
        new, grew, zeroed, improved = ratchet.classify({"a.py": 1}, {})
        self.assertEqual(new, [("a.py", 1)])
        self.assertEqual((grew, zeroed, improved), ([], [], []))

    def test_a_file_over_its_count_grew(self):
        new, grew, zeroed, improved = ratchet.classify({"a.py": 3}, {"a.py": 2})
        self.assertEqual(grew, [("a.py", 3, 2)])
        self.assertEqual((new, zeroed, improved), ([], [], []))

    def test_a_file_that_reached_zero_is_stale(self):
        new, grew, zeroed, improved = ratchet.classify({}, {"a.py": 2})
        self.assertEqual(zeroed, [("a.py", 2)])

    def test_a_file_under_its_count_is_improved_and_not_a_failure(self):
        new, grew, zeroed, improved = ratchet.classify({"a.py": 1}, {"a.py": 2})
        self.assertEqual(improved, [("a.py", 1, 2)])
        self.assertEqual((new, grew, zeroed), ([], [], []))

    def test_holding_its_count_is_silent(self):
        self.assertEqual(ratchet.classify({"a.py": 2}, {"a.py": 2}), ([], [], [], []))

    def test_a_recorded_file_this_tree_does_not_have_is_not_stale(self):
        new, grew, zeroed, improved = ratchet.classify({}, {"ci/deploy.yaml": 4}, seen=set())
        self.assertEqual((new, grew, zeroed, improved), ([], [], [], []))

    def test_a_recorded_file_this_tree_does_have_is_stale_at_zero(self):
        new, grew, zeroed, improved = ratchet.classify({}, {"a.py": 4}, seen={"a.py"})
        self.assertEqual(zeroed, [("a.py", 4)])


class TestPathsThatDifferBetweenTheTrees(unittest.TestCase):
    def test_the_skip_list_comes_from_both_parity_exception_lists(self):
        exceptions = load("public_tree_parity_exceptions_under_test", "public_tree_parity_exceptions.py")
        declared = list(exceptions.COMMUNITY_ONLY_PATHS) + list(exceptions.DIVERGENT_PATHS)
        self.assertEqual(
            ratchet.paths_that_differ_between_the_trees(),
            frozenset(path for path, _reason in declared),
        )

    def test_a_divergent_path_is_skipped_rather_than_recorded(self):
        baseline = load("comment_baseline_skip_check", "comment_baseline.py")
        for path in ratchet.paths_that_differ_between_the_trees():
            self.assertNotIn(path, baseline.BASELINE)


class TestExclusions(unittest.TestCase):
    def test_every_excluded_prefix_carries_a_reason(self):
        for prefix, reason in ratchet.NOT_WRITTEN_BY_HAND:
            self.assertTrue(prefix.endswith("/"), prefix)
            self.assertGreater(len(reason), 20, prefix)

    def test_the_excluded_prefixes_are_the_declared_ones(self):
        self.assertEqual(
            ratchet.excluded_prefixes(),
            tuple(prefix for prefix, _ in ratchet.NOT_WRITTEN_BY_HAND),
        )


class TestBaselineIsCurrent(unittest.TestCase):
    def test_the_baseline_module_parses_and_agrees_with_its_own_totals(self):
        baseline = load("comment_baseline_under_test", "comment_baseline.py")
        self.assertEqual(len(baseline.BASELINE), baseline.FILES_WITH_COMMENTS)
        self.assertEqual(sum(baseline.BASELINE.values()), baseline.COMMENT_LINES)
        self.assertGreater(baseline.FILES_SCANNED, ratchet.MIN_SCANNED_FILES)


if __name__ == "__main__":
    unittest.main()
