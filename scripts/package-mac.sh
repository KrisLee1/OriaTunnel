#!/bin/bash

set -euo pipefail

signed=false
build_target=""
if [[ "${1:-}" == "--signed" ]]; then
  signed=true
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target)
        if [[ $# -lt 2 || -n "$build_target" ]]; then
          echo "Specify --target once, followed by a macOS target triple." >&2
          exit 1
        fi
        build_target="$2"
        case "$build_target" in
          aarch64-apple-darwin|x86_64-apple-darwin) ;;
          *) echo "Signed packaging supports aarch64-apple-darwin and x86_64-apple-darwin." >&2; exit 1 ;;
        esac
        shift 2
        ;;
      *) echo "Unsupported signed packaging argument: $1" >&2; exit 1 ;;
    esac
  done
  if [[ -n "${CARGO_TARGET_DIR:-}" || -n "${CARGO_BUILD_TARGET:-}" ]]; then
    echo "Cargo target overrides are not supported; select the architecture with --target." >&2
    exit 1
  fi
fi

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
bundle_root="$project_root/src-tauri/target${build_target:+/$build_target}/release/bundle"
dmg_dir="$bundle_root/dmg"
app_path="$bundle_root/macos/OriaTunnel.app"
installer_icon="$project_root/src-tauri/icons/installer-icon.icns"
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/oria-tunnel-package.XXXXXX")
marker="$work_dir/package-start"
touch "$marker"
trap 'rm -rf "$work_dir"' EXIT

if $signed; then
  team_id="${ORIATUNNEL_APPLE_TEAM_ID:-67577AA9ZH}"
  notary_profile="${ORIATUNNEL_NOTARY_PROFILE:-OriaTunnel-notary}"
  notary_timeout="${ORIATUNNEL_NOTARY_TIMEOUT:-15m}"
  if [[ ! "$team_id" =~ ^[A-Z0-9]{10}$ ]]; then
    echo "ORIATUNNEL_APPLE_TEAM_ID must be a 10-character Apple Team ID." >&2
    exit 1
  fi
  identities=$(security find-identity -v -p codesigning)
  matching_identities=()
  while IFS= read -r identity; do
    if [[ "$identity" == "Developer ID Application: "* && "$identity" == *" ($team_id)" ]]; then
      if [[ -z "${APPLE_SIGNING_IDENTITY:-}" || "$identity" == "$APPLE_SIGNING_IDENTITY" ]]; then
        matching_identities+=("$identity")
      fi
    fi
  done < <(printf '%s\n' "$identities" | awk -F '"' 'NF >= 3 { print $2 }')
  if [[ ${#matching_identities[@]} -ne 1 ]]; then
    echo "Expected one valid Developer ID Application identity for $team_id. Install its certificate and private key, or select it with APPLE_SIGNING_IDENTITY." >&2
    exit 1
  fi
  export APPLE_SIGNING_IDENTITY="${matching_identities[0]}"
  xcrun notarytool history --keychain-profile "$notary_profile" >/dev/null
  echo "Signing with $APPLE_SIGNING_IDENTITY; notarization profile: $notary_profile"
  node --input-type=module -e '
    import { writeFileSync } from "node:fs";
    writeFileSync(process.argv[1], JSON.stringify({ bundle: {
      createUpdaterArtifacts: false,
      macOS: { signingIdentity: process.env.APPLE_SIGNING_IDENTITY, hardenedRuntime: true }
    } }));
  ' "$work_dir/signing.json"
  evidence_dir="$project_root/outputs/macos-signing/$(date -u +%Y%m%dT%H%M%SZ)-${build_target:-native}-$$"
  mkdir -p "$evidence_dir"
fi

notarize() {
  local payload="$1" label="$2" submission_id
  # Keep submission IDs even if waiting times out, so the same upload can be resumed.
  xcrun notarytool submit "$payload" --keychain-profile "$notary_profile" \
    --output-format json > "$evidence_dir/$label-submit.json"
  submission_id=$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const result = JSON.parse(readFileSync(process.argv[1], "utf8"));
    if (!result.id) process.exit(1);
    console.log(result.id);
  ' "$evidence_dir/$label-submit.json")
  echo "Submitted $label: $submission_id (receipt: $evidence_dir/$label-submit.json)"
  if ! xcrun notarytool wait "$submission_id" --keychain-profile "$notary_profile" \
    --timeout "$notary_timeout" --output-format json > "$evidence_dir/$label-result.json"; then
    echo "Notarization has not completed successfully. Inspect submission $submission_id before uploading again." >&2
    return 1
  fi
  if ! node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const result = JSON.parse(readFileSync(process.argv[1], "utf8"));
    console.log(`Notarization: ${result.status}`);
    if (result.status !== "Accepted") process.exit(1);
  ' "$evidence_dir/$label-result.json"; then
    xcrun notarytool log "$submission_id" --keychain-profile "$notary_profile" \
      "$evidence_dir/$label-log.json" || true
    return 1
  fi
}

cd "$project_root"
node "$project_root/scripts/icon.mjs"
if $signed; then
  build_args=(--bundles app,dmg --config "$work_dir/signing.json")
  if [[ -n "$build_target" ]]; then
    build_args+=(--target "$build_target")
  fi
  # Notarize explicitly after signing; never extract a password from the keychain.
  env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_API_KEY -u APPLE_API_KEY_PATH -u APPLE_API_ISSUER \
    node "$project_root/node_modules/@tauri-apps/cli/tauri.js" build "${build_args[@]}"
else
  node "$project_root/node_modules/@tauri-apps/cli/tauri.js" build --bundles app,dmg "$@"
fi

dmg_path=$(find "$dmg_dir" -maxdepth 1 -type f -name 'OriaTunnel_*.dmg' -newer "$marker" -print | head -n 1)
if [[ -z "$dmg_path" ]]; then
  echo "Cannot find the newly generated OriaTunnel DMG" >&2
  exit 1
fi

if $signed; then
  case "$build_target" in
    x86_64-apple-darwin) expected_arch=x86_64 ;;
    aarch64-apple-darwin) expected_arch=arm64 ;;
    *) expected_arch=$(uname -m) ;;
  esac
  actual_arch=$(lipo -archs "$app_path/Contents/MacOS/oria-tunnel")
  if [[ "$actual_arch" != "$expected_arch" ]]; then
    echo "App architecture mismatch: expected $expected_arch, found $actual_arch." >&2
    exit 1
  fi
  codesign --verify --deep --strict --verbose=2 "$app_path"
  ditto -c -k --keepParent "$app_path" "$work_dir/OriaTunnel-notarization.zip"
  notarize "$work_dir/OriaTunnel-notarization.zip" app
  xcrun stapler staple "$app_path"
  xcrun stapler validate "$app_path"
  spctl --assess --type execute --verbose=2 "$app_path"
  # Copy the stapled App into the image before final DMG signing and notarization.
  bash "$project_root/scripts/set-dmg-volume-icon.sh" "$dmg_path" "$installer_icon" "$app_path"
else
  bash "$project_root/scripts/set-dmg-volume-icon.sh" "$dmg_path" "$installer_icon"
fi

swift "$project_root/scripts/set-file-icon.swift" \
  "$dmg_path" \
  "$installer_icon"

if $signed; then
  codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$dmg_path"
  codesign --verify --strict --verbose=2 "$dmg_path"
  notarize "$dmg_path" dmg
  xcrun stapler staple "$dmg_path"
  xcrun stapler validate "$dmg_path"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg_path"
fi

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
