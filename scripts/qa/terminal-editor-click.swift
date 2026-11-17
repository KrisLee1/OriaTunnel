// Deliver clicks and drags only to the isolated QA application's visible window.
import AppKit
import CoreGraphics

let args = CommandLine.arguments
guard [4, 5, 6].contains(args.count), let pid = Int32(args[1]),
      let app = NSRunningApplication(processIdentifier: pid),
      app.executableURL?.lastPathComponent == "oria-tunnel",
      let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
      let window = windows.first(where: {
          ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0
      }), let bounds = window[kCGWindowBounds as String] as? NSDictionary,
      let rect = CGRect(dictionaryRepresentation: bounds)
else { fputs("QA window unavailable\n", stderr); exit(1) }
func point(_ index: Int) -> CGPoint {
    guard let x = Double(args[index]), let y = Double(args[index + 1]),
          CGRect(origin: .zero, size: rect.size).contains(CGPoint(x: x, y: y))
    else { fputs("Point outside QA window\n", stderr); exit(1) }
    return CGPoint(x: rect.minX + x, y: rect.minY + y)
}
let start = point(2)
let end = args.count == 6 ? point(4) : start
let right = args.count == 5 && args[4] == "right"
app.activate(options: [])
Thread.sleep(forTimeInterval: 0.45)
guard CGPreflightPostEventAccess() else { fputs("macOS event posting unavailable\n", stderr); exit(2) }
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
else { fputs("QA window is not frontmost\n", stderr); exit(2) }
func send(_ type: CGEventType, _ at: CGPoint) {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
          let visible = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
          visible.first(where: { item in
              guard (item[kCGWindowLayer as String] as? Int) == 0,
                    let bounds = item[kCGWindowBounds as String] as? NSDictionary,
                    let frame = CGRect(dictionaryRepresentation: bounds) else { return false }
              return frame.contains(at)
          })?[kCGWindowOwnerPID as String] as? Int32 == pid
    else { fputs("QA window is not visible at the gesture location\n", stderr); exit(2) }
    if type == .mouseMoved {
        // AppKit hover tracking reads the current cursor position as well as the event.
        guard CGWarpMouseCursorPosition(at) == .success else { exit(2) }
    }
    let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: right ? .right : .left)!
    if type != .mouseMoved { event.setIntegerValueField(.mouseEventClickState, value: 1) }
    event.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.04)
}
if args.count == 5 && args[4] == "hover" {
    // Approach the icon from the adjacent tab label, crossing its tracking boundary.
    for dx in [-24, -18, -12, -6, -2, 0] {
        send(.mouseMoved, CGPoint(x: start.x + CGFloat(dx), y: start.y))
    }
    exit(0)
}
send(right ? .rightMouseDown : .leftMouseDown, start)
if args.count == 6 {
    for step in 1...10 {
        let t = CGFloat(step) / 10
        send(.leftMouseDragged, CGPoint(x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y)))
    }
}
send(right ? .rightMouseUp : .leftMouseUp, end)
