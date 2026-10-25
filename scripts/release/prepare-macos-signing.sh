#!/bin/bash
set -euo pipefail
for name in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [[ -z "${!name:-}" ]]; then echo "Missing required macOS secret: $name" >&2; exit 1; fi
done
signing_dir="$RUNNER_TEMP/oria-release-signing"
mkdir -m 700 "$signing_dir"
keychain="$signing_dir/build.keychain-db"
keychain_password=$(openssl rand -hex 32)
echo "::add-mask::$keychain_password"
security list-keychains -d user > "$signing_dir/original-keychains.txt"
security default-keychain -d user > "$signing_dir/original-default.txt"
export ORIA_CERTIFICATE_PATH="$signing_dir/certificate.p12"
node --input-type=module -e 'import fs from "node:fs"; fs.writeFileSync(process.env.ORIA_CERTIFICATE_PATH, Buffer.from(process.env.APPLE_CERTIFICATE, "base64"), {mode:0o600});'
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$ORIA_CERTIFICATE_PATH" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security -t cert -f pkcs12 -k "$keychain" >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" /Library/Keychains/System.keychain
security default-keychain -d user -s "$keychain"
rm -f "$ORIA_CERTIFICATE_PATH"
# The profile lives only in this runner's disposable keychain.
xcrun notarytool store-credentials OriaTunnel-CI --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --keychain "$keychain" >/dev/null
printf 'ORIATUNNEL_APPLE_TEAM_ID=%s\nORIATUNNEL_NOTARY_PROFILE=OriaTunnel-CI\n' "$APPLE_TEAM_ID" >> "$GITHUB_ENV"
