import type { ReactNode } from "react";

interface ArtifactViewerProps {
  path: string;
  content: string;
}

function getFileExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

interface MarkdownBlock {
  type: "heading" | "list" | "paragraph";
  level?: number;
  items?: string[];
  text?: string;
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // Unordered list
    if (line.match(/^- /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^- /)) {
        items.push(lines[i].replace(/^- /, ""));
        i++;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    // Paragraph (collect consecutive non-empty, non-special lines)
    let text = line;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^- /)
    ) {
      text += ` ${lines[i]}`;
      i++;
    }
    blocks.push({ type: "paragraph", text });
  }

  return blocks;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      parts.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      parts.push(<em key={key++}>{match[3]}</em>);
    } else if (match[4]) {
      parts.push(<code key={key++}>{match[4]}</code>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

function MarkdownViewer({ content }: { content: string }) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div>
      {blocks.map((block, i) => {
        if (block.type === "heading") {
          const Tag = `h${block.level}` as keyof JSX.IntrinsicElements;
          return <Tag key={i}>{renderInlineMarkdown(block.text!)}</Tag>;
        }
        if (block.type === "list") {
          return (
            <ul key={i}>
              {block.items!.map((item, j) => (
                <li key={j}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{renderInlineMarkdown(block.text!)}</p>;
      })}
    </div>
  );
}

function JsonViewer({ content }: { content: string }) {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    formatted = content;
  }
  return <pre>{formatted}</pre>;
}

function RawViewer({ content }: { content: string }) {
  return <pre>{content}</pre>;
}

export default function ArtifactViewer({ path, content }: ArtifactViewerProps) {
  const ext = getFileExtension(path);

  if (ext === ".md") {
    return (
      <div data-testid="artifact-viewer" data-type="markdown">
        <MarkdownViewer content={content} />
      </div>
    );
  }

  if (ext === ".json") {
    return (
      <div data-testid="artifact-viewer" data-type="json">
        <JsonViewer content={content} />
      </div>
    );
  }

  return (
    <div data-testid="artifact-viewer" data-type="raw">
      <RawViewer content={content} />
    </div>
  );
}
