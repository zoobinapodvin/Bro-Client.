import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';

process.env.BRO_DISCORD_SUPABASE_PUBLISHABLE_KEY ||= 'sb_publishable_oauth_route_test';
const {default:handler}=await import('../api/platform.js');

function response(){
 const headers=new Map();
 return {
   code:200,headers,
   setHeader(key,value){headers.set(key.toLowerCase(),value);},
   appendHeader(key,value){const k=key.toLowerCase();headers.set(k,[...(headers.get(k)||[]),value]);},
   status(code){this.code=code;return this;},
   json(value){return {status:this.code,body:value,headers};},
   redirect(status,url){return {status,url,headers};},
   end(){return {status:this.code,headers};}
 };
}
async function send(method,url,origin,body=''){
 const req=Readable.from(body?[Buffer.from(body)]:[]);
 req.method=method;req.url=url;
 req.headers={host:'www.broclient.com',...(origin?{origin}:{})};
 return handler(req,response());
}
test('GET /auth/discord directly begins PKCE without a 403/404',async()=>{
 const result=await send('GET','/auth/discord');
 assert.equal(result.status,303);
 const oauth=new URL(result.url);
 assert.equal(oauth.origin,'https://izzqsgszyvkibmkdruvj.supabase.co');
 assert.equal(oauth.pathname,'/auth/v1/authorize');
 assert.equal(oauth.searchParams.get('provider'),'discord');
 assert.equal(oauth.searchParams.get('code_challenge_method'),'s256');
 assert.equal(oauth.searchParams.get('redirect_to'),'https://www.broclient.com/auth/discord-return');
 assert.ok(oauth.searchParams.get('code_challenge')?.length>=43);
 const cookies=result.headers.get('set-cookie')||[];
 assert.ok(cookies.some(s=>s.startsWith('__Host-bro-discord-proof=')&&s.includes('HttpOnly')&&s.includes('Secure')));
});
test('GET OAuth preserves approved checkout destination only',async()=>{
 const good=await send('GET','/auth/discord?return_to=%2Fcheckout%2Fweek');
 assert.ok(good.headers.get('set-cookie').some(x=>x.includes('__Host-bro-discord-next=%2Fcheckout%2Fweek')));
 const bad=await send('GET','/auth/discord?return_to=https%3A%2F%2Fevil.invalid');
 assert.ok(bad.headers.get('set-cookie').some(x=>x.includes('__Host-bro-discord-next=%2F%23compte')));
});
test('old POST form remains functional with trusted production origin',async()=>{
 const result=await send('POST','/auth/discord','https://www.broclient.com','return_to=%2Fcheckout%2Fmonth');
 assert.equal(result.status,303);
 assert.ok(result.headers.get('set-cookie').some(x=>x.includes('__Host-bro-discord-next=%2Fcheckout%2Fmonth')));
});
test('untrusted form POST is rejected',async()=>{
 const result=await send('POST','/auth/discord','https://attacker.invalid','return_to=%2Fcheckout%2Fmonth');
 assert.equal(result.status,403);
});

test('legacy callback returns to account without showing a login document',async()=>{
 const direct=await send('GET','/auth/discord-return');
 assert.equal(direct.status,303);
 assert.equal(direct.url,'/#compte');
 const invalid=await send('GET','/auth/discord-return?code=expired');
 assert.equal(invalid.url,'/?connexion=interrompue#compte');
 const login=await send('GET','/auth/login');
 assert.equal(login.url,'/#compte');
});
