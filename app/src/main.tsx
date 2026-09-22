import React,{useCallback,useEffect,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import App from './App'
import WorkspaceLoader from './WorkspaceLoader'
import {configured,supabase} from './client'
import {loadLive,liveAction,rememberSignup} from './live'
import {demoAction} from './demo'
import {seed,normalizeProfileDetails,profileDetailsError} from './model'
import type {Data,ProfileDetails} from './model'
import './style.css'
import './studio.css'
import './visual-update.css'
const DEMO_KEY='open-labs-demo-v1'
const blank:Data={people:[],initiatives:[],documents:[],obligations:[],threads:[],requests:[],audit:[]}
function readDemo():Data{try{const saved=JSON.parse(localStorage.getItem(DEMO_KEY)||'null');if(saved?.people&&saved?.initiatives&&saved?.audit)return saved}catch{/* recover corrupted local demo */}return structuredClone(seed)}
/**
 * With shouldCreateUser:false, asking for a link for an address that has no
 * account comes back as otp_disabled / "Signups not allowed for otp". That is
 * accurate but unreadable, and it is the one failure a returning member is
 * likely to hit, so it gets plain copy pointing at the new-account form.
 */
function signInMessage(error:{message:string;code?:string},creating:boolean):string{
 const code=error.code??''
 if(!creating&&(code==='otp_disabled'||code==='user_not_found'||/sign\s?ups?\s+not\s+allowed|user\s+not\s+found/i.test(error.message))){
 return 'We could not find an Open Labs account for that email. Choose "I am new here" to create one - it asks for your name.'
 }
 return error.message
}
function Root(){
 const [data,setData]=useState<Data>(()=>configured?blank:readDemo())
 const [userId,setUserId]=useState<string|null>(null)
 const [authEmail,setAuthEmail]=useState<string|null>(null)
 const [loading,setLoading]=useState(configured)
 const [error,setError]=useState('')
 const currentUser=useRef<string|null>(null)
 const refresh=useCallback(async(uid:string|null)=>{try{const result=await loadLive(uid);if(currentUser.current===uid){setData(result);setError('')}}catch(e){if(currentUser.current===uid){setData(blank);setError(e instanceof Error?e.message:'Unable to load workspace')}}finally{if(currentUser.current===uid)setLoading(false)}},[])
 useEffect(()=>{if(!supabase)return;let alive=true
 const {data:subscription}=supabase.auth.onAuthStateChange((_event,session)=>{if(!alive)return;const uid=session?.user.id??null;currentUser.current=uid;setUserId(uid);setAuthEmail(session?.user.email??null);setData(blank);setLoading(true);setTimeout(()=>void refresh(uid),0)})
 void supabase.auth.getSession().then(({data,error})=>{if(!alive)return;if(error){setError(error.message);setLoading(false);return}const uid=data.session?.user.id??null;currentUser.current=uid;setUserId(uid);setAuthEmail(data.session?.user.email??null);void refresh(uid)})
 const timer=setInterval(()=>void refresh(currentUser.current),30000)
 return()=>{alive=false;subscription.subscription.unsubscribe();clearInterval(timer)}
 },[refresh])
 async function action(name:string,payload:any){
 if(!configured){if(name==='switchDemoUser'){setUserId(payload.userId??payload.id??null);return}if(name==='resetDemo'){const reset=structuredClone(seed);setData(reset);localStorage.setItem(DEMO_KEY,JSON.stringify(reset));return}const next=await demoAction(data,userId,name,payload);localStorage.setItem(DEMO_KEY,JSON.stringify(next));setData(next);return}
 await liveAction(data,userId,name,payload);await refresh(userId)
 }
 // `details` is present only when the visitor filled in the new-account form;
 // a returning member signs in with their email alone and keeps the profile
 // they already have.
 async function signIn(email:string,details?:ProfileDetails){
 let signup:ProfileDetails|null=null
 if(details){signup=normalizeProfileDetails(details);const problem=profileDetailsError(signup);if(problem)throw new Error(problem)}
 if(!supabase){const existing=data.people.find(p=>p.email.toLowerCase()===email.toLowerCase());if(existing){setUserId(existing.id);return}const id=crypto.randomUUID();const next={...data,people:[...data.people,{id,name:signup?.name??'',email,status:'pending' as const,roles:[],major:signup?.major??'',interests:signup?.interests??''}]};setData(next);localStorage.setItem(DEMO_KEY,JSON.stringify(next));setUserId(id);return}
 // shouldCreateUser follows the form the visitor used: only the new-account
 // form, which requires a name, may create an account. A returning member's
 // email-only request can therefore never mint a nameless profile, and an
 // account that already exists still signs in either way.
 // The details ride in the magic-link metadata, which handle_new_user copies
 // into the profile; rememberSignup keeps a local copy so a link confirmed
 // after the profile row already exists can still complete it.
 const {error}=await supabase.auth.signInWithOtp({email,options:{shouldCreateUser:!!signup,emailRedirectTo:window.location.origin+window.location.pathname,...(signup?{data:{display_name:signup.name,major:signup.major,interests:signup.interests}}:{})}})
 if(error)throw new Error(signInMessage(error,!!signup))
 if(signup)rememberSignup(email,signup)
 }
 async function signOut(){if(supabase){const {error}=await supabase.auth.signOut();if(error)throw error}setUserId(null);setAuthEmail(null)}
 if(loading)return <WorkspaceLoader />
 if(error)return <div className="connection-state"><h1>Unable to open the workspace</h1><p role="alert">{error}</p><button onClick={()=>{setLoading(true);void refresh(userId)}}>Try again</button></div>
 return <App data={data} userId={userId} onAction={action} mode={configured?'live':'demo'} onSignIn={signIn} onSignOut={signOut} authEmail={authEmail}/>
}
createRoot(document.getElementById('app')!).render(<React.StrictMode><Root/></React.StrictMode>)
