import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle, PanelProps } from "react-resizable-panels";

export function useTransferQueue() {
  const panelRef = useRef<PanelImperativeHandle | null>(null);
  const [queue, setQueue] = useState(true);
  const [request, setRequest] = useState<{ visible: boolean } | null>(null);
  // Async transfer callbacks request a change without retaining a layout handle.
  // Read the current ref only after the Group and its Panels have committed.
  const changeQueue = useCallback(
    (visible: boolean) => setRequest({ visible }),
    [],
  );
  useEffect(() => {
    const panel = panelRef.current;
    if (!request || !panel) return;
    if (request.visible) {
      if (panel.isCollapsed()) panel.expand();
    } else panel.collapse();
    setRequest(null);
  }, [request]);
  const onResize = useCallback<NonNullable<PanelProps["onResize"]>>(
    (size, _id, previous) => {
      if (previous) setQueue(size.inPixels > 39);
    },
    [],
  );
  return { queue, changeQueue, panelRef, onResize };
}
