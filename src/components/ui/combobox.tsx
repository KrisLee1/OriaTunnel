import * as React from "react";
import { Combobox as Primitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { Input } from "./input";
import { cn } from "@/lib/utils";

const Combobox = Primitive.Root;
const ComboboxValue = Primitive.Value;
const ComboboxCollection = Primitive.Collection;
const ComboboxGroup = Primitive.Group;

function ComboboxInput({
  className,
  triggerLabel = "Toggle options",
  ...props
}: Primitive.Input.Props & { triggerLabel?: string }) {
  return (
    <Primitive.InputGroup className="combobox-control">
      <Primitive.Input
        render={<Input />}
        className={cn("pr-9", className)}
        {...props}
      />
      <Primitive.Trigger className="combobox-trigger" aria-label={triggerLabel}>
        <ChevronDownIcon size={15} />
      </Primitive.Trigger>
    </Primitive.InputGroup>
  );
}
function ComboboxContent({
  className,
  anchor,
  ...props
}: Primitive.Popup.Props & Pick<Primitive.Positioner.Props, "anchor">) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        anchor={anchor}
        sideOffset={4}
        align="start"
        className="isolate z-50"
      >
        <Primitive.Popup
          className={cn("floating-surface combobox-content", className)}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
function ComboboxList({ className, ...props }: Primitive.List.Props) {
  return (
    <Primitive.List className={cn("combobox-list", className)} {...props} />
  );
}
function ComboboxEmpty({ className, ...props }: Primitive.Empty.Props) {
  return (
    <Primitive.Empty className={cn("combobox-empty", className)} {...props} />
  );
}
function ComboboxLabel({ className, ...props }: Primitive.GroupLabel.Props) {
  return (
    <Primitive.GroupLabel
      className={cn("combobox-label", className)}
      {...props}
    />
  );
}
function ComboboxItem({ className, children, ...props }: Primitive.Item.Props) {
  return (
    <Primitive.Item className={cn("combobox-item", className)} {...props}>
      {children}
      <Primitive.ItemIndicator className="combobox-indicator">
        <CheckIcon size={15} />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}
function ComboboxChips({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Chips>) {
  return (
    <Primitive.Chips className={cn("combobox-chips", className)} {...props} />
  );
}
function ComboboxChipsInput({ className, ...props }: Primitive.Input.Props) {
  return (
    <Primitive.Input
      className={cn("combobox-chips-input", className)}
      {...props}
    />
  );
}
function ComboboxChip({
  className,
  children,
  removeLabel,
  ...props
}: Primitive.Chip.Props & { removeLabel: string }) {
  return (
    <Primitive.Chip className={cn("combobox-chip", className)} {...props}>
      {children}
      <Primitive.ChipRemove
        aria-label={removeLabel}
        className="combobox-chip-remove"
      >
        <XIcon size={12} />
      </Primitive.ChipRemove>
    </Primitive.Chip>
  );
}
function useComboboxAnchor() {
  return React.useRef<HTMLDivElement>(null);
}

export {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxLabel,
  ComboboxCollection,
  ComboboxItem,
  ComboboxValue,
  ComboboxChips,
  ComboboxChip,
  ComboboxChipsInput,
  useComboboxAnchor,
};
