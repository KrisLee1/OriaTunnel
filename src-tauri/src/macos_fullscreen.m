// Adapted from the OriaShot editor's macOS workspace chrome.
#import <AppKit/AppKit.h>
#import <objc/runtime.h>

static char observerKey;
static char styleMaskSetterKey;

@interface OriaTunnelFullscreenChrome : NSObject
@property(nonatomic, weak) NSWindow *bar;
@property(nonatomic, weak) NSView *content;
@property(nonatomic, strong) NSColor *background;
@property(nonatomic) BOOL opaque, shadow, hidden, ignoresMouse;
@end

@implementation OriaTunnelFullscreenChrome
- (void)didEnter:(NSNotification *)note {
    NSWindow *window = note.object;
    // AppKit finishes detaching the titlebar after the notification returns.
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!(window.styleMask & NSWindowStyleMaskFullScreen) || self.bar) return;
        NSWindow *bar = [window standardWindowButton:NSWindowCloseButton].window;
        if (!bar || bar == window || ![window.childWindows containsObject:bar]) return;

        self.bar = bar;
        self.content = bar.contentView;
        self.background = bar.backgroundColor;
        self.opaque = bar.opaque;
        self.shadow = bar.hasShadow;
        self.hidden = bar.contentView.hidden;
        self.ignoresMouse = bar.ignoresMouseEvents;

        bar.opaque = NO;
        bar.backgroundColor = NSColor.clearColor;
        bar.hasShadow = NO;
        bar.contentView.hidden = YES;
        bar.ignoresMouseEvents = YES;
    });
}

- (void)didExit:(NSNotification *)note {
    NSWindow *bar = self.bar;
    bar.opaque = self.opaque;
    bar.backgroundColor = self.background;
    bar.hasShadow = self.shadow;
    bar.ignoresMouseEvents = self.ignoresMouse;
    self.content.hidden = self.hidden;
    self.bar = nil;
    self.content = nil;
    self.background = nil;
}
@end

static void hideStandardTitlebar(NSWindow *window) {
    window.titleVisibility = NSWindowTitleHidden;
    window.titlebarAppearsTransparent = YES;
    [window standardWindowButton:NSWindowCloseButton].hidden = YES;
    [window standardWindowButton:NSWindowMiniaturizeButton].hidden = YES;
    [window standardWindowButton:NSWindowZoomButton].hidden = YES;
}

void oria_tunnel_install_fullscreen_chrome(void *raw) {
    NSWindow *window = (__bridge NSWindow *)raw;
    if (objc_getAssociatedObject(window, &observerKey)) return;

    // Tao temporarily makes borderless windows titled during fullscreen transitions.
    // Apply full-size content before AppKit lays out that frame. Only customize
    // marked work windows and preserve the original setter (including KVO).
    Class cls = object_getClass(window);
    if (!objc_getAssociatedObject(cls, &styleMaskSetterKey)) {
        SEL selector = @selector(setStyleMask:);
        Method method = class_getInstanceMethod(cls, selector);
        IMP original = method_getImplementation(method);
        IMP replacement = imp_implementationWithBlock(^(NSWindow *target, NSWindowStyleMask mask) {
            BOOL custom = objc_getAssociatedObject(target, &observerKey) != nil;
            if (custom && (mask & NSWindowStyleMaskTitled)) mask |= NSWindowStyleMaskFullSizeContentView;
            ((void (*)(id, SEL, NSWindowStyleMask))original)(target, selector, mask);
            if (custom) hideStandardTitlebar(target);
        });
        const char *types = method_getTypeEncoding(method);
        if (!class_addMethod(cls, selector, replacement, types))
            class_replaceMethod(cls, selector, replacement, types);
        objc_setAssociatedObject(cls, &styleMaskSetterKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }

    OriaTunnelFullscreenChrome *observer = [OriaTunnelFullscreenChrome new];
    objc_setAssociatedObject(window, &observerKey, observer, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:observer selector:@selector(didEnter:) name:NSWindowDidEnterFullScreenNotification object:window];
    [center addObserver:observer selector:@selector(didExit:) name:NSWindowDidExitFullScreenNotification object:window];
    hideStandardTitlebar(window);
}
