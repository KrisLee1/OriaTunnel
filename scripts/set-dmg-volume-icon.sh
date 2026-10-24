#!/bin/bash

set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: set-dmg-volume-icon.sh <dmg-path> <icon.icns> [stapled-app-path]" >&2
  exit 1
fi

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dmg_path=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
icon_path=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
dmg_dir=$(dirname "$dmg_path")
case "$dmg_dir" in
  "$project_root/src-tauri/target/release/bundle/dmg"|\
  "$project_root/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg"|\
  "$project_root/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg") ;;
  *) echo "DMG must be under a supported macOS release bundle directory." >&2; exit 1 ;;
esac
bundle_root=$(dirname "$dmg_dir")

if [[ ! -f "$dmg_path" || "$dmg_path" != *.dmg ]]; then
  echo "DMG must be an existing .dmg release bundle." >&2
  exit 1
fi
if [[ ! -f "$icon_path" || "${icon_path##*.}" != "icns" ]]; then
  echo "Installer volume icon must be an existing .icns file" >&2
  exit 1
fi
app_path="${3:-}"
if [[ -n "$app_path" && ( "$app_path" != "$bundle_root/macos/OriaTunnel.app" || ! -d "$app_path" ) ]]; then
  echo "The stapled app must be the OriaTunnel.app from the same release bundle directory." >&2
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
if [[ -n "$app_path" ]]; then
  if [[ ! -d "$mount_dir/OriaTunnel.app" || -L "$mount_dir/OriaTunnel.app" ]]; then
    echo "Cannot replace the app: the mounted image does not contain the expected app bundle." >&2
    exit 1
  fi
  rm -rf "$mount_dir/OriaTunnel.app"
  ditto "$app_path" "$mount_dir/OriaTunnel.app"
fi
SetFile -c icnC "$mount_dir/.VolumeIcon.icns"
SetFile -a C "$mount_dir"
sync
hdiutil detach "$mounted_device" >/dev/null
mounted_device=""

hdiutil convert "$rw_dmg" -format UDZO -imagekey zlib-level=9 -o "$final_dmg" >/dev/null
mv "$final_dmg" "$dmg_path"
echo "Applied $(basename "$icon_path") to $(basename "$dmg_path") without changing the app icon."
