"use client"

import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { usePresence } from "motion/react";
import { useIsMobile } from "@/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { XIcon } from "lucide-react";
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

const ResponsiveModalContext = createContext<{ isMobile: boolean } | null>(null);

function useResponsiveModal() {
  const context = useContext(ResponsiveModalContext);
  if (!context) {
    throw new Error("useResponsiveModal must be used within a ResponsiveModal.");
  }
  return context;
}

function ResponsiveModal({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const isMobile = useIsMobile();
  const [isPresent, safeToRemove] = usePresence();
  const contextValue = useMemo(() => ({ isMobile }), [isMobile]);
  const finishClose = (nextOpen: boolean) => {
    if (!nextOpen && !isPresent) safeToRemove?.();
  };

  return (
    <ResponsiveModalContext.Provider value={contextValue}>
      {isMobile ? (
        <Drawer open={isPresent ? open : false} onOpenChange={onOpenChange} onOpenChangeComplete={finishClose} swipeDirection="down">
          {children}
        </Drawer>
      ) : (
        <Dialog open={isPresent ? open : false} onOpenChange={onOpenChange} onOpenChangeComplete={finishClose}>
          {children}
        </Dialog>
      )}
    </ResponsiveModalContext.Provider>
  );
}

function ResponsiveModalTrigger({
  children,
}: {
  children: ReactElement;
}) {
  const { isMobile } = useResponsiveModal();
  return isMobile
    ? <DrawerTrigger render={children} />
    : <DialogTrigger render={children} />;
}

function ResponsiveModalContent({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { isMobile } = useResponsiveModal();
  const { t } = useTranslation();
  const layoutClassName = "responsive-modal-surface mx-auto flex min-h-0 max-h-[calc(100dvh-var(--aide-chrome-top)-2rem)] w-[calc(100%-2rem)] flex-col";
  return isMobile
    ? <DrawerContent className={cn("floating-surface modal-surface m-1.5 gap-0 overflow-hidden rounded-xl shadow-md after:hidden", layoutClassName, className)}>{children}</DrawerContent>
    : <DialogContent closeLabel={t("modal.close")} className={cn("min-w-2xs gap-0 overflow-hidden p-0", layoutClassName, className)}>{children}</DialogContent>;
}

function ResponsiveModalHeader({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { isMobile } = useResponsiveModal();
  const { t } = useTranslation();
  if (isMobile) {
    return (
      <DrawerHeader className={cn("responsive-modal-header px-5 py-0 pr-12 text-left", className)}>
        {children}
        <DrawerClose
          className="pointer-events-auto absolute top-2 right-2"
          render={
            <Button variant="ghost" size="icon" aria-label={t("modal.close")}>
              <XIcon aria-hidden="true" />
            </Button>
          }
        />
      </DrawerHeader>
    );
  }
  return <DialogHeader className={cn("responsive-modal-header px-5 py-0 pr-12 text-left", className)}>{children}</DialogHeader>;
}

function ResponsiveModalTitle({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { isMobile } = useResponsiveModal();
  return isMobile
    ? <DrawerTitle className={cn("text-lg leading-tight font-semibold tracking-tight", className)}>{children}</DrawerTitle>
    : <DialogTitle className={className}>{children}</DialogTitle>;
}

function ResponsiveModalDescription({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const { isMobile } = useResponsiveModal();
  return isMobile
    ? <DrawerDescription className={cn("leading-relaxed", className)}>{children}</DrawerDescription>
    : <DialogDescription className={className}>{children}</DialogDescription>;
}

function ResponsiveModalBody({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <ScrollArea
      data-slot="responsive-modal-body"
      className="responsive-modal-scroll-area grid min-h-0 min-w-0 flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden"
      viewportClassName="responsive-modal-body scroll-fade h-auto min-h-0 overscroll-contain px-5 pb-5"
      contentClassName={className}
    >
      {children}
    </ScrollArea>
  );
}

function ResponsiveModalFooter({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="responsive-modal-footer"
      className={cn(
        "modal-actions flex shrink-0 flex-col-reverse gap-2 px-5 pb-5 pt-3 sm:flex-row sm:justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}

export {
  ResponsiveModal,
  ResponsiveModalTrigger,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalBody,
  ResponsiveModalFooter,
}
