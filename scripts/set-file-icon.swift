#!/usr/bin/swift

import AppKit
import Darwin
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else {
    fail("Usage: set-file-icon.swift <file-path> <icon.icns>")
}

let fileManager = FileManager.default
let filePath = URL(fileURLWithPath: arguments[1]).standardizedFileURL.path
let iconPath = URL(fileURLWithPath: arguments[2]).standardizedFileURL.path

var fileIsDirectory: ObjCBool = false
guard fileManager.fileExists(atPath: filePath, isDirectory: &fileIsDirectory),
      !fileIsDirectory.boolValue else {
    fail("Target must be an existing file: \(filePath)")
}

var iconIsDirectory: ObjCBool = false
guard fileManager.fileExists(atPath: iconPath, isDirectory: &iconIsDirectory),
      !iconIsDirectory.boolValue,
      URL(fileURLWithPath: iconPath).pathExtension.lowercased() == "icns" else {
    fail("Icon must be an existing .icns file: \(iconPath)")
}

guard let icon = NSImage(contentsOfFile: iconPath), icon.isValid else {
    fail("Cannot load icon image: \(iconPath)")
}

guard NSWorkspace.shared.setIcon(icon, forFile: filePath, options: []) else {
    fail("Cannot set the custom Finder icon: \(filePath)")
}

print("Applied \(URL(fileURLWithPath: iconPath).lastPathComponent) to \(URL(fileURLWithPath: filePath).lastPathComponent) as its Finder file icon.")
