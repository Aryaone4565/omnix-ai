const ALLOWED_ORIGIN = "https://arya4565.github.io";
const CALLBACK_PATH = "/oauth/google/callback";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const enc = new TextEncoder();
const dec = new TextDecoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "Access-Control-Allow-Origin":ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type,Authorization",
    "Vary":"Origin"
  }});
}
function htmlPage(title, message) {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px Arial;background:#0b0d13;color:#eee;padding:30px"><h2>${title}</h2><p>${message}</p><p>You can close this tab and return to OMNIX Connect.</p></body>`, {headers:{"Content-Type":"text/html;charset=utf-8","Cache-Control":"no-store"}});
}
function b64(bytes) { let s=""; for (const b of bytes) s+=String.fromCharCode(b); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
function unb64(s) { s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4)s+="="; return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }
async function sha(s) { return b64(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(s)))); }
async function cryptoKey(env) {
  if (!env.OMNIX_ENCRYPTION_KEY) throw new Error("OMNIX_ENCRYPTION_KEY is not configured.");
  const raw=unb64(env.OMNIX_ENCRYPTION_KEY);
  if(raw.length!==32) throw new Error("OMNIX_ENCRYPTION_KEY must be a base64url-encoded 32-byte key.");
  return crypto.subtle.importKey("raw",raw,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function seal(env, value) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},await cryptoKey(env),enc.encode(JSON.stringify(value)));
  return b64(iv)+"."+b64(new Uint8Array(ct));
}
async function openSeal(env, value) {
  const [iv,ct]=value.split(".");
  const clear=await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(iv)},await cryptoKey(env),unb64(ct));
  return JSON.parse(dec.decode(clear));
}
function tokenFrom(request) { const h=request.headers.get("Authorization")||""; return h.startsWith("Bearer ")?h.slice(7):""; }
function validOwner(s) { return /^[A-Za-z0-9_-]{40,100}$/.test(s); }
async function bodyJson(request) { try { return await request.json(); } catch { return null; } }
async function requireOwner(request, env) {
  const raw=tokenFrom(request);
  if(!validOwner(raw)) return null;
  return await sha(raw);
}
async function audit(env, owner, action, outcome, connectorId=null, tool=null, detail={}) {
  await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_audit (id,owner_id,connector_id,action,tool_name,outcome,detail_redacted) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),owner,connectorId,action,tool,outcome,JSON.stringify(detail).slice(0,1000)).run();
}
function redirectToApp(flag) { return Response.redirect("https://arya4565.github.io/omnix-ai/connectors.html?gmail="+encodeURIComponent(flag),303); }
function redirectUri(request) { return new URL(CALLBACK_PATH,new URL(request.url).origin).toString(); }
async function gmailConfig(env, owner) {
  return env.OMNIX_DB.prepare("SELECT id,encrypted_credentials,status FROM omnix_connector_configs WHERE owner_id=? AND connector_key='gmail' LIMIT 1").bind(owner).first();
}
async function accessToken(env, config) {
  const creds=await openSeal(env,config.encrypted_credentials);
  if(creds.access_token && creds.expires_at>Date.now()+60000) return {token:creds.access_token,creds};
  if(!creds.refresh_token) throw new Error("Gmail authorization expired. Reconnect Gmail.");
  const form=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:creds.refresh_token,grant_type:"refresh_token"});
  const response=await fetch(GOOGLE_TOKEN,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
  const data=await response.json();
  if(!response.ok||!data.access_token) throw new Error("Google token refresh failed. Reconnect Gmail.");
  const next={...creds,access_token:data.access_token,expires_at:Date.now()+Number(data.expires_in||3600)*1000};
  await env.OMNIX_DB.prepare("UPDATE omnix_connector_configs SET encrypted_credentials=?,status='connected',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(await seal(env,next),config.id).run();
  return {token:data.access_token,creds:next};
}
async function gmailFetch(env, config, path, init={}) {
  const {token}=await accessToken(env,config);
  const response=await fetch(GMAIL_API+path,{...init,headers:{Authorization:"Bearer "+token,...(init.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error("Gmail API returned HTTP "+response.status+": "+String(data.error?.message||"request failed").slice(0,180));
  return data;
}
function decodeBase64Url(s) { try { return dec.decode(Uint8Array.from(atob((s||"").replace(/-/g,"+").replace(/_/g,"/")+"===".slice(((s||"").length+3)%4)),c=>c.charCodeAt(0))); } catch { return ""; } }
function headerValue(headers,name) { return (headers||[]).find(h=>h.name?.toLowerCase()===name.toLowerCase())?.value||""; }
async function messageDetails(env, config, id) {
  const m=await gmailFetch(env,config,"/messages/"+encodeURIComponent(id)+"?format=full");
  const h=m.payload?.headers||[];
  return {id:m.id,threadId:m.threadId,from:headerValue(h,"From"),to:headerValue(h,"To"),subject:headerValue(h,"Subject"),date:headerValue(h,"Date"),snippet:m.snippet||""};
}
function base64urlBytes(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""); }
async function route(request, env) {
  const url=new URL(request.url);
  if(request.method==="OPTIONS") {
    if(url.origin!==new URL("https://arya4565.github.io").origin) return new Response(null,{status:403});
    return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Vary":"Origin"});
  }
  if(url.pathname==="/health"&&request.method==="GET") return json({service:"OMNIX Connect Gmail",status:"online",gmailOAuthConfigured:Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),encryptionConfigured:Boolean(env.OMNIX_ENCRYPTION_KEY)});
  if(url.pathname===CALLBACK_PATH&&request.method==="GET") return await oauthCallback(request,env);
  if(url.origin!==new URL("https://arya4565.github.io").origin) return json({error:"Origin not allowed."},403);
  if(!env.OMNIX_DB) return json({error:"D1 binding OMNIX_DB is missing."},500);
  if(url.pathname==="/gmail/connect"&&request.method==="POST") {
    if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET) return json({error:"Google OAuth is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the omnix-connect Worker after creating OAuth credentials."},503);
    const b=await bodyJson(request), raw=b?.ownerToken;
    if(!validOwner(raw)) return json({error:"Invalid local owner token."},400);
    const owner=await sha(raw), state=b64(crypto.getRandomValues(new Uint8Array(32))), verifier=b64(crypto.getRandomValues(new Uint8Array(32))), challenge=await sha(verifier);
    const expires=new Date(Date.now()+10*60*1000).toISOString();
    await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_oauth_states (state_hash,owner_id,connector_key,code_verifier_encrypted,expires_at) VALUES (?,?,?,?,?)").bind(await sha(state),owner,"gmail",await seal(env,{verifier}),expires).run();
    const auth=new URL(GOOGLE_AUTH);
    for(const [k,v] of Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri(request),response_type:"code",scope:"https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",access_type:"offline",prompt:"consent",state,code_challenge:challenge,code_challenge_method:"S256"})) auth.searchParams.set(k,v);
    return json({authUrl:auth.toString()});
  }
  const owner=await requireOwner(request,env);
  if(!owner) return json({error:"Unauthorized. Open OMNIX Connect in your browser and try again."},401);
  if(url.pathname==="/gmail/status"&&request.method==="GET") {
    const cfg=await gmailConfig(env,owner);
    return json({connected:Boolean(cfg&&cfg.status==="connected"),status:cfg?.status||"disconnected"});
  }
  const cfg=await gmailConfig(env,owner);
  if(!cfg||cfg.status!=="connected"||!cfg.encrypted_credentials) return json({error:"Gmail is not connected. Connect Gmail first."},409);
  if(url.pathname==="/gmail/messages"&&request.method==="GET") {
    try {
      const list=await gmailFetch(env,cfg,"/messages?maxResults=10&q=in%3Ainbox");
      const messages=await Promise.all((list.messages||[]).slice(0,10).map(m=>messageDetails(env,cfg,m.id)));
      await audit(env,owner,"gmail.list_messages","success",cfg.id,"gmail.list_messages",{count:messages.length});
      return json({messages});
    } catch(e) { await audit(env,owner,"gmail.list_messages","error",cfg.id,"gmail.list_messages",{}); return json({error:String(e.message||e)},502); }
  }
  if(url.pathname==="/gmail/message"&&request.method==="GET") {
    const id=url.searchParams.get("id")||"";
    if(!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return json({error:"Invalid message ID."},400);
    try { const message=await messageDetails(env,cfg,id); const full=await gmailFetch(env,cfg,"/messages/"+encodeURIComponent(id)+"?format=full"); const parts=[]; if(full.payload?.body?.data) parts.push(decodeBase64Url(full.payload.body.data)); for(const p of (full.payload?.parts||[])) if(p.mimeType==="text/plain"&&p.body?.data) parts.push(decodeBase64Url(p.body.data)); return json({message,body:parts.join("\n").slice(0,12000)}); }
    catch(e) { return json({error:String(e.message||e)},502); }
  }
  if(url.pathname==="/gmail/send/prepare"&&request.method==="POST") {
    const b=await bodyJson(request);
    const to=String(b?.to||"").trim(),subject=String(b?.subject||"").trim(),body=String(b?.body||"");
    if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)||!subject||!body.trim()||subject.length>250||body.length>15000) return json({error:"Provide a valid recipient, subject and message body."},400);
    const args={to,subject,body}; const hash=await sha(JSON.stringify(args)); const approvalId=crypto.randomUUID(); const expires=new Date(Date.now()+3*60*1000).toISOString();
    await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_approvals (id,owner_id,connector_id,tool_name,arguments_hash,arguments_preview,expires_at) VALUES (?,?,?,?,?,?,?)").bind(approvalId,owner,cfg.id,"gmail.send",hash,JSON.stringify({to,subject}),expires).run();
    await audit(env,owner,"gmail.send.prepare","pending",cfg.id,"gmail.send",{to,subject});
    return json({approvalId,expiresAt:expires,preview:{to,subject,body}});
  }
  if(url.pathname==="/gmail/send"&&request.method==="POST") {
    const b=await bodyJson(request);
    if(!b||!b.approvalId||b.confirmation!=="SEND EMAIL") return json({error:"Explicit confirmation is required. Review the preview and confirm sending."},400);
    const to=String(b.to||"").trim(),subject=String(b.subject||"").trim(),body=String(b.body||"");
    const argsHash=await sha(JSON.stringify({to,subject,body}));
    const approval=await env.OMNIX_DB.prepare("SELECT id FROM omnix_connector_approvals WHERE id=? AND owner_id=? AND connector_id=? AND tool_name='gmail.send' AND arguments_hash=? AND used_at IS NULL AND expires_at>?").bind(b.approvalId,owner,cfg.id,argsHash,new Date().toISOString()).first();
    if(!approval) return json({error:"Approval expired or does not match this exact email. Prepare the email again."},409);
    const used=await env.OMNIX_DB.prepare("UPDATE omnix_connector_approvals SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND used_at IS NULL").bind(b.approvalId).run();
    if(!used.meta?.changes) return json({error:"This approval has already been used."},409);
    try {
      const raw="To: "+to+"\r\nSubject: "+subject+"\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"+body;
      const result=await gmailFetch(env,cfg,"/messages/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({raw:base64urlBytes(raw)})});
      await audit(env,owner,"gmail.send","success",cfg.id,"gmail.send",{to,subject,providerMessageId:result.id||""});
      return json({sent:true,messageId:result.id||"",threadId:result.threadId||"",message:"Gmail accepted the message for sending."});
    } catch(e) { await audit(env,owner,"gmail.send","error",cfg.id,"gmail.send",{to,subject}); return json({error:String(e.message||e)},502); }
  }
  if(url.pathname==="/gmail/disconnect"&&request.method==="POST") {
    await env.OMNIX_DB.prepare("UPDATE omnix_connector_configs SET encrypted_credentials=NULL,status='revoked',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(cfg.id).run();
    await audit(env,owner,"gmail.disconnect","success",cfg.id,"gmail.disconnect",{});
    return json({disconnected:true});
  }
  return json({error:"Not found."},404);
}
async function oauthCallback(request,env) {
  const url=new URL(request.url),state=url.searchParams.get("state")||"",code=url.searchParams.get("code")||"",error=url.searchParams.get("error");
  if(error) return htmlPage("Gmail connection cancelled","Google did not authorize Gmail. Return to OMNIX and try again.");
  if(!state||!code||!env.OMNIX_DB||!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.OMNIX_ENCRYPTION_KEY) return htmlPage("Connection unavailable","OAuth settings are incomplete. Check the OMNIX Connect Worker configuration.");
  try {
    const row=await env.OMNIX_DB.prepare("SELECT state_hash,owner_id,code_verifier_encrypted,expires_at,consumed_at FROM omnix_connector_oauth_states WHERE state_hash=? AND connector_key='gmail'").bind(await sha(state)).first();
    if(!row||row.consumed_at||row.expires_at<new Date().toISOString()) return htmlPage("Connection expired","The connection request expired or was already used. Return to OMNIX and start again.");
    const {verifier}=await openSeal(env,row.code_verifier_encrypted);
    await env.OMNIX_DB.prepare("UPDATE omnix_connector_oauth_states SET consumed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE state_hash=? AND consumed_at IS NULL").bind(row.state_hash).run();
    const form=new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:redirectUri(request),grant_type:"authorization_code",code_verifier:verifier});
    const response=await fetch(GOOGLE_TOKEN,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form});
    const token=await response.json();
    if(!response.ok||!token.access_token) throw new Error("Google token exchange failed.");
    const prior=await env.OMNIX_DB.prepare("SELECT id,encrypted_credentials FROM omnix_connector_configs WHERE owner_id=? AND connector_key='gmail' LIMIT 1").bind(row.owner_id).first();
    let old={}; if(prior?.encrypted_credentials) { try { old=await openSeal(env,prior.encrypted_credentials); } catch {} }
    const creds={access_token:token.access_token,refresh_token:token.refresh_token||old.refresh_token||"",expires_at:Date.now()+Number(token.expires_in||3600)*1000,scope:token.scope||old.scope||""};
    if(!creds.refresh_token) throw new Error("Google did not return a refresh token. Remove OMNIX from your Google account's third-party access and reconnect.");
    const encrypted=await seal(env,creds),id=prior?.id||crypto.randomUUID();
    if(prior) await env.OMNIX_DB.prepare("UPDATE omnix_connector_configs SET encrypted_credentials=?,status='connected',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(encrypted,id).run();
    else await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_configs (id,owner_id,connector_key,display_name,connector_type,endpoint_url,encrypted_credentials,requested_permissions,enabled_tools,status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,row.owner_id,"gmail","Gmail","remote",null,encrypted,JSON.stringify(["gmail.readonly","gmail.send"]),JSON.stringify(["gmail.list_messages","gmail.read_message","gmail.send"]), "connected").run();
    await audit(env,row.owner_id,"gmail.connect","success",id,"gmail.oauth",{});
    return redirectToApp("connected");
  } catch(e) { console.error("Gmail OAuth callback:",String(e.message||e)); return htmlPage("Gmail connection failed",String(e.message||"Unknown error").slice(0,300)); }
}
export default { async fetch(request,env) {
  try { return await route(request,env); }
  catch(e) { console.error("OMNIX Connect error:",String(e?.stack||e)); return json({error:"OMNIX Connect encountered a server error. Check Worker logs."},500); }
} };
