import { useEditor, EditorContent } from '@tiptap/react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef } from 'react'
import { IMAGE_MIME_TYPES, imageFileError } from './model'

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
 const editorRef = useRef<TiptapEditor | null>(null)
 // Keep event handlers on the current render even before passive effects run.
 uploadRef.current = onUploadImage
 scopeRef.current = uploadScopeId
 readOnlyRef.current = readOnly

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

 const editor=useEditor({extensions:[StarterKit,CustomImage,Placeholder.configure({placeholder:'Write an update your team can build on…'})],content:body,editable:!readOnly,onUpdate:({editor})=>onChange?.(editor.getHTML()),editorProps:{handlePaste:(_view,event)=>{
   // Live state, not the mount-time prop: readOnly can flip while this closure
   // stays the one Tiptap captured.
   if(readOnlyRef.current||!editorRef.current?.isEditable)return false
   // planPaste reads the clipboard synchronously; getAsFile is invalid once the
   // event has been released, so nothing here may await first.
   const plan=planPaste(event.clipboardData)
   if(plan.kind==='upload'){
     event.preventDefault()
     plan.files.forEach((file)=>{void insertUpload(file)})
     return true
   }
   if(plan.kind==='insert-html'){
     event.preventDefault()
     editorRef.current?.chain().focus().insertContent(plan.html).run()
     alert(`${plan.removed} embedded image${plan.removed===1?' was':'s were'} dropped. Paste the image file itself, or use Upload Image, so it can be stored and kept.`)
     return true
   }
   return false
 }}})
 useEffect(()=>{editorRef.current=editor??null},[editor])
 useEffect(()=>{editor?.setEditable(!readOnly)},[editor,readOnly])
 useEffect(()=>{if(editor&&readOnly)editor.commands.setContent(body)},[body,editor,readOnly])
 return <div className={'editor '+(readOnly?'readonly':'')}>
 {!readOnly&&<div className="toolbar">
   <button type="button" onClick={()=>editor?.chain().focus().toggleBold().run()}><b>B</b></button>
   <button type="button" onClick={()=>editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
   <button type="button" onClick={()=>editor?.chain().focus().toggleHeading({level:2}).run()}>Heading</button>
   <button type="button" onClick={()=>editor?.chain().focus().toggleBulletList().run()}>List</button>
   <button type="button" onClick={()=>{const url=prompt('Image URL (https://)');if(url?.startsWith('https://'))editor?.chain().focus().setImage({src:url}).run()}}>Image link</button>
   <label style={{ cursor: 'pointer', background: '#eee', padding: '2px 6px', fontSize: 13, border: '1px solid #ccc', borderRadius: 3 }}>
     Upload Image
     {/* `accept` only filters the picker; insertUpload re-checks the allowlist
         and the size bounds, and the back end checks them again. */}
     <input type="file" accept={IMAGE_MIME_TYPES.join(',')} style={{display:'none'}} onChange={async (e) => {
       const file = e.target.files?.[0]
       e.target.value = ''
       if (file) await insertUpload(file)
     }} />
   </label>
   <button type="button" onClick={()=>{const url=prompt('Link URL (https://)');if(url?.startsWith('https://'))editor?.chain().focus().setLink({href:url}).run()}}>Link</button>
 </div>}
 <EditorContent editor={editor}/></div>
}
