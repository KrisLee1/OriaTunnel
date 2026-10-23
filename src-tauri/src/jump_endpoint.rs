//! ProxyJump endpoint syntax only; never resolves DNS or opens a transport.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoint {
    pub alias: String,
    pub user: Option<String>,
    pub port: Option<u16>,
}
pub fn parse(value: &str) -> Result<Endpoint, String> {
    if value.is_empty()
        || value.len() > 1024
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
        || value.contains(['%', '\0', '\n', '\r', ','])
    {
        return Err("ProxyJump 地址无效或包含未支持的 Token".into());
    }
    let value = if let Some(uri) = value.strip_prefix("ssh://") {
        uri.strip_suffix('/').unwrap_or(uri)
    } else {
        value
    };
    if value.contains('/') {
        return Err("ProxyJump SSH URI 不允许路径".into());
    }
    let (user, authority) = if let Some((user, host)) = value.split_once('@') {
        if user.is_empty() || user.contains([':', '@']) || host.contains('@') {
            return Err("ProxyJump 用户名无效；URI 不接受密码".into());
        }
        (Some(user.to_string()), host)
    } else {
        (None, value)
    };
    let (alias, port) = if let Some(rest) = authority.strip_prefix('[') {
        let (alias, suffix) = rest.split_once(']').ok_or("ProxyJump IPv6 缺少右括号")?;
        if alias.parse::<std::net::Ipv6Addr>().is_err() {
            return Err("ProxyJump IPv6 地址无效".into());
        }
        let port = if suffix.is_empty() {
            None
        } else {
            Some(suffix.strip_prefix(':').ok_or("ProxyJump IPv6 端口无效")?)
        };
        (alias, port)
    } else if let Some((alias, port)) = authority.split_once(':') {
        if port.contains(':') {
            return Err("ProxyJump IPv6 请使用方括号".into());
        }
        (alias, Some(port))
    } else {
        (authority, None)
    };
    if alias.is_empty() || alias.contains(['[', ']', '!', '*', '?']) {
        return Err("ProxyJump 需要具体主机地址或别名".into());
    }
    let port = port
        .map(|p| {
            p.parse::<u16>()
                .ok()
                .filter(|p| *p > 0)
                .ok_or("ProxyJump 端口范围为 1–65535")
        })
        .transpose()?;
    Ok(Endpoint {
        alias: alias.into(),
        user,
        port,
    })
}
pub fn id(value: &str, endpoint: &Endpoint) -> String {
    if endpoint.user.is_none()
        && endpoint.port.is_none()
        && !value.starts_with("ssh://")
        && !value.starts_with('[')
    {
        return format!("ssh:{}", endpoint.alias);
    }
    // Lossless deterministic encoding, not a hash: distinct overrides never share identity.
    format!(
        "ssh-jump:{}",
        value
            .as_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}
