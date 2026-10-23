import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { useLayoutEffect, useRef } from "react";

const sweepDuration = 2800;

export function ConnectionEdge(props: EdgeProps) {
  const [path] = getBezierPath(props);
  const connected = props.data?.state === "connected";
  const glow = useRef<SVGGElement>(null);
  const glowPath = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    const element = glow.current;
    const curve = glowPath.current;
    if (!element || !curve) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animations: Animation[] = [];
    const play = () => {
      animations.forEach((animation) => animation.cancel());
      animations = [];
      if (reducedMotion.matches) return;
      const length = curve.getTotalLength();
      const band = Math.min(36, Math.max(14, length * 0.18));
      // Geometry updates and remounts keep the same sweep phase instead of restarting.
      const timelineTime = document.timeline.currentTime;
      const phaseTime =
        (typeof timelineTime === "number" ? timelineTime : performance.now()) %
        sweepDuration;
      animations = Array.from(element.querySelectorAll("path"), (stroke) => {
        stroke.style.strokeDasharray = `${band} ${length + band}`;
        const animation = stroke.animate(
          [
            { strokeDashoffset: `${band}px` },
            { strokeDashoffset: `${-(length + band)}px` },
          ],
          { duration: sweepDuration, iterations: Infinity, easing: "linear" },
        );
        animation.currentTime = phaseTime;
        return animation;
      });
    };
    play();
    reducedMotion.addEventListener("change", play);
    return () => {
      animations.forEach((animation) => animation.cancel());
      reducedMotion.removeEventListener("change", play);
    };
  }, [path, connected]);
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={props.style}
        interactionWidth={20}
      />
      {connected && (
        <g
          ref={glow}
          className="connection-glow"
          fill="none"
          stroke={props.style?.stroke}
          aria-hidden="true"
        >
          <path d={path} strokeWidth={8} opacity={0.14} />
          <path ref={glowPath} d={path} strokeWidth={3} opacity={0.95} />
        </g>
      )}
    </>
  );
}
