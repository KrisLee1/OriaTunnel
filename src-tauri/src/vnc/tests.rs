use super::*;
use flate2::{write::ZlibEncoder, Compression, Decompress};
use std::io::Write;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[cfg(windows)]
#[test]
fn empty_protocol_marker_is_not_an_executable_handler() {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows_sys::Win32::System::Registry::{
        RegDeleteTreeW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ,
    };
    struct PrivateClass(HSTRING);
    impl Drop for PrivateClass {
        fn drop(&mut self) {
            unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, self.0.as_ptr()) };
        }
    }
    let scheme = format!("oria-v4-{}", uuid::Uuid::new_v4());
    let path = format!(r"Software\Classes\{scheme}");
    let class = PrivateClass(HSTRING::from(&path));
    let scheme = HSTRING::from(scheme);
    let scheme = PCWSTR(scheme.as_ptr());
    let set = |path: &HSTRING, name: PCWSTR, value: &str| {
        let value = HSTRING::from(value);
        let size = ((value.len() + 1) * 2) as u32;
        assert_eq!(
            unsafe {
                RegSetKeyValueW(
                    HKEY_CURRENT_USER,
                    path.as_ptr(),
                    name.0,
                    REG_SZ,
                    value.as_ptr().cast(),
                    size,
                )
            },
            0
        );
    };
    set(&class.0, w!("URL Protocol"), "");
    assert!(windows_protocol_handler(scheme).is_err());
    set(
        &HSTRING::from(format!(r"{path}\shell\open\command")),
        PCWSTR::null(),
        r#""unused-test.exe" "%1""#,
    );
    assert!(windows_protocol_handler(scheme).is_ok());
}

#[test]
fn external_links_resolve_a_unique_ssh_host_and_credentials_follow_the_forward_target() {
    use crate::model::{Host, Rule, Runtime, ServiceProtocol, Snapshot};
    let endpoint = Endpoint::parse("vnc://127.0.0.1:15901").unwrap();
    let host = Host {
        id: "ssh-a".into(),
        address: "127.0.0.1".into(),
        ..Default::default()
    };
    let mut snapshot = Snapshot {
        hosts: vec![host.clone()],
        added_host_ids: vec![host.id.clone()],
        ..Default::default()
    };
    assert_eq!(endpoint.workspace_host(&snapshot), Some(host.id.clone()));
    let direct = endpoint.credential_binding(&snapshot);
    snapshot.hosts.push(Host {
        id: "ssh-b".into(),
        ..host.clone()
    });
    snapshot.added_host_ids.push("ssh-b".into());
    assert!(endpoint.workspace_host(&snapshot).is_none());
    let rule = Rule {
        id: "forward".into(),
        host_id: host.id.clone(),
        bind_port: 15901,
        target_host: "desktop-a".into(),
        target_port: 5900,
        service_protocol: Some(ServiceProtocol::Vnc),
        ..Default::default()
    };
    snapshot.runtimes.push(Runtime {
        rule_id: rule.id.clone(),
        status: "listening".into(),
        host_snapshot: Some(host.clone()),
        ..Default::default()
    });
    snapshot.rules.push(rule);
    assert_eq!(endpoint.workspace_host(&snapshot), Some(host.id));
    let forward = endpoint.credential_binding(&snapshot);
    assert_ne!(direct, forward);
    snapshot.rules[0].target_host = "desktop-b".into();
    assert_ne!(forward, endpoint.credential_binding(&snapshot));
}

#[test]
fn validates_protocol_links_before_dispatch() {
    for s in [
        "vnc://a@b",
        "vnc://user:secret@host",
        "vnc://host/path",
        "vnc://host?x",
        "vnc://x#y",
        "vnc://:2",
        "http://x",
        "vnc://host:0",
        "vnc://host:65536",
        "vnc://host\n",
        "vnc://a%2eb",
        "vnc://host:",
        "vnc://[::1",
        "vnc://host/../",
        "vnc://host//",
        "vnc://host:5900/?",
        "vnc://host\\other",
    ] {
        assert!(Endpoint::parse(s).is_err());
    }
    assert_eq!(
        Endpoint::parse("VNC://[::1]:5901/").unwrap().address(),
        "[::1]:5901"
    );
    assert_eq!(
        Endpoint::parse("vnc://localhost").unwrap().address(),
        "localhost:5900"
    );
    assert!(Endpoint::parse(&format!("vnc://{}", "a".repeat(512))).is_err());
    assert_eq!(
        Endpoint::parse("vnc://127.0.0.1:1/").unwrap().address(),
        "127.0.0.1:1"
    );
}
#[test]
fn zrle_keeps_dictionary_across_rectangles_and_checks_palette_indices() {
    use flate2::{Compress, FlushCompress};
    let mut enc = Compress::new(Compression::fast(), true);
    let mut dec = Decompress::new(true);
    let mut expand = |tile: &[u8]| {
        let mut encoded = Vec::with_capacity(4096);
        enc.compress_vec(tile, &mut encoded, FlushCompress::Sync)
            .unwrap();
        let mut output = vec![];
        frame::zrle(&mut dec, &encoded, [0, 0, 3, 2], &mut output).map(|_| {
            let rgba = &output[9..];
            (output[0], rgba.to_vec())
        })
    };
    assert_eq!(expand(&[1, 2, 3, 4]).unwrap(), (12, vec![2, 3, 4, 255]));
    assert_eq!(
        expand(&[2, 1, 0, 0, 0, 2, 0, 0b01000000, 0b10000000]).unwrap(),
        (13, vec![1, 0, 0, 255, 0, 2, 0, 255, 0x40, 0x80])
    );
    assert_eq!(
        expand(&[128, 7, 6, 5, 5]).unwrap(),
        (2, [7, 6, 5, 255].repeat(6))
    );
    assert!(expand(&[130, 1, 2, 3, 4, 5, 6, 255]).is_err());
}
#[test]
fn clipboard_exchanges_unicode_by_request_and_preserves_legacy_text() {
    let mut a = clipboard::Clipboard::default();
    let mut b = clipboard::Clipboard::default();
    let text = "桌面\nB".to_owned();
    assert!(a.offer(text.clone()).is_err());
    assert_eq!(&a.offer("é".into()).unwrap()[8..], &[233]);
    let mut caps = 0x1f000001u32.to_be_bytes().to_vec();
    caps.extend([0; 4]);
    a.receive(&caps).unwrap();
    b.receive(&caps).unwrap();
    let notify = a.offer(text.clone()).unwrap();
    let request = b.receive(&notify[8..]).unwrap().0.unwrap();
    let provide = a.receive(&request[8..]).unwrap().0.unwrap();
    assert_eq!(b.receive(&provide[8..]).unwrap().1, Some(text));
    let mut zip = ZlibEncoder::new(Vec::new(), Compression::fast());
    zip.write_all(&u32::MAX.to_be_bytes()).unwrap();
    let mut invalid = 0x10000001u32.to_be_bytes().to_vec();
    invalid.extend(zip.finish().unwrap());
    assert!(b.receive(&invalid).is_err());
}

#[tokio::test]
async fn loopback_rfb_password_pixels_copyrect_keys_pointer_clipboard_and_disconnect() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut s, _) = listener.accept().await.unwrap();
        s.write_all(b"RFB 003.889\n").await.unwrap();
        let mut banner = [0; 12];
        s.read_exact(&mut banner).await.unwrap();
        assert_eq!(&banner, b"RFB 003.008\n");
        // Apple-specific types may precede classic VNC password authentication.
        s.write_all(&[5, 30, 33, 36, 35, 2]).await.unwrap();
        assert_eq!(s.read_u8().await.unwrap(), 2);
        s.write_all(&std::array::from_fn::<_, 16, _>(|i| i as u8))
            .await
            .unwrap();
        let mut resp = [0; 16];
        s.read_exact(&mut resp).await.unwrap();
        assert_eq!(
            resp,
            [
                0xb8, 0x66, 0x92, 0x41, 0x25, 0xc8, 0xee, 0xbb, 0x9d, 0xeb, 0xc1, 0xdb, 0x61, 0xc5,
                0x38, 0xe2
            ]
        );
        s.write_all(&[0; 4]).await.unwrap();
        assert_eq!(s.read_u8().await.unwrap(), 1);
        let mut init = vec![0, 2, 0, 1];
        init.extend([0; 20]);
        s.write_all(&init).await.unwrap();
        let mut setup = [0; 58];
        s.read_exact(&mut setup).await.unwrap();
        assert_eq!(&setup[48..], &[3, 0, 0, 0, 0, 0, 0, 2, 0, 1]);
        let mut update = vec![0, 0, 0, 2];
        update.extend([0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 2, 3, 0]);
        update.extend([0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]);
        s.write_all(&update).await.unwrap();
        let mut incremental = [0; 10];
        s.read_exact(&mut incremental).await.unwrap();
        assert_eq!(incremental[1], 1);
        s.write_all(&[3, 0, 0, 0, 0, 0, 0, 1, 233]).await.unwrap();
        let mut input = [0; 23];
        s.read_exact(&mut input).await.unwrap();
        assert_eq!(
            input,
            [4, 1, 0, 0, 0, 0, 0, 65, 5, 1, 0, 1, 0, 0, 6, 0, 0, 0, 0, 0, 0, 1, 233]
        );
    });
    let (tx, mut inputs) = mpsc::channel(4);
    let (output, mut events) = mpsc::channel(2);
    let client = tokio::spawn(async move {
        rfb::run(
            TcpStream::connect(addr).await.unwrap(),
            &mut inputs,
            &output,
            None,
            false,
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        assert_eq!(events.recv().await.unwrap().unwrap(), [0]);
        let fixture = String::from_utf8(vec![112, 97, 115, 115, 119, 111, 114, 100]).unwrap();
        tx.send(Input::Password(Zeroizing::new(fixture), false))
            .await
            .unwrap();
        assert_eq!(
            events.recv().await.unwrap().unwrap(),
            frame::packet(1, [0, 0, 2, 1])
        );
        let rect = events.recv().await.unwrap().unwrap();
        assert_eq!(rect[0], 10);
        assert_eq!(&rect[10..14], &[1, 2, 3, 255]);
        assert_eq!(rect[14], 3);
        assert_eq!(&rect[23..], &[0; 4]);
        assert_eq!(events.recv().await.unwrap().unwrap(), [4, 0xc3, 0xa9]);
        tx.send(Input::Wire(vec![4, 1, 0, 0, 0, 0, 0, 65]))
            .await
            .unwrap();
        tx.send(Input::Wire(vec![5, 1, 0, 1, 0, 0])).await.unwrap();
        tx.send(Input::Clipboard {
            text: "é".into(),
            keys: Vec::new(),
        })
        .await
        .unwrap();
        server.await.unwrap();
        assert!(client.await.unwrap().is_err());
    })
    .await
    .unwrap();
}
