'use strict';
// Local OOXML reader. No remote dependency, storage, telemetry, formula evaluation or network.
window.readStockWorkbook=async function(file){
 const fail=message=>{throw Error(message);};
 if(!file||!file.name.toLowerCase().endsWith('.xlsx'))fail('Sélectionne un fichier Excel .xlsx.');
 if(file.size>8*1024*1024)fail('Fichier trop volumineux (8 Mo maximum).');
 const bytes=new Uint8Array(await file.arrayBuffer()),v=new DataView(bytes.buffer),u16=o=>v.getUint16(o,true),u32=o=>v.getUint32(o,true),decoder=new TextDecoder('utf-8',{fatal:true});
 let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===bytes.length){end=i;break;}
 if(end<0||u16(end+4)!==0||u16(end+6)!==0)fail('Fichier Excel invalide ou protégé.');
 const total=u16(end+10),central=u32(end+16),centralSize=u32(end+12);
 if(total>2000||central+centralSize>end)fail('Archive Excel non prise en charge.');
 const entries=new Map();let pos=central;
 for(let i=0;i<total;i++){
  if(pos+46>bytes.length||u32(pos)!==0x02014b50)fail('Archive Excel illisible.');
  const flags=u16(pos+8),method=u16(pos+10),size=u32(pos+20),expanded=u32(pos+24),nl=u16(pos+28),extra=u16(pos+30),comment=u16(pos+32),offset=u32(pos+42);
  if(pos+46+nl+extra+comment>bytes.length)fail('Archive Excel tronquée.');
  const name=decoder.decode(bytes.subarray(pos+46,pos+46+nl));
  if(entries.has(name))fail('Archive Excel invalide.');
  entries.set(name,{flags,method,size,expanded,offset});pos+=46+nl+extra+comment;
 }
 let budget=0;
 async function xml(name,optional=false){
  const e=entries.get(name);if(!e){if(optional)return null;fail('Structure Excel incomplète.');}
  if(e.flags&1||e.expanded>4*1024*1024||(budget+=e.expanded)>20*1024*1024)fail('Fichier Excel protégé ou trop volumineux.');
  if(e.offset+30>bytes.length||u32(e.offset)!==0x04034b50)fail('Archive Excel illisible.');
  const start=e.offset+30+u16(e.offset+26)+u16(e.offset+28);if(start+e.size>bytes.length)fail('Archive Excel tronquée.');
  let out=bytes.subarray(start,start+e.size);
  if(e.method===8){
   if(typeof DecompressionStream!=='function')fail('Utilise une version récente de Chrome, Edge ou Firefox.');
   const reader=new Blob([out]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();const parts=[];let count=0;
   try{for(;;){const x=await reader.read();if(x.done)break;count+=x.value.byteLength;if(count>e.expanded||count>4*1024*1024){await reader.cancel();fail('Taille Excel incohérente.');}parts.push(x.value);}}finally{reader.releaseLock();}
   out=new Uint8Array(count);let at=0;for(const x of parts){out.set(x,at);at+=x.length;}
  }else if(e.method!==0)fail('Compression Excel non prise en charge.');
  if(out.length!==e.expanded)fail('Taille Excel incohérente.');
  const source=decoder.decode(out);if(/<!DOCTYPE|<!ENTITY/i.test(source))fail('Document XML non autorisé.');
  const doc=new DOMParser().parseFromString(source,'application/xml');if(doc.getElementsByTagName('parsererror').length)fail('Document Excel illisible.');return doc;
 }
 const nodes=(root,name)=>Array.from(root.getElementsByTagNameNS('*',name)),first=(root,name)=>nodes(root,name)[0],norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 const workbook=await xml('xl/workbook.xml'),rels=await xml('xl/_rels/workbook.xml.rels'),ssDoc=await xml('xl/sharedStrings.xml',true);
 const strings=ssDoc?nodes(ssDoc,'si').map(si=>nodes(si,'t').map(t=>t.textContent).join('')):[];
 const relation=new Map(nodes(rels,'Relationship').filter(r=>!r.hasAttribute('TargetMode')||r.getAttribute('TargetMode')==='Internal').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));
 function category(name){
  const s=norm(name);
  if(/lifetime|a vie/.test(s))return 'life';
  if(/\b(day|jour)\b/.test(s))return 'day';
  if(/\b(week|semaine)\b/.test(s))return 'week';
  if(/\b(month|mois)\b/.test(s))return 'month';
  return null;
 }
 const rank={available:0,quarantine:1,sold:2},map=new Map();let duplicates=0,conflicts=0,ignored=0;const unknown=[];
 for(const sheet of nodes(workbook,'sheet')){
  const name=sheet.getAttribute('name'),planId=category(name);
  if(!planId){unknown.push(name);continue;}
  const rid=sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id')||sheet.getAttribute('r:id');
  const target=relation.get(rid);if(!target)fail('Lien de feuille Excel introuvable.');
  const path=target.startsWith('/')?target.slice(1):'xl/'+target;
  if(!/^xl\/worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(path))fail('Lien de feuille non autorisé.');
  const doc=await xml(path);let keyCol=null,statusCol=null;
  for(const row of nodes(doc,'row')){
   const vals=new Map();
   for(const cell of nodes(row,'c')){
    const col=(cell.getAttribute('r')||'').match(/^[A-Z]+/)?.[0];if(!col)continue;
    const type=cell.getAttribute('t'),formula=first(cell,'f'),value=first(cell,'v')?.textContent??'';
    let text=type==='s'?strings[Number(value)]??'':type==='inlineStr'?nodes(cell,'t').map(t=>t.textContent).join(''):value;
    if(formula)text='';vals.set(col,String(text).trim());
   }
   if(!keyCol){
    for(const [col,text] of vals){const h=norm(text);if(/^(id de l.article|cle|cles|key|keys|licence|license|id)$/.test(h))keyCol=col;if(/^(type|statut|status|etat)$/.test(h))statusCol=col;}
    if(keyCol&&statusCol)continue;keyCol=null;statusCol=null;continue;
   }
   const key=vals.get(keyCol)||'',type=norm(vals.get(statusCol));
   if(!key){if(type)ignored++;continue;}
   if(key.length<5||key.length>256||/[\r\n\t]/.test(key))fail('Une ligne contient un identifiant de licence invalide.');
   let status=/^(libre|disponible|available)$/.test(type)?'available':/^(vendu|vendue|sold|used|utilise|utilisee)$/.test(type)?'sold':'quarantine';
   const old=map.get(key);
   if(old){duplicates++;if(old.planId!==planId){conflicts++;old.status=old.status==='sold'||status==='sold'?'sold':'quarantine';}else if(rank[status]>rank[old.status])old.status=status;}
   else map.set(key,{key,planId,status});
  }
  if(!keyCol||!statusCol)fail('Les colonnes ID de l’article et Type sont introuvables dans une feuille reconnue.');
 }
 if(!map.size)fail('Aucune licence reconnue dans ce fichier.');
 if(map.size>500)fail('500 licences maximum par import.');
 return {rows:[...map.values()],duplicates,conflicts,ignored,unknown};
};