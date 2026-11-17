import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Folder } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchInput } from "@/components/ui/search-input";
import type { ShellQuery, Prompt } from "./shell-editor";

export function DirectoryPicker({
  id,
  prompt,
  query,
  navigate,
  focus,
  children,
}: {
  id: string;
  query: ShellQuery;
  navigate: (path: string) => Promise<boolean>;
  prompt: Prompt;
  focus: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation("terminal");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<{
    side: "top" | "bottom";
    height: number;
    boundary?: Element;
  }>({ side: "bottom", height: 216 });
  const [filter, setFilter] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(0);
  const generation = useRef(0);
  const search = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const optionId = useId();
  const entries = [
    ...(prompt.cwd !== "/" && !filter ? [".."] : []),
    ...items.filter((i) =>
      i.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
    ),
  ];
  const load = () => {
    const version = ++generation.current;
    setStatus("loading");
    setItems([]);
    setSelected(0);
    void query("list", prompt.cwd).then(
      (list) => {
        if (version === generation.current) {
          setItems(list);
          setStatus("");
        }
      },
      () => {
        if (version === generation.current) setStatus("directoryError");
      },
    );
  };
  useEffect(() => {
    if (!open) return;
    load();
    return () => {
      generation.current++;
    };
  }, [open, query, prompt.cwd]);
  const choose = async (name: string) => {
    if (!name || status === "changing") return;
    const path =
      name === ".."
        ? prompt.cwd.replace(/\/[^/]+\/?$/u, "") || "/"
        : prompt.cwd.replace(/\/$/u, "") + "/" + name;
    setStatus("changing");
    if (await navigate(path)) {
      setOpen(false);
    } else {
      setStatus("directoryError");
    }
  };
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (v && trigger.current) {
          const rect = trigger.current.getBoundingClientRect();
          const boundary =
            trigger.current.closest(".ssh-terminal-view") || undefined;
          const pane = boundary?.getBoundingClientRect();
          const above = rect.top - Math.max(0, pane?.top ?? 0);
          const below =
            Math.min(window.innerHeight, pane?.bottom ?? window.innerHeight) -
            rect.bottom;
          const top = above >= 224 || above >= below;
          setPlacement({
            side: top ? "top" : "bottom",
            height: Math.max(68, Math.min(216, (top ? above : below) - 8)),
            boundary,
          });
        }
        setOpen(v);
        setFilter("");
      }}
    >
      <PopoverTrigger
        id={id}
        ref={trigger}
        title={prompt.cwd}
        aria-label={prompt.cwd}
        aria-current="location"
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        className="shell-directory overflow-hidden gap-0 p-0"
        side={placement.side}
        style={{ height: placement.height }}
        collisionBoundary={placement.boundary}
        collisionAvoidance={{
          side: "none",
          align: "shift",
          fallbackAxisSide: "none",
        }}
        align="start"
        aria-label={t("directories")}
        initialFocus={search}
        finalFocus={() => {
          focus();
          return false;
        }}
      >
        <SearchInput
          ref={search}
          embedded
          placeholder={t("directories")}
          aria-label={t("directories")}
          value={filter}
          role="combobox"
          aria-expanded
          aria-controls={optionId}
          aria-activedescendant={
            entries.length ? optionId + "-" + selected : undefined
          }
          onChange={(e) => {
            if (viewport.current) viewport.current.scrollTop = 0;
            setFilter(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const next = Math.max(
                0,
                Math.min(
                  entries.length - 1,
                  selected + (e.key === "ArrowDown" ? 1 : -1),
                ),
              );
              setSelected(next);
              options.current?.children[next]?.scrollIntoView({
                block: "nearest",
              });
            }
            if (e.key === "Enter" && entries[selected]) {
              e.preventDefault();
              void choose(entries[selected]);
            }
          }}
        />
        <ScrollArea
          className="min-h-0 flex-1"
          viewportRef={viewport}
          viewportClassName="shell-directory-viewport scroll-fade"
          contentClassName="p-1"
        >
          <div
            ref={options}
            id={optionId}
            role="listbox"
            aria-label={t("directories")}
            className="shell-options"
          >
            {entries.map((name, i) => (
              <button
                key={name}
                id={optionId + "-" + i}
                type="button"
                role="option"
                aria-selected={i === selected}
                onPointerMove={() => setSelected(i)}
                onClick={() => void choose(name)}
              >
                {name === ".." ? <ArrowUp size={14} /> : <Folder size={14} />}{" "}
                {name === ".."
                  ? t("parentDirectory")
                  : name.replace(/\/$/u, "")}
              </button>
            ))}
          </div>
          {status === "directoryError" ? (
            <button
              className="shell-directory-status"
              type="button"
              onClick={load}
            >
              {t("directoryError")}
            </button>
          ) : status || !entries.length ? (
            <span className="shell-directory-status" role="status">
              {t(status ? "loading" : "noMatches")}
            </span>
          ) : null}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
