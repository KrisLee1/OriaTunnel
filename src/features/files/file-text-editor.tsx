import { useState, type ReactNode } from "react";
import { WrapText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ui/code-block";

export function FileTextEditor({
  value,
  onChange,
  language,
  encoding,
  lineEnding,
  saving,
  actions,
}: {
  value: string;
  onChange: (value: string) => void;
  language: string;
  encoding: string;
  lineEnding: string;
  saving: boolean;
  actions: ReactNode;
}) {
  const { t } = useTranslation("files");
  const { t: common } = useTranslation();
  const [wrap, setWrap] = useState(false);
  return (
    <CodeBlock className="files-preview-code files-text-editor">
      <CodeBlockHeader>
        <CodeBlockTitle>
          {language === "text" ? common("codeBlock.plainText") : language}
        </CodeBlockTitle>
        <span className="files-code-count">
          {encoding} · {lineEnding}
        </span>
        <CodeBlockActions>
          <Button
            variant="ghost"
            size="icon-xs"
            title={common("codeBlock.wrap")}
            aria-label={common("codeBlock.wrap")}
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            <WrapText />
          </Button>
          <CodeBlockCopyButton value={value} />
          {actions}
        </CodeBlockActions>
      </CodeBlockHeader>
      <Textarea
        autoFocus
        className="files-editor-input"
        aria-label={t("fileContent")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={saving}
        wrap={wrap ? "soft" : "off"}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </CodeBlock>
  );
}
