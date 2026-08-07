#!/usr/bin/env bash
# Pack a Chrome-ready MV3 zip (manifest.json at the archive root).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

version="$(node -p "require('./manifest.json').version")"
out_dir="${OUT_DIR:-dist}"
mkdir -p "$out_dir"
zip_name="vikunja-chrome-${version}.zip"
zip_path="${out_dir}/${zip_name}"

rm -f "$zip_path"
zip -r "$zip_path" \
  manifest.json \
  background \
  capture \
  content \
  icons \
  lib \
  options \
  popup \
  styles \
  _locales \
  -x 'icons/icon.svg' \
  -x '**/.DS_Store' \
  -x '**/.*'

echo "$zip_path"
