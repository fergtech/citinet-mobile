// A note's "rich" body is a TipTap/ProseMirror JSON document written by the web
// editor. This app's editor is plain text only, so it must never silently drop
// a rich body it doesn't understand — these helpers decide when a note carries
// real formatting or media that a plain-text save would destroy.

/** Node types that count as real content even though they carry no `text`. */
const NON_TEXT_CONTENT = new Set(['image', 'video', 'youtube', 'linkPreview', 'horizontalRule']);

/** Marks / node types that a plain-text round trip would flatten. */
const FORMATTING_NODES = new Set([
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
]);

type RichNode = { type?: string; text?: string; marks?: unknown[]; content?: RichNode[] };

/**
 * True when saving this note as plain text would lose something: embedded
 * media, headings/lists/quotes/code, or inline marks (bold, links, …). A rich
 * doc that is just unformatted paragraphs is safe to flatten, so it isn't
 * reported as formatted — those notes stay editable here.
 */
export function hasFormattingOrMedia(rich: unknown): boolean {
  const visit = (node: RichNode | null | undefined): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (node.type && (NON_TEXT_CONTENT.has(node.type) || FORMATTING_NODES.has(node.type))) return true;
    if (Array.isArray(node.marks) && node.marks.length > 0) return true;
    return Array.isArray(node.content) && node.content.some(visit);
  };
  return visit(rich as RichNode);
}
