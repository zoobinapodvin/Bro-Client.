import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 normalizePayment,storeActivity,recentPurchases,setActivityPreference,getActivityPreference,
 backfillWhopHistory
} from '../lib/activity.mjs';

const discordId='1574096900000000001';
const payment=(id,date,productId='prod_ZrNuFIODHTxMx')=>({
 id,paid_at:date,status:'paid',account_id:'biz_emxZArodB6p2Af',
 product:{id:productId},amount_charged:{amount:6,currency:'EUR'}
});
const bucket=()=>({
 objects:{},
 async list({prefix}){return {objects:Object.keys(this.objects).filter(key=>key.startsWith(prefix)).map(key=>({key})),truncated:false,cursor:null};},
 async get(key){return this.objects[key]?{json:async()=>this.objects[key]}:null;},
 async head(key){return this.objects[key]?{etag:'exists'}:null;},
 async put(key,payload,options){if(options?.onlyIf?.etagDoesNotMatch==='*'&&this.objects[key])return null;
   this.objects[key]=JSON.parse(payload);return {etag:'ok'};}
});
test('public activity accepts only verified company, known plan, date and currency',()=>{
 const p=payment('pay_TEST1','2026-11-22T12:00:00.000Z');
 const result=normalizePayment(p,'day');
 assert.equal(result.name,'Client BRO');
 assert.equal(result.avatar,null);
 assert.equal(result.amount,6);
 assert.equal(normalizePayment({...p,account_id:'biz_wrong'},'day'),null);
 assert.equal(normalizePayment({...p,status:'failed',account_id:'biz_wrong'},'day'),null);
 assert.equal(normalizePayment({...p,amount_charged:{amount:6,currency:'USD'}},'day'),null);
});
test('public Discord username only appears with opt-in and never accepts email or untrusted avatar',()=>{
 const p=payment('pay_TEST2','2026-11-22T12:00:00.000Z');
 const a=normalizePayment(p,'day',{visible:true,username:'person@site.com',avatar:'https://evil.invalid/avatar.jpg'});
 assert.equal(a.name,'Client BRO');
 assert.equal(a.avatar,null);
 const b=normalizePayment(p,'day',{visible:true,username:'BroUser',avatar:'https://cdn.discordapp.com/avatars/123/abc.png?size=128'});
 assert.equal(b.name,'BroUser');
 assert.match(b.avatar,/cdn.discordapp.com/);
});
test('newest 5 verified payments are returned without payment IDs, with correct order',async()=>{
 const b=bucket();
 for(let i=0;i<7;i++){
  const id='pay_TEST'+i;
  const p=payment(id,new Date(Date.UTC(2026,10,22,10,i)).toISOString());
  await storeActivity(b,normalizePayment(p,'day'));
 }
 assert.equal((await recentPurchases(b)).length,5);
 const first=(await recentPurchases(b))[0];
 assert.equal(first.date,'2026-11-22T10:06:00.000Z');
 assert.equal(Object.keys(first).includes('paymentId'),false);
});
test('user may revoke Discord pseudo on existing public transactions',async()=>{
 const b=bucket();
 const p=payment('pay_OPTOUT','2026-11-22T12:00:00.000Z');
 await storeActivity(b,{...normalizePayment(p,'day',{visible:true,username:'BroDev',avatar:null}),discordId});
 await setActivityPreference(b,{discordId},true);
 assert.equal(await getActivityPreference(b,discordId),true);
 await setActivityPreference(b,{discordId},false);
 assert.equal(await getActivityPreference(b,discordId),false);
 const feed=await recentPurchases(b);
 assert.equal(feed[0].name,'Client BRO');
 assert.equal(feed[0].avatar,null);
});
test('historical import is scoped to paid exact products, does not grant licenses and is idempotent',async t=>{
 const orig=globalThis.fetch;
 t.after(()=>{globalThis.fetch=orig});
 const b=bucket();
 const valid=payment('pay_HIST1','2026-11-22T11:00:00.000Z');
 const invalid=payment('pay_HIST2','2026-11-22T10:00:00.000Z','prod_other');
 let calls=0;
 globalThis.fetch=async(url,opts)=>{
   calls++;
   const parsed=new URL(url);
   assert.equal(parsed.searchParams.get('company_id'),'biz_emxZArodB6p2Af');
   assert.equal(opts.headers.Authorization,'Bearer secret-test');
   return Response.json({data:[valid,invalid],page_info:{has_next_page:false}});
 };
 const params={apiKey:'secret-test',accountId:'biz_emxZArodB6p2Af'};
 const first=await backfillWhopHistory(b,params);
 assert.equal(first.imported,1);
 const second=await backfillWhopHistory(b,params);
 assert.equal(second.imported,0);
 assert.equal(calls,2);
 assert.equal(Object.keys(b.objects).some(key=>key.startsWith('private/discord-entitlements')),false);
});
test('public site contains accessible five-purchase board; account has no e-mail field and no empty license tile',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../style.css',import.meta.url),'utf8');
 const api=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 assert.match(html,/id="purchaseBoard"/);
 assert.match(js,/refreshRecentBoard/);
 assert.match(js,/user\.discordUsername/);
 assert.doesNotMatch(js,/user\.email/);
 assert.doesNotMatch(api,/email:user\.email/);
 assert.doesNotMatch(js,/Synchronisation automatique Whop en attente de configuration/);
 assert.match(css,/#modal\.client-portal-compact/);
 assert.match(css,/overflow:hidden!important/);
 assert.match(js,/if\(overview\.keyAvailable\)/);
});
