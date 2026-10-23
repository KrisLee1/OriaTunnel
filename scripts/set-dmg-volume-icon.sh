#!/bin/bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: set-dmg-volume-icon.sh <dmg-path> <icon.icns>" >&2
  exit 1
fi

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dmg_path=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
icon_path=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
expected_dmg_dir="$project_root/src-tauri/target/release/bundle/dmg"

if [[ ! -f "$dmg_path" || "$dmg_path" != "$expected_dmg_dir"/*.dmg ]]; then
  echo "DMG must be an existing release bundle under $expected_dmg_dir" >&2
  exit 1
fi
if [[ ! -f "$icon_path" || "${icon_path##*.}" != "icns" ]]; then
  echo "Installer volume icon must be an existing .icns file" >&2
  exit 1
fi

work_dir=$(mktemp -d "${TMPDIR:-/tmp}/oria-tunnel-dmg-icon.XXXXXX")
mount_dir="$work_dir/mount"
rw_dmg="$work_dir/read-write.dmg"
final_dmg="$work_dir/final.dmg"
mounted_device=""

cleanup() {
  if [[ -n "$mounted_device" ]]; then
    hdiutil detach "$mounted_device" >/dev/null 2>&1 || true
  fi
  rm -rf "$work_dir"
}
trap cleanup EXIT

mkdir -p "$mount_dir"
hdiutil convert "$dmg_path" -format UDRW -o "$rw_dmg" >/dev/null
attach_output=$(hdiutil attach -readwrite -noverify -noautoopen -nobrowse \
  -mountpoint "$mount_dir" "$rw_dmg")
mounted_device=$(printf '%s\n' "$attach_output" | awk '/^\/dev\// { print $1; exit }')
if [[ -z "$mounted_device" ]]; then
  echo "Cannot determine the mounted DMG device" >&2
  exit 1
fi

cp "$icon_path" "$mount_dir/.VolumeIcon.icns"
SetFile -c icnC "$mount_dir/.VolumeIcon.icns"
SetFile -a C "$mount_dir"
sync
hdiutil detach "$mounted_device" >/dev/null
mounted_device=""

hdiutil convert "$rw_dmg" -format UDZO -imagekey zlib-level=9 -o "$final_dmg" >/dev/null
mv "$final_dmg" "$dmg_path"
echo "Applied $(basename "$icon_path") to $(basename "$dmg_path") without changing the app icon."
