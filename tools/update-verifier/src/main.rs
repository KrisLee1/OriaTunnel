use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use std::{collections::HashMap, fs, path::Path};

fn decode(value: &str) -> Result<String, String> {
    if value.trim_start().starts_with("untrusted comment:") {
        return Ok(value.trim().into());
    }
    String::from_utf8(
        STANDARD
            .decode(value.trim())
            .map_err(|_| "Invalid signature encoding")?,
    )
    .map_err(|_| "Invalid signature text".into())
}

fn verify(
    bytes: &[u8],
    signature: &str,
    public_key: &str,
    version: &str,
    filename: Option<&str>,
) -> Result<(), String> {
    let key = PublicKey::decode(&decode(public_key)?).map_err(|_| "Invalid public key")?;
    let signature = Signature::decode(&decode(signature)?).map_err(|_| "Invalid signature")?;
    key.verify(bytes, &signature, true)
        .map_err(|_| "Signature does not match the artifact and configured public key")?;
    // Read the comment only after Minisign has authenticated its global signature.
    let field = |name: &str| {
        let prefix = format!("{name}:");
        let mut fields = signature
            .trusted_comment()
            .split('\t')
            .filter_map(|value| value.strip_prefix(&prefix));
        let first = fields.next();
        if fields.next().is_some() {
            None
        } else {
            first
        }
    };
    if field("version") != Some(version) {
        return Err("Signed version does not match the announced version".into());
    }
    if let Some(filename) = filename {
        if field("file") != Some(filename) {
            return Err("Signed filename does not match the artifact filename".into());
        }
    }
    Ok(())
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let mut values = HashMap::new();
    let mut filename_required = false;
    while let Some(arg) = args.next() {
        if arg == "--require-filename" {
            filename_required = true;
            continue;
        }
        if ![
            "--config",
            "--public-key-file",
            "--artifact",
            "--signature",
            "--version",
        ]
        .contains(&arg.as_str())
        {
            return Err("Unknown verifier argument".into());
        }
        if values
            .insert(arg, args.next().ok_or("Missing argument value")?)
            .is_some()
        {
            return Err("Duplicate argument".into());
        }
    }
    let get = |name: &str| {
        values
            .get(name)
            .map(String::as_str)
            .ok_or_else(|| format!("Missing {name}"))
    };
    let key = match (values.get("--config"), values.get("--public-key-file")) {
        (Some(config), None) => {
            let config: serde_json::Value = serde_json::from_slice(
                &fs::read(config).map_err(|_| "Cannot read public configuration")?,
            )
            .map_err(|_| "Invalid public configuration")?;
            config["plugins"]["updater"]["pubkey"]
                .as_str()
                .ok_or("Missing configured public key")?
                .to_string()
        }
        (None, Some(path)) => fs::read_to_string(path).map_err(|_| "Cannot read public key")?,
        _ => return Err("Provide exactly one public key source".into()),
    };
    let artifact = Path::new(get("--artifact")?);
    if fs::metadata(artifact)
        .map_err(|_| "Cannot inspect artifact")?
        .len()
        > 512 * 1024 * 1024
    {
        return Err("Artifact exceeds release size limit".into());
    }
    let bytes = fs::read(artifact).map_err(|_| "Cannot read artifact")?;
    let signature = fs::read_to_string(get("--signature")?).map_err(|_| "Cannot read signature")?;
    let version = get("--version")?;
    verify(
        &bytes,
        &signature,
        &key,
        version,
        if filename_required {
            Some(
                artifact
                    .file_name()
                    .and_then(|v| v.to_str())
                    .ok_or("Invalid artifact filename")?,
            )
        } else {
            None
        },
    )?;
    println!("{}", serde_json::json!({"verified":true,"version":version}));
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Update verification failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const KEY: &str = include_str!("../../../src-tauri/tests/fixtures/updater/public.key");
    const SIGNATURE: &str = include_str!("../../../src-tauri/tests/fixtures/updater/payload.sig");
    const PAYLOAD: &[u8] = include_bytes!("../../../src-tauri/tests/fixtures/updater/payload.txt");
    #[test]
    fn authenticates_artifact_and_version_before_trusting_comment() {
        assert!(verify(PAYLOAD, SIGNATURE, KEY, "0.2.0", Some("updater.txt")).is_ok());
        assert!(verify(b"tampered", SIGNATURE, KEY, "0.2.0", None).is_err());
        assert!(verify(PAYLOAD, SIGNATURE, KEY, "0.3.0", None).is_err());
        assert!(verify(PAYLOAD, SIGNATURE, KEY, "0.2.0", Some("renamed.exe")).is_err());
        let tampered = STANDARD.encode(
            decode(SIGNATURE)
                .unwrap()
                .replace("version:0.2.0", "version:0.3.0"),
        );
        assert!(verify(PAYLOAD, &tampered, KEY, "0.3.0", None).is_err());
    }
}
