#!/usr/bin/env python3
"""Generate static PWA branding from public/assets/ppms/theme.css.

Run after changing theme tokens. --check verifies generated assets without writes.
The live browser chrome reads the resolved palette directly through theme.js.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public" / "assets" / "ppms"


def generated_assets() -> dict[Path, str]:
    css = (ASSETS / "theme.css").read_text(encoding="utf-8")
    palette = dict(re.findall(r"^  --([a-z-]+):\s*(#[a-fA-F0-9]{6});$", css, re.M))
    required = ("primary", "canvas", "on-primary", "brand-detail")
    if any(key not in palette for key in required):
        raise ValueError("Theme is missing a required literal PWA color token")
    primary, canvas, foreground, detail = (palette[key] for key in required)
    manifest_path = ROOT / "public" / "manifest.webmanifest"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["background_color"] = canvas
    manifest["theme_color"] = primary
    outputs = {manifest_path: json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"}
    outputs[ASSETS / "icon-192.svg"] = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">'
        f'<rect width="192" height="192" rx="42" fill="{primary}"/>'
        '<path d="M57 47h44c31 0 48 14 48 40s-18 41-49 41H81v25H57V47zm24 23v35h19c16 0 24-5 24-18s-8-17-24-17H81z" '
        f'fill="{foreground}"/><rect x="121" y="135" width="20" height="20" rx="5" fill="{detail}"/></svg>\n'
    )
    outputs[ASSETS / "icon-512.svg"] = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">'
        f'<rect width="512" height="512" fill="{primary}"/>'
        '<path d="M165 129h102c74 0 113 35 113 96s-41 97-114 97h-43v61h-58V129zm58 55v84h44c38 0 56-13 56-43s-18-41-56-41h-44z" '
        f'fill="{foreground}"/><rect x="321" y="341" width="48" height="48" rx="12" fill="{detail}"/></svg>\n'
    )
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if generated assets need updating")
    args = parser.parse_args()
    stale = []
    for path, expected in generated_assets().items():
        if not path.exists() or path.read_text(encoding="utf-8") != expected:
            stale.append(str(path.relative_to(ROOT)))
            if not args.check:
                path.write_text(expected, encoding="utf-8")
    if args.check and stale:
        print("Theme assets are stale: " + ", ".join(stale), file=sys.stderr)
        print("Run python scripts/sync_theme_assets.py", file=sys.stderr)
        return 1
    print("PPMS theme assets are current." if args.check else "PPMS theme assets generated.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
