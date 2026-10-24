import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { useEntranceMotion } from "./ui/motion";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalBody,
  ResponsiveModalFooter,
} from "./ui/responsive-modal";
const ModalFooterTarget = createContext<HTMLDivElement | null>(null);
const ModalTitleTarget = createContext<HTMLDivElement | null | undefined>(
  undefined,
);

// Feature actions stay beside their form logic, outside the accessible title.
export function ModalTitleActions({ children }: { children: ReactNode }) {
  const target = useContext(ModalTitleTarget);
  if (target === undefined) return <>{children}</>;
  return target ? createPortal(children, target) : null;
}

// Keep feature actions next to their logic while placing them outside the scroll body.
// Submit buttons must name their form when rendered through this slot.
export function ModalActions({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const target = useContext(ModalFooterTarget);
  const actions = <div className={`form-actions ${className}`}>{children}</div>;
  return target
    ? createPortal(
        <ResponsiveModalFooter>{actions}</ResponsiveModalFooter>,
        target,
      )
    : actions;
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Modal({
  title,
  description,
  children,
  close,
  className = "max-w-lg sm:max-w-lg",
}: {
  title: ReactNode;
  description?: string;
  children: ReactNode;
  close: () => void;
  className?: string;
}) {
  const entrance = useEntranceMotion(4);
  const [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  const [titleTarget, setTitleTarget] = useState<HTMLDivElement | null>(null);
  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <ResponsiveModalContent className={className}>
        <ModalFooterTarget.Provider value={footerTarget}>
          <ModalTitleTarget.Provider value={titleTarget}>
            <ResponsiveModalHeader>
              <div className="business-modal-title-row">
                <ResponsiveModalTitle>{title}</ResponsiveModalTitle>
                <div
                  className="business-modal-title-actions"
                  ref={setTitleTarget}
                />
              </div>
            </ResponsiveModalHeader>
            <ResponsiveModalBody>
              <motion.div className="form-body" {...entrance}>
                {description && (
                  <ResponsiveModalDescription>
                    {description}
                  </ResponsiveModalDescription>
                )}
                {children}
              </motion.div>
            </ResponsiveModalBody>
            <div className="business-modal-footer" ref={setFooterTarget} />
          </ModalTitleTarget.Provider>
        </ModalFooterTarget.Provider>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
