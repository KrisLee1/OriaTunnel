import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MarkdownLink } from "@/components/ui/markdown-link";
import { documentUrl } from "@/lib/markdown/document-url";
import "@/features/files/markdown/markdown.css";

export default function ReleaseNotes({ content }: { content: string }) {
  return (
    <div
      className="markdown-document mt-2 overflow-x-auto [&_p]:whitespace-pre-line"
      data-selectable="true"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => documentUrl(url)}
        components={{
          a: MarkdownLink,
          img: ({ alt }) => <>{alt}</>,
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
