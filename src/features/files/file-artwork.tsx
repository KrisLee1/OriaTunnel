import { memo, useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  Code2,
  File,
  FileText,
  Image,
  Music,
  Presentation,
  Table2,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import { interactionSpring } from "@/components/ui/motion";
import "./file-artwork.css";

type Category =
  | "folder"
  | "drive"
  | "batch"
  | "pdf"
  | "table"
  | "document"
  | "slides"
  | "image"
  | "audio"
  | "video"
  | "code"
  | "archive"
  | "file";
const extensions: Partial<Record<Category, string[]>> = {
  pdf: ["pdf"],
  table: ["xlsx", "xls", "csv", "tsv", "ods"],
  document: ["docx", "doc", "odt", "rtf", "txt", "md", "log"],
  slides: ["pptx", "ppt", "odp", "key"],
  image: [
    "png",
    "jpg",
    "jpeg",
    "webp",
    "gif",
    "svg",
    "avif",
    "heic",
    "bmp",
    "tif",
    "tiff",
    "ico",
  ],
  audio: ["mp3", "wav", "flac", "ogg", "m4a", "aac", "aiff", "opus"],
  video: ["mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "mpeg"],
  code: [
    "js",
    "ts",
    "tsx",
    "jsx",
    "py",
    "rs",
    "json",
    "jsonl",
    "html",
    "css",
    "scss",
    "sql",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "bat",
    "cmd",
    "c",
    "cpp",
    "h",
    "java",
    "go",
    "rb",
    "php",
    "swift",
    "kt",
    "lua",
    "yaml",
    "yml",
    "toml",
    "ini",
    "conf",
  ],
  archive: ["zip", "tar", "gz", "bz2", "xz", "zst", "7z", "rar", "tgz"],
};
const glyphs: Partial<Record<Category, LucideIcon>> = {
  pdf: FileText,
  table: Table2,
  document: FileText,
  slides: Presentation,
  image: Image,
  audio: Music,
  video: Video,
  code: Code2,
  archive: Archive,
  file: File,
};
const typeLabels: Partial<Record<Category, string>> = {
  pdf: "PDF",
  table: "DATA",
  document: "DOC",
  slides: "PPT",
  image: "IMG",
  audio: "AUDIO",
  video: "VIDEO",
  code: "CODE",
  archive: "ZIP",
  batch: "FILES",
};

// Appearance only: directory/link identity comes from Rust metadata, never the suffix.
export function fileCategory(name: string, kind?: string): Category {
  if (kind === "directory" || kind === "folder") return "folder";
  if (kind === "drive" || kind === "batch") return kind;
  if (kind === "link") return "file";
  const leaf =
    name
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop()
      ?.toLowerCase() || "";
  if (/^(readme|license|changelog|notice)(\.|$)/.test(leaf)) return "document";
  if (
    ["dockerfile", "makefile", "cmakelists.txt"].includes(leaf) ||
    /^\.(env|bashrc|zshrc|gitignore|gitconfig)(\.|$)/.test(leaf)
  )
    return "code";
  const extension = leaf.includes(".") ? leaf.split(".").pop()! : "";
  return (
    (Object.keys(extensions) as Category[]).find((category) =>
      extensions[category]?.includes(extension),
    ) || "file"
  );
}

/** OriaAide-inspired layered folders and folded sheets, using theme tokens only. */
export const FileArtwork = memo(function FileArtwork({
  name,
  kind,
  large = false,
  className,
}: {
  name: string;
  kind?: string;
  large?: boolean;
  className?: string;
}) {
  const category = fileCategory(name, kind);
  const reducedMotion = useReducedMotion();
  const radiusProbe = useRef<HTMLSpanElement>(null);
  const [radius, setRadius] = useState(4);
  useLayoutEffect(() => {
    const probe = radiusProbe.current;
    if (!probe) return;
    const update = () => {
      const rect = probe.getBoundingClientRect();
      if (rect.height > 0)
        setRadius(Math.round(((rect.width * 64) / rect.height) * 1000) / 1000);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);
  const Glyph = glyphs[category] || File;
  const extension = name
    .split(/[\\/]/)
    .pop()
    ?.match(/\.([a-z0-9]{1,5})$/i)?.[1]
    .toUpperCase();
  const label =
    kind === "link"
      ? "LINK"
      : category === "batch"
        ? "FILES"
        : extension || typeLabels[category] || "FILE";
  const r = radius;
  // Keep matching path commands so the same theme corners survive the morph.
  const sheetBottom = `V${59 - r}Q52 59 ${52 - r} 59H${10 + r}Q10 59 10 ${59 - r}V${5 + r}Q10 5 ${10 + r} 5Z`;
  const sheet = `M${10 + r} 5H39Q39 5 39 5L52 18Q52 18 52 18${sheetBottom}`;
  const unfoldedSheet = `M${10 + r} 5H${52 - r}Q52 5 52 ${5 + r}L52 ${5 + r}Q52 ${5 + r} 52 ${5 + r}${sheetBottom}`;
  const foldRadius = Math.min(r / 2, 3.5);
  const fold = `M39 5V${18 - foldRadius}Q39 18 ${39 + foldRadius} 18H52Z`;
  // Collapse inside the rounded sheet, so the fold stroke cannot leave a spur.
  const cornerX = 52 - r;
  const cornerY = 5 + r;
  const unfoldedCorner = `M${cornerX} ${cornerY}V${cornerY}Q${cornerX} ${cornerY} ${cornerX} ${cornerY}H${cornerX}Z`;
  const folderFront = (left: number, right: number, top: number) =>
    `M${left + r} ${top}H${right - r}Q${right} ${top} ${right} ${top + r}L56 ${56 - r}Q56 56 ${56 - r} 56H${8 + r}Q8 56 8 ${56 - r}L${left} ${top + r}Q${left} ${top} ${left + r} ${top}Z`;
  const front = folderFront(6, 58, 23);
  const openFront = folderFront(3, 61, 25);
  const tabRadius = Math.min(r, 3);
  const back = `M${7 + r} 10H${25 - tabRadius}Q25 10 ${25 + tabRadius} ${10 + tabRadius}L33 18H${57 - r}Q57 18 57 ${18 + r}V${55 - r}Q57 55 ${57 - r} 55H${7 + r}Q7 55 7 ${55 - r}V${10 + r}Q7 10 ${7 + r} 10Z`;
  const shape = (rest: string, hover: string) => ({
    rest: { d: rest },
    "artwork-hover": { d: reducedMotion ? rest : hover },
  });
  const transition = reducedMotion ? { duration: 0 } : interactionSpring;
  return (
    <span
      aria-hidden="true"
      className={cn("files-artwork", large && "files-artwork-large", className)}
      data-category={category}
      data-kind={kind}
    >
      <span ref={radiusProbe} className="files-artwork-radius-probe" />
      {category === "drive" ? (
        <svg viewBox="0 0 64 64" fill="none" className="files-artwork-drive">
          <path
            className="files-artwork-drive-top"
            d={`M${15 + r / 2} 12H${49 - r / 2}Q49 12 50 16L57 32H7L14 16Q15 12 ${15 + r / 2} 12Z`}
          />
          <path
            className="files-artwork-drive-body"
            d={`M${7 + r} 30H${57 - r}Q57 30 57 ${30 + r}V${53 - r}Q57 53 ${57 - r} 53H${7 + r}Q7 53 7 ${53 - r}V${30 + r}Q7 30 ${7 + r} 30Z`}
          />
          <circle className="files-artwork-drive-led" cx="16" cy="42" r="2.5" />
          <path className="files-artwork-drive-detail" d="M25 42H34M43 42H49" />
        </svg>
      ) : category === "batch" ? (
        <svg viewBox="0 0 64 64" fill="none" className="files-artwork-batch">
          <rect
            className="files-artwork-batch-back"
            x="20"
            y="6"
            width="37"
            height="44"
            rx={r}
          />
          <rect
            className="files-artwork-batch-middle"
            x="13"
            y="13"
            width="37"
            height="44"
            rx={r}
          />
          <rect
            className="files-artwork-sheet"
            x="6"
            y="20"
            width="37"
            height="39"
            rx={r}
          />
          <path
            className="files-artwork-batch-lines"
            d="M15 32H34M15 40H34M15 48H27"
          />
        </svg>
      ) : category === "folder" ? (
        <svg viewBox="0 0 64 64" fill="none">
          <path className="files-artwork-folder-back" d={back} />
          <motion.path
            className="files-artwork-folder-front"
            d={front}
            variants={shape(front, openFront)}
            transition={transition}
          />
        </svg>
      ) : (
        <svg viewBox="0 0 64 64" fill="none">
          <motion.path
            className="files-artwork-sheet"
            d={sheet}
            variants={shape(sheet, unfoldedSheet)}
            transition={transition}
          />
          <motion.path
            className="files-artwork-fold"
            d={fold}
            variants={{
              rest: { d: fold, opacity: 1 },
              "artwork-hover": {
                d: reducedMotion ? fold : unfoldedCorner,
                opacity: reducedMotion ? 1 : 0,
              },
            }}
            transition={transition}
          />
          <Glyph
            className="files-artwork-glyph"
            x={large ? 21 : 17}
            y={large ? 16 : 22}
            width={large ? 20 : 28}
            height={large ? 20 : 28}
            strokeWidth={1.5}
          />
          {large && (
            <text
              x={31}
              y={54}
              textAnchor="middle"
              className="files-artwork-extension"
            >
              {label}
            </text>
          )}
        </svg>
      )}
      {kind === "link" && <ArrowUpRight className="files-artwork-link" />}
    </span>
  );
});
