import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

export const interactionSpring = {
  type: "spring",
  stiffness: 500,
  damping: 38,
  mass: 0.7,
} as const;

// Mount-only entrances: live runtime updates must never replay the animation.
export function useEntranceMotion(distance = 6) {
  const reducedMotion = useReducedMotion();
  return {
    initial: reducedMotion ? (false as const) : { opacity: 0, y: distance },
    animate: { opacity: 1, y: 0 },
    transition: reducedMotion
      ? { duration: 0 }
      : { ...interactionSpring, opacity: { duration: 0.18 } },
  };
}

export function PageTransition({ children }: { children: ReactNode }) {
  const entrance = useEntranceMotion(8);
  return (
    <motion.div className="page-transition" {...entrance}>
      {children}
    </motion.div>
  );
}
