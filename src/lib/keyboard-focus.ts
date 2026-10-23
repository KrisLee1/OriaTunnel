const installed = new WeakMap<Document, () => void>()

/** Text inputs match native :focus-visible even after a click; only Tab opts into rings. */
export function installKeyboardFocus(document: Document): () => void {
  const existing = installed.get(document)
  if (existing) return existing
  const root = document.documentElement
  const pointer = () => { delete root.dataset.keyboardNavigation }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing) root.dataset.keyboardNavigation = 'true'
  }
  const capture = { capture: true }
  pointer()
  document.addEventListener('keydown', key, capture)
  document.addEventListener('pointerdown', pointer, capture)
  document.defaultView?.addEventListener('blur', pointer)
  const stop = () => {
    document.removeEventListener('keydown', key, capture)
    document.removeEventListener('pointerdown', pointer, capture)
    document.defaultView?.removeEventListener('blur', pointer)
    pointer(); installed.delete(document)
  }
  installed.set(document, stop)
  return stop
}

if (typeof document !== 'undefined') installKeyboardFocus(document)
