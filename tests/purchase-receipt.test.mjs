import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizePurchaseReceipt,purchaseReceiptPdf} from '../lib/purchase-receipt.mjs';
import {handleBilling} from '../lib/billing.mjs';
const raw={id:'pay_Test123',title:'Pass Semaine',date:'2026-11-26T12:42:00Z',amount:0,currency:'EUR',provider:'tebex',transactionId:'tbx-test-123'};
test('receipt normalizes zero purchases and rejects fabricated amounts',()=>{
 const r=normalizePurchaseReceipt(raw);assert.equal(r.amount,0);assert.equal(r.reference,'tbx-test-123');
 assert.equal(normalizePurchaseReceipt({...raw,amount:null}),null);assert.equal(normalizePurchaseReceipt({...raw,amount:-1}),null);assert.equal(normalizePurchaseReceipt(raw,'pay_Other'),null);
 const pdf=purchaseReceiptPdf(r,'Compte (test)');const s=pdf.toString('latin1');
 assert.match(s,/^%PDF-1\.4/);assert.match(s,/Justificatif d'achat/);assert.match(s,/0,00 EUR/);assert.match(s,/tbx-test-123/);
 const start=Number(s.match(/startxref\n(\d+)/)[1]);assert.equal(s.slice(start,start+4),'xref');
 const refs=s.slice(start).split('\n').slice(3,9);for(const [i,line] of refs.entries())assert.equal(s.slice(Number(line.slice(0,10)),Number(line.slice(0,10))+7),(i+1)+' 0 obj');
});
test('receipt route requires the authenticated owner and serves a local PDF for historical and current purchases',async()=>{
 const owner=createHash('sha256').update('auth-A').digest('hex'),prefix='private/invoices/'+owner+'/';
 const whop={...raw,id:'pay_Old123',provider:undefined,amount:12.5};
 const data=new Map([[prefix+raw.id,raw],[prefix+whop.id,whop]]);
 const bucket={get:async key=>data.has(key)?{json:async()=>data.get(key)}:null,list:async({prefix})=>({objects:[...data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key})),truncated:false})};
 const env={BUCKET:bucket},url='https://example.com/api/invoices/'+raw.id+'/receipt.pdf';
 assert.equal((await handleBilling(new Request(url),env,null)).status,401);
 assert.equal((await handleBilling(new Request(url),env,'auth-B')).status,404);
 const response=await handleBilling(new Request(url),env,'auth-A','Number7');
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');assert.match(response.headers.get('cache-control'),/no-store/);
 assert.match(Buffer.from(await response.arrayBuffer()).toString('latin1'),/Number7/);
 assert.equal((await handleBilling(new Request('https://example.com/api/invoices/'+whop.id+'/receipt.pdf'),env,'auth-A')).status,200);
 const list=await (await handleBilling(new Request('https://example.com/api/invoices'),env,'auth-A')).json();assert.equal(list.invoices.length,2);assert.ok(list.invoices.some(x=>x.amount===0));assert.ok(list.invoices.every(x=>!('pdfUrl' in x)));
});
