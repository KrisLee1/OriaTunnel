import type { ReactNode } from "react";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalBody,
} from "./ui/responsive-modal";
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
  title: string;
  description?: string;
  children: ReactNode;
  close: () => void;
  className?: string;
}) {
  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <ResponsiveModalContent className={className}>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{title}</ResponsiveModalTitle>
        </ResponsiveModalHeader>
        <ResponsiveModalBody>
          <div className="form-body">
            {description && (
              <ResponsiveModalDescription>
                {description}
              </ResponsiveModalDescription>
            )}
            {children}
          </div>
        </ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
