// Run with the isolated QA bundle ID. Preserve all pasteboard items in memory.
import AppKit
import CoreGraphics

func run() throws {
  let bundleID = CommandLine.arguments[1]
  guard bundleID.hasPrefix("com.oria-tunnel.v5."),
    let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first,
    app.isActive, CGPreflightPostEventAccess()
  else {
    throw NSError(domain: "QA requires the active QA app and keyboard event access", code: 1)
  }
  let board = NSPasteboard.general
  let original = board.changeCount
  var saved: [NSPasteboardItem] = []
  for item in board.pasteboardItems ?? [] {
    let copy = NSPasteboardItem()
    for type in item.types {
      guard !type.rawValue.localizedCaseInsensitiveContains("concealed"),
        !type.rawValue.localizedCaseInsensitiveContains("promised"),
        let data = item.data(forType: type), copy.setData(data, forType: type)
      else {
        throw NSError(domain: "Pasteboard item cannot be preserved", code: 1)
      }
    }
    saved.append(copy)
  }
  guard board.changeCount == original else { throw NSError(domain: "Pasteboard changed", code: 1) }
  let marker = CommandLine.arguments[2]
  let external = CommandLine.arguments[3]
  defer {
    if [marker, external].contains(board.string(forType: .string) ?? "") {
      board.clearContents()
      if !saved.isEmpty { precondition(board.writeObjects(saved)) }
      let restored = board.pasteboardItems ?? []
      precondition(restored.count == saved.count)
      for (a, b) in zip(restored, saved) {
        precondition(Set(a.types) == Set(b.types))
        for type in b.types { precondition(a.data(forType: type) == b.data(forType: type)) }
      }
    }
  }
  // Click the QA canvas to make its WKWebView the native first responder.
  let windows =
    CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
    as? [[String: Any]] ?? []
  guard
    let window = windows.first(where: {
      ($0[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier
        && ($0[kCGWindowLayer as String] as? Int) == 0
    }),
    let bounds = window[kCGWindowBounds as String] as? NSDictionary,
    let rect = CGRect(dictionaryRepresentation: bounds)
  else {
    throw NSError(domain: "Missing visible QA window", code: 1)
  }
  let point = CGPoint(x: rect.midX, y: rect.midY)
  guard
    windows.first(where: { info in
      guard (info[kCGWindowLayer as String] as? Int) == 0,
        let bounds = info[kCGWindowBounds as String] as? NSDictionary,
        let frame = CGRect(dictionaryRepresentation: bounds)
      else { return false }
      return frame.contains(point)
    })?[kCGWindowOwnerPID as String] as? Int32 == app.processIdentifier
  else {
    throw NSError(domain: "QA canvas is covered", code: 1)
  }
  for type in [CGEventType.leftMouseDown, .leftMouseUp] {
    CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?
      .post(tap: .cghidEventTap)
  }
  Thread.sleep(forTimeInterval: 0.2)
  func chord(_ letter: CGKeyCode) throws {
    for (key, down) in [(CGKeyCode(55), true), (letter, true), (letter, false), (55, false)] {
      let event = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: down)!
      event.flags = key == 55 && !down ? [] : .maskCommand
      guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier
      else {
        throw NSError(domain: "QA window lost focus", code: 1)
      }
      event.post(tap: .cghidEventTap)
      Thread.sleep(forTimeInterval: 0.03)
    }
  }
  try chord(8)  // Command+C
  let end = Date().addingTimeInterval(5)
  while board.changeCount == original && Date() < end { Thread.sleep(forTimeInterval: 0.04) }
  guard board.string(forType: .string) == marker else {
    throw NSError(domain: "Remote selection did not reach the system pasteboard", code: 1)
  }
  try chord(9)  // Command+V
  // The parent confirms receipt at the RFB peer before allowing restoration.
  guard readLine() == "received", board.string(forType: .string) == marker else {
    throw NSError(domain: "RFB paste was not observed", code: 1)
  }
  // Another process supplies the text, so WebKit cannot reuse same-origin clipboard access.
  board.clearContents()
  guard board.setString(external, forType: .string) else {
    throw NSError(domain: "External pasteboard write failed", code: 1)
  }
  try chord(9)
  guard readLine() == "received external" else {
    throw NSError(domain: "External text did not paste with one shortcut", code: 1)
  }
}
do { try run() } catch {
  fputs("\(error.localizedDescription)\n", stderr)
  exit(1)
}
