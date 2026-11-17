import type { ComponentProps } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "./input";
import { cn } from "@/lib/utils";

export function SearchInput({
  className,
  containerClassName,
  embedded = false,
  ...props
}: ComponentProps<typeof Input> & {
  containerClassName?: string;
  embedded?: boolean;
}) {
  return (
    <div
      data-slot="search-input"
      data-embedded={embedded || undefined}
      className={cn("search-input-control", containerClassName)}
    >
      <SearchIcon aria-hidden="true" />
      <Input
        type="search"
        {...props}
        className={cn(
          embedded && "rounded-none border-0! bg-transparent! shadow-none!",
          className,
        )}
      />
    </div>
  );
}
