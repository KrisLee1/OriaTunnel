type FileDropEvent = {
  dataTransfer: Pick<DataTransfer, "dropEffect" | "types"> | null
  defaultPrevented: boolean
  preventDefault: () => void
}

export function blockUnhandledFileDrop(event: FileDropEvent) {
  if (
    event.defaultPrevented
    || !event.dataTransfer
    || !Array.from(event.dataTransfer.types).includes("Files")
  ) {
    return false
  }

  event.preventDefault()
  event.dataTransfer.dropEffect = "none"
  return true
}

// Wry's macOS drag source reports Cocoa points; Windows reports physical pixels.
export function nativeDropPoint(position: {x:number; y:number}, macOS: boolean, pixelRatio: number) {
  const scale = macOS ? 1 : Math.max(1, pixelRatio)
  return {x:position.x / scale, y:position.y / scale}
}

export async function readNativeDroppedFile(path: string, maxBytes: number, type = '') {
  const { invoke } = await import('@tauri-apps/api/core')
  const bytes = await invoke<ArrayBuffer | number[]>('read_dropped_file', {path, maxBytes})
  const content = Array.isArray(bytes) ? Uint8Array.from(bytes) : new Uint8Array(bytes)
  return new File([content], path.split(/[\\/]/).pop() || 'file', {type})
}
