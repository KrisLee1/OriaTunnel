import { useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { EyeClosedIcon, EyeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordInput({
  id,
  ...props
}: Omit<ComponentProps<typeof Input>, "type" | "className"> & { id: string }) {
  const { t } = useTranslation("tunnel");
  const [revealed, setRevealed] = useState(false);
  const label = t(revealed ? "hidePassword" : "showPassword");
  return (
    <div className="relative">
      <Input
        {...props}
        id={id}
        className="pr-10"
        type={revealed ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-0.5 right-0.5 text-muted-foreground"
        aria-label={label}
        title={label}
        aria-controls={id}
        aria-pressed={revealed}
        onClick={() => setRevealed(!revealed)}
      >
        {revealed ? (
          <EyeIcon aria-hidden="true" />
        ) : (
          <EyeClosedIcon aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
