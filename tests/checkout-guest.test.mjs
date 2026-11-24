import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkoutDestination,authenticatedCheckoutDestination} from '../lib/checkout.mjs';

const config=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
const legacyPlan={...config.plans[0],checkoutUrl:'https://whop.com/checkout/plan_MCtWYReKKKb9m/'};
test('all four offers let guests buy directly, with no account or Whop API request',async()=>{
 for(const plan of config.plans){
   let called=false;
   const result=await checkoutDestination({},null,plan,'https://www.broclient.com',async()=>{called=true;throw Error('must not run');});
   assert.equal(result,plan.checkoutUrl);
   assert.equal(called,false);
 }
});
test('signed-in buyer gets an attributed checkout only when available',async()=>{
 const plan=legacyPlan;
 const result=await checkoutDestination({}, {id:'uid',discordId:'1574096900000000001'},plan,'https://www.broclient.com',
   async()=> 'https://whop.com/checkout/ch_1234');
 assert.equal(result,'https://whop.com/checkout/ch_1234');
});
test('signed-in buyer falls back to official checkout when API key is read-only or Whop fails',async()=>{
 const plan=legacyPlan;
 const result=await checkoutDestination({}, {id:'uid'},plan,'https://www.broclient.com',async()=>{
   throw new Error('Whop 403 - cannot create checkout');
 });
 assert.equal(result,plan.checkoutUrl);
});
test('invalid or off-domain checkout links cannot be injected',async()=>{
 const plan={...config.plans[0],checkoutUrl:'https://evil.invalid/checkout/plan_Z123'};
 await assert.rejects(checkoutDestination({},null,plan,'https://www.broclient.com',async()=>{}));
 const result=await checkoutDestination({}, {id:'uid'},config.plans[0],'https://www.broclient.com',async()=>{
  return 'https://evil.invalid/checkout/ch_1234';
 });
 assert.equal(result,config.plans[0].checkoutUrl);
});
test('checkout UI and explanatory text require Discord',()=>{
 const src=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 const site=readFileSync(new URL('../offres.html',import.meta.url),'utf8');
 assert.match(src,/if\(!user\?\.discordId\)/);
 assert.doesNotMatch(src,/return res\.redirect\(302,target\.href\)/);
 assert.match(site,/Connexion Discord requise/);
 assert.match(config.content.a3,/Oui\. Connecte-toi avec Discord/);
});

test('production authenticated checkout fails closed on Whop 403',async()=>{
 const user={id:'verified-user',discordId:'1574096900000000001'};
 for(const plan of config.plans){
   await assert.rejects(authenticatedCheckoutDestination({},user,plan,'https://www.broclient.com',async()=>{throw Error('whop_api_403')}),/whop_api_403/);
 }
});
test('production checkout preserves attributed success, rejects guests and fails closed on integrity errors',async()=>{
 const user={id:'verified-user',discordId:'1574096900000000001'},plan=legacyPlan;
 assert.deepEqual(await authenticatedCheckoutDestination({},user,plan,'https://www.broclient.com',async()=> 'https://whop.com/checkout/ch_1234'),{url:'https://whop.com/checkout/ch_1234',attributed:true});
 await assert.rejects(authenticatedCheckoutDestination({},null,plan,'https://www.broclient.com',async()=>{throw Error('must not run')}),/discord_session_required/);
 await assert.rejects(authenticatedCheckoutDestination({},user,plan,'https://www.broclient.com',async()=>{throw Error('checkout_price_mismatch')}),/checkout_price_mismatch/);
 await assert.rejects(authenticatedCheckoutDestination({},user,{...plan,checkoutUrl:'https://evil.invalid/checkout/plan_123'},'https://www.broclient.com',async()=>{throw Error('whop_api_403')}),/Invalid official/);
 const src=readFileSync(new URL('../api/platform.js',import.meta.url),'utf8');
 assert.match(src,/await authenticatedCheckoutDestination\(billingEnv,user,plan/);
 assert.match(src,/return res\.redirect\(302,result\.url\)/);
});

test('all new plans use authenticated dynamic checkouts and no fallback',async()=>{
 const expected={"day":"https://whop.com/checkout/plan_2XsZR1EchcSOj","week":"https://whop.com/checkout/plan_sIer2uLNR0Idi","month":"https://whop.com/checkout/plan_jzDhXvlF2aSQc","life":"https://whop.com/checkout/plan_3G7GUcXlBFZJX"};
 const user={id:'verified-user',discordId:'1574096900000000001'};
 for(const plan of config.plans){
  assert.equal(plan.checkoutUrl,expected[plan.id]);
  const result=await authenticatedCheckoutDestination({},user,plan,'https://www.broclient.com',async(env,verified,offer)=>{assert.equal(verified.discordId,user.discordId);assert.equal(offer.checkoutUrl,expected[plan.id]);return 'https://whop.com/checkout/ch_1234';});
  assert.deepEqual(result,{url:'https://whop.com/checkout/ch_1234',attributed:true});
  await assert.rejects(authenticatedCheckoutDestination({},null,plan,'https://www.broclient.com',async()=>{}),/discord_session_required/);
 }
});
test('old persisted checkout URLs migrate while preserving other storefront settings',async()=>{
 const {readSite,validCheckout}=await import('../lib/store.mjs');
 const saved={...config,checkoutLinksVersion:2,plans:config.plans.map(p=>({...p,checkoutUrl:legacyPlan.checkoutUrl,description:'custom'}))};
 const bucket={get:async()=>({etag:'old',json:async()=>saved})};
 const {site}=await readSite(bucket);
 assert.deepEqual(site.plans.map(p=>p.checkoutUrl),config.plans.map(p=>p.checkoutUrl));
 assert.ok(site.plans.every(p=>p.description==='custom'));
 assert.ok(site.plans.every(p=>validCheckout(p.checkoutUrl)));
 assert.equal(validCheckout('https://evil.invalid/modelya/test'),false);
 assert.equal(validCheckout('https://whop.com/modelya/test?redirect=evil'),false);
 saved.checkoutLinksVersion=3;
 assert.equal((await readSite(bucket)).site.plans[0].checkoutUrl,legacyPlan.checkoutUrl);
});
