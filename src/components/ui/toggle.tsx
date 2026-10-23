import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { buttonVariants } from "./button";
import { cn } from "@/lib/utils";

function Toggle({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={(state) =>
        cn(
          buttonVariants({
            variant: state.pressed ? "primary-soft" : "outline",
            size: "sm",
          }),
          typeof className === "function" ? className(state) : className,
        )
      }
      {...props}
    />
  );
}

export { Toggle, ToggleGroup };
