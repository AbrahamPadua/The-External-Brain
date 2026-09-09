import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect } from 'react'
export function Editor({body,onChange,readOnly=false}:{body:string;onChange?:(html:string)=>void;readOnly?:boolean}){
 const editor=useEditor({extensions:[StarterKit,Image,Placeholder.configure({placeholder:'Write an update your team can build on…'})],content:body,editable:!readOnly,onUpdate:({editor})=>onChange?.(editor.getHTML())})
 useEffect(()=>{if(editor&&readOnly)editor.commands.setContent(body)},[body,editor,readOnly])
 return <div className={'editor '+(readOnly?'readonly':'')}>
 {!readOnly&&<div className="toolbar"><button type="button" onClick={()=>editor?.chain().focus().toggleBold().run()}><b>B</b></button><button type="button" onClick={()=>editor?.chain().focus().toggleItalic().run()}><i>I</i></button><button type="button" onClick={()=>editor?.chain().focus().toggleHeading({level:2}).run()}>Heading</button><button type="button" onClick={()=>editor?.chain().focus().toggleBulletList().run()}>List</button><button type="button" onClick={()=>{const url=prompt('Image URL (https://)');if(url?.startsWith('https://'))editor?.chain().focus().setImage({src:url}).run()}}>Image link</button><button type="button" onClick={()=>{const url=prompt('Link URL (https://)');if(url?.startsWith('https://'))editor?.chain().focus().setLink({href:url}).run()}}>Link</button></div>}
 <EditorContent editor={editor}/></div>
}
