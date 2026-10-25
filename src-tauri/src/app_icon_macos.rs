use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
use objc2_foundation::{NSBundle, NSData, NSString};
use std::path::Path;
use tauri::{AppHandle, Runtime};

const DARK_ICON: &[u8] = include_bytes!("../icons/runtime-icon-dark.png");
const MONO_ICON: &[u8] = include_bytes!("../icons/runtime-icon-mono.png");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApplicationIcon {
    Light,
    Dark,
    Mono,
}
impl ApplicationIcon {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            "mono" => Ok(Self::Mono),
            _ => Err(crate::native_message::plain("iconChoice")),
        }
    }
    fn replacement_bytes(self) -> Option<&'static [u8]> {
        match self {
            Self::Light => None,
            Self::Dark => Some(DARK_ICON),
            Self::Mono => Some(MONO_ICON),
        }
    }
}

pub async fn set<R: Runtime>(app: &AppHandle<R>, icon: ApplicationIcon) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = sender.send(set_on_main_thread(icon));
    })
    .map_err(|error| {
        crate::native_message::message(
            "iconSchedule",
            serde_json::json!({"error":error.to_string()}),
        )
    })?;
    receiver
        .await
        .map_err(|_| crate::native_message::plain("iconCancelled"))?
}

fn set_on_main_thread(icon: ApplicationIcon) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or(crate::native_message::plain("iconMainThread"))?;
    let application = NSApplication::sharedApplication(mtm);
    let image = icon
        .replacement_bytes()
        .map(|bytes| {
            NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes))
                .ok_or(crate::native_message::plain("iconDecode"))
        })
        .transpose()?;
    // SAFETY: A valid retained NSImage is assigned on AppKit's main thread.
    // AppKit documents nil as restoring the original bundled icon.
    unsafe { application.setApplicationIconImage(image.as_deref()) };
    let bundle = NSBundle::mainBundle().bundlePath().to_string();
    persist_bundle_icon(Path::new(&bundle), image.as_deref())
}

fn persist_bundle_icon(bundle: &Path, image: Option<&NSImage>) -> Result<(), String> {
    // A bare development executable has no application bundle to customize.
    if bundle.extension().is_none_or(|ext| ext != "app") || !bundle.join("Contents").is_dir() {
        return Ok(());
    }
    // Finder custom icons add ResourceFork/FinderInfo metadata that strict
    // codesign verification rejects, even at a Contents bundle's root. Signed
    // apps keep their original Finder icon; the selected Dock icon still takes
    // effect above and its preference is restored on the next launch.
    if bundle.join("Contents/_CodeSignature").exists() {
        return Ok(());
    }
    if image.is_none() && !bundle.join("Icon\r").exists() {
        return Ok(());
    }
    // Only unsigned development bundles may receive a persistent Finder icon.
    let path = NSString::from_str(&bundle.to_string_lossy());
    if !NSWorkspace::sharedWorkspace().setIcon_forFile_options(
        image,
        &path,
        NSWorkspaceIconCreationOptions::empty(),
    ) {
        return Err(crate::native_message::plain("iconPersist"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_resolved_icons_and_rejects_untrusted_values() {
        for (value, icon) in [
            ("light", ApplicationIcon::Light),
            ("dark", ApplicationIcon::Dark),
            ("mono", ApplicationIcon::Mono),
        ] {
            assert_eq!(ApplicationIcon::parse(value).unwrap(), icon);
        }
        for value in ["system", "", "unknown", "../icon.png"] {
            assert!(ApplicationIcon::parse(value).is_err());
        }
    }

    #[test]
    fn restores_light_and_decodes_padded_runtime_icons() {
        assert!(ApplicationIcon::Light.replacement_bytes().is_none());
        for icon in [ApplicationIcon::Dark, ApplicationIcon::Mono] {
            let image = tauri::image::Image::from_bytes(icon.replacement_bytes().unwrap()).unwrap();
            assert_eq!((image.width(), image.height()), (1024, 1024));
            let alpha = |x, y| image.rgba()[((y * 1024 + x) * 4 + 3) as usize];
            assert_eq!(alpha(512, 79), 0);
            assert!(alpha(512, 81) > 0);
            assert_eq!(alpha(79, 512), 0);
            assert!(alpha(81, 512) > 0);
            assert_eq!(alpha(512, 944), 0);
            assert!(alpha(512, 512) > 0);
        }
    }

    #[test]
    fn signed_bundles_keep_original_finder_icon_and_valid_signature() {
        let directory = tempfile::tempdir().unwrap();
        let bundle = directory.path().join("IconFixture.app");
        let contents = bundle.join("Contents");
        std::fs::create_dir_all(contents.join("MacOS")).unwrap();
        std::fs::copy("/usr/bin/true", contents.join("MacOS/fixture")).unwrap();
        std::fs::write(contents.join("Info.plist"),
            r#"<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.oria-tunnel.icon-fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>fixture</string></dict></plist>"#).unwrap();
        assert!(std::process::Command::new("/usr/bin/codesign")
            .args(["--force", "--sign", "-"])
            .arg(&bundle)
            .status()
            .unwrap()
            .success());
        for icon in [
            ApplicationIcon::Dark,
            ApplicationIcon::Mono,
            ApplicationIcon::Light,
        ] {
            let image = icon.replacement_bytes().map(|bytes| {
                NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes)).unwrap()
            });
            persist_bundle_icon(&bundle, image.as_deref()).unwrap();
            assert!(!bundle.join("Icon\r").exists());
            assert!(std::process::Command::new("/usr/bin/codesign")
                .args(["--verify", "--deep", "--strict"])
                .arg(&bundle)
                .status()
                .unwrap()
                .success());
        }
    }
}
