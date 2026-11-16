import type { ReactNode } from "react";
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
};

export function PageEmptyState({
  icon, title, description, action, className,
}: PageEmptyStateProps) {
  return (
    <Empty className={className}>
      <EmptyHeader className="w-full">
        <EmptyMedia className="text-muted-foreground [&_svg]:size-8" aria-hidden="true">
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
