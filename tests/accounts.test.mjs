import test from 'node:test';
import assert from 'node:assert/strict';
import {registerAccount,findAccount,listAccounts} from '../lib/accounts.mjs';
const makeBucket=()=>{const map=new Map();let etag=0;return {
 map,async get(k){const item=map.get(k);return item?{etag:item.etag,json:async()=>JSON.parse(item.value)}:null;},
 async put(k,value,options={}){const old=map.get(k);if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etag)return null;const entry={etag:String(++etag),value};map.set(k,entry);return entry;},
 async list({prefix,limit=25}){return {objects:[...map.keys()].filter(k=>k.startsWith(prefix)).slice(0,limit).map(key=>({key})),truncated:false};}
};};
const user={id:'auth-a',discordId:'1574096900000000001',discordUsername:'Same name',discordAvatar:null};
test('stable unique accounts are registered only for verified identities, with private auth ID',async()=>{
 const bucket=makeBucket();
 const first=await registerAccount(bucket,user,1700000000000);
 const second=await registerAccount(bucket,{...user,id:'auth-b',discordId:'1574096900000000002'},1700000000000);
 assert.notEqual(first.username,second.username);
 assert.equal((await registerAccount(bucket,{...user,discordUsername:'New Name'},1700001000000)).username,first.username);
 assert.equal((await findAccount(bucket,first.username)).authId,user.id);
 assert.equal(await registerAccount(bucket,{id:'x'}),null);
 await assert.rejects(registerAccount(bucket,{...user,id:'different'}),/account_identity_conflict/);
 const {accounts}=await listAccounts(bucket);
 assert.equal(accounts.length,2);assert.ok(accounts.every(x=>!('authId' in x)));
});
