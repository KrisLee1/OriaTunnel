use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::NSData;
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
            _ => Err("Application icon must be light, dark, or mono".into()),
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
    .map_err(|error| format!("Cannot schedule the application icon update: {error}"))?;
    receiver
        .await
        .map_err(|_| "Application icon update canceled".to_string())?
}

fn set_on_main_thread(icon: ApplicationIcon) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("AppKit main thread is unavailable")?;
    let application = NSApplication::sharedApplication(mtm);
    let Some(bytes) = icon.replacement_bytes() else {
        // SAFETY: AppKit documents nil as restoring the original bundled icon.
        unsafe { application.setApplicationIconImage(None) };
        return Ok(());
    };
    let data = NSData::with_bytes(bytes);
    let image = NSImage::initWithData(NSImage::alloc(), &data)
        .ok_or("Cannot decode the application icon")?;
    // SAFETY: A valid retained NSImage is assigned on AppKit's main thread.
    unsafe { application.setApplicationIconImage(Some(&image)) };
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
}
