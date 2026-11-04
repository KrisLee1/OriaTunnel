import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  parseDataChartSpec,
  renderDataChartSvg,
  defaultDataChartTheme,
} from "@/lib/markdown/data-chart";
import { mermaidThemeColor } from "@/lib/markdown/mermaid-theme";
import { RichSurface } from "./rich-surface";

export default function DataChart({ source }: { source: string }) {
  const { t, i18n } = useTranslation(),
    id = useId();
  const [revision, update] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => update((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  const svg = useMemo(() => {
    const parsed = parseDataChartSpec(source);
    if (!parsed.ok) return null;
    const style =
      typeof document === "undefined"
        ? null
        : getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) =>
      style
        ? mermaidThemeColor(
            style.getPropertyValue(`--oria-color-${name}`),
            fallback,
          )
        : fallback;
    return renderDataChartSvg(
      parsed.spec,
      {
        ...defaultDataChartTheme,
        background: "transparent",
        foreground: color("fg", defaultDataChartTheme.foreground),
        muted: color("muted-fg", defaultDataChartTheme.muted),
        grid: color("border", defaultDataChartTheme.grid),
      },
      { idPrefix: id, locale: i18n.language },
    );
  }, [source, revision, id, i18n.language]);
  return svg ? (
    <RichSurface title={t("markdown.dataChart")}>
      <div
        className="markdown-diagram"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </RichSurface>
  ) : (
    <p role="alert">{t("markdown.dataChartError")}</p>
  );
}
