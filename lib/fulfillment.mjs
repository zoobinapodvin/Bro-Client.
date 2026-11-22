import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

export const RELEASE_PATH='private/releases/BroClient.exe';
const KEY_PREFIX='private/customer-keys/';
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
    for(const item of page.objects){
      if(!item.key.startsWith(PREFIX+discordId+'/'))continue;
      const record=await bucket.get(item.key);
      if(!record)continue;
      const purchase=await record.json();
      const paymentId=purchase.paymentId ?? item.key.split('/').at(-1);
      if(!/^pay_[a-zA-Z0-9]+$/.test(paymentId)||!['day','week','month','life'].includes(purchase.planId))continue;
      purchases.push({paymentId,planId:purchase.planId,expiresAt:purchase.expiresAt,active:!!active(purchase)});
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
export async function assignKey(bucket,{discordId,key,operatorId}){
  if(!isSnowflake(discordId)||!isSnowflake(operatorId)||typeof key!=='string'||key.trim().length<5||key.trim().length>256)
    return {status:'invalid'};
  if(!await hasActivePurchase(bucket,discordId))return {status:'no_purchase'};
  if(!process.env.BRO_KEY_ENCRYPTION_KEY)return {status:'unconfigured'};
  const entry={...encryptCustomerKey(key.trim()),assignedAt:new Date().toISOString(),assignedBy:operatorId};
  const saved=await bucket.put(keyPath(discordId),JSON.stringify(entry),{onlyIf:{etagDoesNotMatch:'*'}});
  return {status:saved?'assigned':'already_assigned'};
}
export async function readCustomerKey(bucket,id){
  if(!await hasActivePurchase(bucket,id))return null;
  const blob=await bucket.get(keyPath(id));
  return blob?decryptCustomerKey(await blob.json()):null;
}
export async function accountOverview(bucket,user){
  const purchases=await listPaidPurchases(bucket,user.discordId);
  const current=purchases.some(p=>p.active);
  const [keyFile,releaseFile]=current?await Promise.all([
    bucket.head(keyPath(user.discordId)),bucket.head(RELEASE_PATH)
  ]):[null,null];
  return {
    purchases,hasPurchase:purchases.length>0,active:current,
    keyAvailable:!!keyFile,downloadAvailable:!!releaseFile,
    whopConfigured:!!(process.env.WHOP_API_KEY&&process.env.WHOP_ACCOUNT_ID&&process.env.WHOP_WEBHOOK_SECRET),
    paymentMode:'verified-webhook',
    discordLinked:!!user.discordId
  };
}
export function validUploadedExe(data){
  if(!Buffer.isBuffer(data)||data.length!==exactExeSize||data.subarray(0,2).toString('ascii')!=='MZ')return false;
  const pe=data.readUInt32LE(0x3c);
  if(pe<0x40||pe>data.length-4||data.subarray(pe,pe+4).toString('hex')!=='50450000')return false;
  return createHash('sha256').update(data).digest('hex')===sha256;
}
export async function storeRelease(bucket,data){
  if(!validUploadedExe(data))return {status:'invalid_release'};
  const result=await bucket.put(RELEASE_PATH,data,{httpMetadata:{contentType:'application/octet-stream'}});
  return {status:result?'stored':'storage_error'};
}
