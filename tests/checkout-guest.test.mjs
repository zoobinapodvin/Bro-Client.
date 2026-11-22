import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkoutDestination} from '../lib/checkout.mjs';

const config=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
test('all four offers let guests buy directly, with no account or Whop API request',async()=>{
 for(const plan of config.plans){
   let called=false;
   const result=await checkoutDestination({},null,plan,'https://www.broclient.com',async()=>{called=true;throw Error('must not run');});
   assert.equal(result,plan.checkoutUrl);
   assert.equal(called,false);
 }
});
test('signed-in buyer gets an attributed checkout only when available',async()=>{
 const plan=config.plans[0];
 const result=await checkoutDestination({}, {id:'uid',discordId:'1574096900000000001'},plan,'https://www.broclient.com',
   async()=> 'https://whop.com/checkout/ch_1234');
 assert.equal(result,'https://whop.com/checkout/ch_1234');
});
test('signed-in buyer falls back to official checkout when API key is read-only or Whop fails',async()=>{
 const plan=config.plans[0];
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
 assert.match(src,/checkoutDestination\(billingEnv,user,plan,origin,createCheckout\)/);
 assert.doesNotMatch(src,/if\(!user&&paymentsReady\)/);
 assert.match(site,/Connexion Discord requise/);
 assert.match(config.content.a3,/Non\. Tu peux acheter directement/);
});
