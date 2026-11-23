import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canEditPatchnotes,editPatchnote,listPatchnotes,readPatchnote} from '../lib/patchnotes.mjs';
import {reconcilePaymentNotifications,notifyVerifiedPurchase} from '../lib/purchase-notify.mjs';

const makeBucket=()=>{
 const data=new Map();let counter=0;
 return {
  data,
  get:async k=>data.has(k)?{etag:data.get(k).etag,json:async()=>JSON.parse(data.get(k).value)}:null,
  head:async k=>data.has(k)?{etag:data.get(k).etag}:null,
  put:async(k,value,{onlyIf}={})=>{
   const curr=data.get(k);
   if(onlyIf?.etagDoesNotMatch==='*'&&curr)return null;
   if(onlyIf?.etagMatches&&curr?.etag!==onlyIf.etagMatches)return null;
   const etag=String(++counter);data.set(k,{value:String(value),etag});return {etag};
  }
 };
};
const note={title:'Amélioration du menu BRO',version:'1.2.0',summary:'Améliorations et corrections de l’interface de jeu.',
 content:'Nouveautés : interface optimisée.\n\nCorrections : amélioration de la stabilité.',publish:true};
test('only the designated Discord identity may edit patchnotes',()=>{
 assert.equal(canEditPatchnotes({discordId:'1027596385123565569'}),true);
 assert.equal(canEditPatchnotes({discordId:'1574096900000000001',admin:true}),false);
 assert.equal(canEditPatchnotes(null),false);
 const src=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 assert.match(src,/if\(!editor\)return res\.status\(403\)/);
 assert.match(src,/canEditPatchnotes\(user\)/);
});
test('public list/detail exposes only published notes and admin sees drafts',async()=>{
 const b=makeBucket();
 assert.deepEqual(await listPatchnotes(b),[]);
 const published=await editPatchnote(b,{...note,action:'create'});
 assert.equal(published.status,200);
 assert.match(published.item.id,/^1-2-0-[a-f0-9]{8}$/);
 const draft=await editPatchnote(b,{...note,title:'Brouillon interne BRO',publish:false});
 assert.equal(draft.item.status,'draft');
 assert.equal((await listPatchnotes(b)).length,1);
 assert.equal((await listPatchnotes(b,{admin:true})).length,2);
 assert.equal(await readPatchnote(b,draft.item.id),null);
 assert.equal((await readPatchnote(b,draft.item.id,{admin:true})).title,'Brouillon interne BRO');
 assert.equal((await readPatchnote(b,published.item.id)).title,note.title);
 const revised=await editPatchnote(b,{...note,action:'update',id:published.item.id,title:'Correctifs version 1.2.0'});
 assert.equal(revised.status,200);
 assert.equal(revised.item.id,published.item.id);
 const deleted=await editPatchnote(b,{action:'delete',id:published.item.id});
 assert.equal(deleted.deleted,true);
 assert.equal(await readPatchnote(b,published.item.id),null);
});
test('invalid notes cannot overwrite published content',async()=>{
 const b=makeBucket();
 assert.equal((await editPatchnote(b,{action:'create',title:'A'})).status,422);
 assert.equal((await editPatchnote(b,{action:'update',id:'../../../../../',...note})).status,422);
 assert.deepEqual(await listPatchnotes(b),[]);
});
const webhookNames=['BRO_DISCORD_WEBHOOK_DAY','BRO_DISCORD_WEBHOOK_WEEK','BRO_DISCORD_WEBHOOK_MONTH','BRO_DISCORD_WEBHOOK_LIFETIME'];
function withFakeWebhooks(t){
 const originals=Object.fromEntries(webhookNames.map(k=>[k,process.env[k]]));
 webhookNames.forEach((name,i)=>process.env[name]='https://discord.com/api/webhooks/1574104664633249842/fakeSecret'+i);
 t.after(()=>{for(const[k,v]of Object.entries(originals))if(v===undefined)delete process.env[k];else process.env[k]=v;});
}
const company='biz_emxZArodB6p2Af';
const payment=(id,plan)=>({id,company:{id:company},status:'paid',
 paid_at:new Date().toISOString(),currency:'EUR',total:plan==='day'?6:15,
 plan:{id:plan==='day'?'plan_MCtWYReKKKb9m':'plan_kPcl5mzGmRq2Q'},
 product:{id:plan==='day'?'prod_ZrNuFIODHTxMx':'prod_m8OHqP9zv7liA'}});
test('staff webhooks use each pass category and do not mention an unverified Discord user',async t=>{
 withFakeWebhooks(t);
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const messages=[];
 globalThis.fetch=async(url,options)=>{
  assert.match(String(url),/^https:\/\/discord\.com\/api\/webhooks\//);
  messages.push({url:String(url),body:JSON.parse(options.body)});
  return Response.json({id:'1574104664633249843',channel_id:'1574104664633249844',webhook_id:'1574104664633249842'});
 };
 const b=makeBucket();
 const p=payment('pay_ABC123','day');
 const result=await notifyVerifiedPurchase(b,{planId:'day'},p);
 assert.equal(result.ok,true);
 assert.equal(messages.length,1);
 assert.equal(messages[0].body.allowed_mentions.users.length,0);
 assert.match(messages[0].body.embeds[0].fields.find(x=>x.name==='Compte Discord').value,/Non associé/);
 assert.equal((await notifyVerifiedPurchase(b,{planId:'day'},p)).alreadySent,true);
 assert.equal(messages.length,1);
});
test('Discord staff mention is permitted only for a verified linked order',async t=>{
 withFakeWebhooks(t);
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 let body;globalThis.fetch=async(u,opt)=>{body=JSON.parse(opt.body);return Response.json({id:'1574104664633249843',channel_id:'1574104664633249844',webhook_id:'1574104664633249842'});};
 const b=makeBucket();
 await notifyVerifiedPurchase(b,{planId:'week',discordId:'1027596385123565569'},payment('pay_DEF123','week'));
 assert.deepEqual(body.allowed_mentions.users,['1027596385123565569']);
 assert.match(body.content,/<@1027596385123565569>/);
});
test('daily reconciliation routes four confirmed passes and never resends an already sent receipt',async t=>{
 withFakeWebhooks(t);
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 const ids=['plan_MCtWYReKKKb9m','plan_kPcl5mzGmRq2Q','plan_iN2Oc79WLycrs','plan_p90wN1m6OLoEH'];
 const payments=ids.map((id,i)=>({
  id:'pay_TODAY'+i,status:'paid',paid_at:new Date().toISOString(),
  company:{id:company},plan:{id},total:10+i,currency:'EUR'
 }));
 const sent=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url).includes('api.whop.com'))return Response.json({data:payments,page_info:{has_next_page:false}});
  sent.push(String(url));return Response.json({id:'1574104664633249843',channel_id:'1574104664633249844',webhook_id:'1574104664633249842'});
 };
 const b=makeBucket();
 const first=await reconcilePaymentNotifications(b,{apiKey:'test-key',accountId:company,date:'today'});
 assert.equal(first.sent,4);assert.equal(first.errors,0);
 assert.equal(new Set(sent).size,4);
 const second=await reconcilePaymentNotifications(b,{apiKey:'test-key',accountId:company,date:'today'});
 assert.equal(second.sent,0);assert.equal(second.alreadySent,4);
 assert.equal(sent.length,4);
});
test('patchnotes routes and mobile design are included in the production build',()=>{
 const vercel=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.ok(vercel.rewrites.some(r=>r.source==='/patchnotes/:slug'));
 const build=readFileSync(new URL('../build.mjs',import.meta.url),'utf8');
 assert.match(build,/patchnotes\.html/);
 const offers=readFileSync(new URL('../offres.html',import.meta.url),'utf8');
 assert.match(offers,/data-patchnote-banner/);
});
