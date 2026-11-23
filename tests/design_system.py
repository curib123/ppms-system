"""Guard the shared PPMS theme and offline asset graph without a build tool."""
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'public/assets/ppms'
COLORS = re.compile(r'#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color)\(')


def main():
    errors = []
    stylesheets = list(ASSETS.glob('*.css'))
    for path in stylesheets:
        text = path.read_text()
        if path.name != 'theme.css' and COLORS.search(text):
            errors.append(f'{path.name}: color literals must be defined in theme.css')
        if len(text.splitlines()) >= 1000:
            errors.append(f'{path.name}: split stylesheets into focused modules')
    for path in (ROOT / 'application/views').rglob('*.php'):
        text = path.read_text()
        if re.search(r'(?:color|background|border)[^;\n]*#[0-9a-fA-F]{3,8}\b', text):
            errors.append(f'{path.relative_to(ROOT)}: inline colors bypass the shared theme')

    css = '\n'.join(path.read_text() for path in stylesheets)
    declared = set(re.findall(r'(--[\w-]+)\s*:', css))
    scripts = '\n'.join(path.read_text() for path in ASSETS.glob('*.js'))
    declared.update(re.findall(r'setProperty\([\s\n]*[\'"](--[\w-]+)', scripts))
    for token, fallback in re.findall(r'var\((--[\w-]+)\s*(,?)', css):
        if token not in declared and not fallback:
            errors.append(f'Undefined design token: {token}')

    # Every CSS import and application module must remain usable after reconnect
    # or an offline reload; a new visual component cannot become a network dependency.
    shell = (ROOT / 'public/sw.js').read_text()
    cached = set(re.findall(r"['\"](assets/ppms/[^'\"]+)['\"]", shell))
    for path in [*stylesheets, *ASSETS.glob('*.js')]:
        if f'assets/ppms/{path.name}' not in cached:
            errors.append(f'{path.name}: missing from offline shell cache')
        if path.suffix == '.css':
            for imported in re.findall(r'@import\s+(?:url\()?\s*[\'"]([^\'"]+)', path.read_text()):
                if not (path.parent / imported).is_file():
                    errors.append(f'{path.name}: missing stylesheet import {imported}')

    for path in [*ASSETS.glob('*.js'), ROOT / 'public/sw.js',
                 *(ROOT / 'tests').glob('*_browser.mjs')]:
        result = subprocess.run(['node', '--check', str(path)], capture_output=True, text=True)
        if result.returncode:
            errors.append(result.stderr)

    generated = subprocess.run(
        [sys.executable, 'scripts/sync_theme_assets.py', '--check'],
        cwd=ROOT, capture_output=True, text=True,
    )
    if generated.returncode:
        errors.append(generated.stdout + generated.stderr)
    if errors:
        for error in sorted(set(errors)):
            print(error, file=sys.stderr)
        return 1
    print('Shared theme, color tokens, generated assets, offline imports and JavaScript syntax passed.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
