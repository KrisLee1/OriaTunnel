#!/bin/bash

set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dmg_dir="$project_root/src-tauri/target/release/bundle/dmg"
installer_icon="$project_root/src-tauri/icons/installer-icon.icns"
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/oria-tunnel-package.XXXXXX")
marker="$work_dir/package-start"
touch "$marker"
trap 'rm -rf "$work_dir"' EXIT

cd "$project_root"
node "$project_root/scripts/icon.mjs"
node "$project_root/node_modules/@tauri-apps/cli/tauri.js" build --bundles app,dmg "$@"

dmg_path=$(find "$dmg_dir" -maxdepth 1 -type f -name 'OriaTunnel_*.dmg' -newer "$marker" -print | head -n 1)
if [[ -z "$dmg_path" ]]; then
  echo "Cannot find the newly generated OriaTunnel DMG" >&2
  exit 1
fi

bash "$project_root/scripts/set-dmg-volume-icon.sh" \
  "$dmg_path" \
  "$installer_icon"

swift "$project_root/scripts/set-file-icon.swift" \
  "$dmg_path" \
  "$installer_icon"

if ! xattr -p com.apple.FinderInfo "$dmg_path" >/dev/null 2>&1 || \
   ! xattr -p com.apple.ResourceFork "$dmg_path" >/dev/null 2>&1; then
  echo "The DMG was built, but its Finder file icon metadata is missing" >&2
  exit 1
fi

zip_path="${dmg_path%.dmg}.zip"
temporary_zip="$work_dir/$(basename "$zip_path")"

ditto -c -k --sequesterRsrc "$dmg_path" "$temporary_zip"
mv "$temporary_zip" "$zip_path"

echo "Finished $(basename "$dmg_path") with matching mounted-volume and Finder file icons."
echo "Created $(basename "$zip_path") with the Finder icon metadata preserved."
