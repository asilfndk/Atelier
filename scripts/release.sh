#!/usr/bin/env bash
# Local release: checks, live tests, package, verify, tag, push, publish.
#   npm run release              full release of the version in package.json
#   npm run release -- --dry-run stops before tagging; DMGs are left in $OUT
set -euo pipefail

dry=false
[[ "${1:-}" == "--dry-run" ]] && dry=true

version=$(node -p "require('./package.json').version")
tag="v$version"

# A dry run never tags, so it may run on any branch, with uncommitted work or an existing tag.
if ! $dry; then
  [[ "$(git branch --show-current)" == main ]] || { echo "release from main only" >&2; exit 1; }
  [[ -z "$(git status --porcelain)" ]] || { echo "working tree not clean" >&2; exit 1; }
  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "$tag already exists; bump version in package.json" >&2
    exit 1
  fi
fi

# iCloud Drive leaves "name 2" copies in synced folders; electron-builder's dependency
# walk hangs on them in node_modules, out/ copies would ship in the app, and
# Turbopack refuses to open a .next/cache holding one ("Unexpected file").
dupes=$(find node_modules out dist-electron .next \( -name "* [0-9]" -o -name "* [0-9].*" \) 2>/dev/null | head -3 || true)
if [[ -n "$dupes" ]]; then
  printf 'iCloud duplicates found, e.g.:\n%s\nrun: rm -rf node_modules out dist-electron .next && npm ci\n' "$dupes" >&2
  exit 1
fi

npm run check
npm run live-test
npm run scheduler-test

# Package outside iCloud Drive: its xattrs make codesign fail ("detritus not allowed").
OUT=$(mktemp -d "${TMPDIR:-/tmp}/atelier-release.XXXXXX")
$dry || trap 'rm -rf "$OUT"' EXIT
NODE_OPTIONS=--experimental-require-module npx electron-builder --mac --publish never \
  -c.directories.output="$OUT"

# The updater trusts latest-mac.yml, and afterPack only verifies signatures.
native=Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds
test "$(lipo -archs "$OUT/mac-arm64/Atelier.app/$native/darwin-arm64.node")" = arm64
test "$(lipo -archs "$OUT/mac/Atelier.app/$native/darwin-x64.node")" = x86_64
grep -qx "version: $version" "$OUT/latest-mac.yml"
test "$(grep -c 'url: .*\.dmg$' "$OUT/latest-mac.yml")" = 2

if $dry; then
  echo "dry run OK, artifacts in $OUT (delete when done, ~1.6 GB)"
  exit 0
fi

git tag "$tag"
git push origin main "$tag"
gh release create "$tag" "$OUT"/*.dmg "$OUT"/*.blockmap "$OUT/latest-mac.yml" \
  --title "Atelier $tag" --generate-notes --verify-tag --latest
gh release view "$tag"
