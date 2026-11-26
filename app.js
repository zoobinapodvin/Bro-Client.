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
let sessionRequest=null,overviewRequest=null,preloadedOverview=null,overviewAt=0,sessionEpoch=0,sessionAt=0;
const sessionFresh=()=>accountReady&&Date.now()-sessionAt<30000;
const freshOverview=()=>preloadedOverview&&Date.now()-overviewAt<30000?preloadedOverview:null;
async function requestOverview(){
 if(overviewRequest)return overviewRequest;
 const epoch=sessionEpoch;
 const pending=(async()=>{const r=await fetch('/api/account/overview',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(r.status===401&&epoch===sessionEpoch){sessionEpoch++;user=null;accountReady=false;sessionAt=0;preloadedOverview=null;overviewAt=0;syncGuideNavigation();if($('#accountPage'))account();throw Error('session_expired');}if(!r.ok)throw Error('overview');const value=await r.json();if(epoch!==sessionEpoch||!user)throw Error('session_changed');preloadedOverview=value;overviewAt=Date.now();return value;})();
 overviewRequest=pending;try{return await pending;}finally{if(overviewRequest===pending)overviewRequest=null;}
}
function syncGuideNavigation(){document.querySelectorAll('[data-paid-guides]').forEach(el=>{el.hidden=user?.guideAccess!==true;});document.querySelectorAll('[data-guest-checkout-note]').forEach(el=>{el.hidden=true;});window.dispatchEvent(new Event('bro-session-changed'));}
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
  const c={...site.content};
  if(c.feature2Title==='Le Discord')c.feature2Title='Assistance client';
  if(c.feature2Text==='Échange avec la communauté et contacte l’équipe Bro Client.')c.feature2Text='Retrouve les informations de contact du vendeur et l’assistance liée à tes commandes.';
  // Migrate only old marketing copy: preserve newer text customized by admins.
  if(['Choisis ton pass, retrouve tes guides et rejoins la communauté BRO.','Aimbot, ESP avancé, outils d’inventaire et profils personnalisés pour ROB RUN. Découvre BRO CLIENT sur PC Windows.'].includes(c.intro))
    c.intro="Découvre BRO CLIENT, ses accès, ses réglages et sa communauté. Retrouve tes guides et ton espace client au même endroit.";
  document.querySelectorAll('[data-key]').forEach(el=>{if(c[el.dataset.key] !== undefined) el.textContent=c[el.dataset.key];});
  const logo=asset(c.brandLogo);
  document.querySelectorAll('.brand,.small-brand').forEach(el=>{
    if(logo){const img=new Image();img.alt=c.brand;img.src=logo;el.replaceChildren(img);}
    else {const mark=block('span',c.brand,'mark');el.replaceChildren(mark);}
  });
  if($('.art')) $('.art').style.backgroundImage=asset(c.heroImage) ? 'url('+JSON.stringify(asset(c.heroImage))+')' : 'none';
  $('#plans')?.replaceChildren(...site.plans.map(plan=>{
    const card=block('article',undefined,'plan '+plan.id);
    card.dataset.homeBlock='offer-plan-'+plan.id;card.dataset.homeLabel='Offre · '+plan.name;
    const row=block('div',undefined,'plan-top');
    row.setAttribute('aria-hidden','true');
    // Reuse the configured Rob Run artwork without another network asset.
    const gameArtwork=asset(c.heroImage);
    if(gameArtwork)row.style.setProperty('--bro-game-art','url('+JSON.stringify(gameArtwork)+')');
    row.append(block('span','BRO.','pass-mark'),block('span',plan.duration,'pass-duration'));
    const price=block('div',undefined,'amount');
    price.append(block('strong',new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(plan.price)+' €'),block('small','paiement unique'));
    const title=block('h3',plan.name),desc=block('p',plan.description),cta=link(c.planButton,'/checkout/'+plan.id,'btn plan-button');title.dataset.homeField='title';desc.dataset.homeField='text';cta.dataset.homeField='cta';
    cta.href='/checkout/'+plan.id+'?feed=public';
    card.append(row,title,desc,price,cta); return card;
  }));
  $('#questions')?.replaceChildren(...[1,2,3].map(i=>{const el=block('details');const title=block('summary',c['q'+i]),text=block('p',c['a'+i]);title.dataset.homeField='title';text.dataset.homeField='text';el.append(title,text);if(document.querySelector('[data-home-block="faq-heading"],[data-home-block="offer-faq-heading"]')){const wrap=block('div',undefined,'home-faq-item');wrap.dataset.homeBlock=(document.querySelector('.offers')?'offer-faq-':'faq-')+i;wrap.dataset.homeLabel='Question '+i;wrap.append(el);return wrap;}return el;}));
  window.dispatchEvent(new Event('bro-home-render'));
}
function openDialog(title) {
  modal.classList.remove('editing','client-portal','client-portal-compact');body.classList.remove('client-portal-body');body.replaceChildren();
  const heading=block('h2',title);heading.id='dialogTitle';body.append(heading);modal.setAttribute('aria-labelledby','dialogTitle');
  if(!modal.open)modal.showModal();modal.scrollTop=0;
}
async function checkout(plan) {
  if(!plan.checkoutUrl){
    openDialog(plan.name);
    body.append(block('p','Le paiement de cette offre est en attente de son lien Whop.'),block('p',plan.price+' € · '+plan.duration));
    body.append(button('Revenir aux offres',()=>modal.close()));
    return;
  }
  // A verified, already-loaded Discord session can navigate immediately.
  // Refresh only when session state is missing or uncertain.
  if(!accountReady||!user?.discordLinked)await loadUser();
  if(!accountReady){
    openDialog('Connexion indisponible');
    body.append(block('p','Impossible de vérifier ta session Discord pour le moment. Réessaie avant de payer.'));
    body.append(button('Réessayer',()=>checkout(plan),'btn client-button-primary'));
    return;
  }
  if(user?.discordLinked){
    location.assign('/checkout/'+plan.id);
    return;
  }
  openDialog('Connecte-toi pour commander');
  modal.classList.add('client-portal','client-portal-compact');
  body.classList.add('client-portal-body');
  const welcome=block('section',undefined,'portal-welcome');
  welcome.append(block('span','BRO CLIENT · CONNEXION SÉCURISÉE','client-kicker'),
    block('h3','Ton pass, lié à ton compte Discord.'),
    block('p','Connecte-toi avec Discord avant de payer. Si ton achat n’apparaît pas dans ton espace client, contacte le support avec ton justificatif de paiement.'));
  welcome.append(discordButton('Continuer avec Discord','/auth/discord?return_to='+encodeURIComponent('/checkout/'+plan.id)));
  body.append(welcome);
}
// Brand icon comes from the public Discord mark, used only in first-party UI.
const discordMark='<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20.317 4.369a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.078.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.078-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.045-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.027c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.095.252-.194.372-.293a.075.075 0 0 1 .078-.01c3.928 1.794 8.18 1.794 12.06 0a.075.075 0 0 1 .079.01c.12.099.246.198.373.293a.077.077 0 0 1-.007.127c-.6.35-1.226.652-1.873.893a.077.077 0 0 0-.041.107c.36.698.773 1.363 1.225 1.993a.076.076 0 0 0 .084.028 19.876 19.876 0 0 0 6.002-3.03.077.077 0 0 0 .032-.057c.5-5.177-.838-9.673-3.548-13.66a.061.061 0 0 0-.031-.028zM8.02 15.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.334-.955 2.419-2.157 2.419zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.334-.955 2.419-2.157 2.419z"/></svg>';
function discordButton(text,href,cls='btn discord-connect'){
  const el=link(text,href,cls);
  const icon=block('span',undefined,'discord-brand-icon');icon.innerHTML=discordMark;
  el.prepend(icon);return el;
}

const accountSkeletonHTML="<div class=\"account-layout account-skeleton\" aria-hidden=\"true\"><aside class=\"account-sidebar\"><div class=\"account-skeleton-profile\"><span></span><div><b></b><i></i></div></div><div class=\"account-skeleton-nav\"><span>Mes clés</span><span>Mes achats</span><span>Assistance</span><span>Paramètres</span></div></aside><div class=\"account-main\"><div class=\"account-section-head\"><div><span class=\"account-eyebrow\">ESPACE PERSONNEL</span><h2>Mes clés</h2><p class=\"client-quiet\">Retrouve les clés associées à tes commandes.</p></div></div><div class=\"account-metrics\"><div class=\"account-metric\"><strong class=\"account-skeleton-bar\"></strong><span>Clés disponibles</span></div><div class=\"account-metric\"><strong class=\"account-skeleton-bar\"></strong><span>En attente de stock</span></div><div class=\"account-metric\"><strong class=\"account-skeleton-bar\"></strong><span>Pass achetés</span></div></div><div class=\"account-key-card account-skeleton-key\"><div class=\"account-skeleton-bar\"></div><div class=\"account-skeleton-bar\"></div></div></div></div>";
function paintAccountSkeleton(root){
 root.setAttribute('aria-busy','true');
 root.innerHTML=accountSkeletonHTML;
}
let accountNavigationMounted=false;
function warmAccount(){
 if(sessionRequest||sessionFresh())return;
 loadUser().catch(()=>{});
}
function openAccountPage(){
 const existing=$('#accountPage');
 if(existing){if(modal.open)modal.close();if(!existing.querySelector('.account-layout:not(.account-skeleton)')&&!existing.querySelector('.portal-welcome'))account();return;}
 const original=$('main#main');
 if(!original){location.assign('/espace-client');return;}
 if(modal.open)modal.close();
 const section=block('main',undefined,'shell account-page-main');section.id='main';
 section.innerHTML="<div class=\"account-intro\"><div><span class=\"account-eyebrow\">BRO CLIENT / ESPACE PRIVÉ</span><h1>Mon espace client<span>.</span></h1><p>Tes clés, tes achats et ton compte, au même endroit.</p></div><span class=\"account-private\">Espace sécurisé</span></div>";
 const root=block('section');root.id='accountPage';root.setAttribute('aria-label','Espace client');paintAccountSkeleton(root);section.append(root);
 // Keep the actual navigation URL, without a new document or another round-trip.
 for(const a of document.querySelectorAll('header a[href^="#"],footer a[href^="#"]')){const href=a.getAttribute('href');a.setAttribute('href',location.pathname+href);}
 for(const a of document.querySelectorAll('header nav [aria-current]'))a.removeAttribute('aria-current');
 original.id='broPreviousMain';original.hidden=true;original.setAttribute('inert','');original.after(section);
 document.body.classList.remove('patchnotes-page');document.body.classList.add('account-page');
 document.querySelector('header [data-account]')?.setAttribute('aria-current','page');
 document.querySelector('nav')?.classList.remove('open');document.querySelector('.hamb')?.setAttribute('aria-expanded','false');
 document.title='Mon espace client · BRO CLIENT';
 let robots=document.querySelector('meta[name="robots"]');if(!robots){robots=block('meta');robots.name='robots';document.head.append(robots);}robots.content='noindex,nofollow';
 accountNavigationMounted=true;history.pushState({broAccount:true},'','/espace-client');window.scrollTo(0,0);
 if(!sessionFresh())warmAccount();
 account();
}
window.addEventListener('popstate',()=>{if(accountNavigationMounted&&location.pathname!=='/espace-client')location.reload();});
window.addEventListener('pagehide',()=>{const root=$('#accountPage');if(root){sessionEpoch++;sessionRequest=null;overviewRequest=null;preloadedOverview=null;overviewAt=0;sessionAt=0;accountReady=false;user=null;paintAccountSkeleton(root);}});
window.addEventListener('pageshow',e=>{if(e.persisted&&$('#accountPage')){loadUser();account();}});

async function account(){
  const body=$('#accountPage');
  if(!body){openAccountPage();return;}
  if(modal.open)modal.close();
  if(!sessionFresh()&&sessionRequest){paintAccountSkeleton(body);await sessionRequest;if(body.isConnected)return account();return;}
  body.replaceChildren();
  body.setAttribute('aria-busy','false');
  const notice=block('p','','client-status-message');
  notice.setAttribute('role','status');
  if(!accountReady){
    body.append(block('p','Impossible de récupérer ta session.','client-quiet'),
      button('Réessayer',async()=>{await loadUser();account();},'btn client-button-primary'));
    return;
  }
  if(!user){
    const welcome=block('section',undefined,'portal-welcome');
    welcome.append(block('span','BRO CLIENT · ESPACE PRIVÉ','client-kicker'),
      block('h3','Retrouve tes accès en un seul endroit.'),
      block('p','Connecte ton compte Discord pour consulter tes achats.'));
    const callbackStatus=new URLSearchParams(location.search).get('connexion');
    if(callbackStatus==='interrompue'||callbackStatus==='indisponible'){
      welcome.append(block('p',callbackStatus==='interrompue'?'La connexion Discord a été interrompue. Tu peux réessayer.':'Discord est temporairement indisponible. Réessaie dans un instant.'));
    }
    welcome.append(discordButton('Continuer avec Discord','/auth/discord?return_to=%2Fespace-client'));
    body.append(welcome);
    return;
  }
  const profile=block('div',undefined,'portal-profile');
  if(user.discordAvatar){
    const avatar=block('img',undefined,'portal-avatar');
    avatar.src=user.discordAvatar;
    avatar.alt='';
    avatar.referrerPolicy='no-referrer';
    avatar.onerror=()=>{const fallback=block('span',undefined,'portal-avatar-placeholder');fallback.innerHTML=discordMark;avatar.replaceWith(fallback);};
    profile.append(avatar);
  }else{
    const fallback=block('span',undefined,'portal-avatar-placeholder');fallback.innerHTML=discordMark;profile.append(fallback);
  }
  const identity=block('div',undefined,'portal-identity');
  identity.append(block('small','CONNECTÉ AVEC DISCORD'),block('strong',user.discordUsername||'Compte Discord'));
  if(user.username)identity.append(block('small','Identifiant : '+user.username));
  profile.append(identity,block('span','Connecté','portal-connected'));
  const layout=block('div',undefined,'account-layout');
  const sidebar=block('aside',undefined,'account-sidebar');
  sidebar.append(profile);
  const main=block('div',undefined,'account-main');
  if(user.stockPath&&!user.admin)sidebar.append(link('Gestion privée des clés',user.stockPath,'btn ghost account-stock'));
  body.append(layout);layout.append(sidebar,main);

  const tabs=block('div',undefined,'portal-tabs');tabs.setAttribute('role','tablist');
  const viewport=block('section',undefined,'portal-view');viewport.setAttribute('aria-live','polite');
  const tabButtons=new Map();
  let overview=freshOverview(),purchases=overview?.purchases||[],current='access',refreshing=false,overviewSignature=overview?JSON.stringify(overview):'';
  for(const [id,label] of [['access','Mes clés'],['orders','Mes achats'],['help','Assistance'],['settings','Paramètres'],...(user.admin?[['admin','Administration']]:[])]){
    const item=button(label,()=>show(id),'portal-tab');
    item.setAttribute('role','tab');item.id='account-tab-'+id;item.setAttribute('aria-controls','account-panel');item.setAttribute('aria-selected','false');
    item.addEventListener('keydown',e=>{const entries=[...tabButtons.entries()],index=entries.findIndex(([k])=>k===id);let n;if(e.key==='ArrowRight'||e.key==='ArrowDown')n=(index+1)%entries.length;else if(e.key==='ArrowLeft'||e.key==='ArrowUp')n=(index+entries.length-1)%entries.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=entries.length-1;else return;e.preventDefault();show(entries[n][0]);entries[n][1].focus();});
    tabButtons.set(id,item);tabs.append(item);
  }
  viewport.id='account-panel';viewport.setAttribute('role','tabpanel');sidebar.append(tabs);main.append(notice,viewport);

  const footer=block('div',undefined,'portal-footer');
  footer.append(block('span','BRO. / Espace client','portal-footer-brand'));
  const logout=button('Délier Discord',async()=>{
    logout.disabled=true;
    try{
      const res=await fetch('/auth/unlink',{method:'POST'});
      if(!res.ok)throw Error();
      sessionEpoch++;sessionRequest=null;user=null;accountReady=true;sessionAt=Date.now();preloadedOverview=null;overviewAt=0;overviewRequest=null;syncGuideNavigation();account();
    }catch{notice.textContent='Déconnexion indisponible. Réessaie.';logout.disabled=false;}
  },'portal-logout');
  const discordLogo=block('span',undefined,'discord-brand-icon');discordLogo.innerHTML=discordMark;
  logout.prepend(discordLogo);footer.append(logout);sidebar.append(footer);

  const status=(text)=>{notice.textContent=text||'';};
  async function refresh(manual=false){
    if(refreshing)return;refreshing=true;
    try{
      if(manual)status('Actualisation des achats…');
      const next=await requestOverview();
      if(!viewport.isConnected)return;
      const signature=JSON.stringify(next),changed=signature!==overviewSignature;
      overview=next;overviewSignature=signature;
      purchases=overview.purchases||[];
      if(user){user.guideAccess=overview.hasPurchase===true;syncGuideNavigation();}
      if(changed&&(current==='access'||current==='orders'))show(current);
      if(manual)status('Achats actualisés.');
    }catch{
      if(manual||!overview)status('Impossible de récupérer les achats actuellement.');
      if(!overview&&current==='access'&&viewport.isConnected){viewport.replaceChildren(block('p','Les accès sont temporairement indisponibles.','client-quiet'),smallButton('Réessayer',()=>refresh(true)));}
    }finally{refreshing=false;}
  }
  function smallButton(label,callback,cls='btn ghost'){
    return button(label,callback,cls+' portal-action');
  }
  function profileVisibilitySetting(){
    const panel=block('div',undefined,'portal-visibility-setting');
    panel.append(block('strong','Visibilité de mes achats','portal-visibility-title'));
    panel.append(block('p','Les nouveaux achats affichent ton nom d’affichage et ta photo Discord par défaut, sauf achat anonyme ou désactivation. Les anciens achats anonymes ne sont pas publiés rétroactivement.','portal-visibility-help'));
    const choice=block('label',undefined,'portal-consent-label');
    const checkbox=block('input');checkbox.type='checkbox';checkbox.disabled=true;
    choice.append(checkbox,block('span','Afficher mon profil Discord dans les derniers achats'));
    panel.append(choice);
    const revealOld=button('Afficher aussi mes anciens achats',()=>saveVisibility(true),'btn ghost portal-action');revealOld.hidden=true;panel.append(revealOld);
    fetch('/api/account/publicity',{cache:'no-store'})
      .then(response=>{if(!response.ok)throw Error();return response.json();})
      .then(data=>{if(panel.isConnected){checkbox.checked=data.showPublic===true;checkbox.disabled=false;revealOld.hidden=!data.showPublic||data.historicalPublic===true;}})
      .catch(()=>{if(panel.isConnected)checkbox.disabled=true;});
    checkbox.onchange=()=>saveVisibility(checkbox.checked);
    async function saveVisibility(checked){
      const previous=checkbox.checked===checked?!checked:checkbox.checked;
      checkbox.disabled=true;revealOld.disabled=true;
      try{
        const response=await fetch('/api/account/publicity',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({showPublic:checked})
        });
        if(!response.ok)throw Error();
        status(checked?'Profil visible pour tes achats vérifiés et associés.':'Tes achats resteront anonymes sur le site.');
        checkbox.checked=checked;revealOld.hidden=true;
        if(document.querySelector('#purchaseBoard'))refreshRecentBoard();
      }catch{
        checkbox.checked=revealOld.hidden?previous:true;status('Impossible de modifier la visibilité pour le moment.');
      }finally{checkbox.disabled=false;revealOld.disabled=false;}
    }
    return panel;
  }
  function show(tab){
    current=tab;viewport.replaceChildren();
    for(const [id,el] of tabButtons){el.classList.toggle('active',id===tab);el.setAttribute('aria-selected',String(id===tab));el.tabIndex=id===tab?0:-1;}viewport.setAttribute('aria-labelledby','account-tab-'+tab);
    if(tab==='access'){
      if(!overview){const head=block('div',undefined,'account-section-head');const title=block('div');title.append(block('span','ESPACE PERSONNEL','account-eyebrow'),block('h2','Mes clés'),block('p','Retrouve les clés associées à tes commandes.','client-quiet'));head.append(title);const preview=block('div',undefined,'account-key-card account-skeleton-key');preview.setAttribute('aria-hidden','true');preview.append(block('div',undefined,'account-skeleton-bar'),block('div',undefined,'account-skeleton-bar'));viewport.append(head,preview);return;}
      const display={day:'Pass Jour',week:'Pass Semaine',month:'Pass Mois',life:'Pass Lifetime'};
      const active=purchases.filter(p=>p.active);
      const head=block('div',undefined,'account-section-head');
      const title=block('div');title.append(block('span','ESPACE PERSONNEL','account-eyebrow'),block('h2','Mes clés'),block('p','Retrouve les clés associées à tes commandes.','client-quiet'));
      head.append(title,smallButton('Actualiser mes accès',()=>refresh(true)));
      viewport.append(head);
      const metrics=block('div',undefined,'account-metrics');
      for(const [n,label] of [[active.filter(p=>p.keyAvailable).length+(overview.legacyKeyAvailable?1:0),'Clés disponibles'],[active.filter(p=>p.waitingStock).length,'En attente de stock'],[purchases.length,'Pass achetés']]){
        const tile=block('div',undefined,'account-metric');tile.append(block('strong',String(n)),block('span',label));metrics.append(tile);
      }
      viewport.append(metrics);
      if(!purchases.length&&!overview.legacyKeyAvailable){
        const empty=block('div',undefined,'account-empty');empty.append(block('span','◇','account-empty-icon'),block('h3','Aucune clé pour le moment'),block('p','Tes clés apparaîtront ici après confirmation de ton achat.'),link('Découvrir les offres','/offres','btn client-button-primary'));viewport.append(empty);return;
      }
      const list=block('div',undefined,'account-key-list');
      function keyControls(card,paymentId){
        const query='?payment='+encodeURIComponent(paymentId);
        const input=block('input');input.type='text';input.readOnly=true;input.value='•••• •••• ••••';input.className='portal-key-input';input.setAttribute('aria-label','Clé de licence');input.autocomplete='off';input.spellcheck=false;
        const getKey=async()=>{const r=await fetch('/api/account/key'+query,{cache:'no-store'});if(!r.ok)throw Error();return (await r.json()).key;};
        const actions=block('div',undefined,'portal-key-actions');let revealed=false;
        const reveal=smallButton('Afficher',async()=>{try{if(revealed){input.value='•••• •••• ••••';revealed=false;reveal.textContent='Afficher';return;}reveal.disabled=true;const value=await getKey();if(!input.isConnected)return;input.value=value;revealed=true;reveal.textContent='Masquer';}catch{status('Clé indisponible.');}finally{reveal.disabled=false;}});
        actions.append(reveal,smallButton('Copier',async()=>{try{await navigator.clipboard.writeText(await getKey());status('Clé copiée.');}catch{status('Copie indisponible.');}},'btn client-button-primary'),link('Fichier .txt','/api/account/key.txt'+query,'btn ghost portal-action'));
        const field=block('div',undefined,'account-key-field');field.append(input,actions);card.append(field);
      }
      for(const purchase of [...purchases].sort((a,b)=>Number(b.active)-Number(a.active))){
        const card=block('article',undefined,'account-key-card');
        const top=block('div',undefined,'account-key-top'),identity=block('div',undefined,'account-key-identity');
        const img=block('img');img.src='/assets/robrun.jpg';img.alt='';img.loading='lazy';
        const name=block('div');name.append(block('small','ROB RUN'),block('h3',display[purchase.planId]||'Pass'));identity.append(img,name);
        const state=purchase.keyAvailable?'Clé disponible':purchase.waitingStock?'En attente de stock':purchase.active?'Livraison à vérifier':'Accès Discord terminé';
        const pill=block('span',state,'account-key-state '+(purchase.keyAvailable?'is-ready':purchase.active?'is-waiting':'is-ended'));top.append(identity,pill);card.append(top);
        if(purchase.keyAvailable){
          keyControls(card,purchase.paymentId);
        }else card.append(block('p',purchase.waitingStock?'Commande confirmée. Ta clé sera attribuée dès que le stock correspondant sera disponible.':purchase.active?'Commande confirmée. Contacte le support si ta clé reste indisponible.':'Retrouve la référence de cette commande dans Mes achats.','client-quiet'));
        const meta=block('div',undefined,'account-key-meta');
        meta.append(block('span',purchase.expiresAt?'Accès Discord : '+new Date(purchase.expiresAt).toLocaleString('fr-FR'):'Accès Discord à vie'),block('span','Activation de la licence : non synchronisée'));
        card.append(meta);list.append(card);
      }
      if(overview.legacyKeyAvailable){const old=block('article',undefined,'account-key-card');old.append(block('h3','Clé historique'));keyControls(old,'legacy');list.append(old);}
      viewport.append(list);
      if(active.length){const launcherNotice=block('p','Pour télécharger le launcher, c’est ','client-quiet');const launcherLink=link('ici','https://discord.com/channels/1448897452404117558/1574774596706508821');launcherLink.style.textDecoration='underline';launcherLink.target='_blank';launcherLink.rel='noopener noreferrer';launcherNotice.append(launcherLink,'.');viewport.append(launcherNotice);}
    }else if(tab==='orders'){
      const header=block('div',undefined,'portal-orders-heading');
      header.append(block('strong','Historique des achats'));
      header.append(smallButton('Actualiser mes achats',()=>refresh(true),'btn client-button-primary'));
      viewport.append(header);
      if(!purchases.length){
        viewport.append(block('p','Ton historique sera affiché après un achat associé à ton compte.','client-quiet'));
      }else{
        for(const item of purchases){
          const row=block('div',undefined,'portal-order-item');
          const names={day:'Jour',week:'Semaine',month:'Mois',life:'Lifetime'};
          row.append(block('strong','Bro Client · '+(names[item.planId]||'Pass')),
            block('span',item.active?'Accès Discord actif':'Accès Discord terminé',item.active?'client-tag-active':'client-tag-expired'));
          viewport.append(row);
        }
      }
      const invoices=block('details');
      invoices.append(block('summary','Factures et assistance par achat'));
      invoices.addEventListener('toggle',()=>{
        if(invoices.open&&!invoices.dataset.loaded){
          invoices.dataset.loaded='true';loadInvoices(invoices);
        }
      });
      viewport.append(invoices);
      const ordersLink=link('Ouvrir mes factures Whop','https://whop.com/@me/settings/orders/','portal-small-link');
      ordersLink.target='_blank';ordersLink.rel='noopener noreferrer';viewport.append(ordersLink);
    }else if(tab==='help'){
      viewport.append(block('h3','Besoin d’aide ?'),block('p','Assistance pour ton compte et tes achats.','client-quiet'));
      const links=block('div',undefined,'portal-help-actions');
      if(user.guideAccess===true)links.append(link('Consulter les guides','/guides','btn client-button-primary'));
      const guild=link('Contacter le vendeur','/informations.html#assistance','btn client-discord-link portal-action');
      guild.target='_blank';guild.rel='noopener noreferrer';links.append(guild);
      viewport.append(links);
    }else if(tab==='settings'){
      viewport.append(block('h2','Paramètres du compte'),block('p','Gère la visibilité de tes achats et la liaison Discord.','client-quiet'),profileVisibilitySetting());
      viewport.append(smallButton('Délier Discord',()=>logout.click()),smallButton('Synchroniser mon rôle',async()=>{
        status('Synchronisation des rôles…');
        try{const response=await fetch('/api/discord/sync',{method:'POST'});if(!response.ok)throw Error();const data=await response.json();
          status(data.status==='role_granted_lifetime'?'Rôles Customer et Lifetime synchronisés.':data.status==='role_granted'?'Rôle Customer synchronisé.':'Synchronisation : '+(data.status||'non disponible'));
        }catch{status('Synchronisation indisponible.');}
      }));
    }else if(tab==='admin'&&user.admin){
      const area=block('div',undefined,'portal-admin-tools');
      area.append(block('h3','Gestion Bro Client'));
      if(user.stockPath)area.append(link('Gestion privée des clés',user.stockPath,'btn client-button-primary'));
      const actions=block('div',undefined,'portal-admin-actions');
      if(user.homeEditor)actions.append(smallButton('Site',editor));
      actions.append(smallButton('Guides',()=>guides(true)));
      actions.append(smallButton('Installer /startkey',async()=>{
        try{const response=await fetch('/api/discord/register',{method:'POST'});
          const data=await response.json();status(data.status==='registered'?'Commandes installées.':'Bot non configuré.');}
        catch{status('Installation indisponible.');}
      }));
      actions.append(smallButton('Importer achats Whop',async()=>{
        status('Lecture des paiements Whop vérifiés…');
        try{
          const response=await fetch('/api/admin/activity/backfill',{method:'POST'});
          const data=await response.json();if(!response.ok)throw Error(data.error||'Whop indisponible');
          status(data.imported+' achat(s) historique(s) ajouté(s), '+(data.linked||0)+' référence(s) vérifiée(s) rattachée(s).');
        }catch(error){status(error.message);}
      }));
      area.append(actions);
      const registry=block('div',undefined,'account-block bro-account-registry');
      registry.append(block('h3','Comptes et paiements'),block('p','Les comptes enregistrés apparaissent dès leur prochaine connexion. Pour un paiement sans référence liée, vérifie le justificatif et l’identité Discord du client avant de le rattacher.','client-quiet'));
      const accounts=block('div');
      async function listRegistered(cursor){
        try{
          const r=await fetch('/api/admin/accounts'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{cache:'no-store'});
          if(!r.ok)throw Error();
          const data=await r.json();accounts.replaceChildren();
          if(!data.accounts.length)accounts.append(block('p','Aucun compte enregistré sur cette page.'));
          for(const account of data.accounts){
            const line=block('p',account.username+' · '+account.displayName+' · '+account.discordId,'client-quiet');
            accounts.append(line);
          }
          if(data.nextCursor)accounts.append(smallButton('Page suivante',()=>listRegistered(data.nextCursor)));
        }catch{accounts.textContent='Registre momentanément indisponible.';}
      }
      registry.append(smallButton('Afficher les comptes',()=>listRegistered()),accounts);
      const form=block('form');const accountField=block('input');accountField.placeholder='Identifiant BRO ou ID Discord';accountField.required=true;accountField.setAttribute('aria-label','Identifiant BRO ou ID Discord');
      const paymentField=block('input');paymentField.placeholder='Référence Whop pay_…';paymentField.required=true;paymentField.setAttribute('aria-label','Référence du paiement Whop');
      const verified=block('input');verified.type='checkbox';verified.required=true;const label=block('label');label.append(verified,document.createTextNode(' J’ai vérifié le justificatif et le compte Discord du client.'));
      const submit=block('button','Rattacher le paiement','btn ghost');submit.type='submit';
      form.append(accountField,paymentField,label,submit);
      form.onsubmit=async e=>{
        e.preventDefault();submit.disabled=true;
        try{
          const res=await fetch('/api/admin/payments/attach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({account:accountField.value.trim(),paymentId:paymentField.value.trim(),confirmed:verified.checked})});
          const result=await res.json();if(!res.ok)throw Error(result.error||'Rattachement refusé.');
          status('Paiement rattaché : '+result.username+' · '+result.plan+(result.active?'':' (pass expiré)'));form.reset();
        }catch(error){status(error.message||'Rattachement indisponible.');}
        finally{submit.disabled=false;}
      };
      registry.append(form);area.append(registry);
      viewport.append(area);
    }
  }
  show('access');
  if(!overview)refresh();
  // Whop can redirect before the signed webhook arrives. Poll briefly only on a return to the account.
  if($('#accountPage')){let tries=0;const timer=setInterval(()=>{if(!viewport.isConnected||++tries>12){clearInterval(timer);return;}refresh();},5000);}
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
      if(/^pay_[A-Za-z0-9]+$/.test(invoice.id)){
        const reference=invoice.provider==='tebex'?invoice.transactionId:invoice.id;
        const ref=block('p',(invoice.provider==='tebex'?'Référence Tebex · ':'Référence Whop · ')+reference);
        const copy=button('Copier la référence',async()=>{
          try{await navigator.clipboard.writeText(reference);copy.textContent='Référence copiée';}
          catch{ref.textContent='Référence à copier : '+reference;}
        });
        const support=link('Contacter le vendeur','/informations.html#assistance','portal-small-link');
        support.target='_blank';support.rel='noopener noreferrer';
        row.append(ref,copy,support);
      }
      if(invoice.pdfUrl==='/api/invoices/'+invoice.id+'/pdf'){const pdf=link('Voir la facture',invoice.pdfUrl);pdf.target='_blank';pdf.rel='noopener noreferrer';row.append(pdf);}target.append(row);
    }
    if(data.nextCursor){const more=button('Voir les paiements précédents',()=>{more.remove();loadInvoices(target,data.nextCursor);});target.append(more);}
  }catch{if(!note.isConnected)target.append(note);note.textContent='Le relevé est temporairement indisponible. Tes achats restent accessibles sur Whop.';}
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
  if(!user?.homeEditor)return;
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
async function loadUser(){
 if(sessionRequest)return sessionRequest;
 const epoch=sessionEpoch;
 const pending=(async()=>{try{const response=await fetch('/api/me',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error();const data=await response.json();if(epoch!==sessionEpoch)return;sessionEpoch++;overviewRequest=null;user=data.user;accountReady=true;sessionAt=Date.now();preloadedOverview=user?data.overview??null:null;overviewAt=Date.now();if(user&&!preloadedOverview)requestOverview().catch(()=>{});}catch{if(epoch===sessionEpoch){accountReady=false;sessionAt=0;user=null;preloadedOverview=null;}}finally{syncGuideNavigation();}})();
 sessionRequest=pending;try{return await pending;}finally{if(sessionRequest===pending)sessionRequest=null;}
}
document.querySelectorAll('i[data-icon]').forEach(el=>{el.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+paths[el.dataset.icon]+'</svg>';});
$('.close').onclick=()=>modal.close();modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
document.querySelectorAll('[data-account]').forEach(el=>{el.onclick=openAccountPage;const warm=()=>{if(!$('#accountPage'))warmAccount();};el.addEventListener('pointerenter',warm,{passive:true});el.addEventListener('focus',warm);});

const menu=$('nav');const hamburger=$('.hamb');hamburger.onclick=()=>{const show=menu.classList.toggle('open');hamburger.setAttribute('aria-expanded',String(show));};
menu.querySelectorAll('a').forEach(el=>el.onclick=()=>{menu.classList.remove('open');hamburger.setAttribute('aria-expanded','false');});
const sections=Array.from(menu.querySelectorAll('a[href^="#"]')).map(a=>[a,document.getElementById(a.hash.slice(1))]).filter(([,section])=>section);
function updateNav(){if($('#accountPage')||!sections.length)return;let current=sections[0];for(const pair of sections)if(pair[1].getBoundingClientRect().top<=180)current=pair;for(const [a] of sections)if(a===current[0])a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');}
window.addEventListener('scroll',updateNav,{passive:true});
if(location.hash==='#tarifs')location.replace('/offres');
if(location.hash==='#compte'&&!$('#accountPage'))location.replace('/espace-client'+location.search);
window.addEventListener('hashchange',()=>{if(location.hash==='#compte'&&!$('#accountPage'))location.assign('/espace-client'+location.search);});
(async()=>{
  loadUser();
  // The account never waits for public marketing/configuration requests.
  if($('#accountPage'))account();
  try{const res=await fetch('/api/site',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!res.ok)throw Error();site=await res.json();if(!site.content||!site.plans)throw Error();}
  catch{try{site=await(await fetch('/defaults.json')).json();}catch{return;}}
  render();
})();


/* Community stats are approximate and fetched from a public same-origin API, never from client-side bot secrets. */
const discordCounter=document.querySelector('[data-discord-community]');
let counterBusy=false;
function paintCounter(result){
 if(!result?.available||!Number.isSafeInteger(result.members)||result.members<0||!Number.isSafeInteger(result.online)||result.online<0||result.online>result.members)return false;
 discordCounter.querySelector('[data-discord-online]').textContent=result.online.toLocaleString('fr-FR');discordCounter.querySelector('[data-discord-total]').textContent=result.members.toLocaleString('fr-FR');discordCounter.setAttribute('aria-label','Communauté Discord : environ '+result.online+' membres en ligne sur '+result.members);discordCounter.title='Statistiques approximatives de la communauté';return true;
}
async function refreshDiscordCounter(){
  if(!discordCounter||counterBusy)return;counterBusy=true;
  try{
    const response=await fetch('/api/discord/community',{cache:'no-cache'});
    if(!response.ok)throw Error('Unavailable');
    const result=await response.json();
    if(!paintCounter(result))throw Error('Invalid stats');
    try{sessionStorage.setItem('bro-counter-v1',JSON.stringify({at:Date.now(),value:result}));}catch{}
  }catch{
    if(discordCounter.querySelector('[data-discord-total]').textContent==='—')discordCounter.setAttribute('aria-label','Statistiques de la communauté indisponibles.');
  }finally{counterBusy=false;}
}
if(discordCounter){
  try{const saved=JSON.parse(sessionStorage.getItem('bro-counter-v1'));if(saved&&Date.now()-saved.at<300000)paintCounter(saved.value);}catch{}
  refreshDiscordCounter();
  setInterval(()=>{if(document.visibilityState==='visible')refreshDiscordCounter();},120000);
}


/* Compact verified Whop activity. Never infer purchaser identity from a login alone. */
const recentBoard=document.getElementById('purchaseBoard');
const recentIndicator=document.querySelector('.purchase-live-indicator');
let lastFeedSignature='',feedBusy=false;
let lastTopPurchase=null;
function updateRecentStatus(state){
 if(!recentIndicator)return;
 const indicatorState=state==='error'||state==='not_configured'?'error':state==='ok'?'ok':state==='cached'?'cached':'loading';
 const labels={ok:'À jour',error:'Indisponible',loading:'Chargement',cached:'Dernier relevé'};
 const label=recentIndicator.querySelector('.purchase-live-text');
 recentIndicator.dataset.state=indicatorState;
 if(label)label.textContent=labels[indicatorState];
 recentIndicator.title=indicatorState==='error'?'Synchronisation temporairement indisponible':'Mise à jour automatique des achats';
}
function renderRecentFeed(data){
 const state=data.sync?.state??'pending';
 updateRecentStatus(state);
 const purchases=data.purchases.filter(p=>p&&Number.isFinite(p.amount)&&Number.isFinite(Date.parse(p.date))).slice(0,5);
 const signature=JSON.stringify([purchases,state]);
 if(signature===lastFeedSignature)return;
 lastFeedSignature=signature;
 if(!purchases.length){
  recentBoard.replaceChildren(block('p',state==='ok'?'Aucun achat confirmé à afficher.':'Synchronisation des achats en cours.','purchase-board-empty'));
  return;
 }
 const newest=JSON.stringify([purchases[0].date,purchases[0].plan,purchases[0].amount]);
 const hasNew=lastTopPurchase!==null&&lastTopPurchase!==newest;
 lastTopPurchase=newest;
 const currency=new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'});
 const datetime=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',
   day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
 const rows=purchases.map((purchase,index)=>{
  const entry=block('div',undefined,'purchase-card');
  entry.setAttribute('role','listitem');
  if(hasNew&&index===0)entry.classList.add('purchase-card-new');
  const buyer=block('div',undefined,'purchase-card-buyer');
  const photo=block('span',undefined,'purchase-card-avatar');
  photo.setAttribute('aria-hidden','true');
  // A Discord profile is public here only after verified association AND opt-in.
  const personal=typeof purchase.name==='string'&&purchase.name.trim()&&purchase.name!=='Client BRO';
  const pseudo=personal?purchase.name.replace(/#\d{1,4}$/,'').trim().slice(0,32):'Membre BRO';
  if(purchase.avatar&&personal){
   const img=block('img');img.src=purchase.avatar;img.alt='';img.loading='lazy';
   img.decoding='async';img.referrerPolicy='no-referrer';
   img.onerror=()=>{img.replaceWith(block('span','B.'));};
   photo.append(img);photo.classList.add('has-photo');
  }else photo.append(block('span','B.'));
  const username=block('strong',pseudo||'Membre BRO','purchase-card-username');
  if(personal){username.classList.add(purchase.planId==='life'||purchase.plan==='Pass Lifetime'?'purchase-name-lifetime':'purchase-name-customer');username.title=pseudo;}
  buyer.append(photo,username);
  const name=block('span',purchase.plan||'Pass Bro Client','purchase-card-product');
  const amount=block('strong',new Intl.NumberFormat('fr-FR',{style:'currency',currency:/^[A-Z]{3}$/.test(purchase.currency||'')?purchase.currency:'EUR'}).format(purchase.amount),'purchase-card-price');
  const when=block('time',datetime.format(new Date(purchase.date)).replace(',',' ·'),'purchase-card-date');
  when.dateTime=purchase.date;
  when.title='Paiement confirmé';
  entry.append(buyer,name,amount,when);
  return entry;
 });
 recentBoard.replaceChildren(...rows);
}
async function refreshRecentBoard(){
 if(!recentBoard||feedBusy)return;feedBusy=true;
 try{
  const response=await fetch('/api/activity',{cache:'no-store'});
  if(!response.ok)throw Error('feed_unavailable');
  const data=await response.json();
  if(!Array.isArray(data.purchases))throw Error('bad_feed');
  renderRecentFeed(data);
  // The browser snapshot never stores Discord names, avatars or private account data.
  try{sessionStorage.setItem('bro-feed-v1',JSON.stringify({at:Date.now(),purchases:data.purchases.slice(0,5).map(p=>({plan:p.plan,amount:p.amount,date:p.date,currency:p.currency,name:'Client BRO',avatar:null}))}));}catch{}
 }catch{
  updateRecentStatus('error');
  if(!recentBoard.querySelector('.purchase-card')){
   recentBoard.replaceChildren(block('p','Achats indisponibles pour le moment.','purchase-board-empty'));
  }
 }finally{feedBusy=false;}
}
if(recentBoard){
 recentBoard.setAttribute('role','list');
 try{const saved=JSON.parse(sessionStorage.getItem('bro-feed-v1'));if(saved&&Date.now()-saved.at<120000&&Array.isArray(saved.purchases))renderRecentFeed({purchases:saved.purchases,sync:{state:'cached'}});}catch{}
 refreshRecentBoard();
 setInterval(()=>{if(document.visibilityState==='visible')refreshRecentBoard();},15000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshRecentBoard();});
}


/* Offer release badge: updates automatically whenever the owner publishes. */
if(document.querySelector('[data-patchnote-banner]')){
 fetch('/api/patchnotes',{cache:'no-store'})
   .then(res=>{if(!res.ok)throw Error('unavailable');return res.json();})
   .then(({notes})=>{
    const latest=Array.isArray(notes)?notes.find(n=>n.status==='published'):null;
    if(!latest)return;
    const version=document.querySelector('[data-patchnote-version]');
    const title=document.querySelector('[data-patchnote-head]');
    const subtitle=document.querySelector('[data-patchnote-detail]');
    if(version)version.textContent=' · '+latest.version;
    else if(title)title.textContent='Dernière mise à jour · '+latest.version;
    if(subtitle)subtitle.textContent=latest.title;
    // The badge always opens the complete archive, not a single update.
    const banner=document.querySelector('[data-patchnote-banner]');
    if(banner)banner.href='/patchnotes';
   }).catch(()=>{/* The patchnote list remains accessible without an API response. */});
}

if(location.pathname==='/offres'&&new URLSearchParams(location.search).get('paiement')==='indisponible'){
 const notice=block('p','Le paiement est temporairement indisponible. Ton achat doit être relié à ton compte Discord. Réessaie plus tard.','notice');
 notice.setAttribute('role','alert');document.querySelector('#plans')?.before(notice);
}
