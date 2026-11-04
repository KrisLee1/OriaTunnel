import mermaid from "mermaid";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { mermaidThemeColor } from "@/lib/markdown/mermaid-theme";
import { RichSurface } from "./rich-surface";

export default function Mermaid({ source }: { source: string }) {
  const { t } = useTranslation();
  const id = useId().replace(/[^a-z0-9]/gi, "");
  const [svg, setSvg] = useState(""),
    [error, setError] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setRevision((v) => v + 1));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) =>
      mermaidThemeColor(
        styles.getPropertyValue(`--oria-color-${name}`),
        getComputedStyle(document.body).color,
      );
    try {
      mermaid.initialize({
        startOnLoad: false,
        secure: [
          "secure",
          "securityLevel",
          "startOnLoad",
          "maxTextSize",
          "maxEdges",
          "theme",
          "themeVariables",
          "themeCSS",
          "htmlLabels",
        ],
        securityLevel: "strict",
        htmlLabels: false,
        suppressErrorRendering: true,
        maxTextSize: 50_000,
        maxEdges: 500,
        theme: "base",
        themeVariables: {
          background: "transparent",
          primaryColor: token("surface"),
          primaryTextColor: token("fg"),
          primaryBorderColor: token("border"),
          lineColor: token("fg"),
          secondaryColor: token("accent"),
          tertiaryColor: token("surface"),
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        },
      });
      // Strict rendering does not bind generated click handlers.
      void mermaid.render(`tunnel-mermaid-${id}-${revision}`, source).then(
        (result) => {
          if (live) {
            setSvg(result.svg);
            setError(false);
          }
        },
        () => {
          if (live) {
            setError(true);
            setSvg("");
          }
        },
      );
    } catch {
      setError(true);
      setSvg("");
    }
    return () => {
      live = false;
    };
  }, [source, id, revision]);
  return error ? (
    <p role="alert">{t("markdown.mermaidError")}</p>
  ) : svg ? (
    <RichSurface title={t("markdown.mermaidDiagram")}>
      <div
        className="markdown-diagram"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </RichSurface>
  ) : (
    <p role="status">{t("markdown.renderingDiagram")}</p>
  );
}
