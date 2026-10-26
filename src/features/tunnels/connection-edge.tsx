import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { connectionSweep } from "./connection-sweep";

const sweepDuration = 2800;

export const ConnectionEdge = memo(function ConnectionEdge(props: EdgeProps) {
  const [path] = getBezierPath(props);
  const connected = props.data?.state === "connected";
  const glow = useRef<SVGGElement>(null);
  const sweep = useMemo(() => connectionSweep(path), [path]);
  const latestSweep = useRef(sweep);
  const animations = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    latestSweep.current = sweep;
    for (const animation of animations.current) {
      (animation.effect as KeyframeEffect | null)?.setKeyframes(sweep.frames);
    }
  }, [sweep]);
  useLayoutEffect(() => {
    const element = glow.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const play = () => {
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
      if (reducedMotion.matches) return;
      // Geometry updates and remounts keep the same sweep phase instead of restarting.
      const timelineTime = document.timeline.currentTime;
      const phaseTime =
        (typeof timelineTime === "number" ? timelineTime : performance.now()) %
        sweepDuration;
      animations.current = Array.from(
        element.querySelectorAll("path"),
        (stroke) => {
          const animation = stroke.animate(latestSweep.current.frames, {
            duration: sweepDuration,
            iterations: Infinity,
            easing: "linear",
          });
          animation.currentTime = phaseTime;
          return animation;
        },
      );
    };
    play();
    reducedMotion.addEventListener("change", play);
    return () => {
      animations.current.forEach((animation) => animation.cancel());
      animations.current = [];
      reducedMotion.removeEventListener("change", play);
    };
  }, [connected]);
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
          <path
            d={path}
            strokeDasharray={sweep.dasharray}
            strokeWidth={8}
            opacity={0.14}
          />
          <path
            d={path}
            strokeDasharray={sweep.dasharray}
            strokeWidth={3}
            opacity={0.95}
          />
        </g>
      )}
    </>
  );
});
