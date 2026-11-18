import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type PageEmptyStateProps = {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
  role?: "status" | "alert";
};

export function PageEmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
  role,
}: PageEmptyStateProps) {
  return (
    <Empty
      role={role}
      className={cn(compact && "gap-2.5 px-3 py-3", className)}
    >
      <EmptyHeader className="w-full">
        <EmptyMedia
          variant="icon"
          className={cn(
            "mb-0 size-12 rounded-xl bg-primary/8 text-primary [&_svg:not([class*='size-'])]:size-6",
            compact && "size-8 rounded-lg [&_svg:not([class*='size-'])]:size-4",
          )}
          aria-hidden="true"
        >
          {icon}
        </EmptyMedia>
        <EmptyTitle role="heading" aria-level={2}>
          {title}
        </EmptyTitle>
        {description && (
          <EmptyDescription className="max-w-full wrap-anywhere">
            {description}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
