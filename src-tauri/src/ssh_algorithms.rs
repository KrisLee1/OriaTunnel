//! Apply source algorithm policy to the transport, never fall back on an empty set.
use crate::model::AlgorithmOptions;
use russh::{cipher, kex, mac, Preferred};

fn extension(name: &str) -> bool {
    name.starts_with("ext-info-") || name.starts_with("kex-strict-")
}

fn resolve<T: Clone + PartialEq + AsRef<str>>(
    expression: &str,
    defaults: &[T],
    parse: impl Fn(&str) -> Option<T>,
    directive: &str,
) -> Result<Vec<T>, String> {
    let (mode, list) = match expression.as_bytes().first() {
        Some(b'+' | b'-' | b'^') => (expression.as_bytes()[0], &expression[1..]),
        _ => (b'=', expression),
    };
    let names = list.split(',').collect::<Vec<_>>();
    if names.iter().any(|name| {
        name.is_empty()
            || !name.bytes().all(|c| {
                c.is_ascii_alphanumeric()
                    || b"@._-".contains(&c)
                    || (mode == b'-' && b"*?".contains(&c))
            })
    }) {
        return Err(format!("{directive}: 算法列表无效"));
    }
    let mut selected = Vec::new();
    if mode == b'-' {
        selected.extend(
            defaults
                .iter()
                .filter(|algorithm| {
                    !names.iter().any(|name| {
                        glob::Pattern::new(name).is_ok_and(|p| p.matches(algorithm.as_ref()))
                    })
                })
                .cloned(),
        );
    } else {
        if mode == b'+' {
            selected.extend_from_slice(defaults);
        }
        for algorithm in names.iter().filter_map(|name| parse(name)) {
            // Unsupported names are omitted from the permitted list. This can
            // narrow a policy but can never advertise an unconfigured algorithm.
            if !selected.contains(&algorithm) {
                selected.push(algorithm);
            }
        }
        if mode == b'^' {
            for algorithm in defaults {
                if !selected.contains(algorithm) {
                    selected.push(algorithm.clone());
                }
            }
        }
    }
    if selected.is_empty() {
        return Err(format!(
            "{directive}: 配置中没有当前 SSH 引擎可用的算法，已阻止连接"
        ));
    }
    Ok(selected)
}

fn apply(options: &AlgorithmOptions) -> (Preferred, Vec<(String, String)>) {
    // List modifiers apply to this engine's defaults, not an installed ssh binary.
    let mut preferred = Preferred::default();
    let mut errors = Vec::new();
    if let Some(expression) = &options.ciphers {
        match resolve(
            expression,
            &preferred.cipher,
            |name| {
                (name != "none")
                    .then(|| cipher::Name::try_from(name).ok())
                    .flatten()
            },
            "Ciphers",
        ) {
            Ok(names) => preferred.cipher = names.into(),
            Err(error) => errors.push(("ciphers".into(), error)),
        }
    }
    if let Some(expression) = &options.kex_algorithms {
        let defaults = preferred
            .kex
            .iter()
            .filter(|name| !extension(name.as_ref()))
            .cloned()
            .collect::<Vec<_>>();
        match resolve(
            expression,
            &defaults,
            |name| {
                (!extension(name) && name != "none")
                    .then(|| kex::Name::try_from(name).ok())
                    .flatten()
            },
            "KexAlgorithms",
        ) {
            Ok(mut names) => {
                // These are protocol capabilities, not selectable KEX methods.
                // Keep strict KEX and extension negotiation even for explicit lists.
                names.extend(
                    preferred
                        .kex
                        .iter()
                        .filter(|name| extension(name.as_ref()))
                        .cloned(),
                );
                preferred.kex = names.into();
            }
            Err(error) => errors.push(("kexalgorithms".into(), error)),
        }
    }
    if let Some(expression) = &options.macs {
        match resolve(
            expression,
            &preferred.mac,
            |name| {
                (name != "none")
                    .then(|| mac::Name::try_from(name).ok())
                    .flatten()
            },
            "MACs",
        ) {
            Ok(names) => preferred.mac = names.into(),
            Err(error) => errors.push(("macs".into(), error)),
        }
    }
    (preferred, errors)
}

pub fn diagnostics(options: &AlgorithmOptions) -> Vec<(String, String)> {
    apply(options).1
}

pub fn preferred(options: &AlgorithmOptions) -> Result<Preferred, String> {
    let (preferred, errors) = apply(options);
    if errors.is_empty() {
        Ok(preferred)
    } else {
        Err(errors
            .into_iter()
            .map(|(_, error)| error)
            .collect::<Vec<_>>()
            .join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_operations_preserve_order_deduplicate_and_never_broaden_explicit_policy() {
        let defaults = ["first", "second"];
        let parse = |name: &str| match name {
            "first" => Some("first"),
            "second" => Some("second"),
            "third" => Some("third"),
            _ => None,
        };
        for (expression, expected) in [
            ("second,unknown,second", vec!["second"]),
            ("+third,first", vec!["first", "second", "third"]),
            ("^third,second", vec!["third", "second", "first"]),
            ("-f*", vec!["second"]),
            ("-unknown", vec!["first", "second"]),
        ] {
            assert_eq!(
                resolve(expression, &defaults, parse, "test").unwrap(),
                expected
            );
        }
        for expression in [
            "unknown",
            "-*",
            "",
            "+",
            "^",
            "-",
            "first,",
            "first second",
            "*",
            "+*",
            "-bad[pattern",
        ] {
            assert!(
                resolve(expression, &defaults, parse, "test").is_err(),
                "{expression}"
            );
        }
    }

    #[test]
    fn explicit_policy_keeps_protocol_extensions_and_rejects_empty_intersections() {
        let options = AlgorithmOptions {
            ciphers: Some("aes128-ctr,unsupported-cipher".into()),
            kex_algorithms: Some("curve25519-sha256".into()),
            macs: Some("hmac-sha2-256".into()),
        };
        let selected = preferred(&options).unwrap();
        assert_eq!(selected.cipher.as_ref(), [cipher::AES_128_CTR]);
        assert_eq!(selected.mac.as_ref(), [mac::HMAC_SHA256]);
        assert_eq!(selected.kex[0], kex::CURVE25519);
        assert!(Preferred::default()
            .kex
            .iter()
            .filter(|n| extension(n.as_ref()))
            .all(|n| selected.kex.contains(n)));
        let bad = AlgorithmOptions {
            ciphers: Some("none".into()),
            kex_algorithms: Some("ext-info-c,kex-strict-c-v00@openssh.com".into()),
            macs: Some("-*".into()),
        };
        assert_eq!(diagnostics(&bad).len(), 3);
        assert!(preferred(&bad).is_err());
    }

    #[test]
    fn macos_crypto_preferences_are_prepended_to_engine_defaults() {
        let options = AlgorithmOptions {
            ciphers: Some("^aes128-gcm@openssh.com,aes256-gcm@openssh.com".into()),
            kex_algorithms: Some("^ecdh-sha2-nistp256".into()),
            macs: Some("^hmac-sha2-256-etm@openssh.com,hmac-sha2-256".into()),
        };
        let selected = preferred(&options).unwrap();
        assert_eq!(selected.cipher[0].as_ref(), "aes128-gcm@openssh.com");
        assert_eq!(selected.cipher[1].as_ref(), "aes256-gcm@openssh.com");
        assert_eq!(selected.kex[0].as_ref(), "ecdh-sha2-nistp256");
        assert_eq!(selected.mac[0].as_ref(), "hmac-sha2-256-etm@openssh.com");
        assert_eq!(selected.mac[1].as_ref(), "hmac-sha2-256");
        let defaults = Preferred::default();
        assert!(defaults.cipher.iter().all(|n| selected.cipher.contains(n)));
        assert!(defaults.kex.iter().all(|n| selected.kex.contains(n)));
        assert!(defaults.mac.iter().all(|n| selected.mac.contains(n)));
    }
}
