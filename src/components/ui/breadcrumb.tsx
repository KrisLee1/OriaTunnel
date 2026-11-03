import type { ComponentProps } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
export function Breadcrumb(props: ComponentProps<"nav">) {
  return <nav data-slot="breadcrumb" {...props} />;
}
export function BreadcrumbList({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        "flex min-w-0 items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
export function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex min-w-0 items-center", className)}
      {...props}
    />
  );
}
export function BreadcrumbSeparator() {
  return (
    <li role="presentation" aria-hidden="true" data-slot="breadcrumb-separator">
      <ChevronRight className="size-3 shrink-0" />
    </li>
  );
}
