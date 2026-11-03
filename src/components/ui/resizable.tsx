import { Group, Panel, Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";
export const ResizablePanelGroup = Group;
export const ResizablePanel = Panel;
export function ResizableHandle({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator {...props} className={cn("files-resize-handle", className)} />
  );
}
