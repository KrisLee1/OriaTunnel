//! Passwords only enter the OS vault after successful SSH password authentication.
use crate::{
    model::{AuthMethod, Host},
    tunnel::Secret,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path, sync::Mutex};
use zeroize::{Zeroize, Zeroizing};

pub struct Vault {
    scope: String,
    epochs: Mutex<BTreeMap<String, u64>>,
}
#[derive(Deserialize)]
struct Stored {
    binding: String,
    password: String,
}
impl Drop for Stored {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}
fn hash(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
pub fn binding(host: &Host) -> String {
    hash(&serde_json::to_vec(&(&host.address, host.port, &host.user, &host.auth_method)).unwrap())
}
impl Vault {
    pub fn new(path: &Path) -> Self {
        Self {
            scope: hash(path.to_string_lossy().as_bytes()),
            epochs: Mutex::new(BTreeMap::new()),
        }
    }
    fn target(&self, host: &Host) -> String {
        format!(
            "OriaTunnel/password/v1/{}/{}",
            self.scope,
            hash(host.id.as_bytes())
        )
    }
    pub fn epoch(&self, id: &str) -> u64 {
        *self.epochs.lock().unwrap().get(id).unwrap_or(&0)
    }
    pub fn read(&self, host: &Host) -> Result<Option<Secret>, String> {
        let mut epochs = self.epochs.lock().unwrap();
        let Some(bytes) = platform::read(&self.target(host))? else {
            return Ok(None);
        };
        let mut stored: Stored =
            serde_json::from_slice(&bytes).map_err(|_| "已保存密码格式不可用，请清除后重新保存")?;
        if stored.binding != binding(host) {
            *epochs.entry(host.id.clone()).or_default() += 1;
            platform::delete(&self.target(host))?;
            return Ok(None);
        }
        if !matches!(host.auth_method, AuthMethod::Auto | AuthMethod::Password) {
            return Ok(None);
        }
        Ok(Some(Secret::password(std::mem::take(&mut stored.password))))
    }
    pub fn save(
        &self,
        host: &Host,
        password: &str,
        method: AuthMethod,
        epoch: u64,
    ) -> Result<(), String> {
        let epochs = self.epochs.lock().unwrap();
        if method != AuthMethod::Password
            || password.is_empty()
            || *epochs.get(&host.id).unwrap_or(&0) != epoch
        {
            return Ok(());
        }
        #[derive(Serialize)]
        struct Payload<'a> {
            binding: String,
            password: &'a str,
        }
        let bytes = Zeroizing::new(
            serde_json::to_vec(&Payload {
                binding: binding(host),
                password,
            })
            .map_err(|_| "密码保存准备失败")?,
        );
        platform::write(&self.target(host), &bytes)
    }
    pub fn forget(&self, host: &Host) -> Result<(), String> {
        let mut epochs = self.epochs.lock().unwrap();
        *epochs.entry(host.id.clone()).or_default() += 1;
        platform::delete(&self.target(host))
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::*,
    };
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    pub fn read(target: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        let name = wide(target);
        let mut credential = std::ptr::null_mut();
        unsafe {
            if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) == 0 {
                return if GetLastError() == ERROR_NOT_FOUND {
                    Ok(None)
                } else {
                    Err("无法读取 Windows 凭据管理器".into())
                };
            }
            let value = &mut *credential;
            if value.CredentialBlobSize > CRED_MAX_CREDENTIAL_BLOB_SIZE
                || (value.CredentialBlobSize > 0 && value.CredentialBlob.is_null())
            {
                CredFree(credential.cast());
                return Err("已保存密码格式不可用，请清除后重新保存".into());
            }
            let bytes = if value.CredentialBlobSize == 0 {
                Zeroizing::new(Vec::new())
            } else {
                let blob = std::slice::from_raw_parts_mut(
                    value.CredentialBlob,
                    value.CredentialBlobSize as usize,
                );
                let copy = Zeroizing::new(blob.to_vec());
                blob.zeroize();
                copy
            };
            CredFree(credential.cast());
            Ok(Some(bytes))
        }
    }
    pub fn write(target: &str, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
            return Err("密码过长，无法保存至 Windows 凭据管理器".into());
        }
        let mut name = wide(target);
        let mut user = wide("OriaTunnel");
        let mut blob = Zeroizing::new(bytes.to_vec());
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: name.as_mut_ptr(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: user.as_mut_ptr(),
            ..unsafe { std::mem::zeroed() }
        };
        if unsafe { CredWriteW(&credential, 0) } == 0 {
            return Err("无法保存到 Windows 凭据管理器".into());
        }
        Ok(())
    }
    pub fn delete(target: &str) -> Result<(), String> {
        if unsafe { CredDeleteW(wide(target).as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
            && unsafe { GetLastError() } != ERROR_NOT_FOUND
        {
            return Err("无法从 Windows 凭据管理器清除密码".into());
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use security_framework::passwords::{
        delete_generic_password_options, generic_password, set_generic_password_options,
        PasswordOptions,
    };
    const SERVICE: &str = "com.oria-tunnel.ssh-password";
    const NOT_FOUND: i32 = -25300;

    fn options(target: &str) -> PasswordOptions {
        let mut options = PasswordOptions::new_generic_password(SERVICE, target);
        // Passwords stay on this Mac; never opt into iCloud Keychain synchronization.
        options.set_access_synchronized(Some(false));
        options
    }
    pub fn read(target: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        match generic_password(options(target)) {
            Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
            Err(error) if error.code() == NOT_FOUND => Ok(None),
            Err(_) => Err("无法读取 macOS 钥匙串".into()),
        }
    }
    pub fn write(target: &str, bytes: &[u8]) -> Result<(), String> {
        set_generic_password_options(bytes, options(target))
            .map_err(|_| "无法保存到 macOS 钥匙串".into())
    }
    pub fn delete(target: &str) -> Result<(), String> {
        match delete_generic_password_options(options(target)) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == NOT_FOUND => Ok(()),
            Err(_) => Err("无法从 macOS 钥匙串清除密码".into()),
        }
    }
}

pub const SUPPORTED: bool = cfg!(any(windows, target_os = "macos"));

#[cfg(all(test, any(windows, target_os = "macos")))]
mod tests {
    use super::*;
    struct Fixture {
        vault: Vault,
        host: Host,
    }
    impl Fixture {
        fn new() -> Self {
            Self {
                vault: Vault::new(
                    &std::env::temp_dir().join(format!("oria-vault-test-{}", uuid::Uuid::new_v4())),
                ),
                host: Host {
                    id: "fixture-host".into(),
                    address: "fixture.invalid".into(),
                    user: "fixture".into(),
                    auth_method: AuthMethod::Password,
                    ..Default::default()
                },
            }
        }
        fn save(&self, password: &str) {
            self.vault
                .save(
                    &self.host,
                    password,
                    AuthMethod::Password,
                    self.vault.epoch(&self.host.id),
                )
                .unwrap();
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = self.vault.forget(&self.host);
        }
    }
    #[test]
    fn os_vault_roundtrip_is_scoped_and_clear_invalidates_pending_writes() {
        let f = Fixture::new();
        let password = Zeroizing::new(uuid::Uuid::new_v4().to_string());
        f.save(&password);
        assert!(f
            .vault
            .read(&f.host)
            .unwrap()
            .is_some_and(|s| *s == **password));
        let other = Fixture::new();
        assert!(other.vault.read(&f.host).unwrap().is_none());
        let mut other_host = f.host.clone();
        other_host.id = "other".into();
        assert!(f.vault.read(&other_host).unwrap().is_none());
        let old = f.vault.epoch(&f.host.id);
        f.vault.forget(&f.host).unwrap();
        f.vault
            .save(&f.host, &password, AuthMethod::Password, old)
            .unwrap();
        assert!(f.vault.read(&f.host).unwrap().is_none());
        f.save(&password);
        assert!(f.vault.read(&f.host).unwrap().is_some());
    }
    #[test]
    fn endpoint_changes_invalidate_credentials_but_display_changes_do_not() {
        for field in ["address", "user", "port", "auth"] {
            let f = Fixture::new();
            let password = Zeroizing::new(uuid::Uuid::new_v4().to_string());
            f.save(&password);
            let mut host = f.host.clone();
            host.name = "Renamed".into();
            host.tags = vec!["new".into()];
            assert!(f.vault.read(&host).unwrap().is_some());
            match field {
                "address" => host.address = "changed.invalid".into(),
                "user" => host.user = "changed".into(),
                "port" => host.port = 2222,
                _ => host.auth_method = AuthMethod::PrivateKey,
            }
            assert!(f.vault.read(&host).unwrap().is_none());
            assert!(f.vault.read(&f.host).unwrap().is_none());
        }
    }
    #[test]
    fn passphrases_empty_inputs_and_corrupt_entries_are_not_reused() {
        let f = Fixture::new();
        let value = Zeroizing::new(uuid::Uuid::new_v4().to_string());
        for method in [AuthMethod::PrivateKey, AuthMethod::Agent, AuthMethod::Auto] {
            f.vault.save(&f.host, &value, method, 0).unwrap();
            assert!(f.vault.read(&f.host).unwrap().is_none());
        }
        f.save("");
        assert!(f.vault.read(&f.host).unwrap().is_none());
        platform::write(&f.vault.target(&f.host), b"invalid").unwrap();
        assert!(f.vault.read(&f.host).is_err());
        f.vault.forget(&f.host).unwrap();
        assert!(f.vault.read(&f.host).unwrap().is_none());
    }
}
#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::*;
    pub fn read(_: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        Ok(None)
    }
    pub fn write(_: &str, _: &[u8]) -> Result<(), String> {
        Err("当前平台暂不支持记住密码".into())
    }
    pub fn delete(_: &str) -> Result<(), String> {
        Err("当前平台暂不支持记住密码".into())
    }
}
