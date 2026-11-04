import { useRef, useState, type ReactNode } from "react";
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

export function RichSurface({
  title,
  children,
  inline = false,
}: {
  title: string;
  children: ReactNode;
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false),
    [scale, setScale] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const Tag = inline ? "span" : "div";
  return (
    <>
      <Tag className="markdown-rich-surface">
        <span className="markdown-rich-toolbar">
          <span>{title}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            className="markdown-expand"
            aria-label={t("markdown.fullscreenDiagram")}
            title={title}
            onClick={() => {
              setScale(1);
              setOpen(true);
            }}
          >
            <Maximize2 />
          </Button>
        </span>
        {children}
      </Tag>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="files-inspector markdown-fullscreen"
          closeLabel={t("modal.close")}
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="markdown-zoom">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="−"
              disabled={scale <= 0.25}
              onClick={() => setScale(Math.max(0.25, scale - 0.25))}
            >
              <Minus />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setScale(1)}>
              <RotateCcw />
              {Math.round(scale * 100)}%
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="+"
              disabled={scale >= 4}
              onClick={() => setScale(Math.min(4, scale + 0.25))}
            >
              <Plus />
            </Button>
          </div>
          <ScrollArea
            className="markdown-fullscreen-scroll"
            viewportRef={viewport}
            viewportClassName="scroll-fade"
          >
            <div
              className="markdown-canvas-content"
              style={{ zoom: scale, cursor: scale > 1 ? "grab" : undefined }}
              onPointerDown={(event) => {
                if (
                  scale <= 1 ||
                  event.button !== 0 ||
                  (event.target as Element).closest("text,button,a,summary")
                )
                  return;
                const el = viewport.current;
                if (!el) return;
                pan.current = {
                  x: event.clientX,
                  y: event.clientY,
                  left: el.scrollLeft,
                  top: el.scrollTop,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const p = pan.current,
                  el = viewport.current;
                if (p && el) {
                  el.scrollLeft = p.left - (event.clientX - p.x);
                  el.scrollTop = p.top - (event.clientY - p.y);
                }
              }}
              onPointerUp={() => {
                pan.current = null;
              }}
              onPointerCancel={() => {
                pan.current = null;
              }}
            >
              {children}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
