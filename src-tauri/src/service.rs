//! Service launch URLs come only from saved rules and authoritative listening state.
use crate::model::{ForwardKind, Host, Rule, Runtime, ServiceProtocol};
use std::net::IpAddr;

fn loopback(host: &str) -> bool {
    host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
        || host.eq_ignore_ascii_case("localhost")
        || host.to_ascii_lowercase().ends_with(".localhost")
}

fn authority(host: &str) -> Result<String, String> {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return Ok(match ip {
            IpAddr::V4(_) => ip.to_string(),
            IpAddr::V6(_) => format!("[{ip}]"),
        });
    }
    if host.is_empty()
        || host.len() > 253
        || !host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
    {
        return Err(crate::native_message::plain("serviceAddress"));
    }
    Ok(host.into())
}

pub fn service_url(rule: &Rule, host: &Host, runtime: &Runtime) -> Result<String, String> {
    if runtime.rule_id != rule.id || runtime.status != "listening" {
        return Err(crate::native_message::plain("serviceListening"));
    }
    if runtime.configuration_changed {
        return Err(crate::native_message::plain("serviceHostChanged"));
    }
    let scheme = match rule
        .service_protocol
        .ok_or(crate::native_message::plain("serviceProtocol"))?
    {
        ServiceProtocol::Http => "http",
        ServiceProtocol::Https => "https",
        ServiceProtocol::Vnc => "vnc",
    };
    let address = match rule.kind {
        ForwardKind::D => return Err(crate::native_message::plain("serviceSocks")),
        ForwardKind::L => match rule.bind_address.as_str() {
            "0.0.0.0" => "127.0.0.1",
            "::" => "::1",
            address => address,
        },
        ForwardKind::R => {
            if loopback(&rule.bind_address) {
                return Err(crate::native_message::plain("serviceRemoteLoopback"));
            }
            match rule.bind_address.as_str() {
                "0.0.0.0" | "::" | "*" => host.address.as_str(),
                address => address,
            }
        }
    };
    if rule.bind_port == 0 {
        return Err(crate::native_message::plain("servicePort"));
    }
    let authority = authority(address)?;
    let url = tauri::Url::parse(&format!("{scheme}://{authority}:{}/", rule.bind_port))
        .map_err(|_| crate::native_message::plain("serviceAddress"))?;
    if rule.kind == ForwardKind::R
        && url
            .host_str()
            .is_some_and(|host| loopback(host.trim_matches(['[', ']'])))
    {
        return Err(crate::native_message::plain("serviceRemoteLoopback"));
    }
    Ok(url.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Rule, Host, Runtime) {
        (
            Rule {
                id: "service-fixture".into(),
                service_protocol: Some(ServiceProtocol::Http),
                bind_port: 18080,
                ..Default::default()
            },
            Host {
                address: "ssh.example.invalid".into(),
                ..Default::default()
            },
            Runtime {
                rule_id: "service-fixture".into(),
                status: "listening".into(),
                ..Default::default()
            },
        )
    }
    #[test]
    fn schemes_and_local_listeners_use_the_forwarded_port() {
        let (mut rule, host, runtime) = fixture();
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "http://127.0.0.1:18080/"
        );
        rule.bind_address = "0.0.0.0".into();
        rule.service_protocol = Some(ServiceProtocol::Https);
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "https://127.0.0.1:18080/"
        );
        rule.bind_address = "::".into();
        rule.service_protocol = Some(ServiceProtocol::Vnc);
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "vnc://[::1]:18080/"
        );
        rule.bind_address = "2001:db8::1".into();
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "vnc://[2001:db8::1]:18080/"
        );
    }
    #[test]
    fn remote_listener_is_explicit_and_dynamic_has_no_service_endpoint() {
        let (mut rule, host, runtime) = fixture();
        rule.kind = ForwardKind::R;
        for address in [
            "127.0.0.1",
            "127.1.2.3",
            "::1",
            "localhost",
            "x.localhost",
            "127.1",
            "0x7f000001",
        ] {
            rule.bind_address = address.into();
            assert!(service_url(&rule, &host, &runtime).is_err());
        }
        rule.bind_address = "0.0.0.0".into();
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "http://ssh.example.invalid:18080/"
        );
        rule.bind_address = "service.example.invalid".into();
        assert_eq!(
            service_url(&rule, &host, &runtime).unwrap(),
            "http://service.example.invalid:18080/"
        );
        rule.kind = ForwardKind::D;
        assert!(service_url(&rule, &host, &runtime).is_err());
    }
    #[test]
    fn rejects_inactive_changed_or_unselected_services_and_url_injection() {
        let (mut rule, host, mut runtime) = fixture();
        for status in [
            "connecting",
            "stopped",
            "failed",
            "reconnecting",
            "verifying-host",
        ] {
            runtime.status = status.into();
            assert!(service_url(&rule, &host, &runtime).is_err());
        }
        runtime.status = "listening".into();
        runtime.configuration_changed = true;
        assert!(service_url(&rule, &host, &runtime).is_err());
        runtime.configuration_changed = false;
        rule.service_protocol = None;
        assert!(service_url(&rule, &host, &runtime).is_err());
        rule.service_protocol = Some(ServiceProtocol::Http);
        for address in [
            "evil.invalid/path",
            "user@evil.invalid",
            "x?y",
            "x#y",
            "x%2fy",
            " x",
            "x\n",
            "https://x",
            "-arg",
            "x;open",
        ] {
            rule.bind_address = address.into();
            assert!(service_url(&rule, &host, &runtime).is_err(), "{address:?}");
        }
    }
}
