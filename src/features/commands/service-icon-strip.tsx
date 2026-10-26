import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDownIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { interactionSpring } from "@/components/ui/motion";

export function ServiceIconStrip({
  children,
  count,
  actions,
  expandable = true,
  className = "",
}: {
  children: ReactNode;
  count: number;
  actions?: ReactNode;
  expandable?: boolean;
  className?: string;
}) {
  const { t } = useTranslation("commands");
  const [expanded, setExpanded] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(32);
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const stripId = useId();
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () =>
      setExpandedHeight(Math.max(32, viewport.scrollHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [wrapped, count]);
  return (
    <div
      className={`service-icon-strip nodrag nopan nowheel ${className} ${wrapped ? "is-expanded" : ""}`}
    >
      <motion.div
        ref={frameRef}
        className="host-service-scroll"
        initial={false}
        animate={{ height: expanded ? expandedHeight : 32 }}
        transition={reducedMotion ? { duration: 0 } : interactionSpring}
        onAnimationComplete={() => {
          if (!expanded) setWrapped(false);
        }}
      >
        <ScrollArea
          viewportRef={viewportRef}
          viewportClassName="host-service-viewport"
          contentClassName="host-service-content"
          id={stripId}
          aria-label={t("services")}
        >
          {children}
        </ScrollArea>
      </motion.div>
      <div className="host-service-tools">
        {expandable && count > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-controls={stripId}
            aria-expanded={expanded}
            aria-label={t(expanded ? "collapseServices" : "expandServices")}
            title={t(expanded ? "collapseServices" : "expandServices")}
            onClick={() => {
              if (!expanded) {
                if (viewportRef.current) viewportRef.current.scrollLeft = 0;
                setWrapped(true);
              } else if (
                reducedMotion ||
                (frameRef.current?.clientHeight ?? expandedHeight) <= 32
              ) {
                // A single-row expansion has no height animation to complete.
                setWrapped(false);
              }
              setExpanded((value) => !value);
            }}
          >
            <motion.span
              className="inline-flex"
              initial={false}
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={reducedMotion ? { duration: 0 } : interactionSpring}
            >
              <ChevronDownIcon aria-hidden="true" />
            </motion.span>
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}
