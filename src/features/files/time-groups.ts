import { useEffect, useState } from "react";
import type { TFunction } from "i18next";

export const TIME_HEADING_HEIGHT = 32;

function localMidnight(date = new Date()) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

export function useLocalDay() {
  const [day, setDay] = useState(localMidnight);
  useEffect(() => {
    let timer: number;
    const refresh = () => {
      window.clearTimeout(timer);
      const now = new Date();
      setDay(localMidnight(now));
      const next = new Date(now);
      next.setHours(24, 0, 0, 0);
      timer = window.setTimeout(refresh, +next - +now);
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return day;
}

export type TimeGroup = {
  key:
    | "today"
    | "yesterday"
    | "pastWeek"
    | "thisMonth"
    | "unknownTime"
    | number;
  start: number;
};

export function groupByTime<T>(
  items: T[],
  timestamp: (item: T) => number | null | undefined,
  day: number,
  newest: boolean,
) {
  const today = new Date(day);
  const midnight = (offset: number) =>
    +new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  const yesterday = midnight(-1);
  const week = midnight(-6);
  const month = +new Date(today.getFullYear(), today.getMonth(), 1);
  const groups = new Map<TimeGroup["key"], { time: TimeGroup; items: T[] }>();
  for (const item of items) {
    const ms = timestamp(item);
    let key: TimeGroup["key"];
    let start: number;
    if (ms == null || !Number.isFinite(ms)) {
      key = "unknownTime";
      start = 0;
    } else if (ms >= day) {
      key = "today";
      start = day;
    } else if (ms >= yesterday) {
      key = "yesterday";
      start = yesterday;
    } else if (ms >= week) {
      key = "pastWeek";
      start = week;
    } else if (ms >= month) {
      key = "thisMonth";
      start = month;
    } else {
      const date = new Date(ms);
      key = start = +new Date(date.getFullYear(), date.getMonth(), 1);
    }
    let group = groups.get(key);
    if (!group) {
      group = { time: { key, start }, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.time.key === "unknownTime") -
        Number(b.time.key === "unknownTime") ||
      (a.time.start - b.time.start) * (newest ? -1 : 1),
  );
}

export function timeGroupLabel(
  group: TimeGroup,
  t: TFunction<"files">,
  language: string,
  day: number,
) {
  if (typeof group.key === "string") return t(group.key);
  const date = new Date(group.key);
  return date.toLocaleDateString(language, {
    month: "long",
    year:
      date.getFullYear() === new Date(day).getFullYear()
        ? undefined
        : "numeric",
  });
}
