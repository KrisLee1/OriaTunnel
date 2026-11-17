import {
  Fragment,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { DirectoryPicker } from "./directory-picker";
import { toast } from "@/components/ui/toast";
import { breadcrumbs } from "@/features/files/api";
import type { Prompt, ShellQuery } from "./shell-editor";

export type DirectoryNavigation = {
  query: ShellQuery;
  changed: (cwd: string) => void;
};

// BreadcrumbList uses a 2px gap on either side of each slash.
const listGap = 2;
const overflowWidth = 16;
const iconWidthWithGap = 18;
let canvas: CanvasRenderingContext2D | null;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function fitLeaf(
  name: string,
  width: number,
  measure: (value: string) => number,
) {
  if (measure(name) <= width) return name;
  const chars = Array.from(graphemes.segment(name), (part) => part.segment);
  let low = 0,
    high = chars.length - 1,
    best = "…";
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    const end = Math.ceil(keep / 2);
    const label =
      chars.slice(0, keep - end).join("") +
      "…" +
      chars.slice(chars.length - end).join("");
    if (measure(label) <= width) {
      best = label;
      low = keep + 1;
    } else high = keep - 1;
  }
  return best;
}

export function TerminalPath({
  prompt,
  directory,
  focus,
}: {
  prompt: Prompt;
  directory?: DirectoryNavigation;
  focus: () => void;
}) {
  const { t } = useTranslation("files");
  const pickerId = useId();
  const { cwd, home } = prompt;
  const parts = useMemo(() => {
    const path = breadcrumbs(cwd, !prompt.powershell);
    const homeIndex = path.findIndex((part) => part.path === home);
    return homeIndex < 0
      ? path
      : [{ label: "~", path: home }, ...path.slice(homeIndex + 1)];
  }, [cwd, home, prompt.powershell]);
  const last = parts.length - 1;
  const leaf = parts[last];
  const absoluteRoot = parts[0].label === "/";
  const nav = useRef<HTMLElement>(null);
  const pending = useRef(false);
  const [layout, setLayout] = useState({ hidden: 0, leaf: leaf.label });
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    canvas ??= document.createElement("canvas").getContext("2d");
    const context = canvas;
    if (!context) return;
    const measure = () => {
      const font = getComputedStyle(el);
      context.font = font.fontSize + " " + font.fontFamily;
      const width = (value: string) =>
        Math.ceil(context.measureText(value).width);
      const widths = parts.map((part) => width(part.label));
      const separatorWidth = width("/") + 2 * listGap;
      let preferred = widths.reduce((a, b) => a + b, 0) + last * separatorWidth;
      if (absoluteRoot && last > 0) preferred -= separatorWidth - listGap;
      // Fix the preferred width to the complete path. Hiding middle segments
      // must not shrink the box being observed and trigger another collapse.
      const ideal = preferred + iconWidthWithGap + "px";
      if (el.style.width !== ideal) el.style.width = ideal;
      if (!el.clientWidth) return;
      const budget = el.clientWidth - iconWidthWithGap;
      let hidden = 0;
      if (preferred > budget && last > 1) {
        preferred += overflowWidth + separatorWidth;
        while (preferred > budget && hidden < last - 1)
          preferred -= widths[++hidden] + separatorWidth;
      }
      const label = fitLeaf(
        leaf.label,
        budget - preferred + widths[last],
        width,
      );
      setLayout((prev) =>
        prev.hidden === hidden && prev.leaf === label
          ? prev
          : { hidden, leaf: label },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [parts, last, leaf, absoluteRoot]);
  const navigate = async (path: string) => {
    if (!directory || pending.current) return false;
    pending.current = true;
    try {
      const [next] = await directory.query("cd", path);
      directory.changed(next);
      focus();
      return true;
    } catch {
      toast.add({
        type: "error",
        title: t("failed"),
        description: path,
      });
      return false;
    } finally {
      pending.current = false;
    }
  };
  const hidden = parts.slice(1, 1 + layout.hidden);
  return (
    <Breadcrumb
      ref={nav}
      className="shell-path"
      aria-label={t("path")}
      title={cwd}
    >
      {directory ? (
        <label htmlFor={pickerId} title={cwd}>
          <Folder size={14} aria-hidden="true" />
        </label>
      ) : (
        <Folder size={14} aria-hidden="true" />
      )}
      <BreadcrumbList>
        {parts.map((part, i) => {
          const separator = i > 0 && !(i === 1 && absoluteRoot) && (
            <BreadcrumbSeparator>/</BreadcrumbSeparator>
          );
          if (i > 0 && i <= layout.hidden) {
            if (i !== 1) return null;
            return (
              <Fragment key={part.path}>
                {separator}
                <BreadcrumbItem>
                  {directory ? (
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger
                        aria-label={t("collapsedPaths")}
                        title={t("collapsedPaths")}
                      >
                        <BreadcrumbEllipsis />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-max max-w-[min(24rem,80vw)]"
                        data-terminal-ancestors=""
                        finalFocus={() => {
                          focus();
                          return false;
                        }}
                      >
                        {hidden.map((parent) => (
                          <DropdownMenuItem
                            key={parent.path}
                            title={parent.path}
                            onClick={() => void navigate(parent.path)}
                          >
                            {parent.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <BreadcrumbEllipsis />
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          }
          const label = i === last ? layout.leaf : part.label;
          return (
            <Fragment key={part.path}>
              {separator}
              <BreadcrumbItem>
                {!directory ? (
                  <span title={part.path}>{label}</span>
                ) : i === last ? (
                  <DirectoryPicker
                    id={pickerId}
                    prompt={prompt}
                    query={directory.query}
                    navigate={navigate}
                    focus={focus}
                  >
                    {label}
                  </DirectoryPicker>
                ) : (
                  <button
                    type="button"
                    title={part.path}
                    onClick={() => void navigate(part.path)}
                  >
                    {label}
                  </button>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
