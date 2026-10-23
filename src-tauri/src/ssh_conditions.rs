//! Match evaluation without shell, DNS, network interfaces, or command execution.
use std::collections::BTreeMap;
pub struct Outcome {
    pub active: bool,
    pub final_pass: bool,
    pub unsupported: bool,
}
fn pattern_list(patterns: &str, value: &str, ignore_case: bool) -> bool {
    let mut positive = false;
    for pattern in patterns.split(',') {
        let (negative, pattern) = pattern
            .strip_prefix('!')
            .map_or((false, pattern), |p| (true, p));
        let (pattern, value) = if ignore_case {
            (pattern.to_ascii_lowercase(), value.to_ascii_lowercase())
        } else {
            (pattern.to_string(), value.to_string())
        };
        if glob::Pattern::new(&pattern).is_ok_and(|p| p.matches(&value)) {
            if negative {
                return false;
            }
            positive = true;
        }
    }
    positive
}
pub fn evaluate(
    args: &[String],
    alias: &str,
    local_user: &str,
    values: &BTreeMap<String, String>,
    final_pass: bool,
) -> Outcome {
    let mut result = true;
    let mut unsupported = false;
    let mut wants_final = false;
    let mut i = 0;
    while i < args.len() {
        let raw = args[i].to_ascii_lowercase();
        let (negated, key) = raw
            .strip_prefix('!')
            .map_or((false, raw.as_str()), |key| (true, key));
        i += 1;
        let mut unknown = false;
        let matched = match key {
            "all" => {
                if args.len() != 1 && !(args.len() == 2 && args[0].eq_ignore_ascii_case("final")) {
                    unsupported = true;
                }
                true
            }
            "final" => {
                wants_final = true;
                final_pass
            }
            "host" | "originalhost" | "user" | "localuser" | "tagged" => {
                let Some(pattern) = args.get(i) else {
                    unsupported = true;
                    break;
                };
                i += 1;
                let hostname = values
                    .get("hostname")
                    .cloned()
                    .unwrap_or_else(|| alias.into())
                    .replace("%h", alias);
                let value = match key {
                    "host" => hostname.as_str(),
                    "originalhost" => alias,
                    "user" => values.get("user").map(String::as_str).unwrap_or(local_user),
                    "localuser" => local_user,
                    _ => values.get("tag").map(String::as_str).unwrap_or(""),
                };
                pattern_list(pattern, value, matches!(key, "host" | "originalhost"))
            }
            "canonical" => {
                // CanonicalizeHostname is unsupported except 'no'; no DNS lookup is performed.
                false
            }
            _ => {
                unsupported = true;
                unknown = true;
                if i < args.len() {
                    i += 1;
                }
                true
            }
        };
        if !unknown {
            result &= if negated { !matched } else { matched };
        }
    }
    if args.is_empty() {
        unsupported = true;
    }
    Outcome {
        active: result && !unsupported,
        final_pass: wants_final,
        unsupported: result && unsupported,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unknown_negated_conditions_never_become_a_safe_false_branch() {
        let args = |s: &str| s.split_whitespace().map(String::from).collect::<Vec<_>>();
        assert!(
            evaluate(
                &args("!exec command"),
                "host",
                "local",
                &Default::default(),
                false
            )
            .unsupported
        );
        assert!(
            evaluate(
                &args("originalhost host !exec command"),
                "host",
                "local",
                &Default::default(),
                false
            )
            .unsupported
        );
        let no = evaluate(
            &args("originalhost other !exec command"),
            "host",
            "local",
            &Default::default(),
            false,
        );
        assert!(!no.active);
        assert!(!no.unsupported);
        let values = BTreeMap::from([("tag".into(), "prod".into())]);
        assert!(
            evaluate(
                &args("tagged prod,!test localuser local"),
                "host",
                "local",
                &values,
                false
            )
            .active
        );
        assert!(!evaluate(&args("user !local"), "host", "local", &values, false).active);
    }
}
