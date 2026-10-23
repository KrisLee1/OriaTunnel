import { useEffect, useRef, type RefObject } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { nativeDropPoint } from '@/lib/file-drop'

export function useNativeFileDrop(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onDrop: (paths: string[], point: { x: number; y: number }) => void,
  onHover: (hovering: boolean) => void,
) {
  const callbacks = useRef({onDrop, onHover})
  callbacks.current = {onDrop, onHover}
  useEffect(() => {
    if (!enabled || !isTauri()) return
    let disposed = false
    let hasFiles = false
    const stop = getCurrentWebview().onDragDropEvent(({payload}) => {
      if (disposed) return
      if (payload.type === 'leave') { hasFiles = false; callbacks.current.onHover(false); return }
      if (payload.type === 'enter' || payload.type === 'drop') hasFiles = payload.paths.length > 0
      const point = nativeDropPoint(payload.position, navigator.platform.includes('Mac'), window.devicePixelRatio)
      const target = document.elementFromPoint(point.x, point.y)?.closest('[data-native-file-drop]')
      const inside = hasFiles && !!ref.current && target === ref.current
      callbacks.current.onHover(inside && payload.type !== 'drop')
      if (inside && payload.type === 'drop') callbacks.current.onDrop(payload.paths, point)
    })
    return () => { disposed = true; callbacks.current.onHover(false); void stop.then(unlisten => unlisten()).catch(() => {}) }
  }, [enabled, ref])
}
