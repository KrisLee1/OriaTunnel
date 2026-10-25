import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import i18n from "@/i18n";
import { RuleToolbar } from "./rule-toolbar";

function render(selected: number, busy = false, available = true) {
  return renderToStaticMarkup(
    <RuleToolbar
      count={3}
      selected={selected}
      undoCount={0}
      busy={busy}
      available={available}
      onToggleAll={() => {}}
      onStart={() => {}}
      onStop={() => {}}
      onDelete={() => {}}
      onImport={() => {}}
      onExport={() => {}}
      onUndo={() => {}}
    />,
  );
}
describe("bulk deletion action", () => {
  const label = (count: number) =>
    i18n.t("deleteSelected", { ns: "tunnel", count });
  it("only offers deletion after a selection and reports its scope", () => {
    expect(render(0)).not.toContain("lucide-trash-2");
    expect(render(2)).toContain(label(2));
    expect(render(2)).toContain("lucide-trash-2");
  });
  it("blocks deletion while a request is running or native actions are unavailable", () => {
    for (const html of [render(2, true), render(2, false, false)]) {
      const action = html
        .match(/<button[^>]*>[\s\S]*?<\/button>/g)
        ?.find((button) => button.includes(label(2)));
      expect(action).toContain("disabled");
    }
  });
});
