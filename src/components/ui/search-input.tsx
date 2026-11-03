import type { ComponentProps } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "./input";
import { cn } from "@/lib/utils";

export function SearchInput({
  className,
  containerClassName,
  ...props
}: ComponentProps<typeof Input> & { containerClassName?: string }) {
  return (
    <div
      data-slot="search-input"
      className={cn("search-input-control", containerClassName)}
    >
      <SearchIcon aria-hidden="true" />
      <Input type="search" {...props} className={className} />
    </div>
  );
}
