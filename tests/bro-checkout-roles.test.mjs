import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCounts} from '../lib/community.mjs';
import defaults from '../defaults.json' with {type:'json'};
import {entitlement,reconcileMember,expiryForPlan} from '../lib/discord.mjs';

const member='1574096900000000001';
const guild='1448897452404117558';
const customer='1574096039663898766';
const lifetime='1574096085197131957';
const makeBucket=(records)=>({
  list:async ({prefix})=>({
    objects:Object.keys(records).filter(key=>key.startsWith(prefix)).map(key=>({key})),
    truncated:false,
    cursor:null
  }),
  get:async path=>records[path]?{json:async()=>records[path]}:null
});
const purchase=(id,planId,expiresAt)=>({
  ['private/discord-entitlements/'+member+'/'+id]:{planId,expiresAt}
});

test('all four official public prices and distinct checkout URLs',()=>{
 const expected={day:6,week:15,month:35,life:100};
 assert.deepEqual(Object.fromEntries(defaults.plans.map(p=>[p.id,p.price])),expected);
 assert.equal(new Set(defaults.plans.map(p=>p.checkoutUrl)).size,4);
 assert.deepEqual(Object.fromEntries(defaults.plans.map(p=>[p.id,p.checkoutUrl])),{"day":"https://whop.com/checkout/plan_2XsZR1EchcSOj","week":"https://whop.com/checkout/plan_sIer2uLNR0Idi","month":"https://whop.com/checkout/plan_jzDhXvlF2aSQc","life":"https://whop.com/checkout/plan_3G7GUcXlBFZJX"});
});
test('lifetime entitlement is preserved alongside expired temporary passes',async()=>{
 const old=new Date(Date.now()-86400000).toISOString();
 const bucket=makeBucket({
  ...purchase('pay_oldmonth','month',old),
  ...purchase('pay_lifetime','life',null)
 });
 assert.deepEqual(await entitlement(bucket,member),{paid:true,ever:true,lifetime:true});
});
test('temporary entitlement never grants lifetime',async()=>{
 const current=new Date(Date.now()+86400000).toISOString();
 const bucket=makeBucket(purchase('pay_day','day',current));
 assert.deepEqual(await entitlement(bucket,member),{paid:true,ever:true,lifetime:false});
});
test('no active purchase is expired, and one-time lifetime does not expire',()=>{
 assert.equal(expiryForPlan('life',new Date().toISOString()),null);
 assert.ok(Date.parse(expiryForPlan('day',new Date().toISOString()))>Date.now());
});
test('verified lifetime gets both Customer and Lifetime roles',async t=>{
 const original={token:process.env.BRO_DISCORD_BOT_TOKEN,guild:process.env.BRO_DISCORD_GUILD_ID,role:process.env.BRO_DISCORD_CUSTOMER_ROLE_ID,life:process.env.BRO_DISCORD_LIFETIME_ROLE_ID};
 const originalFetch=globalThis.fetch;
 t.after(()=>{globalThis.fetch=originalFetch;
  for(const [variable,value] of [['BRO_DISCORD_BOT_TOKEN',original.token],['BRO_DISCORD_GUILD_ID',original.guild],['BRO_DISCORD_CUSTOMER_ROLE_ID',original.role],['BRO_DISCORD_LIFETIME_ROLE_ID',original.life]]) {
    if(value===undefined)delete process.env[variable]; else process.env[variable]=value;
  }
 });
 process.env.BRO_DISCORD_BOT_TOKEN='unit-test-placeholder';
 process.env.BRO_DISCORD_GUILD_ID=guild;
 process.env.BRO_DISCORD_CUSTOMER_ROLE_ID=customer;
 process.env.BRO_DISCORD_LIFETIME_ROLE_ID=lifetime;
 const actions=[];
 globalThis.fetch=async (url,options)=>{actions.push({url,method:options.method});return new Response(null,{status:204});};
 const result=await reconcileMember(makeBucket(purchase('pay_life','life',null)),member);
 assert.equal(result.status,'role_granted_lifetime');
 assert.equal(actions.length,2);
 assert.equal(actions[0].method,'PUT');
 assert.equal(actions[1].method,'PUT');
 assert.ok(actions[0].url.endsWith('/roles/'+customer));
 assert.ok(actions[1].url.endsWith('/roles/'+lifetime));
});

test('Discord community counts use the actual Bro Client guild only',()=>{
 assert.deepEqual(normalizeCounts({guild:{id:'1448897452404117558'},approximate_member_count:210,approximate_presence_count:47}),{members:210,online:47});
 assert.equal(normalizeCounts({guild:{id:'123456789012345678'},approximate_member_count:5000,approximate_presence_count:500}),null);
 assert.equal(normalizeCounts({guild:{id:'1448897452404117558'},approximate_member_count:'210',approximate_presence_count:47}),null);
});
test('both public navigation headers include a non-clickable Discord counter',()=>{
 for(const page of ['index.html','offres.html']){
  const html=readFileSync(new URL('../'+page,import.meta.url),'utf8');
  assert.ok(html.includes('data-discord-community'));
  assert.ok(html.includes('data-discord-online'));
  assert.ok(html.includes('data-discord-total'));
  assert.doesNotMatch(html,/https:\/\/discord\.gg\//);
  assert.match(html,/<div class="discord-live" data-discord-community/);
  assert.ok(html.indexOf('data-discord-community')<html.indexOf('<nav aria-label="Navigation principale">'));
 }
});
