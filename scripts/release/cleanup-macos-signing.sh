#!/bin/bash
set -euo pipefail
signing_dir="$RUNNER_TEMP/oria-release-signing"
if [[ -f "$signing_dir/original-default.txt" ]]; then
  original_default=$(cat "$signing_dir/original-default.txt")
  original_default="${original_default#*\"}"; original_default="${original_default%\"*}"
  [[ -z "$original_default" ]] || security default-keychain -d user -s "$original_default"
fi
if [[ -f "$signing_dir/original-keychains.txt" ]]; then
  original=()
  while IFS= read -r line; do
    line="${line#*\"}"; line="${line%\"*}"
    [[ -n "$line" ]] && original+=("$line")
  done < "$signing_dir/original-keychains.txt"
  [[ ${#original[@]} -eq 0 ]] || security list-keychains -d user -s "${original[@]}"
fi
security delete-keychain "$signing_dir/build.keychain-db" >/dev/null 2>&1 || true
rm -rf "$signing_dir"
