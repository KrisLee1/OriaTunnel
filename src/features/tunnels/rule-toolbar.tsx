import {
  FileInputIcon,
  FileOutputIcon,
  PlayIcon,
  SquareIcon,
  Undo2Icon,
  Trash2Icon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function RuleToolbar({
  count,
  selected,
  undoCount,
  busy,
  available,
  onToggleAll,
  onStart,
  onStop,
  onDelete,
  onImport,
  onExport,
  onUndo,
}: {
  count: number;
  selected: number;
  undoCount: number;
  busy: boolean;
  available: boolean;
  onToggleAll: (checked: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onImport: () => void;
  onExport: () => void;
  onUndo: () => void;
}) {
  const { t } = useTranslation("tunnel");
  const disabled = !available || busy;
  return (
    <div className="rule-toolbar" role="group" aria-label={t("forwardActions")}>
      <div className="rule-batch-controls">
        <label className="rule-select-all">
          <input
            type="checkbox"
            aria-label={t("selectAllRules")}
            checked={count > 0 && selected === count}
            ref={(node) => {
              if (node) node.indeterminate = selected > 0 && selected < count;
            }}
            disabled={busy || count === 0}
            onChange={(event) => onToggleAll(event.target.checked)}
          />
          <span>{t("selectAll")}</span>
        </label>
        <span
          className="rule-selection-count"
          data-active={selected > 0}
          aria-live="polite"
        >
          {t("selectionSummary", { selected, count })}
        </span>
        <div className="rule-toolbar-actions">
          <Button
            size="sm"
            variant="primary-soft"
            disabled={disabled || !selected}
            aria-label={t("startSelected")}
            title={t("startSelected")}
            onClick={onStart}
          >
            <PlayIcon />
            {t("start")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={disabled || !selected}
            aria-label={t("stopSelected")}
            title={t("stopSelected")}
            onClick={onStop}
          >
            <SquareIcon />
            {t("stop")}
          </Button>
          {selected > 0 && (
            <Button
              size="sm"
              variant="destructive"
              disabled={disabled}
              onClick={onDelete}
            >
              <Trash2Icon />
              {t("deleteSelected", { count: selected })}
            </Button>
          )}
        </div>
      </div>
      <div className="rule-file-controls">
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={onImport}
        >
          <FileInputIcon />
          {t("importConfig")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || !count}
          title={t(selected ? "exportSelectedHint" : "exportAllHint", {
            count: selected || count,
          })}
          onClick={onExport}
        >
          <FileOutputIcon />
          {t("exportConfig")}
          <span className="rule-export-count">{selected || count}</span>
        </Button>
        {undoCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title={t("undoDelete")}
            onClick={onUndo}
          >
            <Undo2Icon />
            {t("undoDelete")}
            <span className="rule-export-count">{undoCount}</span>
          </Button>
        )}
      </div>
    </div>
  );
}
