import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { useStore } from "@xyflow/react";
import { GitPullRequestCreateArrowIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { interactionSpring } from "@/components/ui/motion";
import { projectPort, type PortPlacement } from "./port-placement";
import {
  inLocalAddCorridor,
  localAddAnchor,
  type LocalAddAnchor,
} from "./local-add-geometry";

export function LocalAddForward({
  card,
  disabled,
  suspended,
  onAdd,
}: {
  card: RefObject<HTMLElement | null>;
  disabled: boolean;
  suspended: boolean;
  onAdd: (placement: PortPlacement) => void;
}) {
  const { t } = useTranslation("tunnel");
  const filterId = `local-add-goo-${useId().replace(/:/g, "")}`;
  const transform = useStore((state) => state.transform);
  const zoom = transform[2];
  const reducedMotion = useReducedMotion();
  // Slow the separation/merge while keeping pointer tracking responsive.
  const progress = useSpring(0, {
    stiffness: 150,
    damping: 25,
    mass: 1.05,
    restDelta: 0.001,
    restSpeed: 0.01,
  });
  const originX = useSpring(0, interactionSpring);
  const originY = useSpring(0, interactionSpring);
  const normalX = useSpring(1, interactionSpring);
  const normalY = useSpring(0, interactionSpring);
  const radius = useMotionValue(20 / zoom);
  const skinWidth = useMotionValue(200);
  const skinHeight = useMotionValue(164);
  const skinCorner = useMotionValue(16);
  const rectWidth = useTransform(skinWidth, (width) =>
    Math.max(0, width - 1 / zoom),
  );
  const rectHeight = useTransform(skinHeight, (height) =>
    Math.max(0, height - 1 / zoom),
  );
  const filterWidth = useTransform(skinWidth, (width) => width + 128 / zoom);
  const filterHeight = useTransform(
    skinHeight,
    (height) => height + 128 / zoom,
  );
  const active = useRef(false);
  const focused = useRef(false);
  const suppressRestoredFocus = useRef(false);
  const awaitFreshPointer = useRef(false);
  const anchor = useRef<LocalAddAnchor | null>(null);
  const latestPointer = useRef<PointerEvent | null>(null);
  const [shown, setShown] = useState(false);
  const offset = useTransform(progress, [0, 1], [-24 / zoom, 34 / zoom]);
  const x = useTransform(() => originX.get() + normalX.get() * offset.get());
  const y = useTransform(() => originY.get() + normalY.get() * offset.get());
  const buttonX = useTransform(() => x.get() - radius.get());
  const buttonY = useTransform(() => y.get() - radius.get());
  const iconOpacity = useTransform(progress, [0, 0.5, 0.9, 1], [0, 0, 1, 1]);
  const neckRadius = useTransform(
    progress,
    [0, 0.2, 0.55, 0.8, 0.92, 1],
    [0, 12 / zoom, 14 / zoom, 9 / zoom, 3 / zoom, 0],
  );
  const pull = useTransform(
    progress,
    [0, 0.4, 0.8, 1],
    [0, 5 / zoom, 3 / zoom, 0],
  );
  const neckX = useTransform(() => originX.get() + normalX.get() * pull.get());
  const neckY = useTransform(() => originY.get() + normalY.get() * pull.get());
  const blur = useTransform(
    progress,
    [0, 0.12, 0.3, 0.88, 1],
    [0, 2 / zoom, 3 / zoom, 3 / zoom, 0],
  );

  // The rect, stretching edge and droplet share one silhouette. Text and ports
  // remain separate DOM layers and never pass through the filter.
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const measure = () => {
      skinWidth.set(element.offsetWidth);
      skinHeight.set(element.offsetHeight);
      skinCorner.set(
        parseFloat(getComputedStyle(element).borderTopLeftRadius) || 16,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [card, skinWidth, skinHeight, skinCorner]);

  const reveal = useCallback(
    (value: boolean) => {
      if (active.current !== value) {
        active.current = value;
        setShown(value);
      }
      if (reducedMotion) progress.jump(value ? 1 : 0);
      else progress.set(value ? 1 : 0);
    },
    [progress, reducedMotion],
  );

  const position = useCallback(
    (next: LocalAddAnchor) => {
      anchor.current = next;
      const immediate = reducedMotion || progress.get() < 0.01;
      for (const [value, target] of [
        [originX, next.origin.x],
        [originY, next.origin.y],
        [normalX, next.normal.x],
        [normalY, next.normal.y],
      ] as const) {
        if (immediate) value.jump(target);
        else value.set(target);
      }
    },
    [normalX, normalY, originX, originY, progress, reducedMotion],
  );

  useEffect(() => {
    radius.set(20 / zoom);
    if (disabled || suspended) {
      reveal(false);
      return;
    }
    const element = card.current;
    if (!element) return;
    const defaultAnchor = () =>
      localAddAnchor(
        { x: element.offsetWidth, y: element.offsetHeight / 2 },
        element.offsetWidth,
        element.offsetHeight,
        zoom,
      );
    position(anchor.current || defaultAnchor());
    const coarse = window.matchMedia("(hover: none)");
    if (coarse.matches && !awaitFreshPointer.current) reveal(true);
    let frame = 0;
    const update = () => {
      frame = 0;
      const latest = latestPointer.current;
      if (awaitFreshPointer.current) {
        reveal(false);
        return;
      }
      if (focused.current || coarse.matches || !latest) return;
      const target = latest.target;
      if (
        !(target instanceof Element) ||
        !target.closest(".canvas") ||
        document.querySelector('[aria-modal="true"]') ||
        target.closest(".local-port-handle") ||
        (latest.buttons && !target.closest(".local-add-button"))
      ) {
        reveal(false);
        return;
      }
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        reveal(false);
        return;
      }
      const point = {
        x: ((latest.clientX - rect.left) * element.offsetWidth) / rect.width,
        y: ((latest.clientY - rect.top) * element.offsetHeight) / rect.height,
      };
      const next = localAddAnchor(
        point,
        element.offsetWidth,
        element.offsetHeight,
        zoom,
      );
      if (active.current && anchor.current) {
        const current = anchor.current;
        const outward =
          (point.x - current.origin.x) * current.normal.x +
          (point.y - current.origin.y) * current.normal.y;
        if (
          target.closest(".local-add-button") ||
          (outward >= 0 && inLocalAddCorridor(point, current, zoom))
        )
          return;
      }
      if (next.near) {
        position(next);
        reveal(true);
      } else if (
        !active.current ||
        !anchor.current ||
        !inLocalAddCorridor(point, anchor.current, zoom)
      )
        reveal(false);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      if (
        event.type === "pointermove" &&
        event.target instanceof Element &&
        event.target.closest(".canvas") &&
        !document.querySelector('[aria-modal="true"]')
      )
        awaitFreshPointer.current = false;
      latestPointer.current = event;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const leave = () => {
      if (!focused.current && !coarse.matches) reveal(false);
    };
    const down = (event: PointerEvent) => {
      if (
        coarse.matches &&
        event.pointerType === "touch" &&
        event.target instanceof Element &&
        element.contains(event.target) &&
        !event.target.closest(".local-port-handle")
      ) {
        awaitFreshPointer.current = false;
        position(defaultAnchor());
        reveal(true);
      }
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".local-add-button")
      )
        leave();
    };
    const refresh = () => {
      // Recompute against the current transformed card after zoom/pan/resize.
      if (!latestPointer.current && !focused.current) position(defaultAnchor());
      if (!frame) frame = requestAnimationFrame(update);
    };
    const resize = new ResizeObserver(refresh);
    resize.observe(element);
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerup", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    window.addEventListener("resize", refresh);
    refresh();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", move);
      document.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", refresh);
    };
  }, [card, disabled, suspended, transform, zoom, radius, position, reveal]);

  return (
    <div className="local-add-forward" data-visible={shown}>
      <svg className="local-add-fluid" aria-hidden="true">
        <defs>
          <motion.filter
            id={filterId}
            filterUnits="userSpaceOnUse"
            x={-64 / zoom}
            y={-64 / zoom}
            width={filterWidth}
            height={filterHeight}
            colorInterpolationFilters="sRGB"
          >
            <motion.feGaussianBlur
              in="SourceGraphic"
              stdDeviation={blur}
              result="blur"
            />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="skin"
            />
            <feMorphology
              in="skin"
              operator="dilate"
              radius={0.5 / zoom}
              result="outline"
            />
            <feFlood
              floodColor="var(--oria-color-border)"
              result="outline-color"
            />
            <feComposite
              in="outline-color"
              in2="outline"
              operator="in"
              result="border"
            />
            <feMerge>
              <feMergeNode in="border" />
              <feMergeNode in="skin" />
            </feMerge>
          </motion.filter>
        </defs>
        <g filter={`url(#${filterId})`}>
          <motion.rect
            x={0.5 / zoom}
            y={0.5 / zoom}
            width={rectWidth}
            height={rectHeight}
            rx={skinCorner}
          />
          <motion.circle cx={neckX} cy={neckY} r={neckRadius} />
          <motion.circle cx={x} cy={y} r={radius} />
        </g>
      </svg>
      <motion.div
        className="local-add-button-frame nodrag nopan"
        style={{
          x: buttonX,
          y: buttonY,
          opacity: iconOpacity,
          width: 40 / zoom,
          height: 40 / zoom,
          pointerEvents: shown ? "auto" : "none",
        }}
      >
        <Button
          className="local-add-button nodrag nopan"
          type="button"
          size="icon-lg"
          variant="ghost"
          style={{
            width: 40 / zoom,
            height: 40 / zoom,
            borderWidth: 0,
            outlineWidth: 2 / zoom,
            outlineOffset: 3 / zoom,
          }}
          aria-label={t("add")}
          title={t("add")}
          disabled={disabled || suspended}
          onFocus={() => {
            if (suppressRestoredFocus.current) {
              suppressRestoredFocus.current = false;
              focused.current = false;
              reveal(false);
              card.current
                ?.closest<HTMLElement>(".react-flow__node")
                ?.focus({ preventScroll: true });
              return;
            }
            awaitFreshPointer.current = false;
            focused.current = true;
            reveal(true);
          }}
          onBlur={() => {
            focused.current = false;
            reveal(false);
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              event.currentTarget.blur();
            }
          }}
          onClick={(event) => {
            event.stopPropagation();
            focused.current = false;
            suppressRestoredFocus.current = true;
            awaitFreshPointer.current = true;
            if (!window.matchMedia("(hover: none)").matches) reveal(false);
            const origin = anchor.current?.origin || {
              x: skinWidth.get(),
              y: skinHeight.get() / 2,
            };
            onAdd(
              projectPort(
                origin.x,
                origin.y,
                skinWidth.get(),
                skinHeight.get(),
              ),
            );
          }}
        >
          <GitPullRequestCreateArrowIcon
            aria-hidden="true"
            style={{ width: 18 / zoom, height: 18 / zoom }}
          />
        </Button>
      </motion.div>
    </div>
  );
}
