import "@/i18n";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ContextMenu } from "@/components/ui/context-menu";
import {
  FileSortOptions,
  FileCreateOptions,
  FileUploadOptions,
} from "./file-options-menu";

describe("opened file options menu", () => {
  for (const Root of [DropdownMenu, ContextMenu]) {
    it("shares create, sort and upload items with a valid Base UI parent in either menu", () => {
      const html = renderToStaticMarkup(
        <Root defaultOpen>
          <FileSortOptions
            sort="type"
            descending
            onSortChange={() => {}}
            onDescendingChange={() => {}}
          />
          <FileCreateOptions
            canCreate
            onCreate={() => {}}
            onCreateText={() => {}}
          />
          <FileUploadOptions canUpload onUpload={() => {}} />
        </Root>,
      );
      expect(html.match(/data-slot="dropdown-menu-item"/g)).toHaveLength(10);
      expect(html).toContain("lucide-folder-plus");
      expect(html).toContain("lucide-file-plus-2");
      expect(html).toContain("lucide-folder-up");
      expect(html).toContain("lucide-file-up");
      expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    });
  }
});
