import React,{useCallback,useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import App from './App'
import {configured,supabase} from './client'
import {loadLive,liveAction} from './live'
import {demoAction} from './demo'
import {seed} from './model'
import type {Data} from './model'
import './style.css'
const DEMO_KEY='open-labs-demo-v1'
const blank:Data={people:[],initiatives:[],documents:[],obligations:[],threads:[],requests:[],audit:[]}
function readDemo():Data{try{const saved=JSON.parse(localStorage.getItem(DEMO_KEY)||'null');if(saved?.people&&saved?.initiatives&&saved?.audit)return saved}catch{/* recover corrupted local demo */}return structuredClone(seed)}
function Root(){
 const [data,setData]=useState<Data>(()=>configured?blank:readDemo())
 const [userId,setUserId]=useState<string|null>(null)
 const [loading,setLoading]=useState(configured)
 const [error,setError]=useState('')
 const currentUser=useRef<string|null>(null)
 const refresh=useCallback(async(uid:string|null)=>{try{const result=await loadLive(uid);if(currentUser.current===uid){setData(result);setError('')}}catch(e){if(currentUser.current===uid){setData(blank);setError(e instanceof Error?e.message:'Unable to load workspace')}}finally{if(currentUser.current===uid)setLoading(false)}},[])
 useEffect(()=>{if(!supabase)return;let alive=true
 const {data:subscription}=supabase.auth.onAuthStateChange((_event,session)=>{if(!alive)return;const uid=session?.user.id??null;currentUser.current=uid;setUserId(uid);setData(blank);setLoading(true);setTimeout(()=>void refresh(uid),0)})
 void supabase.auth.getSession().then(({data,error})=>{if(!alive)return;if(error){setError(error.message);setLoading(false);return}const uid=data.session?.user.id??null;currentUser.current=uid;setUserId(uid);void refresh(uid)})
 const timer=setInterval(()=>void refresh(currentUser.current),30000)
 return()=>{alive=false;subscription.subscription.unsubscribe();clearInterval(timer)}
 },[refresh])
 async function action(name:string,payload:any){
 if(!configured){if(name==='switchDemoUser'){setUserId(payload.userId??payload.id??null);return}if(name==='resetDemo'){const reset=structuredClone(seed);setData(reset);localStorage.setItem(DEMO_KEY,JSON.stringify(reset));return}const next=await demoAction(data,userId,name,payload);localStorage.setItem(DEMO_KEY,JSON.stringify(next));setData(next);return}
 await liveAction(data,userId,name,payload);await refresh(userId)
 }
 async function signIn(email:string){
 if(!supabase){const existing=data.people.find(p=>p.email.toLowerCase()===email.toLowerCase());if(existing){setUserId(existing.id);return}const id=crypto.randomUUID();const next={...data,people:[...data.people,{id,name:email.split('@')[0],email,status:'pending' as const,roles:[]}]};setData(next);localStorage.setItem(DEMO_KEY,JSON.stringify(next));setUserId(id);return}
 const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin+window.location.pathname,data:{display_name:email.split('@')[0]}}});if(error)throw new Error(error.message)
 }
 async function signOut(){if(supabase){const {error}=await supabase.auth.signOut();if(error)throw error}setUserId(null)}
 if(loading)return <div className="connection-state"><h1>Open Labs</h1><p>Opening your workspace…</p></div>
 if(error)return <div className="connection-state"><h1>Unable to open the workspace</h1><p role="alert">{error}</p><button onClick={()=>{setLoading(true);void refresh(userId)}}>Try again</button></div>
 return <App data={data} userId={userId} onAction={action} mode={configured?'live':'demo'} onSignIn={signIn} onSignOut={signOut}/>
}
createRoot(document.getElementById('app')!).render(<React.StrictMode><Root/></React.StrictMode>)
