// Native corner and Gaussian backdrop leaf functions migrated from OriaAide.
use objc2::{
    ffi::{objc_getAssociatedObject, objc_setAssociatedObject, OBJC_ASSOCIATION_RETAIN_NONATOMIC},
    msg_send,
    runtime::{AnyClass, AnyObject},
};
use objc2_app_kit::{NSColor, NSWindow};
use objc2_foundation::{NSRect, NSString};
static BACKDROP_LAYER_ASSOCIATION_KEY: u8 = 0;
static BACKDROP_HOST_ASSOCIATION_KEY: u8 = 0;
pub fn apply(window: tauri::WebviewWindow, blur: u32, radius: f64) -> Result<(), String> {
    let handle = window.clone();
    window
        .run_on_main_thread(move || {
            if let Ok(pointer) = handle.ns_window() {
                // SAFETY: Tauri owns the live NSWindow; all AppKit operations run on its main thread.
                let native = unsafe { &*(pointer as *const NSWindow) };
                native.setHasShadow(false);
                native.setOpaque(false);
                let color = if blur == 0 {
                    NSColor::clearColor()
                } else {
                    NSColor::colorWithWhite_alpha(1.0, 0.001)
                };
                native.setBackgroundColor(Some(&color));
                set_native_blur_radius(native, blur, radius);
                set_native_corner_radius(native, radius);
                native.setHasShadow(true);
                native.invalidateShadow();
            }
        })
        .map_err(|e| e.to_string())
}
fn set_native_corner_radius(native_window: &NSWindow, radius: f64) {
    let Some(content_view) = native_window.contentView() else {
        return;
    };
    content_view.setWantsLayer(true);

    // NSView's typed `layer` accessor is gated behind objc2's QuartzCore
    // integration. Messaging the CALayer directly keeps this adapter small.
    // SAFETY: `content_view` is retained for this scope, `layer` is an AppKit-
    // owned CALayer, and this function is only called on the main thread.
    unsafe {
        let layer: *mut AnyObject = msg_send![&*content_view, layer];
        let Some(layer) = layer.as_ref() else {
            return;
        };
        let _: () = msg_send![layer, setCornerRadius: radius];
        let _: () = msg_send![layer, setMasksToBounds: radius > 0.0];
    }
    native_window.invalidateShadow();
}

fn set_native_blur_radius(native_window: &NSWindow, radius: u32, corner_radius: f64) {
    let _ = set_layer_background_blur_radius(native_window, radius, corner_radius);
}

fn set_layer_background_blur_radius(
    native_window: &NSWindow,
    radius: u32,
    corner_radius: f64,
) -> bool {
    // SAFETY: AppKit owns the content hierarchy and all Objective-C objects are
    // used synchronously on its main thread. Dynamically looked-up classes are
    // checked before use, and associated objects retain the host and backdrop.
    unsafe {
        let window_object = (native_window as *const NSWindow as *mut AnyObject)
            .as_mut()
            .expect("NSWindow references are non-null");
        let host_key = std::ptr::addr_of!(BACKDROP_HOST_ASSOCIATION_KEY).cast();
        let mut host = objc_getAssociatedObject(window_object, host_key).cast_mut();
        if host.is_null() {
            if radius == 0 {
                return true;
            }
            let (Some(effect_view_class), Some(number_class)) = (
                AnyClass::get(c"NSVisualEffectView"),
                AnyClass::get(c"NSNumber"),
            ) else {
                return false;
            };
            let Some(content_view) = native_window.contentView() else {
                return false;
            };
            let bounds = content_view.bounds();
            let allocated: *mut AnyObject = msg_send![effect_view_class, alloc];
            host = msg_send![allocated, initWithFrame: bounds];
            let Some(host_object) = host.as_ref() else {
                return false;
            };
            let yes: *mut AnyObject = msg_send![number_class, numberWithBool: true];
            let clear_key = NSString::from_str("clear");
            let _: () = msg_send![host_object, setState: 1_isize];
            let _: () = msg_send![host_object, setBlendingMode: 0_isize];
            let _: () = msg_send![host_object, setMaterial: 0_isize];
            let _: () = msg_send![host_object, setValue: yes, forKey: &*clear_key];
            let _: () = msg_send![host_object, setWantsLayer: true];

            let content_object = &*content_view as *const _ as *mut AnyObject;
            let _: () = msg_send![content_object, setFrame: bounds];
            let _: () = msg_send![content_object, setAutoresizingMask: 18_u64];
            // The WebView may already carry the startup corner radius from
            // before the blur host exists. Once wrapped, only the host owns
            // window clipping; leaving the nested mask in place would keep
            // the page background stuck at that initial radius.
            let _: () = msg_send![content_object, setWantsLayer: true];
            let content_layer: *mut AnyObject = msg_send![content_object, layer];
            if let Some(content_layer) = content_layer.as_ref() {
                let _: () = msg_send![content_layer, setCornerRadius: 0.0_f64];
                let _: () = msg_send![content_layer, setMasksToBounds: false];
            }
            let _: () = msg_send![host_object, addSubview: content_object];
            let _: () = msg_send![native_window, setContentView: host_object];
            objc_setAssociatedObject(
                window_object,
                host_key,
                host,
                OBJC_ASSOCIATION_RETAIN_NONATOMIC,
            );
            let _: () = msg_send![host_object, release];
        }
        let Some(host) = host.as_ref() else {
            return false;
        };
        let _: () = msg_send![host, setWantsLayer: true];
        let layer: *mut AnyObject = msg_send![host, layer];
        let Some(layer) = layer.as_ref() else {
            return false;
        };
        // The WebView's root layer must stay transparent. A background filter
        // placed directly on it produces an opaque backdrop and defeats the
        // theme opacity setting.
        let no_filters: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![layer, setBackgroundFilters: no_filters];

        let association_key = std::ptr::addr_of!(BACKDROP_LAYER_ASSOCIATION_KEY).cast();
        let mut backdrop = objc_getAssociatedObject(host, association_key).cast_mut();
        if backdrop.is_null() {
            let Some(backdrop_class) = AnyClass::get(c"CABackdropLayer") else {
                return false;
            };
            backdrop = msg_send![backdrop_class, layer];
            if backdrop.is_null() {
                return false;
            }
            objc_setAssociatedObject(
                host as *const AnyObject as *mut AnyObject,
                association_key,
                backdrop,
                OBJC_ASSOCIATION_RETAIN_NONATOMIC,
            );
            let _: () = msg_send![layer, insertSublayer: backdrop, atIndex: 0_u32];

            // Keep this layer hosted by WindowServer so it samples the desktop
            // behind the transparent window instead of only sibling WebView
            // layers. Toggling the hosting flag recreates the surface once;
            // subsequent appearance updates reuse the retained backdrop.
            let Some(number_class) = AnyClass::get(c"NSNumber") else {
                return false;
            };
            let no: *mut AnyObject = msg_send![number_class, numberWithBool: false];
            let yes: *mut AnyObject = msg_send![number_class, numberWithBool: true];
            let flatten_key = NSString::from_str("shouldAutoFlattenLayerTree");
            let hosting_key = NSString::from_str("canHostLayersInWindowServer");
            let _: () = msg_send![native_window, setValue: no, forKey: &*flatten_key];
            let _: () = msg_send![native_window, setValue: no, forKey: &*hosting_key];
            let _: () = msg_send![native_window, setValue: yes, forKey: &*hosting_key];
        }
        let Some(backdrop) = backdrop.as_ref() else {
            return false;
        };
        let bounds: NSRect = msg_send![host, bounds];
        let _: () = msg_send![backdrop, setFrame: bounds];
        let _: () = msg_send![backdrop, setAutoresizingMask: 18_u64];
        let _: () = msg_send![backdrop, setCornerRadius: corner_radius];
        let _: () = msg_send![backdrop, setMasksToBounds: corner_radius > 0.0];
        let _: () = msg_send![backdrop, setAllowsGroupBlending: true];
        let _: () = msg_send![backdrop, setAllowsGroupOpacity: true];
        let _: () = msg_send![backdrop, setAllowsEdgeAntialiasing: false];
        let _: () = msg_send![backdrop, setDisablesOccludedBackdropBlurs: true];
        let _: () = msg_send![backdrop, setIgnoresOffscreenGroups: true];
        let _: () = msg_send![backdrop, setAllowsInPlaceFiltering: false];
        let _: () = msg_send![backdrop, setScale: 1.0_f64];
        let _: () = msg_send![backdrop, setBleedAmount: 0.0_f64];
        let _: () = msg_send![backdrop, setWindowServerAware: true];
        if radius == 0 {
            let _: () = msg_send![backdrop, removeAllAnimations];
            let _: () = msg_send![backdrop, setHidden: true];
            let _: () = msg_send![backdrop, setFilters: no_filters];
            return true;
        }

        let (Some(filter_class), Some(number_class), Some(array_class)) = (
            AnyClass::get(c"CAFilter"),
            AnyClass::get(c"NSNumber"),
            AnyClass::get(c"NSArray"),
        ) else {
            return false;
        };
        let filter_type = NSString::from_str("gaussianBlur");
        let filter: *mut AnyObject = msg_send![filter_class, filterWithType: &*filter_type];
        let Some(filter) = filter.as_ref() else {
            return false;
        };
        let radius_value: *mut AnyObject =
            msg_send![number_class, numberWithDouble: f64::from(radius)];
        let normalize_edges: *mut AnyObject = msg_send![number_class, numberWithBool: true];
        let radius_key = NSString::from_str("inputRadius");
        let normalize_key = NSString::from_str("inputNormalizeEdges");
        let _: () = msg_send![filter, setValue: radius_value, forKey: &*radius_key];
        let _: () = msg_send![filter, setValue: normalize_edges, forKey: &*normalize_key];
        let filters: *mut AnyObject = msg_send![array_class, arrayWithObject: filter];
        let Some(filters) = filters.as_ref() else {
            return false;
        };
        let _: () = msg_send![backdrop, setFilters: filters];
        // The backdrop replaces the sharp desktop sample and must remain fully
        // opaque. Theme opacity is applied by the WebView's tinted background;
        // lowering this layer's opacity would mix sharp desktop pixels back in.
        let _: () = msg_send![backdrop, setOpacity: 1.0_f32];
        let _: () = msg_send![backdrop, setHidden: false];
        true
    }
}
