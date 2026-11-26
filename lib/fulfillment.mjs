import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from 'node:crypto';

export const RELEASE_PATH='private/releases/BroClient.exe';
const KEY_PREFIX='private/customer-keys/';
const STOCK_PATH='private/licenses/inventory-v1.json';
const OWNER='1027596385123565569';
const PLANS=['day','week','month','life'];
const validPayment=id=>typeof id==='string'&&/^pay_[A-Za-z0-9]+$/.test(id);
const PREFIX='private/discord-entitlements/';
const sha256='a8395f613d99768d3e9589820339d5f729592dd16a9d8d1cc2adb0bf573571dd';
const exactExeSize=2836992;
export const isSnowflake=value=>typeof value==='string'&&/^\d{17,20}$/.test(value);
const keyPath=id=>KEY_PREFIX+id+'.json';
const active=item=>item && (item.expiresAt===null||typeof item.expiresAt==='string'&&Number.isFinite(Date.parse(item.expiresAt))&&Date.parse(item.expiresAt)>Date.now());

export async function listPaidPurchases(bucket,discordId){
  if(!isSnowflake(discordId))return [];
  let cursor;const purchases=[];
  for(let pageIndex=0;pageIndex<4;pageIndex++){
    const page=await bucket.list({prefix:PREFIX+discordId+'/',limit:100,cursor});
    const items=page.objects.filter(item=>item.key.startsWith(PREFIX+discordId+'/'));
    // Bound the parallel reads to avoid a serial network round-trip per purchase.
    for(let i=0;i<items.length;i+=12){
      const records=await Promise.all(items.slice(i,i+12).map(async item=>{
        const record=await bucket.get(item.key);if(!record)return null;
        const purchase=await record.json();
        const paymentId=purchase.paymentId ?? item.key.split('/').at(-1);
        if(!/^pay_[a-zA-Z0-9]+$/.test(paymentId)||!PLANS.includes(purchase.planId))return null;
        return {paymentId,planId:purchase.planId,expiresAt:purchase.expiresAt,active:!!active(purchase)};
      }));
      purchases.push(...records.filter(Boolean));
    }
    if(!page.truncated||!page.cursor)break;
    cursor=page.cursor;
  }
  return purchases.sort((a,b)=>(Number(b.active)-Number(a.active))||a.paymentId.localeCompare(b.paymentId));
}
export async function hasActivePurchase(bucket,id){
  return (await listPaidPurchases(bucket,id)).some(p=>p.active);
}
function cryptKey(){
  const value=process.env.BRO_KEY_ENCRYPTION_KEY;
  if(typeof value!=='string'||!/^[a-f0-9]{64}$/i.test(value))throw Error('Key encryption not configured');
  return Buffer.from(value,'hex');
}
export function encryptCustomerKey(raw){
  const key=cryptKey();
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(raw,'utf8'),cipher.final()]);
  return {v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')};
}
export function decryptCustomerKey(record){
  const key=cryptKey();
  if(record?.v!==1)throw Error('Invalid key version');
  const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(record.iv,'base64'));
  cipher.setAuthTag(Buffer.from(record.tag,'base64'));
  return Buffer.concat([cipher.update(Buffer.from(record.data,'base64')),cipher.final()]).toString('utf8');
}
// Single private, conditional-write ledger. A successful CAS commits both
// the key reservation and its payment ownership; no partial allocation is possible.
const keyFingerprint=key=>createHmac('sha256',cryptKey()).update('license-v1\0'+key).digest('hex');
export function ownerStockPath(user){
 if(user?.discordId!==OWNER)return null;
 try{return '/gestion-cles/'+createHmac('sha256',cryptKey()).update('owner-stock-url-v1:'+OWNER).digest('hex');}catch{return null;}
}
async function readInventory(bucket,{forWrite=false}={}){
 const blob=await bucket.get(STOCK_PATH,{forWrite});
 if(blob){const state=await blob.json();if(state.v!==1||!Array.isArray(state.keys)||!Array.isArray(state.pending))throw Error('invalid_inventory');return {state,etag:blob.etag};}
 return {state:{v:1,keys:[],pending:[]},etag:null};
}
async function initializeLegacy(bucket,state){
 if(state.legacyImported)return;
 let cursor;
 do {
  const page=await bucket.list({prefix:KEY_PREFIX,limit:100,cursor});
  for(const item of page.objects){
   const record=await bucket.get(item.key);if(!record)continue;
   const raw=await record.json();
   const fingerprint=keyFingerprint(decryptCustomerKey(raw));
   if(!state.keys.some(k=>k.id===fingerprint))state.keys.push({id:fingerprint,planId:null,createdAt:raw.assignedAt??null,legacy:true,discordId:item.key.slice(KEY_PREFIX.length).replace(/\.json$/,'')});
  }
  cursor=page.truncated?page.cursor:null;
 }while(cursor);
 state.legacyImported=true;
}
function fulfillPending(state){
 // Preserve verified pending orders and inventory during the temporary pause.
 if(process.env.BRO_KEY_DELIVERY_PAUSED==='true')return;
 for(const order of state.pending){
  if(!active(order)||state.keys.some(k=>k.paymentId===order.paymentId))continue;
  const key=state.keys.find(k=>!k.paymentId&&!k.legacy&&!k.blockedStatus&&k.planId===order.planId);
  if(!key)continue;
  Object.assign(key,order,{assignedAt:new Date().toISOString()});
 }
 state.pending=state.pending.filter(order=>!state.keys.some(k=>k.paymentId===order.paymentId));
}
async function changeInventory(bucket,operation){
 for(let attempt=0;attempt<12;attempt++){
  const {state,etag}=await readInventory(bucket,{forWrite:true});
  await initializeLegacy(bucket,state);
  const result=operation(state);
  if(result.write===false)return result.value;
  fulfillPending(state);
  const saved=await bucket.put(STOCK_PATH,JSON.stringify(state),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});
  if(saved)return typeof result.value==='function'?result.value(state):result.value;
 }
 throw Error('inventory_conflict');
}
export async function addStockKey(bucket,{planId,key,operatorId}){
 if(operatorId!==OWNER||!PLANS.includes(planId)||typeof key!=='string'||key.trim().length<5||key.trim().length>256)return {status:'invalid'};
 const raw=key.trim(),id=keyFingerprint(raw);
 return changeInventory(bucket,state=>{
  if(state.keys.some(k=>k.id===id))return {write:false,value:{status:'duplicate'}};
  if(state.keys.length>=10000)return {write:false,value:{status:'capacity'}};
  state.keys.push({id,planId,encrypted:encryptCustomerKey(raw),createdAt:new Date().toISOString()});
  return {value:s=>({status:'added',id,assigned:!!s.keys.find(k=>k.id===id).paymentId})};
 });
}
// Imported sold or ambiguous keys are never eligible for automatic delivery.
export async function importStockKeys(bucket,{planId,rows,operatorId}){
 if(operatorId!==OWNER||(planId!==null&&!PLANS.includes(planId))||!Array.isArray(rows)||!rows.length||rows.length>500)return {status:'invalid'};
 const merged=new Map(),rank={available:0,quarantine:1,sold:2};
 let duplicates=0,categoryConflicts=0;
 for(const row of rows){
  const category=planId===null?row?.planId:planId;
  if(!PLANS.includes(category))return {status:'invalid'};
  const raw=typeof row?.key==='string'?row.key.trim():'';
  if(raw.length<5||raw.length>256||/[\r\n\t]/.test(raw)||!Object.hasOwn(rank,row?.status))return {status:'invalid'};
  const id=keyFingerprint(raw),old=merged.get(id);
  if(old)duplicates++;
  if(old&&old.planId!==category){categoryConflicts++;old.status=old.status==='sold'||row.status==='sold'?'sold':'quarantine';}
  else if(!old||rank[row.status]>rank[old.status])merged.set(id,{raw,status:row.status,planId:category});
 }
 return changeInventory(bucket,state=>{
  const newCount=[...merged.keys()].filter(id=>!state.keys.some(k=>k.id===id)).length;
  if(state.keys.length+newCount>10000)return {write:false,value:{status:'capacity'}};
  const counts={added:0,existing:0,locked:0,quarantined:0,duplicates,conflicts:categoryConflicts};
  for(const [id,row] of merged){
   const old=state.keys.find(k=>k.id===id);
   if(old){
    counts.existing++;
    if(old.planId&&old.planId!==row.planId){counts.conflicts++;if(!old.paymentId&&!old.legacy)old.blockedStatus=old.blockedStatus==='sold'||row.status==='sold'?'sold':'quarantine';}
    else if(!old.paymentId&&!old.legacy&&row.status!=='available'&&old.blockedStatus!=='sold'){old.blockedStatus=row.status;}
    continue;
   }
   const record={id,planId:row.planId,encrypted:encryptCustomerKey(row.raw),createdAt:new Date().toISOString(),imported:true};
   if(row.status!=='available')record.blockedStatus=row.status;
   if(row.status==='sold')counts.locked++;
   if(row.status==='quarantine')counts.quarantined++;
   state.keys.push(record);counts.added++;
  }
  return {value:{status:'imported',...counts}};
 });
}
export async function queuePaidKey(bucket,{discordId,paymentId,planId,expiresAt}){
 if(!isSnowflake(discordId)||!validPayment(paymentId)||!PLANS.includes(planId)||!active({expiresAt}))return {status:'invalid'};
 if(!process.env.BRO_KEY_ENCRYPTION_KEY)return {status:'unconfigured'};
 // The entitlement is written only after payment verification by the server.
 const entitlement=await bucket.get(PREFIX+discordId+'/'+paymentId);
 if(!entitlement)return {status:'unverified'};
 const verified=await entitlement.json();
 if(verified.paymentId!==paymentId||verified.planId!==planId||verified.expiresAt!==expiresAt)return {status:'unverified'};
 return changeInventory(bucket,state=>{
  const assigned=state.keys.find(k=>k.paymentId===paymentId);
  if(assigned)return {write:false,value:{status:assigned.discordId===discordId?'assigned':'conflict'}};
  const waiting=state.pending.find(k=>k.paymentId===paymentId);
  if(waiting&&waiting.discordId!==discordId)return {write:false,value:{status:'conflict'}};
  if(!waiting)state.pending.push({discordId,paymentId,planId,expiresAt});
  return {value:s=>({status:s.keys.some(k=>k.paymentId===paymentId)?'assigned':'waiting_stock'})};
 });
}
export async function stockOverview(bucket){
 const {state}=await readInventory(bucket);
 await initializeLegacy(bucket,state);
 const rows=state.keys.map(k=>({id:k.id,planId:k.planId,createdAt:k.createdAt,assignedAt:k.assignedAt??null,discordId:k.discordId??null,paymentId:k.paymentId??null,expiresAt:k.expiresAt??null,status:k.legacy?'legacy':k.paymentId?(active(k)?'assigned':'expired'):k.blockedStatus||'available'}));
 return {rows,deliveryPaused:process.env.BRO_KEY_DELIVERY_PAUSED==='true',pending:state.pending.map(({discordId,paymentId,planId,expiresAt})=>({discordId,paymentId,planId,expiresAt})),counts:Object.fromEntries(PLANS.map(plan=>[plan,{available:rows.filter(k=>k.planId===plan&&k.status==='available').length,assigned:rows.filter(k=>k.planId===plan&&['assigned','expired','sold'].includes(k.status)).length,waiting:state.pending.filter(k=>k.planId===plan&&active(k)).length}]))};
}
// Notification metadata only: never decrypt or return a redeemable license.
export async function paymentLicenseStatus(bucket,{paymentId,discordId,planId}){
 if(!validPayment(paymentId)||!isSnowflake(discordId)||!PLANS.includes(planId))return {status:'unlinked'};
 const {state}=await readInventory(bucket);
 const row=state.keys.find(k=>k.paymentId===paymentId&&k.discordId===discordId&&k.planId===planId&&!k.legacy&&!k.blockedStatus);
 if(row)return {status:'assigned',reference:row.id.slice(0,16)};
 if(state.pending.some(k=>k.paymentId===paymentId&&k.discordId===discordId&&k.planId===planId))return {status:'waiting'};
 return {status:'pending'};
}
export async function revealStockKey(bucket,user,id){
 if(!ownerStockPath(user)||typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))return null;
 const {state}=await readInventory(bucket);
 await initializeLegacy(bucket,state);
 const row=state.keys.find(k=>k.id===id);
 if(!row)return null;
 if(row.legacy){const record=await bucket.get(keyPath(row.discordId));return record?decryptCustomerKey(await record.json()):null;}
 return decryptCustomerKey(row.encrypted);
}
export async function assignKey(bucket,{discordId,key,operatorId}){
 if(!isSnowflake(discordId)||!isSnowflake(operatorId)||typeof key!=='string'||key.trim().length<5||key.trim().length>256)return {status:'invalid'};
 const purchases=(await listPaidPurchases(bucket,discordId)).filter(p=>p.active);
 if(!purchases.length)return {status:'no_purchase'};
 if(!process.env.BRO_KEY_ENCRYPTION_KEY)return {status:'unconfigured'};
 if(await bucket.head(keyPath(discordId)))return {status:'already_assigned'};
 const id=keyFingerprint(key.trim());
 return changeInventory(bucket,state=>{
  const purchase=purchases.find(p=>!state.keys.some(k=>k.paymentId===p.paymentId));
  if(!purchase||state.keys.some(k=>k.id===id))return {write:false,value:{status:'already_assigned'}};
  state.keys.push({id,encrypted:encryptCustomerKey(key.trim()),createdAt:new Date().toISOString(),assignedAt:new Date().toISOString(),discordId,paymentId:purchase.paymentId,planId:purchase.planId,expiresAt:purchase.expiresAt});
  return {value:{status:'assigned'}};
 });
}
export async function readCustomerKey(bucket,id,paymentId=null){
 const purchases=(await listPaidPurchases(bucket,id)).filter(p=>p.active);
 if(!purchases.length)return null;
 const {state}=await readInventory(bucket);
 const row=state.keys.find(k=>k.discordId===id&&k.paymentId&&(!paymentId||k.paymentId===paymentId)&&purchases.some(p=>p.paymentId===k.paymentId&&p.planId===k.planId));
 if(row)return decryptCustomerKey(row.encrypted);
 if(paymentId&&paymentId!=='legacy')return null;
 const blob=await bucket.get(keyPath(id));
 return blob?decryptCustomerKey(await blob.json()):null;
}
export async function accountOverview(bucket,user){
 const [purchases,{state},legacyRecord]=await Promise.all([listPaidPurchases(bucket,user.discordId),readInventory(bucket),bucket.head(keyPath(user.discordId))]);
 const current=purchases.some(p=>p.active);
 const legacy=current?legacyRecord:null;
 // Dates come only from verified, account-owned payment records; never infer from expiry.
 const invoicePrefix=typeof user.id==='string'&&user.id?'private/invoices/'+createHash('sha256').update(user.id).digest('hex')+'/':null;
 for(let i=0;i<purchases.length;i+=12)await Promise.all(purchases.slice(i,i+12).map(async p=>{
  p.purchaseDate=null;
  try{
   const entry=invoicePrefix?await bucket.get(invoicePrefix+p.paymentId):null;
   const invoice=entry?await entry.json():null;
   if(invoice?.id===p.paymentId&&Number.isFinite(Date.parse(invoice.date))){p.purchaseDate=new Date(invoice.date).toISOString();return;}
   const stored=await bucket.get('private/activity/receipts/'+p.paymentId+'.json');
   const receipt=stored?await stored.json():null;
   if(receipt?.paymentId===p.paymentId&&receipt.discordId===user.discordId&&receipt.planId===p.planId&&Number.isFinite(Date.parse(receipt.date)))p.purchaseDate=new Date(receipt.date).toISOString();
  }catch{/* Missing transaction metadata must not prevent access to existing purchases. */}
 }));
 for(const p of purchases){
  p.keyAvailable=p.active&&state.keys.some(k=>k.paymentId===p.paymentId&&k.discordId===user.discordId&&k.planId===p.planId);
  p.waitingStock=p.active&&state.pending.some(k=>k.paymentId===p.paymentId&&k.discordId===user.discordId);
 }
 purchases.sort((a,b)=>(Date.parse(b.purchaseDate)||0)-(Date.parse(a.purchaseDate)||0)||a.paymentId.localeCompare(b.paymentId));
 return {purchases,hasPurchase:purchases.length>0,active:current,keyAvailable:!!legacy||purchases.some(p=>p.keyAvailable),legacyKeyAvailable:!!legacy,downloadAvailable:false,
 whopConfigured:!!(process.env.WHOP_API_KEY&&process.env.WHOP_ACCOUNT_ID&&process.env.WHOP_WEBHOOK_SECRET),paymentMode:'verified-webhook',discordLinked:!!user.discordId};
}
export function validUploadedExe(data){
  if(!Buffer.isBuffer(data)||data.length!==exactExeSize||data.subarray(0,2).toString('ascii')!=='MZ')return false;
  const pe=data.readUInt32LE(0x3c);
  if(pe<0x40||pe>data.length-4||data.subarray(pe,pe+4).toString('hex')!=='50450000')return false;
  return createHash('sha256').update(data).digest('hex')===sha256;
}
export async function storeRelease(){
  return {status:'distribution_discontinued'};
}
