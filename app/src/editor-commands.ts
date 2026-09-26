/**
 * The block commands the rich-text editor offers through its `/` menu, and the
 * URL rules its link and image-link inputs apply.
 *
 * Everything that decides WHAT is offered or accepted lives here as plain data
 * and pure functions, so it can be tested without a DOM or an editor view.
 * `runSlashCommand` is the only part that touches an editor, and it only needs
 * the editor's command chain.
 */
import type { Editor, Range } from '@tiptap/core'

export type SlashCommandId =
  | 'text' | 'h1' | 'h2' | 'h3'
  | 'bullet' | 'numbered' | 'checklist'
  | 'quote' | 'code' | 'divider' | 'table'
  | 'image-upload' | 'image-link'

export type SlashCommand = {
  id: SlashCommandId
  title: string
  description: string
  /** Extra words a person might type for this block (matched by prefix). */
  keywords: readonly string[]
  group: 'Basic blocks' | 'Media'
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: 'text', title: 'Text', description: 'Plain paragraph text', keywords: ['paragraph', 'plain', 'p', 'normal'], group: 'Basic blocks' },
  { id: 'h1', title: 'Heading 1', description: 'Large section heading', keywords: ['h1', 'title', 'heading1', 'big'], group: 'Basic blocks' },
  { id: 'h2', title: 'Heading 2', description: 'Medium section heading', keywords: ['h2', 'subtitle', 'heading2'], group: 'Basic blocks' },
  { id: 'h3', title: 'Heading 3', description: 'Small section heading', keywords: ['h3', 'heading3', 'small'], group: 'Basic blocks' },
  { id: 'bullet', title: 'Bulleted list', description: 'A simple bulleted list', keywords: ['ul', 'unordered', 'bullets', 'list', '-'], group: 'Basic blocks' },
  { id: 'numbered', title: 'Numbered list', description: 'A list with numbers', keywords: ['ol', 'ordered', 'numbers', 'list', '1.'], group: 'Basic blocks' },
  { id: 'checklist', title: 'Checklist', description: 'Track tasks with checkboxes', keywords: ['todo', 'to-do', 'task', 'checkbox', 'check', 'list', '[]'], group: 'Basic blocks' },
  { id: 'quote', title: 'Quote', description: 'Capture a quotation', keywords: ['blockquote', 'citation', '>'], group: 'Basic blocks' },
  { id: 'code', title: 'Code block', description: 'Monospaced code snippet', keywords: ['codeblock', 'pre', 'snippet', 'monospace', '```'], group: 'Basic blocks' },
  { id: 'divider', title: 'Divider', description: 'Visually separate sections', keywords: ['hr', 'rule', 'line', 'separator', 'horizontal', '---'], group: 'Basic blocks' },
  { id: 'table', title: 'Table', description: '3 x 3 table with a header row', keywords: ['grid', 'rows', 'columns', 'spreadsheet'], group: 'Basic blocks' },
  { id: 'image-upload', title: 'Upload image', description: 'PNG, JPEG, GIF or WebP from your device', keywords: ['image', 'picture', 'photo', 'img', 'upload', 'file', 'gif', 'media'], group: 'Media' },
  { id: 'image-link', title: 'Image or GIF from link', description: 'Embed an image by its https:// address', keywords: ['image', 'gif', 'url', 'link', 'embed', 'img', 'picture', 'media'], group: 'Media' },
]

const words = (value: string) => value.toLowerCase().split(/[\s/-]+/).filter(Boolean)

/** True when every character of `needle` appears in `hay` in order. */
function isSubsequence(needle: string, hay: string): boolean {
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return needle.length === 0
}

/**
 * Rank how well a typed query names a command; lower is better, null is no
 * match. Title prefixes beat word prefixes beat keywords beat substrings beat a
 * loose in-order match, so "h" offers the headings first and "td" still finds
 * "To-do"-style checklists through the keyword.
 */
function scoreCommand(command: SlashCommand, query: string): number | null {
  const title = command.title.toLowerCase()
  const compactTitle = title.replace(/\s+/g, '')
  if (title.startsWith(query) || compactTitle.startsWith(query)) return 0
  if (words(title).some((w) => w.startsWith(query))) return 1
  if (command.keywords.some((k) => k.toLowerCase().startsWith(query))) return 2
  if (title.includes(query)) return 3
  if (command.keywords.some((k) => k.toLowerCase().includes(query))) return 4
  if (query.length >= 2 && isSubsequence(query, compactTitle)) return 5
  return null
}

/**
 * The commands to offer for what has been typed after `/`. An empty query
 * offers everything in its natural order; otherwise the best matches come
 * first and ties keep that natural order.
 */
export function filterSlashCommands(query: string, commands: readonly SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return [...commands]
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, q) }))
    .filter((entry): entry is { command: SlashCommand; index: number; score: number } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.command)
}

/** What a slash command needs from the surrounding editor UI. */
export type SlashHooks = {
  /** Open the image file picker; the chosen file goes through insertUpload. */
  pickImage: () => void
  /** Ask for an image URL in the editor's own inline input. */
  promptImageUrl: () => void
}

/**
 * Apply a block command. `range` is the `/query` text to remove first when the
 * command came from the slash menu; pass null from a toolbar.
 */
export function runSlashCommand(editor: Editor, id: SlashCommandId, range: Range | null, hooks: SlashHooks): boolean {
  const chain = editor.chain().focus()
  if (range) chain.deleteRange(range)
  switch (id) {
    case 'text': return chain.clearNodes().setParagraph().run()
    case 'h1': return chain.setHeading({ level: 1 }).run()
    case 'h2': return chain.setHeading({ level: 2 }).run()
    case 'h3': return chain.setHeading({ level: 3 }).run()
    case 'bullet': return chain.toggleBulletList().run()
    case 'numbered': return chain.toggleOrderedList().run()
    case 'checklist': return chain.toggleTaskList().run()
    case 'quote': return chain.toggleBlockquote().run()
    case 'code': return chain.setCodeBlock().run()
    case 'divider': return chain.setHorizontalRule().run()
    case 'table': return chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    case 'image-upload': { const ok = chain.run(); hooks.pickImage(); return ok }
    case 'image-link': { const ok = chain.run(); hooks.promptImageUrl(); return ok }
  }
}

/**
 * A link target typed by a person, or null when it is not one we allow. Only
 * https: and mailto: are accepted; a bare domain such as `example.org/page`
 * is read as https, and a bare email address as mailto.
 */
export function normalizeLinkUrl(input: string): string | null {
  const value = String(input ?? '').trim()
  if (!value || /\s/.test(value)) return null
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(value)) return value
  if (/^https:\/\/[^/\s]+\.[^/\s]+/i.test(value) || /^https:\/\/localhost\b/i.test(value)) return value
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null           // any other scheme, including http:
  if (/^[^@\s/]+@[^@\s/]+\.[a-z]{2,}$/i.test(value)) return `mailto:${value}`
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(value)) return `https://${value}`
  return null
}

/** An image address typed by a person, or null. Only https: images are allowed. */
export function normalizeImageUrl(input: string): string | null {
  const value = String(input ?? '').trim()
  if (!/^https:\/\/[^/\s]+\.[^/\s]+\/?\S*$/i.test(value)) return null
  return value
}
