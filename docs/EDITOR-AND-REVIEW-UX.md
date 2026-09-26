# Rich-text editor and review workspace (2026-09-26)

This update replaces the bare editor toolbar with a Notion-style editor, fixes how
imported historical documents read, and gives Roast Me (RM) and review drafts a
larger workspace. Stored content is unchanged: every document, review, abstract,
motivation and task description is still HTML, so no migration is needed.

## Why Tiptap and not BlockNote

BlockNote was considered because it ships a Notion-like UI out of the box. It was
rejected because it stores its own block JSON. Everything that reads stored
content works on HTML: `live.ts` strips and re-signs image URLs through
`data-object-path`, `highlight.ts` anchors review comments to text positions,
plus `sanitize()`, `DocumentImages` and the historical import. Switching would
have meant a data migration and rewriting those paths. The editor UI was built
on the Tiptap v3 setup the app already had.

## Editor (`app/src/Editor.tsx`, `editor-commands.ts`, `editor.css`)

- **Slash menu.** Type `/` at the start of a line or after a space. Commands:
  Text, Heading 1 to 3, Bulleted list, Numbered list, Checklist, Quote, Code block,
  Divider, Table, Upload image, Image or GIF from link. Arrow keys, Enter/Tab and
  Escape work; typing filters the list. The command list and filter live in
  `editor-commands.ts` as a pure, tested function.
- **Selection bubble menu.** Text style, bold, italic, underline, strike, inline
  code and link. The link field replaces `window.prompt()`, accepts only
  `https://` and `mailto:` (bare domains become https, bare emails become
  mailto) and can remove a link. Ctrl/Cmd+K opens it.
- **Tables.** Inserted as 3x3 with a header row. While the cursor is inside a
  table a control strip adds or deletes rows and columns, toggles the header row
  or deletes the table. Wide tables scroll horizontally.
- **Checklists.** Nested items are allowed. Read-only views cannot toggle them.
- **Toolbar.** Grouped icon buttons (lucide-react) with `aria-label` and tooltip,
  active states, sticky while scrolling, wraps in narrow panes. The old "Upload
  Image" label had inline light styles that rendered white on white in dark mode;
  it is now a normal themed button.
- **Images.** Paste and drag-and-drop follow the same rules and both go through
  the existing upload path, so the `data-object-path` invariant is unchanged.
- **Placeholders.** An empty document says "Type '/' for commands, or just start
  writing…"; empty headings show their level.
- **No typography extension.** `--` stays as typed instead of turning into a
  dash.
- **Opening a draft no longer marks it unsaved.** Tiptap can normalise a freshly
  loaded document and fire `onUpdate` before `onCreate`. The first update is now
  the baseline and only real changes reach `onChange`, so opening a draft no
  longer autosaves or triggers the unsaved-changes prompt.
- **Label click fix.** Editors sit inside `<label className="field">`. A click
  inside the editor used to activate the label's first control, which silently
  pressed the first toolbar button (formerly Bold). The editor now cancels that
  default, and clicking the label text focuses the editor.

Drag-to-reorder blocks was left out: `@tiptap/extension-drag-handle` requires the
collaboration packages (yjs) as peer dependencies.

**Packages added:** `@tiptap/suggestion`, `@tiptap/extension-table`,
`@tiptap/extension-list` (all `^3.31.3`, matching the other Tiptap packages) and
`@floating-ui/dom` (already present transitively). Run `npm install` in `app/`.

**`highlight.ts`:** the inline-comments renderer's attribute allowlist now keeps
`data-type`/`data-checked` (checklists), `start` on ordered lists and
`colspan`/`rowspan` on cells. The comment-anchoring text is unchanged.

**CSS:** old editor rules were removed from `style.css` and `studio.css`; all
editor styles are in `editor.css`. `.split-pane` uses `overflow-x: clip` so the
sticky toolbar can stick inside split panes.

## Garbled imported text (`app/src/imported-title.ts`)

Some imported titles showed `Ã¢â‚¬â€` instead of `—`: UTF-8 text misread as
Windows-1252 twice, sometimes with the undefined byte 0x9D dropped.
`repairMojibake()` finds runs that look like misdecoded UTF-8, maps them back to
bytes and decodes them strictly (up to three passes, restoring a dropped 0x9D).
Runs that do not decode are left alone, so text like "Ayşe", "café" or "naïve" is
never changed. `cleanImportedText()` runs it first, then the old replacement
table as a fallback.

The repair is presentation-only; stored rows are unchanged. Non-imported
document titles now pass through `presentDocumentTitle()`, because the database
builds review draft titles as `'Review of ' || <RM title>` in
`supabase/migrations/202609250022_progress_reviews.sql`. For imported RMs, that
copies the raw "Historical RM —" title and its encoding damage into new rows.
**Follow-up:** clean the title in that SQL function too, so new drafts stop
storing it.

## Historical RM bodies (`app/src/historical-body.ts`)

Imported RMs stored their extracted text inside `<pre>`/`<code>`, so they
rendered as monospace strips with hard line wraps. `presentHistoricalBody()`
turns that into readable HTML at load time in `live.ts`, only for documents
flagged historical:

- paragraphs are split on blank lines and hard wraps inside them are rejoined
- lines starting with `-`, `*`, `•` or `1.` become lists, and URLs become links
- the `--- Source RM: … ---` banner and `Initiative: … Status: …` lines become a
  compact block quote with bold labels

It does nothing to clean or user-written HTML, preserves images, and leaves
stored content verbatim.

## Larger RM and review workspace (`App.tsx`, `visual-update.css`)

- The document dialog (`Modal size="document"`) is up to 1400px wide and nearly
  full screen height. Other dialogs keep their 560px size.
- Document pages (`#/document/:id`) use `ol-page-wide` (1480px instead of 1080px).
- Draft editors are taller (`.doc-draft`, up to 58vh).
- The dialog header uses icon buttons: **show/hide the RM being reviewed** (review
  drafts only), **open full page** (maximize) and **close**. The full page shows
  the same toggle next to the back link.
- The toggle's state is saved per browser (`openlabs:review-reference:v1`) and
  applies across drafts, the dialog and the full page. Hiding the RM gives the
  review the full width without remounting the editor, so cursor and undo
  history are kept.
- The RM pane's own "Open full page" link is now an open-in-page icon, so it is
  not confused with the dialog's maximize button.

## Known limits

- Table HTML is verbose. Task details are capped at 8000 characters in the
  database, and `sanitize()` truncates display at 20000 characters by default.
- Tables have no column resizing.

## Tests

New: `editor.test.ts` (slash filtering, link/image URL rules, schema round trip
of tables, dividers, checklists, quotes, code blocks and images with
`data-object-path`, including after `sanitize()`), `historical-body.test.ts`, and
more cases in `imported-title.test.ts`. `npx tsc --noEmit` passes. `npx vitest
run` passes except the failures that were already there:
`src/workspace-loading.test.tsx` (one test) and
`scripts/check-import.test.mjs` ("No test suite found").
