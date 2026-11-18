import type { Entry } from "./api";
import { TIME_HEADING_HEIGHT, type TimeGroup } from "./time-groups";

export type FileSection = { time: TimeGroup | null; items: Entry[] };

export function fileSectionLayout(
  sections: FileSection[],
  columns: number,
  rowHeight: number,
) {
  let height = 0;
  const positions = sections.map((section) => {
    const top = height;
    const contentTop = top + (section.time ? TIME_HEADING_HEIGHT : 0);
    height = contentTop + Math.ceil(section.items.length / columns) * rowHeight;
    return { ...section, top, contentTop, bottom: height };
  });
  return { sections: positions, height };
}
