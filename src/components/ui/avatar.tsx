// Adapted from shadcn/ui's Base UI Avatar; no surface behind transparent images.
// https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/avatar.tsx
import type { ComponentProps } from "react";
import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cn } from "@/lib/utils";

function Avatar({
  className,
  size = "default",
  ...props
}: AvatarPrimitive.Root.Props & { size?: "default" | "sm" | "lg" }) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative inline-flex shrink-0 select-none rounded-full",
        size === "sm" ? "size-6" : size === "lg" ? "size-12" : "size-8",
        className,
      )}
      {...props}
    />
  );
}
function AvatarImage({ className, ...props }: AvatarPrimitive.Image.Props) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn(
        "aspect-square size-full rounded-[inherit] object-contain",
        className,
      )}
      {...props}
    />
  );
}
function AvatarFallback({
  className,
  ...props
}: AvatarPrimitive.Fallback.Props) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-[inherit] text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
function AvatarBadge({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute -right-1 -bottom-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[8px] leading-none font-medium text-primary-foreground ring-1 ring-background select-none",
        className,
      )}
      {...props}
    />
  );
}
export { Avatar, AvatarImage, AvatarFallback, AvatarBadge };
