import { useEffect, useId, useRef, useState } from "react";
import {
  FolderOpenIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";

export function FilePathsEditor({
  value,
  onChange,
  disabled,
  pickFile,
  label,
  addLabel,
  chooseLabel,
  removeLabel,
  description,
  placeholder,
  className = "field",
  formatError = String,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
  pickFile?: () => Promise<string | null>;
  label: string;
  addLabel: string;
  chooseLabel: (count: number) => string;
  removeLabel: (count: number) => string;
  description?: string;
  placeholder?: string;
  className?: string;
  formatError?: (cause: unknown) => string;
}) {
  const id = useId();
  const active = useRef(true);
  const pending = useRef(false);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const [picking, setPicking] = useState<number | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const locked = disabled || picking !== null;
  async function choose(index: number) {
    if (disabled || pending.current || !pickFile) return;
    pending.current = true;
    setPicking(index);
    try {
      const path = await pickFile();
      if (
        active.current &&
        path !== null &&
        index < latest.current.value.length
      ) {
        const next = [...latest.current.value];
        next[index] = path;
        latest.current.onChange(next);
      }
    } catch (cause) {
      if (active.current)
        toast.add({ title: formatError(cause), type: "error", timeout: 6000 });
    } finally {
      pending.current = false;
      if (active.current) setPicking(null);
    }
  }
  return (
    <div className={className} role="group" aria-labelledby={`${id}-title`}>
      <div className="field-section-header">
        <span id={`${id}-title`}>{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={locked}
          onClick={() => onChange([...value, ""])}
        >
          <PlusIcon />
          {addLabel}
        </Button>
      </div>
      {description && (
        <p id={`${id}-hint`} className="muted">
          {description}
        </p>
      )}
      <div className="host-path-list">
        {value.map((path, index) => (
          <div className="host-path-row" key={index}>
            <Input
              value={path}
              disabled={locked}
              aria-label={`${label} · ${index + 1}`}
              aria-describedby={description ? `${id}-hint` : undefined}
              placeholder={placeholder}
              onChange={(event) =>
                onChange(
                  value.map((current, i) =>
                    i === index ? event.target.value : current,
                  ),
                )
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={locked || !pickFile}
              aria-label={chooseLabel(index + 1)}
              title={chooseLabel(index + 1)}
              onClick={() => void choose(index)}
            >
              {picking === index ? (
                <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
              ) : (
                <FolderOpenIcon />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
              disabled={locked}
              aria-label={removeLabel(index + 1)}
              title={removeLabel(index + 1)}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
