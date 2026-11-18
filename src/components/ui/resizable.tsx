import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";
import "./resizable.css";

export const ResizablePanelGroup = Group;
export const ResizablePanel = Panel;
export function ResizableHandle({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator {...props} className={cn("resizable-handle", className)} />
  );
}
