const ALLOWED_ORIGIN = "https://aryaone4565.github.io";
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
function redirectToApp(flag) { return Response.redirect("https://aryaone4565.github.io/omnix-ai/connectors.html?gmail="+encodeURIComponent(flag),303); }
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
  const origin=request.headers.get("Origin")||"";
  if(request.method==="OPTIONS") {
    if(origin!==ALLOWED_ORIGIN) return new Response(null,{status:403});
    return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Authorization","Vary":"Origin"}});
  }
  if(url.pathname==="/health"&&request.method==="GET") return json({service:"OMNIX Connect Gmail",status:"online",gmailOAuthConfigured:Boolean(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET),encryptionConfigured:Boolean(env.OMNIX_ENCRYPTION_KEY)});
  if(url.pathname===CALLBACK_PATH&&request.method==="GET") return await oauthCallback(request,env);
  if(url.pathname==="/oauth/meta/callback"&&request.method==="GET") return await metaOAuthCallback(request,env);
  if(origin!==ALLOWED_ORIGIN) return json({error:"Origin not allowed."},403);
  if(!env.OMNIX_DB) return json({error:"D1 binding OMNIX_DB is missing."},500);
  if(url.pathname==="/gmail/connect"&&request.method==="POST") {
    if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET) return json({error:"Google OAuth is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the omnix-connect Worker after creating OAuth credentials."},503);
    const b=await bodyJson(request), raw=b?.ownerToken;
    if(!validOwner(raw)) return json({error:"Invalid local owner token."},400);
    const owner=await sha(raw), state=b64(crypto.getRandomValues(new Uint8Array(32))), verifier=b64(crypto.getRandomValues(new Uint8Array(32))), challenge=await sha(verifier);
    const expires=new Date(Date.now()+10*60*1000).toISOString();
    await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_oauth_states (state_hash,owner_id,connector_key,code_verifier_encrypted,expires_at) VALUES (?,?,?,?,?)").bind(await sha(state),owner,"gmail",await seal(env,{verifier}),expires).run();
    const auth=new URL(GOOGLE_AUTH);
    for(const [k,v] of Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirectUri(request),response_type:"code",scope:"https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify",access_type:"offline",prompt:"consent",state,code_challenge:challenge,code_challenge_method:"S256"})) auth.searchParams.set(k,v);
    return json({authUrl:auth.toString()});
  }
  const owner=await requireOwner(request,env);
  if(!owner) return json({error:"Unauthorized. Open OMNIX Connect in your browser and try again."},401);
  if(url.pathname==="/social/status"&&request.method==="GET") {
    const [wa,meta]=await Promise.all([
      env.OMNIX_DB.prepare("SELECT status FROM omnix_connector_configs WHERE owner_id=? AND connector_key='whatsapp' LIMIT 1").bind(owner).first(),
      env.OMNIX_DB.prepare("SELECT status FROM omnix_connector_configs WHERE owner_id=? AND connector_key='meta' LIMIT 1").bind(owner).first()
    ]);
    return json({whatsapp:wa?.status==="connected",instagram:meta?.status==="connected",messenger:meta?.status==="connected",metaConfigured:Boolean(env.META_APP_ID&&env.META_APP_SECRET)});
  }
  if(url.pathname==="/whatsapp/configure"&&request.method==="POST") {
    const b=await bodyJson(request),phoneNumberId=String(b?.phoneNumberId||"").trim(),wabaId=String(b?.businessAccountId||"").trim(),accessToken=String(b?.accessToken||"").trim();
    if(!/^\\d{5,30}$/.test(phoneNumberId)||!/^\\d{5,30}$/.test(wabaId)||accessToken.length<30||accessToken.length>5000) return json({error:"Provide a valid WhatsApp Phone Number ID, WhatsApp Business Account ID, and access token."},400);
    const existing=await env.OMNIX_DB.prepare("SELECT id FROM omnix_connector_configs WHERE owner_id=? AND connector_key='whatsapp' LIMIT 1").bind(owner).first();
    const id=existing?.id||crypto.randomUUID(),encrypted=await seal(env,{phoneNumberId,businessAccountId:wabaId,accessToken});
    if(existing) await env.OMNIX_DB.prepare("UPDATE omnix_connector_configs SET encrypted_credentials=?,status='connected',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(encrypted,id).run();
    else await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_configs (id,owner_id,connector_key,display_name,connector_type,endpoint_url,encrypted_credentials,requested_permissions,enabled_tools,status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,owner,"whatsapp","WhatsApp Business","native",null,encrypted,JSON.stringify(["whatsapp_business_messaging"]),JSON.stringify(["whatsapp.send_message"]),"connected").run();
    await audit(env,owner,"whatsapp.configure","success",id,"whatsapp.configure",{});
    return json({connected:true,message:"WhatsApp Business credentials encrypted and saved on the server."});
  }
  if(url.pathname==="/whatsapp/disconnect"&&request.method==="POST") {
    const c=await env.OMNIX_DB.prepare("SELECT id FROM omnix_connector_configs WHERE owner_id=? AND connector_key='whatsapp' LIMIT 1").bind(owner).first();
    if(c) { await env.OMNIX_DB.prepare("UPDATE omnix_connector_configs SET encrypted_credentials=NULL,status='revoked',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(c.id).run(); await audit(env,owner,"whatsapp.disconnect","success",c.id,"whatsapp.disconnect",{}); }
    return json({disconnected:true});
  }
  if(url.pathname==="/whatsapp/send/prepare"&&request.method==="POST") {
    const c=await env.OMNIX_DB.prepare("SELECT id,encrypted_credentials,status FROM omnix_connector_configs WHERE owner_id=? AND connector_key='whatsapp' LIMIT 1").bind(owner).first();
    if(!c||c.status!=="connected"||!c.encrypted_credentials) return json({error:"Connect WhatsApp Business first."},409);
    const b=await bodyJson(request),to=String(b?.to||"").replace(/[\\s()+-]/g,""),message=String(b?.message||"").trim();
    if(!/^\\d{8,15}$/.test(to)||!message||message.length>4000) return json({error:"Provide a recipient phone number with country code and a message under 4,000 characters."},400);
    const args={to,message},hash=await sha(JSON.stringify(args)),approvalId=crypto.randomUUID(),expires=new Date(Date.now()+3*60*1000).toISOString();
    await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_approvals (id,owner_id,connector_id,tool_name,arguments_hash,arguments_preview,expires_at) VALUES (?,?,?,?,?,?,?)").bind(approvalId,owner,c.id,"whatsapp.send",hash,JSON.stringify({to,message}),expires).run();
    return json({approvalId,expiresAt:expires,preview:{to,message}});
  }
  if(url.pathname==="/whatsapp/send"&&request.method==="POST") {
    const b=await bodyJson(request),to=String(b?.to||"").replace(/[\\s()+-]/g,""),message=String(b?.message||"").trim();
    if(!b?.approvalId||b.confirmation!=="SEND MESSAGE") return json({error:"Explicit confirmation is required."},400);
    const c=await env.OMNIX_DB.prepare("SELECT id,encrypted_credentials,status FROM omnix_connector_configs WHERE owner_id=? AND connector_key='whatsapp' LIMIT 1").bind(owner).first();
    if(!c||c.status!=="connected"||!c.encrypted_credentials) return json({error:"Connect WhatsApp Business first."},409);
    const hash=await sha(JSON.stringify({to,message}));
    const approval=await env.OMNIX_DB.prepare("SELECT id FROM omnix_connector_approvals WHERE id=? AND owner_id=? AND connector_id=? AND tool_name='whatsapp.send' AND arguments_hash=? AND used_at IS NULL AND expires_at>?").bind(b.approvalId,owner,c.id,hash,new Date().toISOString()).first();
    if(!approval) return json({error:"Approval expired or doesn't match this exact message."},409);
    const used=await env.OMNIX_DB.prepare("UPDATE omnix_connector_approvals SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND used_at IS NULL").bind(b.approvalId).run();
    if(!used.meta?.changes) return json({error:"This approval has already been used."},409);
    try {
      const creds=await openSeal(env,c.encrypted_credentials);
      const response=await fetch("https://graph.facebook.com/v22.0/"+encodeURIComponent(creds.phoneNumberId)+"/messages",{method:"POST",headers:{"Authorization":"Bearer "+creds.accessToken,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",recipient_type:"individual",to,type:"text",text:{preview_url:false,body:message}})});
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error("WhatsApp API HTTP "+response.status+": "+String(data.error?.message||"request failed").slice(0,160));
      await audit(env,owner,"whatsapp.send","success",c.id,"whatsapp.send",{to});
      return json({sent:true,messageId:data.messages?.[0]?.id||"",message:"WhatsApp accepted the message."});
    } catch(e) { await audit(env,owner,"whatsapp.send","error",c.id,"whatsapp.send",{to}); return json({error:String(e.message||e)},502); }
  }
  if(url.pathname==="/meta/connect"&&request.method==="POST") {
    if(!env.META_APP_ID||!env.META_APP_SECRET) return json({error:"Meta OAuth is not configured. Add META_APP_ID and META_APP_SECRET to the omnix-connect Worker after creating a Meta developer app."},503);
    const b=await bodyJson(request),raw=b?.ownerToken;
    if(!validOwner(raw)) return json({error:"Invalid local owner token."},400);
    const state=b64(crypto.getRandomValues(new Uint8Array(32))),ownerHash=await sha(raw),expires=new Date(Date.now()+10*60*1000).toISOString();
    await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_oauth_states (state_hash,owner_id,connector_key,code_verifier_encrypted,expires_at) VALUES (?,?,?,?,?)").bind(await sha(state),ownerHash,"meta",await seal(env,{verifier:""}),expires).run();
    const auth=new URL("https://www.facebook.com/v22.0/dialog/oauth");
    for(const [k,v] of Object.entries({client_id:env.META_APP_ID,redirect_uri:new URL("/oauth/meta/callback",new URL(request.url).origin).toString(),response_type:"code",scope:"pages_show_list,pages_messaging,pages_read_engagement,instagram_basic,instagram_manage_messages",state})) auth.searchParams.set(k,v);
    return json({authUrl:auth.toString()});
  }
  if(url.pathname==="/meta/send/prepare"&&request.method==="POST") {
    const c=await env.OMNIX_DB.prepare("SELECT id,encrypted_credentials,status FROM omnix_connector_configs WHERE owner_id=? AND connector_key='meta' LIMIT 1").bind(owner).first();
    if(!c||c.status!=="connected"||!c.encrypted_credentials) return json({error:"Connect Instagram/Messenger first."},409);
    const b=await bodyJson(request),platform=String(b?.platform||""),pageId=String(b?.pageId||""),recipientId=String(b?.recipientId||""),message=String(b?.message||"").trim();
    if(!["instagram","messenger"].includes(platform)||!/^\\d{3,30}$/.test(pageId)||!/^\\d{3,40}$/.test(recipientId)||!message||message.length>2000) return json({error:"Provide platform, Page ID, recipient ID, and message."},400);
    const args={platform,pageId,recipientId,message},hash=await sha(JSON.stringify(args)),approvalId=crypto.randomUUID(),expires=new Date(Date.now()+3*60*1000).toISOString();
    await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_approvals (id,owner_id,connector_id,tool_name,arguments_hash,arguments_preview,expires_at) VALUES (?,?,?,?,?,?,?)").bind(approvalId,owner,c.id,"meta.send",hash,JSON.stringify({platform,pageId,recipientId,message}),expires).run();
    return json({approvalId,expiresAt:expires,preview:{platform,pageId,recipientId,message}});
  }
  if(url.pathname==="/meta/send"&&request.method==="POST") {
    const b=await bodyJson(request),platform=String(b?.platform||""),pageId=String(b?.pageId||""),recipientId=String(b?.recipientId||""),message=String(b?.message||"").trim();
    if(!b?.approvalId||b.confirmation!=="SEND MESSAGE") return json({error:"Explicit confirmation is required."},400);
    const c=await env.OMNIX_DB.prepare("SELECT id,encrypted_credentials,status FROM omnix_connector_configs WHERE owner_id=? AND connector_key='meta' LIMIT 1").bind(owner).first();
    if(!c||c.status!=="connected"||!c.encrypted_credentials) return json({error:"Connect Instagram/Messenger first."},409);
    const hash=await sha(JSON.stringify({platform,pageId,recipientId,message}));
    const approval=await env.OMNIX_DB.prepare("SELECT id FROM omnix_connector_approvals WHERE id=? AND owner_id=? AND connector_id=? AND tool_name='meta.send' AND arguments_hash=? AND used_at IS NULL AND expires_at>?").bind(b.approvalId,owner,c.id,hash,new Date().toISOString()).first();
    if(!approval) return json({error:"Approval expired or doesn't match this exact message."},409);
    const used=await env.OMNIX_DB.prepare("UPDATE omnix_connector_approvals SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND used_at IS NULL").bind(b.approvalId).run();
    if(!used.meta?.changes) return json({error:"This approval has already been used."},409);
    try {
      const creds=await openSeal(env,c.encrypted_credentials),page=(creds.pages||[]).find(p=>p.id===pageId);
      if(!page?.access_token) throw new Error("That Page is not connected to this Meta account.");
      const payload={recipient:{id:recipientId},message:{text:message}};
      const response=await fetch("https://graph.facebook.com/v22.0/"+encodeURIComponent(pageId)+"/messages?access_token="+encodeURIComponent(page.access_token),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error("Meta API HTTP "+response.status+": "+String(data.error?.message||"request failed").slice(0,160));
      await audit(env,owner,"meta.send","success",c.id,"meta.send",{platform,to:recipientId});
      return json({sent:true,messageId:data.message_id||"",message:"Meta accepted the message."});
    } catch(e) { await audit(env,owner,"meta.send","error",c.id,"meta.send",{platform}); return json({error:String(e.message||e)},502); }
  }
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
  if(url.pathname==="/gmail/search"&&request.method==="GET") {
    const q=String(url.searchParams.get("q")||"").trim().slice(0,250);
    if(!q) return json({error:"Provide a Gmail search query."},400);
    try {
      const list=await gmailFetch(env,cfg,"/messages?maxResults=10&q="+encodeURIComponent(q));
      const messages=await Promise.all((list.messages||[]).slice(0,10).map(m=>messageDetails(env,cfg,m.id)));
      await audit(env,owner,"gmail.search","success",cfg.id,"gmail.search",{count:messages.length});
      return json({messages,query:q});
    } catch(e) { await audit(env,owner,"gmail.search","error",cfg.id,"gmail.search",{}); return json({error:String(e.message||e)},502); }
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
  if(url.pathname==="/gmail/trash/prepare"&&request.method==="POST") {
    const b=await bodyJson(request), messageId=String(b?.messageId||"");
    if(!/^[A-Za-z0-9_-]{1,200}$/.test(messageId)) return json({error:"Invalid message ID."},400);
    try {
      const message=await messageDetails(env,cfg,messageId);
      const approvalId=crypto.randomUUID(), expires=new Date(Date.now()+3*60*1000).toISOString();
      const argsHash=await sha(JSON.stringify({messageId}));
      await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_approvals (id,owner_id,connector_id,tool_name,arguments_hash,arguments_preview,expires_at) VALUES (?,?,?,?,?,?,?)").bind(approvalId,owner,cfg.id,"gmail.trash",argsHash,JSON.stringify({from:message.from,subject:message.subject,date:message.date}),expires).run();
      await audit(env,owner,"gmail.trash.prepare","pending",cfg.id,"gmail.trash",{subject:message.subject||""});
      return json({approvalId,expiresAt:expires,message});
    } catch(e) { return json({error:String(e.message||e)},502); }
  }
  if(url.pathname==="/gmail/trash"&&request.method==="POST") {
    const b=await bodyJson(request), messageId=String(b?.messageId||"");
    if(!b?.approvalId||b.confirmation!=="MOVE TO TRASH"||!/^[A-Za-z0-9_-]{1,200}$/.test(messageId)) return json({error:"Review the message and explicitly confirm moving it to Trash."},400);
    const argsHash=await sha(JSON.stringify({messageId}));
    const approval=await env.OMNIX_DB.prepare("SELECT id FROM omnix_connector_approvals WHERE id=? AND owner_id=? AND connector_id=? AND tool_name='gmail.trash' AND arguments_hash=? AND used_at IS NULL AND expires_at>?").bind(b.approvalId,owner,cfg.id,argsHash,new Date().toISOString()).first();
    if(!approval) return json({error:"Approval expired or does not match this exact email. Prepare the action again."},409);
    const used=await env.OMNIX_DB.prepare("UPDATE omnix_connector_approvals SET used_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND used_at IS NULL").bind(b.approvalId).run();
    if(!used.meta?.changes) return json({error:"This approval has already been used."},409);
    try {
      await gmailFetch(env,cfg,"/messages/"+encodeURIComponent(messageId)+"/trash",{method:"POST"});
      await audit(env,owner,"gmail.trash","success",cfg.id,"gmail.trash",{messageId});
      return json({trashed:true,message:"Email moved to Gmail Trash. It was not permanently deleted."});
    } catch(e) { await audit(env,owner,"gmail.trash","error",cfg.id,"gmail.trash",{}); return json({error:String(e.message||e)},502); }
  }
  if(url.pathname==="/gmail/disconnect"&&request.method==="POST") {
    await env.OMNIX_DB.prepare("UPDATE omnix_connector_configs SET encrypted_credentials=NULL,status='revoked',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(cfg.id).run();
    await audit(env,owner,"gmail.disconnect","success",cfg.id,"gmail.disconnect",{});
    return json({disconnected:true});
  }
  return json({error:"Not found."},404);
}
async function metaOAuthCallback(request,env) {
  const url=new URL(request.url),state=url.searchParams.get("state")||"",code=url.searchParams.get("code")||"",error=url.searchParams.get("error");
  if(error) return htmlPage("Meta connection cancelled","Meta did not authorize the requested permissions. Return to OMNIX Connect and try again.");
  if(!state||!code||!env.OMNIX_DB||!env.META_APP_ID||!env.META_APP_SECRET||!env.OMNIX_ENCRYPTION_KEY) return htmlPage("Meta connection unavailable","Meta OAuth settings are incomplete. Check the OMNIX Connect Worker configuration.");
  try {
    const row=await env.OMNIX_DB.prepare("SELECT state_hash,owner_id,expires_at,consumed_at FROM omnix_connector_oauth_states WHERE state_hash=? AND connector_key='meta'").bind(await sha(state)).first();
    if(!row||row.consumed_at||row.expires_at<new Date().toISOString()) return htmlPage("Connection expired","The Meta connection request expired or was already used. Start again from OMNIX Connect.");
    await env.OMNIX_DB.prepare("UPDATE omnix_connector_oauth_states SET consumed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE state_hash=? AND consumed_at IS NULL").bind(row.state_hash).run();
    const redirectUri=new URL("/oauth/meta/callback",new URL(request.url).origin).toString();
    const tokenUrl=new URL("https://graph.facebook.com/v22.0/oauth/access_token");
    for(const [k,v] of Object.entries({client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,redirect_uri:redirectUri,code})) tokenUrl.searchParams.set(k,v);
    const tokenResponse=await fetch(tokenUrl),tokenData=await tokenResponse.json();
    if(!tokenResponse.ok||!tokenData.access_token) throw new Error("Meta token exchange failed.");
    const longUrl=new URL("https://graph.facebook.com/v22.0/oauth/access_token");
    for(const [k,v] of Object.entries({grant_type:"fb_exchange_token",client_id:env.META_APP_ID,client_secret:env.META_APP_SECRET,fb_exchange_token:tokenData.access_token})) longUrl.searchParams.set(k,v);
    const longResponse=await fetch(longUrl),longData=await longResponse.json();
    const userToken=longResponse.ok&&longData.access_token?longData.access_token:tokenData.access_token;
    const pagesResponse=await fetch("https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token="+encodeURIComponent(userToken));
    const pagesData=await pagesResponse.json();
    if(!pagesResponse.ok) throw new Error("Unable to list Pages: "+String(pagesData.error?.message||"check Meta permissions").slice(0,180));
    const pages=(pagesData.data||[]).map(p=>({id:String(p.id),name:String(p.name||"Facebook Page"),access_token:String(p.access_token||""),instagram_business_account:p.instagram_business_account||null})).filter(p=>p.id&&p.access_token);
    if(!pages.length) throw new Error("No Facebook Pages with usable permissions were found. Add your Page to this Meta app and reconnect.");
    const prior=await env.OMNIX_DB.prepare("SELECT id FROM omnix_connector_configs WHERE owner_id=? AND connector_key='meta' LIMIT 1").bind(row.owner_id).first();
    const id=prior?.id||crypto.randomUUID(),creds={user_access_token:userToken,pages,connected_at:new Date().toISOString()};
    if(prior) await env.OMNIX_DB.prepare("UPDATE omnix_connector_configs SET encrypted_credentials=?,status='connected',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(await seal(env,creds),id).run();
    else await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_configs (id,owner_id,connector_key,display_name,connector_type,endpoint_url,encrypted_credentials,requested_permissions,enabled_tools,status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,row.owner_id,"meta","Instagram & Messenger","native",null,await seal(env,creds),JSON.stringify(["pages_show_list","pages_messaging","instagram_basic","instagram_manage_messages"]),JSON.stringify(["meta.send"]), "connected").run();
    await audit(env,row.owner_id,"meta.connect","success",id,"meta.oauth",{pages:pages.length});
    return Response.redirect("https://aryaone4565.github.io/omnix-ai/connectors.html?meta=connected",303);
  } catch(e) { console.error("Meta OAuth callback:",String(e.message||e)); return htmlPage("Meta connection failed",String(e.message||"Unknown error").slice(0,300)); }
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
    else await env.OMNIX_DB.prepare("INSERT INTO omnix_connector_configs (id,owner_id,connector_key,display_name,connector_type,endpoint_url,encrypted_credentials,requested_permissions,enabled_tools,status) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,row.owner_id,"gmail","Gmail","remote",null,encrypted,JSON.stringify(["gmail.readonly","gmail.send","gmail.modify"]),JSON.stringify(["gmail.list_messages","gmail.read_message","gmail.send","gmail.trash"]), "connected").run();
    await audit(env,row.owner_id,"gmail.connect","success",id,"gmail.oauth",{});
    return redirectToApp("connected");
  } catch(e) { console.error("Gmail OAuth callback:",String(e.message||e)); return htmlPage("Gmail connection failed",String(e.message||"Unknown error").slice(0,300)); }
}
export default { async fetch(request,env) {
  try { return await route(request,env); }
  catch(e) { console.error("OMNIX Connect error:",String(e?.stack||e)); return json({error:"OMNIX Connect encountered a server error. Check Worker logs."},500); }
} };
