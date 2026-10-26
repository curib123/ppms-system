"""Exercise quality checks using disposable sources and real subprocess failures."""
import importlib.util
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('check_quality', ROOT / 'scripts/check_quality.py')
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


class QualityChecks(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='ppms_quality_')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        subprocess.run(['git', 'init', '--quiet', str(self.root)], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Quality test',
                        '-c', 'user.email=quality@example.test', 'commit', '--quiet',
                        '--allow-empty', '-m', 'empty fixture'], check=True)

    def source(self, name, content, tracked=True):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')
        if tracked:
            subprocess.run(['git', '-C', str(self.root), 'add', '--', name], check=True)
        return path

    def analyzer(self, evaluation, version='0.14.0'):
        helper = self.root / 'analyzer.py'
        helper.write_text('import json, os, sys\nfrom pathlib import Path\n'
                          "if '--version' in sys.argv:\n"
                          '    print(' + repr('topos ' + version) + ')\n'
                          '    raise SystemExit(0)\n' + evaluation, encoding='utf-8')
        return [sys.executable, '-X', 'utf8', str(helper)]

    def test_only_first_party_tracked_sources_are_checked(self):
        self.source('application/controllers/Example.php', '<?php echo 1;')
        self.source('scripts/example.py', 'value = 1\n')
        self.source('public/assets/js/example.js', 'const value = 1;')
        for name in ('system/Framework.php', 'application/third_party/vendor.php',
                     'public/assets/vendor/library.js', 'application/config/local.php',
                     'application/cache/data.php', 'application/logs/export.py',
                     'application/sessions/session.php', 'public/assets/generated/bundle.js',
                     'public/assets/dist/bundle.js', 'scripts/node_modules/library.js'):
            self.source(name, 'excluded fixture')
        self.source('tests/untracked.py', 'untracked fixture', tracked=False)
        names = [path.as_posix() for path in quality.tracked_sources(self.root)]
        self.assertEqual(names, ['application/controllers/Example.php',
                                'public/assets/js/example.js', 'scripts/example.py'])

    def test_invalid_php_fails_the_check(self):
        php = shutil.which('php')
        if not php:
            self.skipTest('PHP is required for the real syntax-failure check')
        self.source('application/controllers/Broken.php', '<?php function broken( {')
        with self.assertRaisesRegex(RuntimeError, 'Broken.php'):
            quality.lint(self.root, quality.tracked_sources(self.root), php)

    def test_invalid_python_fails_the_check(self):
        self.source('scripts/broken.py', 'def broken(:\n')
        with self.assertRaisesRegex(RuntimeError, 'broken.py'):
            quality.lint(self.root, quality.tracked_sources(self.root), 'unused-php')

    def test_analyzer_failure_is_not_reported_as_success(self):
        self.source('scripts/example.py', 'value = 1\n')
        command = [sys.executable, '-c', 'raise SystemExit(7)']
        with self.assertRaisesRegex(RuntimeError, 'Topos'):
            quality.run_topos(self.root, quality.tracked_sources(self.root), command)

    def test_evaluation_failure_after_valid_version_is_not_success(self):
        self.source('scripts/example.py', 'value = 1\n')
        command = self.analyzer("print('analysis failed', file=sys.stderr)\nraise SystemExit(7)\n")
        with self.assertRaisesRegex(RuntimeError, 'analysis failed'):
            quality.run_topos(self.root, quality.tracked_sources(self.root), command)
        self.assertFalse((self.root / '.quality/topos.json').exists())

    def test_wrong_analyzer_version_is_rejected(self):
        self.source('scripts/example.py', 'value = 1\n')
        with self.assertRaisesRegex(RuntimeError, 'version mismatch'):
            quality.run_topos(self.root, quality.tracked_sources(self.root),
                              self.analyzer('raise SystemExit(0)\n', version='0.13.0'))
        self.assertFalse((self.root / '.quality/topos.json').exists())

    def test_unparseable_source_does_not_report_success(self):
        self.source('scripts/example.py', 'value = 1\n')
        result = {'version': '0.14.0', 'results': [
            {'file': 'scripts/example.py', 'is_parseable': False}]}
        with self.assertRaisesRegex(RuntimeError, 'could not parse'):
            quality.run_topos(self.root, quality.tracked_sources(self.root),
                              self.analyzer('print(' + repr(json.dumps(result)) + ')\n'))

    def test_wrong_and_duplicate_file_coverage_is_rejected(self):
        self.source('scripts/example.py', 'value = 1\n')
        self.source('scripts/second.py', 'value = 2\n')
        for files in (['scripts/example.py', 'scripts/other.py'],
                      ['scripts/example.py', 'scripts/example.py']):
            with self.subTest(files=files):
                result = {'version': '0.14.0', 'results': [
                    {'file': name, 'is_parseable': True} for name in files]}
                with self.assertRaisesRegex(RuntimeError, 'coverage'):
                    quality.run_topos(self.root, quality.tracked_sources(self.root),
                                      self.analyzer('print(' + repr(json.dumps(result)) + ')\n'))
                self.assertFalse((self.root / '.quality/topos.json').exists())

    def test_source_changed_during_analysis_is_rejected(self):
        self.source('scripts/example.py', 'value = 1\n')
        result = {'version': '0.14.0', 'results': [
            {'file': 'scripts/example.py', 'is_parseable': True}]}
        command = self.analyzer("Path('scripts/example.py').write_text('value = 2\\n', encoding='utf-8')\n"
                                'print(' + repr(json.dumps(result)) + ')\n')
        with self.assertRaisesRegex(RuntimeError, 'changed during analysis'):
            quality.run_topos(self.root, quality.tracked_sources(self.root), command)
        self.assertFalse((self.root / '.quality/topos.json').exists())

    def test_report_uses_metadata_from_before_analysis(self):
        self.source('scripts/example.py', 'value = 1\n')
        result = {'version': '0.14.0', 'results': [
            {'file': 'scripts/example.py', 'is_parseable': True}]}
        command = self.analyzer("Path('analysis-created.txt').write_text('temporary output', encoding='utf-8')\n"
                                'print(' + repr(json.dumps(result)) + ')\n')
        subprocess.run(['git', '-C', str(self.root), 'add', '--', 'analyzer.py'], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Quality test',
                        '-c', 'user.email=quality@example.test', 'commit', '--quiet', '-m', 'fixture'], check=True)
        revision = subprocess.run(['git', '-C', str(self.root), 'rev-parse', 'HEAD'],
                                  capture_output=True, text=True, check=True).stdout.strip()
        report = quality.run_topos(self.root, quality.tracked_sources(self.root), command)
        self.assertEqual(report['source_revision'], revision)
        self.assertFalse(report['working_tree_dirty'])

    def test_update_notices_are_disabled_for_version_and_evaluation(self):
        self.source('scripts/example.py', 'value = 1\n')
        result = {'version': '0.14.0', 'results': [
            {'file': 'scripts/example.py', 'is_parseable': True}]}
        command = self.analyzer('print(' + repr(json.dumps(result)) + ')\n')
        helper = Path(command[-1])
        code = helper.read_text(encoding='utf-8')
        helper.write_text(code.replace("if '--version' in sys.argv:",
                          "assert os.environ.get('TOPOS_NO_UPDATE_NOTICES') == '1'\n"
                          "if '--version' in sys.argv:"), encoding='utf-8')
        report = quality.run_topos(self.root, quality.tracked_sources(self.root), command)
        self.assertEqual(report['analysis'], result)

    def test_php_is_not_sent_to_topos(self):
        self.source('application/controllers/Example.php', '<?php echo 1;')
        with self.assertRaisesRegex(RuntimeError, 'no supported'):
            quality.run_topos(self.root, quality.tracked_sources(self.root), ['unused-topos'])

    def test_empty_analyzer_results_do_not_claim_coverage(self):
        self.source('scripts/example.py', 'value = 1\n')
        helper = self.root / 'analyzer.py'
        helper.write_text("import sys\nprint('topos 0.14.0' if '--version' in sys.argv else "
                          "'{\"version\":\"0.14.0\",\"results\":[]}')\n", encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, 'coverage'):
            quality.run_topos(self.root, quality.tracked_sources(self.root), [sys.executable, str(helper)])

    def test_malformed_analyzer_json_fails(self):
        self.source('scripts/example.py', 'value = 1\n')
        helper = self.root / 'analyzer.py'
        helper.write_text("import sys\nprint('topos 0.14.0' if '--version' in sys.argv else 'invalid-json')\n", encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, 'invalid JSON'):
            quality.run_topos(self.root, quality.tracked_sources(self.root), [sys.executable, str(helper)])

    def test_report_preserves_utf8_and_identifies_actual_sources(self):
        source = self.source('scripts/example.py', 'value = 1\n')
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Quality test',
                        '-c', 'user.email=quality@example.test', 'commit', '--quiet', '-m', 'test fixture'], check=True)
        analysis = {'version': '0.14.0', 'results': [{'file': 'scripts/example.py',
                    'is_parseable': True, 'advisories': ['reviewed \u201d']}]}
        helper = self.root / 'analyzer.py'
        helper.write_text("import sys\nprint('topos 0.14.0' if '--version' in sys.argv else "
                          + repr(json.dumps(analysis, ensure_ascii=False)) + ')\n', encoding='utf-8')
        report = quality.run_topos(self.root, quality.tracked_sources(self.root),
                                   [sys.executable, '-X', 'utf8', str(helper)])
        self.assertEqual(report['analysis'], analysis)
        self.assertEqual(report['source_sha256']['scripts/example.py'], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertTrue(report['working_tree_dirty'])
        self.assertFalse(report['php_supported'])
        self.assertFalse(report['composable_enabled'])
        self.assertEqual(json.loads((self.root / '.quality/topos.json').read_text(encoding='utf-8')), report)


if __name__ == '__main__':
    unittest.main(verbosity=2)
