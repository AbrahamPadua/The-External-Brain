import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect } from 'react'
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

export function Editor({
  body, onChange, readOnly=false, onUploadImage
}: {
  body: string
  onChange?: (html: string) => void
  readOnly?: boolean
  onUploadImage?: (file: File) => Promise<{ path: string; url: string } | null>
}) {
 const editor=useEditor({extensions:[StarterKit,CustomImage,Placeholder.configure({placeholder:'Write an update your team can build on…'})],content:body,editable:!readOnly,onUpdate:({editor})=>onChange?.(editor.getHTML())})
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
     <input type="file" accept={IMAGE_MIME_TYPES.join(',')} style={{display:'none'}} onChange={async (e) => {
       const file = e.target.files?.[0]
       e.target.value = ''
       if (!file) return
       if (!onUploadImage) { alert('Image upload not supported here. Save as draft first.'); return }
       // `accept` only filters the picker; the allowlist and the size bounds are
       // checked before the upload starts and again by the back end.
       const problem = imageFileError(file)
       if (problem) { alert(problem); return }
       try {
         const res = await onUploadImage(file)
         if (res) editor?.chain().focus().setImage({ src: res.url, 'data-object-path': res.path } as any).run()
       } catch (err) {
         alert(err instanceof Error ? err.message : String(err))
       }
     }} />
   </label>
   <button type="button" onClick={()=>{const url=prompt('Link URL (https://)');if(url?.startsWith('https://'))editor?.chain().focus().setLink({href:url}).run()}}>Link</button>
 </div>}
 <EditorContent editor={editor}/></div>
}
