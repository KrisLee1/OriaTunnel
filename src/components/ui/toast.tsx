// Adapted from shadcn/ui's Base UI Toast; ORIA surface and localized close label.
// https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/base/ui/toast.tsx
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const toast = ToastPrimitive.createToastManager();
const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;
const ToastProvider = ToastPrimitive.Provider;
const ToastPortal = ToastPrimitive.Portal;

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn("toast-viewport", className)}
      {...props}
    />
  );
}
function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn("toast floating-surface", className)}
      {...props}
    />
  );
}
function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn("toast-content", className)}
      {...props}
    />
  );
}
function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  );
}
function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
function ToastAction({
  render = <Button variant="outline" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      {...props}
    />
  );
}
function ToastClose({
  children,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Close toast"
      render={render}
      {...props}
    >
      {children ?? <XIcon aria-hidden="true" />}
    </ToastPrimitive.Close>
  );
}
function ToastIcon({ type }: { type?: string }) {
  const Icon = {
    success: CircleCheckIcon,
    info: InfoIcon,
    warning: TriangleAlertIcon,
    error: OctagonXIcon,
    loading: Loader2Icon,
  }[type || ""];
  if (!Icon) return null;
  return (
    <span
      data-slot="toast-icon"
      className={cn(
        "shrink-0 [&_svg]:size-4",
        type === "error" && "text-destructive",
        type === "loading" && "animate-spin motion-reduce:animate-none",
      )}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}
function ToastList({ closeLabel }: { closeLabel: string }) {
  const { toasts } = useToastManager();
  return toasts.map((item) => (
    <Toast key={item.id} toast={item}>
      <ToastContent>
        <ToastIcon type={item.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastAction />
        <ToastClose aria-label={closeLabel} />
      </ToastContent>
    </Toast>
  ));
}
function Toaster({
  children,
  toastManager = toast,
  closeLabel = "Close toast",
  ...props
}: ToastPrimitive.Provider.Props & { closeLabel?: string }) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList closeLabel={closeLabel} />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}
export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
};
