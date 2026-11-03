import "@/i18n";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { FileOptionsMenu } from "./file-options-menu";

describe("opened file options menu", () => {
  for (const remote of [false, true]) {
    it(`renders ${remote ? "remote" : "local"} popup contents with real Base UI group contexts`, () => {
      // Render contents directly: server-rendered portals skip their descendants,
      // which would hide the missing Menu.Group error until the user opens it.
      const html = renderToStaticMarkup(
        <DropdownMenu defaultOpen>
          <FileOptionsMenu
            remote={remote}
            hidden={false}
            sort="name"
            canCreate
            canUpload
            onHiddenChange={() => {}}
            onSortChange={() => {}}
            onCreate={() => {}}
            onUpload={() => {}}
          />
        </DropdownMenu>,
      );
      expect(html.match(/data-slot="dropdown-menu-group"/g)).toHaveLength(3);
      expect(html.match(/data-slot="dropdown-menu-item"/g)).toHaveLength(
        remote ? 7 : 5,
      );
      expect(html).toContain("lucide-eye");
      expect(html).toContain("lucide-arrow-down-a-z");
      expect(html).toContain("lucide-check");
      expect(html).toContain("lucide-folder-plus");
    });
  }
});
