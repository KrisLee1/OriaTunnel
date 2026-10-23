import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { ParameterTitle } from "@/components/parameter-field";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import type { Host } from "@/types";
export function JumpRouteEditor({
  hosts,
  hostId,
  value,
  onChange,
  disabled = false,
}: {
  hosts: Host[];
  hostId: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("tunnel");
  const ids = value?.split(",").filter(Boolean) || [];
  const candidates = hosts.filter((h) => h.id !== hostId);
  const save = (next: string[]) =>
    onChange(next.length ? next.join(",") : null);
  return (
    <div className="jump-route-editor">
      <div className="field-section-header">
        <ParameterTitle
          label={t("jumpHostTitle")}
          parameter="-J"
          description={t("jumpOrderHint")}
        />
        <div className="field-section-actions">
          {!ids.length && (
            <span className="muted">{t("directConnection")}</span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={
              disabled ||
              ids.length >= 8 ||
              !candidates.some((h) => !ids.includes(h.id))
            }
            onClick={() => {
              const next = candidates.find((h) => !ids.includes(h.id));
              if (next) save([...ids, next.id]);
            }}
          >
            <PlusIcon />
            {t("addJump")}
          </Button>
        </div>
      </div>
      <div className="host-path-list">
        {ids.map((id, index) => (
          <div className="host-path-row" key={index}>
            <Select
              disabled={disabled}
              items={[
                ...(!candidates.some((h) => h.id === id)
                  ? [{ value: id, label: t("sourceMissing") }]
                  : []),
                ...candidates.map((h) => ({
                  value: h.id,
                  label: `${index + 1}. ${h.name}`,
                })),
              ]}
              value={id}
              onValueChange={(hostId) =>
                hostId &&
                save(ids.map((current, i) => (i === index ? hostId : current)))
              }
            >
              <SelectTrigger
                className="min-w-0 flex-1"
                aria-label={t("jumpNumber", { count: index + 1 })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {!candidates.some((h) => h.id === id) && (
                  <SelectItem value={id} disabled>
                    {t("sourceMissing")}
                  </SelectItem>
                )}
                {candidates.map((h) => (
                  <SelectItem
                    key={h.id}
                    value={h.id}
                    disabled={ids.includes(h.id) && id !== h.id}
                  >
                    {index + 1}. {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
              disabled={disabled}
              aria-label={`${t("removeJump")} · ${index + 1}`}
              title={t("removeJump")}
              onClick={() => save(ids.filter((_, i) => i !== index))}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
