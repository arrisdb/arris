import "./index.css";
import { markdownToHtml } from "../../utils/markdown/render";
import type { MarkdownPreviewProps } from "./types";

function MarkdownPreview({ source }: MarkdownPreviewProps) {
  return (
    <div
      className="mdbc-markdown-preview"
      data-testid="markdown-preview"
      // Trusted: rendered from the user's own local markdown file.
      dangerouslySetInnerHTML={{ __html: markdownToHtml(source) }}
    />
  );
}

export { MarkdownPreview };
