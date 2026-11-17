import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowUp,
  Folder,
  HardDrive,
  Monitor,
  type LucideIcon,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SearchInput } from "@/components/ui/search-input";
import type { ShellQuery, Prompt } from "./shell-editor";
import { breadcrumbs } from "@/features/files/api";

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
  const [drives, setDrives] = useState(false);
  const [items, setItems] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(0);
  const generation = useRef(0);
  const search = useRef<HTMLInputElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const optionId = useId();
  const parent = breadcrumbs(prompt.cwd, !prompt.powershell).at(-2)?.path;
  const separator = prompt.powershell ? "\\" : "/";
  const base = prompt.cwd.endsWith(separator)
    ? prompt.cwd
    : prompt.cwd + separator;
  const entries: { label: string; path: string | null; icon: LucideIcon }[] =
    items
      .filter((name) =>
        name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
      )
      .map((name) => ({
        label: drives
          ? name
          : name.replace(prompt.powershell ? /[\\/]$/u : /\/$/u, ""),
        path: drives ? name : base + name,
        icon: drives ? HardDrive : Folder,
      }));
  if (!filter) {
    if (prompt.powershell && !drives)
      entries.unshift({
        label: t("local", { ns: "files" }),
        path: null,
        icon: Monitor,
      });
    if (drives || parent)
      entries.unshift({
        label: drives ? t("back", { ns: "files" }) : t("parentDirectory"),
        path: drives ? null : parent!,
        icon: ArrowUp,
      });
  }
  const load = () => {
    const version = ++generation.current;
    setStatus("loading");
    setItems([]);
    setSelected(0);
    void query(drives ? "drives" : "list", drives ? "" : prompt.cwd).then(
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
  }, [open, query, prompt.cwd, drives]);
  const choose = async (path: string | null) => {
    if (status === "changing") return;
    if (path === null) {
      generation.current++;
      setItems([]);
      setDrives(!drives);
      search.current?.focus();
      return;
    }
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
        if (v) setDrives(false);
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
          placeholder={drives ? t("drive", { ns: "files" }) : t("directories")}
          aria-label={drives ? t("drive", { ns: "files" }) : t("directories")}
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
              void choose(entries[selected].path);
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
            {entries.map(({ label, path, icon: Icon }, i) => (
              <button
                key={path ?? "drive-list"}
                id={optionId + "-" + i}
                type="button"
                role="option"
                title={drives && path ? path : undefined}
                aria-selected={i === selected}
                onPointerMove={() => setSelected(i)}
                onClick={() => void choose(path)}
              >
                <Icon size={14} /> {label}
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
