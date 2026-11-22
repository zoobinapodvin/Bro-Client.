'use strict';
const $ = selector => document.querySelector(selector);
const modal = $('#modal');
const body = $('#modalBody');
const paths = {
  user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  cube:'<path d="m12 2 9 5v10l-9 5-9-5V7zm-9 5 9 5 9-5m-9 5v10"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  file:'<path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8m-8 4h6"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'
};
let site, user = null, accountReady = false;
const block = (tag, text, cls) => {
  const el = document.createElement(tag);
  if(text !== undefined) el.textContent = text;
  if(cls) el.className = cls;
  return el;
};
function link(text,href,cls) {
  const el=block('a',text,cls); el.href=href; return el;
}
function button(text,callback,cls='btn ghost'){
  const el=block('button',text,cls); el.type='button'; el.addEventListener('click',callback); return el;
}
function asset(value) {
  if(typeof value !== 'string' || !value.trim()) return '';
  try { const url=new URL(value,location.origin); return ['https:'].includes(url.protocol)||url.origin===location.origin ? url.href : ''; }
  catch { return ''; }
}
function render(){
  const c=site.content;
  document.querySelectorAll('[data-key]').forEach(el=>{if(c[el.dataset.key] !== undefined) el.textContent=c[el.dataset.key];});
  const logo=asset(c.brandLogo);
  document.querySelectorAll('.brand,.small-brand').forEach(el=>{
    if(logo){const img=new Image();img.alt=c.brand;img.src=logo;el.replaceChildren(img);}
    else {const mark=block('span',c.brand,'mark');el.replaceChildren(mark);}
  });
  if($('.art')) $('.art').style.backgroundImage=asset(c.heroImage) ? 'url('+JSON.stringify(asset(c.heroImage))+')' : 'none';
  $('#plans')?.replaceChildren(...site.plans.map(plan=>{
    const card=block('article',undefined,'plan '+plan.id);
    const row=block('div',undefined,'plan-top');
    row.setAttribute('aria-hidden','true');
    row.append(block('span','BRO.','pass-mark'),block('span',plan.duration,'pass-duration'));
    const price=block('div',undefined,'amount');
    price.append(block('strong',new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(plan.price)+' €'),block('small','paiement unique'));
    card.append(row,block('h3',plan.name),block('p',plan.description),price,button(c.planButton,()=>checkout(plan),'btn plan-button')); return card;
  }));
  $('#questions').replaceChildren(...[1,2,3].map(i=>{const el=block('details');el.append(block('summary',c['q'+i]),block('p',c['a'+i]));return el;}));
}
function openDialog(title) {
  modal.classList.remove('editing','client-portal');body.classList.remove('client-portal-body');body.replaceChildren();
  const heading=block('h2',title);heading.id='dialogTitle';body.append(heading);modal.setAttribute('aria-labelledby','dialogTitle');
  if(!modal.open)modal.showModal();modal.scrollTop=0;
}
function checkout(plan) {
  if(plan.checkoutUrl){location.assign('/checkout/'+plan.id);return;}
  openDialog(plan.name);
  body.append(block('p','Le paiement de cette offre est en attente de son lien Whop.'),block('p',plan.price+' € · '+plan.duration));
  body.append(button('Revenir aux offres',()=>modal.close()));
}
// Brand icon comes from the public Discord mark, used only in first-party UI.
const discordMark='<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20.317 4.369a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.078.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.078-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.045-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.027c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.095.252-.194.372-.293a.075.075 0 0 1 .078-.01c3.928 1.794 8.18 1.794 12.06 0a.075.075 0 0 1 .079.01c.12.099.246.198.373.293a.077.077 0 0 1-.007.127c-.6.35-1.226.652-1.873.893a.077.077 0 0 0-.041.107c.36.698.773 1.363 1.225 1.993a.076.076 0 0 0 .084.028 19.876 19.876 0 0 0 6.002-3.03.077.077 0 0 0 .032-.057c.5-5.177-.838-9.673-3.548-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.334-.955 2.419-2.157 2.419zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.334-.955 2.419-2.157 2.419z"/></svg>';
function discordButton(text,href,cls='btn discord-connect'){
  const el=link(text,href,cls);
  const icon=block('span',undefined,'discord-brand-icon');icon.innerHTML=discordMark;
  el.prepend(icon);return el;
}
async function account(){
  openDialog('Espace client');
  modal.classList.add('client-portal');
  body.classList.add('client-portal-body');
  const hero=block('div',undefined,'client-hero');
  const eyebrow=block('span','BRO CLIENT / ESPACE PRIVÉ','client-eyebrow');
  const info=block('div',undefined,'client-hero-copy');
  info.append(eyebrow,block('h3',user?'Bienvenue dans ton espace.':'Un espace, tous tes accès.'));
  const desc=block('p',user?'Achats, téléchargements et accès Discord réunis au même endroit.':'Connecte Discord pour retrouver tes services et tes achats vérifiés.');
  info.append(desc);hero.append(info);
  body.append(hero);
  if(!accountReady){
    body.append(block('p','Connexion à ton espace indisponible.','client-note'),button('Réessayer',async()=>{await loadUser();account();},'btn ghost'));return;
  }
  if(!user){
    const loginCard=block('section',undefined,'client-signin');
    loginCard.append(block('h3','Connexion sécurisée avec Discord'),block('p','Aucun mot de passe Bro Client à créer. La connexion passe par Discord et Supabase.'));
    loginCard.append(discordButton('Continuer avec Discord','/auth/discord'));
    body.append(loginCard);return;
  }
  const identity=block('div',undefined,'client-identity');
  const identityIcon=block('span',undefined,'discord-brand-icon');identityIcon.innerHTML=discordMark;
  const who=block('div',undefined,'client-who');
  who.append(block('strong','Discord connecté'),block('small',user.email||'Compte associé','account-email'));
  identity.append(identityIcon,who,block('span','Session active','client-online-badge'));
  body.append(identity);

  const actions=block('div',undefined,'client-toolbar');
  const refresh=button('Actualiser mes achats',()=>updateOverview(true),'btn client-button-primary');
  const sync=button('Synchroniser mon rôle',async()=>{
    sync.disabled=true;notice.textContent='Synchronisation Discord en cours…';
    try{
      const response=await fetch('/api/discord/sync',{method:'POST'});
      const result=await response.json();
      const labels={
        role_granted:'Ton rôle Customer est synchronisé.',
        role_granted_lifetime:'Tes rôles Customer et Lifetime sont synchronisés.',
        no_purchase:'Aucun achat Discord vérifié pour le moment.',
        bot_unconfigured:'Le bot attend ses identifiants de configuration.',
        not_member:'Rejoins le serveur Discord avant de synchroniser ton rôle.',
        discord_unavailable:'Discord est momentanément indisponible.',
        insufficient_permissions:'Le bot doit disposer du droit Gérer les rôles.'
      };
      notice.textContent=labels[result.status]||result.error||'Synchronisation indisponible.';
    }catch{notice.textContent='Synchronisation momentanément indisponible.';}
    finally{sync.disabled=false;}
  },'btn ghost');
  actions.append(refresh,sync);
  body.append(actions);
  const notice=block('p','','client-feedback');notice.setAttribute('role','status');body.append(notice);
  const grid=block('div',undefined,'client-grid');
  const purchases=block('section',undefined,'client-tile client-purchases');
  purchases.append(block('span','01 / ACHATS','client-kicker'),block('h3','Mes achats'),block('p','Retrouve les passes associés à ton compte Discord.','client-subtitle'));
  const purchaseBody=block('div',undefined,'client-purchase-results');
  purchases.append(purchaseBody);
  const delivery=block('section',undefined,'client-tile client-delivery');
  delivery.append(block('span','02 / TÉLÉCHARGEMENTS','client-kicker'),block('h3','Mon Bro Client'));
  const deliveryBody=block('div',undefined,'client-delivery-results');
  delivery.append(deliveryBody);
  grid.append(purchases,delivery);

  const keyTile=block('section',undefined,'client-tile client-key-tile');
  keyTile.append(block('span','03 / ACTIVATION','client-kicker'),block('h3','Clé d’activation'));
  const keyBody=block('div',undefined,'client-key-results');
  keyTile.append(keyBody);
  const resources=block('section',undefined,'client-tile client-resources');
  resources.append(block('span','04 / RESSOURCES','client-kicker'),block('h3','Centre d’aide'));
  resources.append(block('p','Consulte les guides et contacte le support officiel si nécessaire.','client-subtitle'));
  resources.append(button('Consulter les guides',()=>guides(false),'btn ghost'));
  const guild=discordButton('Rejoindre le serveur','https://discord.gg/uRQyKBhhgA','btn client-discord-link');
  guild.target='_blank';guild.rel='noopener noreferrer';
  resources.append(guild);
  grid.append(keyTile,resources);
  body.append(grid);

  const receipts=block('details',undefined,'client-receipts');
  const receiptTitle=block('summary','Factures et historique Whop');
  const receiptList=block('div');
  receipts.append(receiptTitle,receiptList);
  const portal=link('Consulter les achats sur Whop','https://whop.com/@me/settings/orders/');
  portal.target='_blank';portal.rel='noopener noreferrer';receipts.append(portal);
  receipts.addEventListener('toggle',()=>{if(receipts.open&&!receiptList.childElementCount)loadInvoices(receiptList);});
  body.append(receipts);
  if(user.admin){
    const admin=block('section',undefined,'client-admin');
    admin.append(block('h3','Administration Bro Client'),block('p','Importer la version exacte du programme validé, enregistrer les commandes et administrer le site.'));
    const row=block('div',undefined,'client-admin-actions');
    row.append(button('Administrer le site',editor,'btn ghost'),button('Gérer les guides',()=>guides(true),'btn ghost'));
    const register=button('Installer /bro et /startkey',async()=>{
      register.disabled=true;notice.textContent='Enregistrement des commandes Discord…';
      try{
        const result=await(await fetch('/api/discord/register',{method:'POST'})).json();
        notice.textContent=result.status==='registered'?'Commandes installées dans Discord.':'La configuration du bot doit être terminée.';
      }catch{notice.textContent='Impossible d’installer les commandes actuellement.';}
      finally{register.disabled=false;}
    },'btn ghost');
    row.append(register);
    const upload=block('input');upload.type='file';upload.accept='.exe,application/octet-stream';upload.setAttribute('aria-label','Importer la version de BroClient.exe');
    const publish=button('Importer BroClient.exe',async()=>{
      const file=upload.files?.[0];if(!file){notice.textContent='Sélectionne le fichier BroClient.exe.';return;}
      publish.disabled=true;notice.textContent='Vérification et transfert privé du fichier…';
      try{
        const response=await fetch('/api/admin/release',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
        const result=await response.json();
        if(!response.ok||result.status!=='stored')throw Error('Fichier différent de la version autorisée, ou stockage indisponible.');
        notice.textContent='BroClient.exe enregistré dans le stockage privé.';
        await updateOverview(false);
      }catch(error){notice.textContent=error.message;}
      finally{publish.disabled=false;}
    },'btn client-button-primary');
    admin.append(row,upload,publish);body.append(admin);
  }
  const footer=block('div',undefined,'client-footer');
  footer.append(block('span','Ton compte reste associé à tes achats après déconnexion.','client-footer-note'));
  const disconnect=button('Déconnecter Discord',async()=>{
    disconnect.disabled=true;
    try{
      const response=await fetch('/auth/unlink',{method:'POST'});
      if(!response.ok)throw Error();
      user=null;account();
    }catch{notice.textContent='Impossible de déconnecter la session. Réessaie.';disconnect.disabled=false;}
  },'btn client-disconnect');
  const miniIcon=block('span',undefined,'discord-brand-icon');miniIcon.innerHTML=discordMark;
  disconnect.prepend(miniIcon);footer.append(disconnect);body.append(footer);

  async function updateOverview(manual){
    refresh.disabled=true;
    if(manual)notice.textContent='Actualisation des achats vérifiés…';
    try{
      const response=await fetch('/api/account/overview',{cache:'no-store'});
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Service indisponible.');
      purchaseBody.replaceChildren();
      deliveryBody.replaceChildren();
      keyBody.replaceChildren();
      if(data.purchases?.length){
        for(const purchase of data.purchases){
          const row=block('div',undefined,'client-pass');
          const labels={day:'Pass Jour',week:'Pass Semaine',month:'Pass Mois',life:'Pass Lifetime'};
          const name=block('strong',labels[purchase.planId]||'Pass Bro Client');
          const active=block('span',purchase.active?'Actif':'Expiré',purchase.active?'client-tag-active':'client-tag-expired');
          row.append(name,active);
          if(purchase.expiresAt&&purchase.active)row.append(block('small','Jusqu’au '+new Date(purchase.expiresAt).toLocaleDateString('fr-FR')));
          purchaseBody.append(row);
        }
      }else purchaseBody.append(block('p','Aucun achat associé à ce compte pour le moment.','client-muted'));
      if(!data.whopConfigured)purchaseBody.append(block('p','Synchronisation automatique Whop en attente de configuration.','client-muted'));
      if(data.active){
        if(data.downloadAvailable){
          const download=link('Télécharger BroClient.exe','/api/account/download','btn client-button-primary');
          download.setAttribute('download','BroClient.exe');deliveryBody.append(download);
        }else deliveryBody.append(block('p','Le programme sera disponible dans ton espace après sa publication.','client-muted'));
        if(data.keyAvailable){
          const copy=button('Copier ma clé',async()=>{
            try{
              const response=await fetch('/api/account/key',{cache:'no-store'});
              if(!response.ok)throw Error();
              const {key}=await response.json();
              await navigator.clipboard.writeText(key);
              notice.textContent='Clé copiée dans le presse-papiers.';
            }catch{notice.textContent='La copie a échoué. Utilise le téléchargement texte.';}
          },'btn client-button-primary');
          const txt=link('Télécharger la clé (.txt)','/api/account/key.txt','btn ghost');
          keyBody.append(copy,txt);
        }else{
          keyBody.append(block('p','Tu as déjà acheté ? Ouvre un ticket support pour récupérer ta clé.','client-muted'));
          const support=discordButton('Contacter le support','https://discord.gg/uRQyKBhhgA','btn ghost');
          support.target='_blank';support.rel='noopener noreferrer';keyBody.append(support);
        }
      }else deliveryBody.append(block('p','Disponible après la confirmation d’un achat actif.','client-muted'));
      if(manual)notice.textContent='Achats vérifiés actualisés. Les achats effectués sans connexion Discord nécessitent une vérification par le support.';
    }catch(error){
      purchaseBody.replaceChildren(block('p','Impossible de consulter les achats pour le moment.','client-muted'));
      notice.textContent=error.message;
    }finally{refresh.disabled=false;}
  }
  updateOverview(false);
}
async function loadInvoices(target,cursor) {
  const note=block('p','Chargement des paiements…');target.append(note);
  try{
    const response=await fetch('/api/invoices'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
    if(!response.ok)throw Error();
    const data=await response.json();note.remove();
    if(data.mode!=='synced'){target.append(block('p','Tes factures sont disponibles dans le portail Whop avec le compte utilisé pour ton achat.'));return;}
    if(!data.invoices?.length&&!cursor)target.append(block('p','Aucun paiement à afficher pour le moment.'));
    for(const invoice of data.invoices||[]){
      const row=block('div',undefined,'invoice');row.append(block('strong',invoice.title||'Paiement'));
      const date=new Date(invoice.date);
      const amount=new Intl.NumberFormat('fr-FR',{style:'currency',currency:invoice.currency||'EUR'}).format(invoice.amount);
      row.append(block('p',[Number.isNaN(date.valueOf())?'':date.toLocaleDateString('fr-FR'),amount].filter(Boolean).join(' · ')));
      if(asset(invoice.pdfUrl)){const pdf=link('Voir la facture',asset(invoice.pdfUrl));pdf.target='_blank';pdf.rel='noopener noreferrer';row.append(pdf);}target.append(row);
    }
    if(data.nextCursor){const more=button('Voir les paiements précédents',()=>{more.remove();loadInvoices(target,data.nextCursor);});target.append(more);}
  }catch{note.textContent='Le relevé est temporairement indisponible. Tes achats restent accessibles sur Whop.';}
}
const labels={
 legalIdentity:'Identité et statut juridique',legalAddress:'Adresse professionnelle',legalRegistration:'Immatriculation et TVA',legalDirector:'Responsable de publication',legalContact:'E-mail public',legalPhone:'Téléphone professionnel',legalMediator:'Nom, adresse et site du médiateur',brand:'Nom de marque',brandLogo:'Logo',heroImage:'Illustration de l’accueil',navHome:'Lien Accueil',navPlans:'Lien Tarifs',navFeatures:'Lien Fonctionnalités',navFaq:'Lien FAQ',accountLabel:'Espace client',
 eyebrow:'Étiquette',titleLine1:'Titre, première ligne',titleLine2:'Titre, deuxième ligne',intro:'Présentation',primary:'Bouton principal',secondary:'Bouton secondaire',
 pricingLabel:'Étiquette',pricingTitle:'Titre',pricingIntro:'Description',planButton:'Bouton de l’offre',lifetimeBadge:'Badge Lifetime',
 featureLabel:'Étiquette',featureTitle:'Titre',featureIntro:'Description',feature1Title:'Premier titre',feature1Text:'Premier texte',feature2Title:'Deuxième titre',feature2Text:'Deuxième texte',feature3Title:'Troisième titre',feature3Text:'Troisième texte',faqLabel:'Étiquette',faqTitle:'Titre',q1:'Question 1',a1:'Réponse 1',q2:'Question 2',a2:'Réponse 2',q3:'Question 3',a3:'Réponse 3',footer:'Texte du pied de page',name:'Nom',duration:'Durée',price:'Prix en euros',description:'Description',checkoutUrl:'Lien de paiement Whop'
};
async function guides(edit){
  openDialog(edit?'Gérer les guides':'Mes guides');
  const container=block('div'),status=block('p','Chargement…','notice');status.setAttribute('role','status');body.append(container,status,button('Retour au compte',account));
  try{
    const result=await fetch('/api/guides');if(!result.ok)throw Error();
    const {guides:items,revision}=await result.json();status.textContent='';
    function draw(){
      container.replaceChildren();
      if(!items.length)container.append(block('p','Aucun guide publié pour le moment.'));
      items.forEach((guide,i)=>{
        if(!edit){const details=block('details',undefined,'account-block');details.append(block('summary',guide.title),block('p',guide.body,'guide-body'));container.append(details);return;}
        const section=block('section',undefined,'editor account-block');
        for(const [key,label] of [['title','Titre'],['body','Contenu']]){
          const field=block('label',label),input=block(key==='body'?'textarea':'input');input.value=guide[key];input.oninput=()=>guide[key]=input.value;field.append(input);section.append(field);
        }
        section.append(button('Retirer ce guide',()=>{items.splice(i,1);draw();}));container.append(section);
      });
      if(edit){
        const save=button('Publier les modifications',async()=>{
          save.disabled=true;
          try{const res=await fetch('/api/guides',{method:'POST',headers:{'Content-Type':'application/json','If-Match':revision},body:JSON.stringify({guides:items})});
          if(!res.ok){status.textContent=res.status===409?'Une autre session a modifié les guides. Rouvre le catalogue.':'Vérifie les titres, les contenus et la taille du catalogue.';return;}await guides(true);body.append(block('p','Catalogue publié.','notice'));}catch{status.textContent='Enregistrement indisponible.';}finally{save.disabled=false;}
        },'btn cyan');
        container.append(button('Ajouter un guide',()=>{items.push({title:'',body:''});draw();container.querySelector('section:last-of-type input')?.focus();}),save);
      }
    }
    draw();
  }catch{status.textContent='Les guides sont momentanément indisponibles.';}
}
function editor(){
  if(!user?.admin)return;
  openDialog('Administration');modal.classList.add('editing');
  const draft=structuredClone({content:site.content,plans:site.plans});const revision=site.revision;
  const form=block('form',undefined,'editor');const status=block('p','','notice');status.setAttribute('role','status');
  let uploads=0;
  function group(title,record,keys){
    const section=block('details');section.append(block('summary',title));
    keys.forEach(key=>{
      const label=block('label',labels[key]||key);const multiline=/intro|Text|^a\d|description/i.test(key);
      const input=block(multiline?'textarea':'input');input.value=record[key]??'';
      if(key==='price'){input.type='number';input.min='0.01';input.step='0.01';}
      if(key==='checkoutUrl')input.type='url';
      input.addEventListener('input',()=>{record[key]=key==='price'?Number(input.value):input.value;});
      label.append(input);section.append(label);
      if(['brandLogo','heroImage'].includes(key)){
        const picker=block('label','Importer une image (PNG, JPEG ou WebP, 4 Mo maximum)');const file=block('input');file.type='file';file.accept='image/png,image/jpeg,image/webp';picker.append(file);section.append(picker);
        file.onchange=async()=>{
          const image=file.files[0];if(!image)return;
          if(image.size>4*1024*1024){status.textContent='Cette image dépasse 4 Mo.';return;}
          uploads++;status.textContent='Importation en cours…';
          try{const res=await fetch('/api/media',{method:'POST',headers:{'Content-Type':image.type},body:image});if(!res.ok)throw Error();const data=await res.json();record[key]=input.value=data.url;status.textContent='Image prête à enregistrer.';}catch{status.textContent='L’importation a échoué.';}finally{uploads--;}
        };
      }
    });form.append(section);
  }
  group('Identité et navigation',draft.content,['brand','brandLogo','navHome','navPlans','navFeatures','navFaq','accountLabel','footer']);
  group('Informations légales',draft.content,['legalIdentity','legalAddress','legalRegistration','legalDirector','legalContact','legalPhone','legalMediator']);
  group('Accueil',draft.content,['heroImage','eyebrow','titleLine1','titleLine2','intro','primary','secondary']);
  group('Boutique',draft.content,['pricingLabel','pricingTitle','pricingIntro','planButton','lifetimeBadge']);
  draft.plans.forEach(plan=>group(plan.name,plan,['name','duration','price','description','checkoutUrl']));
  group('Fonctionnalités',draft.content,['featureLabel','featureTitle','featureIntro','feature1Title','feature1Text','feature2Title','feature2Text','feature3Title','feature3Text']);
  group('Questions fréquentes',draft.content,['faqLabel','faqTitle','q1','a1','q2','a2','q3','a3']);
  const actions=block('div',undefined,'modal-actions');const save=block('button','Enregistrer','btn cyan');save.type='submit';actions.append(save,button('Retour au compte',account));form.append(actions,status);body.append(form);
  form.onsubmit=async event=>{
    event.preventDefault();if(uploads){status.textContent='Attends la fin de l’importation.';return;}save.disabled=true;
    try{
      const res=await fetch('/api/site',{method:'POST',headers:{'Content-Type':'application/json','If-Match':revision||''},body:JSON.stringify(draft)});
      if(!res.ok){if(res.status===409||res.status===412){status.textContent='Le contenu a été modifié dans une autre session. Recharge la page avant de réessayer.';return;}throw Error();}
      const result=await res.json();site=result.content?result:await (await fetch('/api/site',{cache:'no-store'})).json();render();account();body.append(block('p','Modifications enregistrées.','notice'));
    }catch{status.textContent='Enregistrement impossible. Vérifie les champs et les liens Whop.';}finally{save.disabled=false;}
  };
}
async function loadUser(){try{const response=await fetch('/api/me',{cache:'no-store'});if(!response.ok)throw Error();user=(await response.json()).user;accountReady=true;}catch{accountReady=false;}}
document.querySelectorAll('i[data-icon]').forEach(el=>{el.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+paths[el.dataset.icon]+'</svg>';});
$('.close').onclick=()=>modal.close();modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
document.querySelectorAll('[data-account]').forEach(el=>el.onclick=account);
const menu=$('nav');const hamburger=$('.hamb');hamburger.onclick=()=>{const show=menu.classList.toggle('open');hamburger.setAttribute('aria-expanded',String(show));};
menu.querySelectorAll('a').forEach(el=>el.onclick=()=>{menu.classList.remove('open');hamburger.setAttribute('aria-expanded','false');});
const sections=Array.from(menu.querySelectorAll('a[href^="#"]')).map(a=>[a,document.getElementById(a.hash.slice(1))]).filter(([,section])=>section);
function updateNav(){if(!sections.length)return;let current=sections[0];for(const pair of sections)if(pair[1].getBoundingClientRect().top<=180)current=pair;for(const [a] of sections)if(a===current[0])a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');}
window.addEventListener('scroll',updateNav,{passive:true});
if(location.hash==='#tarifs')location.replace('/offres');
const gallery=$('.gallery-strip');
if(gallery){
 const slides=[['launcher','Le launcher'],['visuals','Affichage en jeu'],['settings','Interface de réglages'],['appearance','Options du joueur']];
 for(const [file,label] of slides){
   const src='/assets/full-'+file+'.webp';
   const select=button(label,()=>{
     $('#preview').src=src;$('#preview').alt=label+' — capture de Bro Client';$('#caption').textContent=label;$('#full-preview').href=src;$('#zoom').href=src;
     for(const item of gallery.children)item.setAttribute('aria-pressed',String(item===select));
   },'preview-tab');
   select.setAttribute('aria-pressed',String(file==='launcher'));gallery.append(select);
 }
}
(async()=>{
  const session=loadUser();
  try{const res=await fetch('/api/site',{cache:'no-store'});if(!res.ok)throw Error();site=await res.json();if(!site.content||!site.plans)throw Error();}
  catch{site=await(await fetch('/defaults.json')).json();}
  render();await session;if(location.hash==='#compte')account();
})();


/* Community stats are approximate and fetched from a public same-origin API, never from client-side bot secrets. */
const discordCounter=document.querySelector('[data-discord-community]');
async function refreshDiscordCounter(){
  if(!discordCounter)return;
  try{
    const response=await fetch('/api/discord/community',{cache:'no-cache'});
    if(!response.ok)throw Error('Unavailable');
    const result=await response.json();
    if(!result.available||!Number.isSafeInteger(result.members)||result.members<0||
      !Number.isSafeInteger(result.online)||result.online<0||result.online>result.members)throw Error('Invalid stats');
    discordCounter.querySelector('[data-discord-online]').textContent=result.online.toLocaleString('fr-FR');
    discordCounter.querySelector('[data-discord-total]').textContent=result.members.toLocaleString('fr-FR');
    discordCounter.setAttribute('aria-label',
      'Rejoindre le serveur Discord Bro Client. Environ '+result.online+' membres en ligne sur '+result.members+' membres.');
    discordCounter.title='Rejoindre le Discord Bro Client · Statistiques approximatives';
  }catch{
    discordCounter.setAttribute('aria-label','Rejoindre le serveur Discord Bro Client. Statistiques indisponibles.');
  }
}
if(discordCounter){
  refreshDiscordCounter();
  setInterval(()=>{if(document.visibilityState==='visible')refreshDiscordCounter();},120000);
}
