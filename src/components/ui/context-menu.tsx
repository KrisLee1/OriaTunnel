import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { cn } from "@/lib/utils";

// ContextMenu uses the same Base UI Menu items; share their material and keyboard behavior.
export {
  DropdownMenuItem as ContextMenuItem,
  DropdownMenuSeparator as ContextMenuSeparator,
  DropdownMenuShortcut as ContextMenuShortcut,
} from "./dropdown-menu";

export function ContextMenu(props: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root {...props} />;
}

export function ContextMenuTrigger(
  props: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>,
) {
  return (
    <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
  );
}

export function ContextMenuContent({
  className,
  anchor,
  children,
  ...props
}: ContextMenuPrimitive.Popup.Props & {
  anchor?: ContextMenuPrimitive.Positioner.Props["anchor"];
}) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        anchor={anchor}
        className="isolate z-50 outline-none"
      >
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "floating-surface min-w-44 max-h-(--available-height) overflow-auto rounded-lg p-1 text-sm text-popover-foreground outline-none duration-aide-fast data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}
