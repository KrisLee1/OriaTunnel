import { useState, type CSSProperties } from "react";
import { PaletteIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const presets = [
  { color: "#5b9fe6", label: "colorBlue" },
  { color: "#67ad98", label: "colorGreen" },
  { color: "#da89b0", label: "colorPink" },
  { color: "#e8b45f", label: "colorAmber" },
  { color: "#a58adf", label: "colorPurple" },
  { color: "#58b9c8", label: "colorCyan" },
  { color: "#df7f78", label: "colorRed" },
  { color: "#9ba6b5", label: "colorGray" },
] as const;

export function ConnectionColorDot({ color }: { color: string | null }) {
  return (
    <span
      className="connection-color-dot"
      style={{ backgroundColor: color || "var(--oria-color-accent)" }}
      aria-hidden="true"
    />
  );
}

export function ConnectionColorPicker({
  value,
  onChange,
  fieldLabel,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  fieldLabel?: string;
}) {
  const { t } = useTranslation("tunnel");
  const [lastCustom, setLastCustom] = useState(value || "#ef797d");
  const normalized = value?.toLowerCase() || null;
  const customSelected =
    !!normalized && !presets.some((preset) => preset.color === normalized);
  return (
    <div
      className="field"
      role="group"
      aria-label={fieldLabel ?? t("connectionColor")}
    >
      <span>{fieldLabel ?? t("connectionColor")}</span>
      <div className="connection-color-palette">
        {[{ color: null, label: "themeColor" }, ...presets].map((option) => (
          <Button
            key={option.label}
            type="button"
            variant="ghost"
            size="icon"
            className="connection-color-swatch"
            aria-label={t(option.label)}
            title={t(option.label)}
            aria-pressed={normalized === option.color}
            style={
              {
                "--swatch-color": option.color || "var(--oria-color-accent)",
              } as CSSProperties
            }
            onClick={() => onChange(option.color)}
          >
            <span className="connection-color-fill" />
          </Button>
        ))}
        <label
          className="connection-color-swatch connection-color-custom"
          data-selected={customSelected}
          title={t("customColor")}
          style={
            {
              "--swatch-color": customSelected ? value : lastCustom,
            } as CSSProperties
          }
        >
          <input
            type="color"
            aria-label={t("customColor")}
            value={customSelected ? value! : lastCustom}
            onChange={(event) => {
              setLastCustom(event.target.value);
              onChange(event.target.value);
            }}
          />
          <span className="connection-color-fill">
            <PaletteIcon size={17} aria-hidden="true" />
          </span>
        </label>
      </div>
    </div>
  );
}
