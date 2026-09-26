# UI changes

## Editor and review workspace (2026-09-26)

- Notion-style editor on the existing Tiptap setup: `/` command menu, selection bubble menu with an inline link field, tables, checklists, dividers, code blocks, a themed icon toolbar and drag-and-drop images. Content is still stored as HTML.
- Imported titles with double-encoded characters (for example `Ã¢â‚¬â€`) are repaired for display, and imported RM bodies render as paragraphs and lists instead of monospace strips.
- RM and review drafts open in a near-full-screen dialog and a wider full page. Header actions are icons: show/hide the RM being reviewed, open full page, close.
- Details, follow-ups and known limits: [EDITOR-AND-REVIEW-UX.md](EDITOR-AND-REVIEW-UX.md).

## Technical studio revamp (2026-09-22)

- Adapted the supplied UI dashboard HTML into the existing application: midnight surfaces, blue actions, coral/cyan accents, branded header and persistent desktop navigation. Mobile keeps the hamburger menu, Escape and focus behavior. Saved light/dark preferences remain intact.
- Member dashboard groups actual Roast Me obligations, reviews, decisions, threads and initiatives with clear counts and responsive columns. Existing data selectors and action handlers remain in place.
- Shared controls, editor focus, tables, dialogs and empty states use the new visual treatment. Wide tables have keyboard-focusable local scroll containers.
- Real pending state now shows the supplied neural arbor SVG. The loader has no artificial delay or fake progress and respects reduced motion. Existing success, error and retry logic remains unchanged.
- `studio.css` contains the staged presentation layer after the original stylesheet. No UI framework, backend migration or external font download was added; named fonts have system fallbacks.
- See [the staged plan](UI-REVAMP-PLAN.md), [agent packets](UI-REVAMP-TASKS.md), and [validation report](UI-REVAMP-REVIEW.md).

## Settings and navigation

- Primary navigation now opens from a hamburger button and closes after navigation, an outside click, or Escape.
- Settings consolidates personal profile editing, light/dark appearance, account sign-in or sign-out, demo identity switching, and read-only role preview.
- Existing profile bookmarks continue to open the profile section in Settings.
- Page content uses responsive horizontal padding and remains centered at its existing maximum width.
