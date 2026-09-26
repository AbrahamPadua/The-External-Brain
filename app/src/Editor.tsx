import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Extension, isNodeSelection, isTextSelection } from '@tiptap/core'
import type { Range } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { TableKit } from '@tiptap/extension-table'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Suggestion from '@tiptap/suggestion'
import { shift, size } from '@floating-ui/dom'
import type { SuggestionProps } from '@tiptap/suggestion'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import {
  BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart,
  Bold, Code, Grid2x2X, Heading1, Heading2, Heading3, ImagePlus, ImageUp, Italic, Link as LinkIcon,
  Link2Off, List, ListChecks, ListOrdered, Minus, PanelTop, Pilcrow, Quote, Redo2, SquareCode,
  Strikethrough, Table as TableIcon, Trash, Underline, Undo2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { IMAGE_MIME_TYPES, imageFileError } from './model'
import {
  filterSlashCommands, normalizeImageUrl, normalizeLinkUrl, runSlashCommand,
} from './editor-commands'
import type { SlashCommand, SlashCommandId } from './editor-commands'
import './editor.css'

/**
 * An uploaded image is identified by its storage object path, which is the only
 * durable reference: the `src` it is displayed with is a short-lived signed URL
 * that the live adapter mints per render and strips again before anything is
 * stored. Carrying `data-object-path` through parse and serialise is what keeps
 * an old version's images resolvable after every signed URL has expired.
 *
 * `src` is deliberately left alone here so the image is actually visible while
 * it is being edited; app/src/live.ts removes it on the way to the database.
 */
// Exported so src/image-refs.test.ts can round-trip the real schema config.
export const CustomImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-object-path': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-object-path'),
        renderHTML: (attributes) =>
          attributes['data-object-path']
            ? { 'data-object-path': attributes['data-object-path'] }
            : {},
      },
    }
  },
})

/** The image files on a clipboard, ignoring anything that is not an allowed image. */
export function clipboardImageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  // A clipboard may expose the same image through `files`, through `items`, or
  // through both, so read each and de-duplicate rather than trusting one.
  const fromFiles: File[] = data.files ? Array.from(data.files) : []
  const fromItems: File[] = (data.items ? Array.from(data.items) : [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file)
  const seen = new Set<string>()
  return [...fromFiles, ...fromItems].filter((file) => {
    if (!IMAGE_MIME_TYPES.includes(file.type)) return false
    const key = `${file.name}:${file.size}:${file.type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Remove `<img src="data:...">` from pasted markup. Inline base64 would be
 * written into the document body verbatim, which is exactly the persisted blob
 * the storage flow exists to avoid; an image has to arrive as a file so it can
 * be uploaded and referenced by object path.
 */
export function stripDataImages(html: string): { html: string; removed: number } {
  if (!/<img/i.test(html)) return { html, removed: 0 }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const inline = Array.from(doc.querySelectorAll('img'))
    .filter((img) => /^data:/i.test(img.getAttribute('src') || ''))
  inline.forEach((img) => img.remove())
  return { html: inline.length ? doc.body.innerHTML : html, removed: inline.length }
}

/**
 * What a paste should do. Image files are uploaded and referenced by object
 * path; markup carrying inline base64 images is inserted with those images
 * removed; anything else is left to Tiptap. This is the decision `handlePaste`
 * runs, kept separate only so it can be tested without an editor view.
 */
export type PasteAction =
  | { kind: 'upload'; files: File[] }
  | { kind: 'insert-html'; html: string; removed: number }
  | { kind: 'default' }

export function planPaste(data: DataTransfer | null | undefined): PasteAction {
  const files = clipboardImageFiles(data)
  if (files.length) return { kind: 'upload', files }
  const html = data?.getData?.('text/html') || ''
  if (html) {
    const cleaned = stripDataImages(html)
    if (cleaned.removed) return { kind: 'insert-html', html: cleaned.html, removed: cleaned.removed }
  }
  return { kind: 'default' }
}

/**
 * The document schema: every node and mark a stored body may contain. The live
 * editor adds only behaviour (placeholder, slash menu) on top of this, so a test
 * that round-trips HTML through these extensions exercises the real schema.
 */
export function schemaExtensions() {
  return [
    StarterKit.configure({
      // Links are edited through the bubble menu; a click in the editor should
      // place the caret, not navigate away. Read-only views are not editable,
      // so their links behave as ordinary anchors.
      link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
    }),
    CustomImage,
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ]
}

/* Slash menu ------------------------------------------------------------ */

/** How the slash suggestion plugin talks to the React menu that renders it. */
type SlashBridge = {
  start: (props: SuggestionProps<SlashCommand, SlashCommand>) => void
  update: (props: SuggestionProps<SlashCommand, SlashCommand>) => void
  exit: () => void
  keyDown: (event: KeyboardEvent) => boolean
  run: (command: SlashCommand, range: Range) => void
}

const slashPluginKey = new PluginKey('slashCommand')

const SlashCommandExtension = Extension.create<{ bridge: () => SlashBridge | null }>({
  name: 'slashCommand',
  addOptions() {
    return { bridge: () => null }
  },
  addProseMirrorPlugins() {
    const bridge = this.options.bridge
    return [
      Suggestion<SlashCommand, SlashCommand>({
        editor: this.editor,
        pluginKey: slashPluginKey,
        char: '/',
        items: ({ query }) => filterSlashCommands(query),
        // Not in read-only views, and not inside code, where a slash is code.
        allow: ({ editor, state }) =>
          editor.isEditable && state.selection.$from.parent.type.name !== 'codeBlock',
        command: ({ range, props }) => bridge()?.run(props, range),
        // Fixed, so a scrolling modal or pane cannot clip the menu.
        floatingUi: {
          strategy: 'fixed',
          middleware: [
            shift({ padding: 8 }),
            size({
              padding: 8,
              apply({ availableHeight, elements }) {
                elements.floating.style.maxHeight = `${Math.max(140, Math.min(340, Math.floor(availableHeight)))}px`
              },
            }),
          ],
        },
        render: () => ({
          onStart: (props) => bridge()?.start(props),
          onUpdate: (props) => bridge()?.update(props),
          onExit: () => bridge()?.exit(),
          onKeyDown: ({ event }) => bridge()?.keyDown(event) ?? false,
        }),
      }),
    ]
  },
})

/** Mod-K opens the link field, as in most editors. */
const LinkShortcut = Extension.create<{ open: () => void }>({
  name: 'linkShortcut',
  addOptions() {
    return { open: () => {} }
  },
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        if (!this.editor.isEditable) return false
        this.options.open()
        return true
      },
    }
  },
})

const SLASH_ICONS: Record<SlashCommandId, LucideIcon> = {
  text: Pilcrow, h1: Heading1, h2: Heading2, h3: Heading3,
  bullet: List, numbered: ListOrdered, checklist: ListChecks,
  quote: Quote, code: SquareCode, divider: Minus, table: TableIcon,
  'image-upload': ImageUp, 'image-link': ImagePlus,
}

type SlashState = {
  items: SlashCommand[]
  index: number
  query: string
  command: (item: SlashCommand) => void
  mount: SuggestionProps<SlashCommand, SlashCommand>['mount']
}

/* Bubble menu ----------------------------------------------------------- */

const BUBBLE_OPTIONS = {
  strategy: 'fixed' as const,
  placement: 'top' as const,
  offset: 8,
  flip: true,
  shift: { padding: 8 },
}

/** Show the formatting bubble for a real text selection in an editable view. */
function bubbleShouldShow({ editor, view, state, from, to, element }: {
  editor: TiptapEditor; view: TiptapEditor['view']; state: TiptapEditor['state']
  from: number; to: number; element: HTMLElement
}): boolean {
  if (!editor.isEditable) return false
  const { selection, doc } = state
  const hasFocus = view.hasFocus() || element.contains(document.activeElement)
  if (!hasFocus || selection.empty) return false
  if (isNodeSelection(selection)) return false            // an image or divider
  if (isTextSelection(selection) && !doc.textBetween(from, to).length) return false
  if (editor.isActive('codeBlock')) return false
  return true
}

/* Small UI pieces ------------------------------------------------------- */

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const MOD = isMac ? 'Cmd' : 'Ctrl'

function ToolButton({ label, shortcut, icon: Icon, active = false, disabled = false, onClick, children }: {
  label: string
  shortcut?: string
  icon?: LucideIcon
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      className={'ed-btn' + (active ? ' is-active' : '') + (children ? ' has-text' : '')}
      aria-label={label}
      aria-pressed={active || undefined}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      // Keep the editor's selection: a toolbar click must not blur it first.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {Icon ? <Icon size={16} strokeWidth={2} aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3' | 'other'

function BlockTypeSelect({ editor, value, compact = false }: { editor: TiptapEditor; value: BlockType; compact?: boolean }) {
  return (
    <select
      className={'ed-select' + (compact ? ' compact' : '')}
      aria-label="Text style"
      title="Text style"
      value={value === 'other' ? 'paragraph' : value}
      onChange={(e) => {
        const next = e.target.value as BlockType
        const chain = editor.chain().focus()
        if (next === 'paragraph') chain.setParagraph().run()
        else chain.setHeading({ level: Number(next.slice(1)) as 1 | 2 | 3 }).run()
      }}
    >
      <option value="paragraph">Text</option>
      <option value="h1">Heading 1</option>
      <option value="h2">Heading 2</option>
      <option value="h3">Heading 3</option>
    </select>
  )
}

/** An inline URL field used for links and image links instead of prompt(). */
function UrlForm({ kind, initial, onSubmit, onRemove, onCancel }: {
  kind: 'link' | 'image'
  initial?: string
  onSubmit: (url: string) => void
  onRemove?: () => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial ?? '')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])
  const submit = () => {
    const url = kind === 'link' ? normalizeLinkUrl(value) : normalizeImageUrl(value)
    if (!url) {
      setError(kind === 'link' ? 'Use an https:// or mailto: address.' : 'Use an https:// image address.')
      return
    }
    onSubmit(url)
  }
  return (
    <div className="ed-url-form" role="group" aria-label={kind === 'link' ? 'Link address' : 'Image address'}>
      <div className="ed-url-row">
        <input
          ref={inputRef}
          type="url"
          inputMode="url"
          value={value}
          aria-label={kind === 'link' ? 'Link URL' : 'Image URL'}
          aria-invalid={error ? true : undefined}
          placeholder={kind === 'link' ? 'Paste a link (https:// or mailto:)' : 'https://example.com/image.gif'}
          onChange={(e) => { setValue(e.target.value); setError('') }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit() }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
          }}
        />
        <button type="button" className="ed-url-apply" onClick={submit}>
          {kind === 'link' ? 'Apply' : 'Insert'}
        </button>
        {onRemove ? (
          <button type="button" className="ed-btn" aria-label="Remove link" title="Remove link" onClick={onRemove}>
            <Link2Off size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {error ? <p className="ed-url-error" role="alert">{error}</p> : null}
    </div>
  )
}

/** Apply (or insert) a link at the current selection. */
function applyLink(editor: TiptapEditor, href: string) {
  const { empty } = editor.state.selection
  if (editor.isActive('link')) {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  } else if (empty) {
    // Nothing selected: insert the address itself as the link text.
    const text = href.replace(/^mailto:/i, '')
    editor.chain().focus().insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }).run()
  } else {
    editor.chain().focus().setLink({ href }).run()
  }
}

/* The editor ------------------------------------------------------------ */

export function Editor({
  body, onChange, readOnly=false, onUploadImage, uploadScopeId
}: {
  body: string
  onChange?: (html: string) => void
  readOnly?: boolean
  onUploadImage?: (file: File) => Promise<{ path: string; url: string } | null>
  /**
   * Identifies what the uploads belong to, normally the document id. It is
   * captured when an upload starts and re-checked before the image is inserted,
   * so a slow upload can never land in a document the editor has since moved to.
   */
  uploadScopeId?: string
}) {
 // Refs, not closures: useEditor captures its options once, so a paste handler
 // built at mount would keep calling the first render's upload callback.
 const uploadRef = useRef(onUploadImage)
 const scopeRef = useRef(uploadScopeId)
 const readOnlyRef = useRef(readOnly)
 const onChangeRef = useRef(onChange)
 const lastHtmlRef = useRef<string | null>(null)
 const editorRef = useRef<TiptapEditor | null>(null)
 const fileInputRef = useRef<HTMLInputElement>(null)
 const slashBridgeRef = useRef<SlashBridge | null>(null)
 // Keep event handlers on the current render even before passive effects run.
 uploadRef.current = onUploadImage
 scopeRef.current = uploadScopeId
 readOnlyRef.current = readOnly
 onChangeRef.current = onChange

 /** Which inline URL form the toolbar is showing, if any. */
 const [urlPrompt, setUrlPrompt] = useState<null | 'link' | 'image'>(null)
 /** Whether the selection bubble is showing its link field instead of buttons. */
 const [bubbleLink, setBubbleLink] = useState(false)

 const insertUpload = async (file: File) => {
   const upload = uploadRef.current
   if (!upload) { alert('Image upload is not available here. Save the draft first.'); return }
   const problem = imageFileError(file)
   if (problem) { alert(problem); return }
   const scope = scopeRef.current
   try {
     const res = await upload(file)
     if (!res) return
     const editor = editorRef.current
     if (!editor || editor.isDestroyed || readOnlyRef.current || !editor.isEditable) return
     if (scopeRef.current !== scope) return   // moved on: do not insert here
     editor.chain().focus().setImage({ src: res.url, 'data-object-path': res.path } as never).run()
   } catch (err) {
     alert(err instanceof Error ? err.message : String(err))
   }
 }
 const insertUploadRef = useRef(insertUpload)
 insertUploadRef.current = insertUpload

 /**
  * Paste and drop share one rule set (planPaste): allowed image files are
  * uploaded, markup carrying inline base64 images is inserted without them,
  * and anything else is left to Tiptap.
  */
 const applyTransfer = (data: DataTransfer | null, event: Event, at?: number): boolean => {
   // Live state, not the mount-time prop: readOnly can flip while this closure
   // stays the one Tiptap captured.
   if (readOnlyRef.current || !editorRef.current?.isEditable) return false
   // planPaste reads the transfer synchronously; getAsFile is invalid once the
   // event has been released, so nothing here may await first.
   const plan = planPaste(data)
   if (plan.kind === 'upload') {
     event.preventDefault()
     if (at !== undefined) editorRef.current?.chain().focus().setTextSelection(at).run()
     plan.files.forEach((file) => { void insertUploadRef.current(file) })
     return true
   }
   if (plan.kind === 'insert-html') {
     event.preventDefault()
     const chain = editorRef.current?.chain().focus()
     if (at !== undefined) chain?.insertContentAt(at, plan.html).run()
     else chain?.insertContent(plan.html).run()
     alert(`${plan.removed} embedded image${plan.removed===1?' was':'s were'} dropped. Paste the image file itself, or use Upload image, so it can be stored and kept.`)
     return true
   }
   return false
 }

 const openLinkRef = useRef<() => void>(() => {})
 openLinkRef.current = () => {
   if (editorRef.current?.state.selection.empty) setUrlPrompt('link')
   else setBubbleLink(true)
 }
 // Built once: the editor keeps the extensions it was created with anyway, and
 // everything that changes per render is reached through a ref.
 const extensions = useMemo(() => [
   ...schemaExtensions(),
   Placeholder.configure({
     placeholder: ({ editor, node }) => {
       if (node.type.name === 'heading') return `Heading ${node.attrs.level}`
       if (node.type.name === 'codeBlock') return ''
       return editor.isEmpty ? "Type '/' for commands, or just start writing…" : "Type '/' for commands"
     },
   }),
   SlashCommandExtension.configure({ bridge: () => slashBridgeRef.current }),
   LinkShortcut.configure({ open: () => openLinkRef.current() }),
 ], [])

 const editor = useEditor({
   extensions,
   content: body,
   editable: !readOnly,
   // Plugins can normalise a freshly loaded document (e.g. appending a trailing
   // paragraph) and that fires onUpdate although nobody typed anything. Only
   // report real changes, so opening a draft never marks it unsaved.
   onCreate: ({ editor }) => { lastHtmlRef.current ??= editor.getHTML() },
   onUpdate: ({ editor }) => {
     const html = editor.getHTML()
     // The first update can arrive before onCreate, while the loaded document
     // is still being normalised; it is the baseline, not an edit.
     if (lastHtmlRef.current === null) { lastHtmlRef.current = html; return }
     if (html === lastHtmlRef.current) return
     lastHtmlRef.current = html
     onChangeRef.current?.(html)
   },
   editorProps: {
     handlePaste: (_view, event) => applyTransfer(event.clipboardData, event),
     handleDrop: (view, event, _slice, moved) => {
       // Moving content that is already in the document is Tiptap's job.
       if (moved) return false
       const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
       return applyTransfer(event.dataTransfer, event, pos?.pos)
     },
   },
 })
 useEffect(()=>{editorRef.current=editor??null},[editor])
 useEffect(()=>{editor?.setEditable(!readOnly)},[editor,readOnly])
 useEffect(()=>{if(editor&&readOnly)editor.commands.setContent(body)},[body,editor,readOnly])

 /* Slash menu state, driven by the suggestion plugin through the bridge. */
 const [slash, setSlashState] = useState<SlashState | null>(null)
 const slashRef = useRef<SlashState | null>(null)
 const setSlash = useCallback((next: SlashState | null) => { slashRef.current = next; setSlashState(next) }, [])
 const slashMenuRef = useRef<HTMLDivElement>(null)
 const slashHooks = {
   pickImage: () => fileInputRef.current?.click(),
   promptImageUrl: () => setUrlPrompt('image'),
 }
 const slashHooksRef = useRef(slashHooks)
 slashHooksRef.current = slashHooks
 slashBridgeRef.current = {
   start: (p) => setSlash({ items: p.items, index: 0, query: p.query, command: p.command, mount: p.mount }),
   update: (p) => {
     const prev = slashRef.current
     const index = prev && prev.query === p.query ? Math.min(prev.index, Math.max(0, p.items.length - 1)) : 0
     setSlash({ items: p.items, index, query: p.query, command: p.command, mount: p.mount })
   },
   exit: () => setSlash(null),
   keyDown: (event) => {
     const s = slashRef.current
     if (!s) return false
     const n = s.items.length
     if (event.key === 'ArrowDown' && n) { setSlash({ ...s, index: (s.index + 1) % n }); return true }
     if (event.key === 'ArrowUp' && n) { setSlash({ ...s, index: (s.index - 1 + n) % n }); return true }
     if ((event.key === 'Enter' || event.key === 'Tab') && n) { s.command(s.items[s.index]); return true }
     if (event.key === 'Escape') { setSlash(null); return true }
     return false
   },
   run: (command, range) => {
     const ed = editorRef.current
     if (!ed) return
     runSlashCommand(ed, command.id, range, slashHooksRef.current)
   },
 }
 const slashOpen = !!slash
 const slashMount = slash?.mount
 useLayoutEffect(() => {
   if (!slashOpen || !slashMount || !slashMenuRef.current) return
   return slashMount(slashMenuRef.current)
   // Mount once per opening: the reference rect is re-read live by the plugin.
 }, [slashOpen]) // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(() => {
   slashMenuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
 }, [slash?.index, slash?.query])

 /* Reactive toolbar state: re-rendered only when one of these values changes. */
 const ui = useEditorState({
   editor,
   selector: ({ editor: e }) => {
     if (!e) return null
     const block: BlockType = e.isActive('heading', { level: 1 }) ? 'h1'
       : e.isActive('heading', { level: 2 }) ? 'h2'
       : e.isActive('heading', { level: 3 }) ? 'h3'
       : e.isActive('paragraph') ? 'paragraph' : 'other'
     return {
       block,
       bold: e.isActive('bold'),
       italic: e.isActive('italic'),
       underline: e.isActive('underline'),
       strike: e.isActive('strike'),
       code: e.isActive('code'),
       link: e.isActive('link'),
       href: String(e.getAttributes('link').href ?? ''),
       bullet: e.isActive('bulletList'),
       ordered: e.isActive('orderedList'),
       task: e.isActive('taskList'),
       quote: e.isActive('blockquote'),
       codeBlock: e.isActive('codeBlock'),
       table: e.isActive('table'),
       canUndo: e.can().undo(),
       canRedo: e.can().redo(),
     }
   },
 })

 /* Keep the fixed-position bubble anchored when a scrolling pane moves. */
 useEffect(() => {
   if (!editor || readOnly) return
   const onScroll = () => {
     if (editor.isDestroyed || editor.state.selection.empty) return
     editor.view.dispatch(editor.state.tr.setMeta('textBubble', 'updatePosition'))
   }
   document.addEventListener('scroll', onScroll, true)
   return () => document.removeEventListener('scroll', onScroll, true)
 }, [editor, readOnly])

 /*
  * Stick the toolbar just below the page's own sticky top bar, whose height
  * changes with the viewport (one row on desktop, two on a phone). Inside a
  * dialog the dialog scrolls, so the CSS default of 0 applies there.
  */
 const rootRef = useRef<HTMLDivElement>(null)
 useEffect(() => {
   const root = rootRef.current
   if (readOnly || !root || root.closest('.modal-card')) return
   const bar = document.querySelector<HTMLElement>('.ol-topbar')
   if (!bar) return
   const apply = () => {
     const position = getComputedStyle(bar).position
     const height = position === 'sticky' || position === 'fixed' ? bar.getBoundingClientRect().height : 0
     root.style.setProperty('--ed-sticky-top', `${Math.round(height)}px`)
   }
   apply()
   const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null
   observer?.observe(bar)
   window.addEventListener('resize', apply)
   return () => { observer?.disconnect(); window.removeEventListener('resize', apply) }
 }, [readOnly])

 const bubbleOptions = useMemo(() => ({ ...BUBBLE_OPTIONS, onHide: () => setBubbleLink(false) }), [])

 const chain = () => editor!.chain().focus()
 const closePrompt = () => { setUrlPrompt(null); editor?.commands.focus() }

 /**
  * Editors sit inside <label className="field"> in several forms. A click on a
  * label's non-control content "activates" the label's first control, which
  * would press the first toolbar button (Undo) whenever someone clicks text or
  * a menu item that re-renders away mid-click. Cancelling the click's default
  * stops that; real controls inside the editor (links, checkboxes, inputs) keep
  * their own default action.
  */
 const stopLabelActivation = (e: ReactMouseEvent<HTMLDivElement>) => {
   const target = e.target as Element
   const control = target.closest?.('a[href], input, select, textarea, label')
   if (control && e.currentTarget.contains(control)) return
   e.preventDefault()
 }

 /** An Escape that closed one of the editor's own menus must not also close
  *  the dialog the editor sits in (dialogs listen for Escape on document). */
 const containEscape = (e: ReactKeyboardEvent<HTMLDivElement>) => {
   if (e.key === 'Escape' && e.defaultPrevented) e.stopPropagation()
 }

 return <div ref={rootRef} className={'editor '+(readOnly?'readonly':'')} onClick={stopLabelActivation} onKeyDown={containEscape}>
 {/* Becomes the surrounding label's control: a click on the field's label text
     lands here and moves the caret into the editor instead of pressing the
     first toolbar button. Hidden, so it never takes focus itself. */}
 <input className="ed-label-sink" type="text" hidden tabIndex={-1} aria-hidden="true" readOnly
   onClick={() => { if (!readOnlyRef.current) editorRef.current?.commands.focus() }} />
 {!readOnly&&editor&&ui&&<div className="toolbar">
   {/* Groups draw their own leading separator; the one that lands at the
       start of a wrapped row falls in the clipped gutter and is hidden. */}
   <div className="ed-tb-clip"><div className="ed-tb-row" role="toolbar" aria-label="Formatting">
   <div className="ed-group">
     <ToolButton label="Undo" shortcut={`${MOD}+Z`} icon={Undo2} disabled={!ui.canUndo} onClick={()=>chain().undo().run()}/>
     <ToolButton label="Redo" shortcut={`${MOD}+Shift+Z`} icon={Redo2} disabled={!ui.canRedo} onClick={()=>chain().redo().run()}/>
   </div>
   <div className="ed-group">
     <BlockTypeSelect editor={editor} value={ui.block}/>
   </div>
   <div className="ed-group">
     <ToolButton label="Bold" shortcut={`${MOD}+B`} icon={Bold} active={ui.bold} onClick={()=>chain().toggleBold().run()}/>
     <ToolButton label="Italic" shortcut={`${MOD}+I`} icon={Italic} active={ui.italic} onClick={()=>chain().toggleItalic().run()}/>
     <ToolButton label="Underline" shortcut={`${MOD}+U`} icon={Underline} active={ui.underline} onClick={()=>chain().toggleUnderline().run()}/>
     <ToolButton label="Strikethrough" shortcut={`${MOD}+Shift+S`} icon={Strikethrough} active={ui.strike} onClick={()=>chain().toggleStrike().run()}/>
   </div>
   <div className="ed-group">
     <ToolButton label="Bulleted list" icon={List} active={ui.bullet} onClick={()=>chain().toggleBulletList().run()}/>
     <ToolButton label="Numbered list" icon={ListOrdered} active={ui.ordered} onClick={()=>chain().toggleOrderedList().run()}/>
     <ToolButton label="Checklist" icon={ListChecks} active={ui.task} onClick={()=>chain().toggleTaskList().run()}/>
   </div>
   <div className="ed-group">
     <ToolButton label="Quote" icon={Quote} active={ui.quote} onClick={()=>chain().toggleBlockquote().run()}/>
     <ToolButton label="Code block" icon={SquareCode} active={ui.codeBlock} onClick={()=>chain().toggleCodeBlock().run()}/>
     <ToolButton label="Divider" icon={Minus} onClick={()=>chain().setHorizontalRule().run()}/>
     <ToolButton label="Table" icon={TableIcon} active={ui.table} disabled={ui.table} onClick={()=>chain().insertTable({rows:3,cols:3,withHeaderRow:true}).run()}/>
   </div>
   <div className="ed-group">
     <ToolButton label="Upload image" icon={ImageUp} onClick={()=>fileInputRef.current?.click()}/>
     {/* `accept` only filters the picker; insertUpload re-checks the allowlist
         and the size bounds, and the back end checks them again. */}
     <input ref={fileInputRef} type="file" accept={IMAGE_MIME_TYPES.join(',')} className="ed-file-input"
       tabIndex={-1} aria-hidden="true" onChange={async (e) => {
         const file = e.target.files?.[0]
         e.target.value = ''
         if (file) await insertUpload(file)
       }} />
     <ToolButton label="Image link" icon={ImagePlus} active={urlPrompt==='image'} onClick={()=>setUrlPrompt(urlPrompt==='image'?null:'image')}/>
     <ToolButton label="Link" shortcut={`${MOD}+K`} icon={LinkIcon} active={ui.link||urlPrompt==='link'} onClick={()=>setUrlPrompt(urlPrompt==='link'?null:'link')}/>
   </div>
   </div></div>
   {urlPrompt ? (
     <div className="ed-popover ed-toolbar-popover">
       <UrlForm
         key={urlPrompt}
         kind={urlPrompt}
         initial={urlPrompt==='link' ? ui.href : ''}
         onCancel={closePrompt}
         onRemove={urlPrompt==='link' && ui.link ? () => { chain().extendMarkRange('link').unsetLink().run(); setUrlPrompt(null) } : undefined}
         onSubmit={(url) => {
           if (urlPrompt === 'link') applyLink(editor, url)
           else chain().setImage({ src: url }).run()
           setUrlPrompt(null)
         }}
       />
     </div>
   ) : null}
   {ui.table ? (
     <div className="ed-table-bar" role="group" aria-label="Table">
       <span className="ed-table-bar-label">Table</span>
       <ToolButton label="Add row above" icon={BetweenHorizontalStart} onClick={()=>chain().addRowBefore().run()}/>
       <ToolButton label="Add row below" icon={BetweenHorizontalEnd} onClick={()=>chain().addRowAfter().run()}/>
       <ToolButton label="Add column left" icon={BetweenVerticalStart} onClick={()=>chain().addColumnBefore().run()}/>
       <ToolButton label="Add column right" icon={BetweenVerticalEnd} onClick={()=>chain().addColumnAfter().run()}/>
       <ToolButton label="Toggle header row" icon={PanelTop} onClick={()=>chain().toggleHeaderRow().run()}/>
       <span className="ed-sep" aria-hidden="true"/>
       <ToolButton label="Delete row" icon={Trash} onClick={()=>chain().deleteRow().run()}><span>Row</span></ToolButton>
       <ToolButton label="Delete column" icon={Trash} onClick={()=>chain().deleteColumn().run()}><span>Col</span></ToolButton>
       <ToolButton label="Delete table" icon={Grid2x2X} onClick={()=>chain().deleteTable().run()}/>
     </div>
   ) : null}
 </div>}
 {!readOnly&&editor&&ui ? (
   <BubbleMenu editor={editor} pluginKey="textBubble" shouldShow={bubbleShouldShow} options={bubbleOptions}
     className="ed-popover ed-bubble" updateDelay={100}>
     {bubbleLink ? (
       <UrlForm
         kind="link"
         initial={ui.href}
         onCancel={() => { setBubbleLink(false); editor.commands.focus() }}
         onRemove={ui.link ? () => { chain().extendMarkRange('link').unsetLink().run(); setBubbleLink(false) } : undefined}
         onSubmit={(url) => { applyLink(editor, url); setBubbleLink(false) }}
       />
     ) : (
       <div className="ed-bubble-row" role="toolbar" aria-label="Selection formatting">
         <BlockTypeSelect editor={editor} value={ui.block} compact/>
         <span className="ed-sep" aria-hidden="true"/>
         <ToolButton label="Bold" shortcut={`${MOD}+B`} icon={Bold} active={ui.bold} onClick={()=>chain().toggleBold().run()}/>
         <ToolButton label="Italic" shortcut={`${MOD}+I`} icon={Italic} active={ui.italic} onClick={()=>chain().toggleItalic().run()}/>
         <ToolButton label="Underline" shortcut={`${MOD}+U`} icon={Underline} active={ui.underline} onClick={()=>chain().toggleUnderline().run()}/>
         <ToolButton label="Strikethrough" icon={Strikethrough} active={ui.strike} onClick={()=>chain().toggleStrike().run()}/>
         <ToolButton label="Inline code" shortcut={`${MOD}+E`} icon={Code} active={ui.code} onClick={()=>chain().toggleCode().run()}/>
         <span className="ed-sep" aria-hidden="true"/>
         <ToolButton label={ui.link ? 'Edit link' : 'Add link'} icon={LinkIcon} active={ui.link} onClick={()=>setBubbleLink(true)}/>
         {ui.link ? <ToolButton label="Remove link" icon={Link2Off} onClick={()=>chain().extendMarkRange('link').unsetLink().run()}/> : null}
       </div>
     )}
   </BubbleMenu>
 ) : null}
 {slash && !readOnly ? (
   <div ref={slashMenuRef} className="ed-popover ed-slash-menu" role="listbox" aria-label="Insert block"
     onMouseDown={(e) => e.preventDefault()}>
     {slash.items.length ? slash.items.map((item, i) => {
       const Icon = SLASH_ICONS[item.id]
       const showGroup = !slash.query && (i === 0 || slash.items[i - 1].group !== item.group)
       return (
         <div key={item.id} role="presentation">
           {showGroup ? <div className="ed-slash-group" role="presentation">{item.group}</div> : null}
           <button
             type="button"
             role="option"
             aria-selected={i === slash.index}
             className={'ed-slash-item' + (i === slash.index ? ' is-selected' : '')}
             onMouseEnter={() => { if (slashRef.current && slashRef.current.index !== i) setSlash({ ...slashRef.current, index: i }) }}
             onClick={() => slash.command(item)}
           >
             <span className="ed-slash-icon"><Icon size={18} aria-hidden="true"/></span>
             <span className="ed-slash-text">
               <span className="ed-slash-title">{item.title}</span>
               <span className="ed-slash-desc">{item.description}</span>
             </span>
           </button>
         </div>
       )
     }) : <div className="ed-slash-empty">No matching blocks</div>}
   </div>
 ) : null}
 <EditorContent editor={editor}/></div>
}
