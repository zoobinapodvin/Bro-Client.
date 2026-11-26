// Purchase receipts are not tax invoices; never invent VAT, legal issuer or refund status.
const validId=id=>typeof id==='string'&&/^pay_[A-Za-z0-9]{1,160}$/.test(id);
export function normalizePurchaseReceipt(v,id=v?.id){
 if(!validId(id)||v?.id!==id||typeof v.title!=='string'||!v.title.trim()||v.title.length>180||!Number.isFinite(Date.parse(v.date))||typeof v.amount!=='number'||!Number.isFinite(v.amount)||v.amount<0||v.amount>10000000||!/^[A-Z]{3}$/.test(v.currency||''))return null;
 const provider=v.provider==='tebex'?'tebex':v.provider==='whop'||v.provider==null?'whop':'other';
 const reference=provider==='tebex'&&typeof v.transactionId==='string'&&/^tbx-[A-Za-z0-9-]{1,100}$/.test(v.transactionId)?v.transactionId:id;
 return {id,title:v.title,date:new Date(v.date).toISOString(),amount:v.amount,currency:v.currency,provider,reference};
}
function latin(s){return String(s).replace(/[\u2018\u2019]/g,"'").replace(/[\u2013\u2014]/g,'-').replace(/\u20ac/g,'EUR').replace(/[\u00a0\u202f]/g,' ').replace(/[^\x20-\x7e\xa0-\xff]/g,'?');}
const literal=s=>'('+latin(s).replace(/[\\()]/g,'\\$&')+')';
export function purchaseReceiptPdf(record,customer='Compte BRO'){
 const r=normalizePurchaseReceipt({...record,transactionId:record.reference});if(!r)throw Error('invalid_receipt');
 const date=new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(r.date));
 const total=r.amount.toFixed(new Intl.NumberFormat('fr-FR',{style:'currency',currency:r.currency}).resolvedOptions().maximumFractionDigits).replace('.',',')+' '+r.currency;
 const ops=[];
 const t=(x,y,size,s,bold=false,color='0.12 0.18 0.25')=>ops.push('BT '+color+' rg /'+(bold?'F2':'F1')+' '+size+' Tf 1 0 0 1 '+x+' '+y+' Tm '+literal(s)+' Tj ET');
 const rect=(x,y,w,h,c)=>ops.push(c+' rg '+x+' '+y+' '+w+' '+h+' re f');
 const rule=y=>ops.push('0.82 0.86 0.90 RG 0.7 w 45 '+y+' m 550 '+y+' l S');
 const wrap=(s,n=70)=>{const lines=[];let line='';for(const word of latin(s).split(/\s+/)){if(word.length>n){if(line){lines.push(line);line='';}for(let i=0;i<word.length;i+=n)lines.push(word.slice(i,i+n));}else if(line&&line.length+word.length+1>n){lines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)lines.push(line);return lines;};
 rect(0,733,595,109,'0.09 0.15 0.22');t(45,775,32,'BRO.',true,'1 1 1');t(45,751,10,'BRO CLIENT  |  broclient.com',false,'0.76 0.84 0.92');
 t(45,696,23,"Justificatif d'achat",true);t(45,671,11,date,false,'0.35 0.43 0.52');rule(651);
 t(45,628,10,'COMPTE CLIENT',true,'0.35 0.43 0.52');wrap(String(customer).slice(0,120),60).slice(0,3).forEach((v,i)=>t(45,611-i*13,11,v,true));
 t(45,558,10,'REFERENCE DE TRANSACTION',true,'0.35 0.43 0.52');wrap(r.reference,70).slice(0,3).forEach((v,i)=>t(45,540-i*13,11,v));
 t(45,487,10,'TRAITEMENT DU PAIEMENT',true,'0.35 0.43 0.52');t(45,470,11,r.provider==='tebex'?'Tebex':r.provider==='whop'?'Whop':'Prestataire de paiement');
 rect(45,419,505,27,'0.90 0.93 0.96');t(55,429,10,'SERVICE ACHETE',true);t(388,429,10,'QTE',true);t(445,429,10,'MONTANT',true);
 wrap(r.title,47).slice(0,5).forEach((v,i)=>t(55,395-i*13,11,v,true));t(396,395,11,'1');t(445,395,11,total,true);rule(326);
 rect(45,255,505,48,'0.88 0.92 0.96');t(58,275,11,'Montant de la transaction',true);t(410,274,15,total,true);
 t(45,217,10,'Ce document récapitule la transaction enregistrée sur BRO CLIENT.');
 t(45,202,10,'Il ne remplace pas la facture fiscale du vendeur légal.');
 t(45,187,10,'Les taxes et les remboursements éventuels ne sont pas attestés ici.');
 rule(80);t(45,60,9,'BRO CLIENT  |  Justificatif de commande  |  broclient.com',false,'0.35 0.43 0.52');t(535,60,9,'1/1');
 const stream=Buffer.from(ops.join('\n')+'\n','latin1');
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',Buffer.concat([Buffer.from('<< /Length '+stream.length+' >>\nstream\n'),stream,Buffer.from('endstream')])];
 let parts=[Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n','latin1')],offsets=[0],length=parts[0].length;
 for(let i=0;i<objects.length;i++){offsets.push(length);const obj=Buffer.concat([Buffer.from((i+1)+' 0 obj\n'),Buffer.isBuffer(objects[i])?objects[i]:Buffer.from(objects[i]),Buffer.from('\nendobj\n')]);parts.push(obj);length+=obj.length;}
 parts.push(Buffer.from('xref\n0 '+offsets.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(v=>String(v).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+length+'\n%%EOF\n'));
 return Buffer.concat(parts);
}
