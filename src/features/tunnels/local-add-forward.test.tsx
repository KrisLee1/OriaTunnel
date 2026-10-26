import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReactFlowProvider } from "@xyflow/react";
import "@/i18n";
import { LocalAddForward } from "./local-add-forward";

describe("local card silhouette before DOM measurement", () => {
  const attribute = (node: string | undefined, name: string) =>
    parseFloat(node?.match(new RegExp(`${name}="([^"]+)"`))?.[1] || "NaN");
  it("starts each mount at the actual card size and keeps the hidden droplet inside its right edge", () => {
    for (const size of [
      { width: 200, height: 164 },
      { width: 320, height: 200 },
      { width: 704, height: 320 },
    ]) {
      for (let mount = 0; mount < 2; mount++) {
        const html = renderToStaticMarkup(
          <ReactFlowProvider>
            <LocalAddForward
              card={{ current: null }}
              size={size}
              disabled={false}
              suspended={false}
              onAdd={() => {}}
            />
          </ReactFlowProvider>,
        );
        const skin = html.slice(0, html.indexOf("</svg>"));
        const rect = skin.match(/<rect[^>]*>/)?.[0];
        expect(attribute(rect, "width")).toBe(size.width - 1);
        expect(attribute(rect, "height")).toBe(size.height - 1);
        const circles = skin.match(/<circle[^>]*>/g) || [];
        expect(attribute(circles.at(-1), "cx")).toBe(size.width - 24);
        expect(attribute(circles.at(-1), "cy")).toBe(size.height / 2);
      }
    }
  });
});
