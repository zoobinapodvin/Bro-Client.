import {listPaidPurchases} from './fulfillment.mjs';
export const CUSTOMER_GUIDES_KEY='private/guides/customer-catalogue-v2.json';
// The former public installation instructions are retired, not moved behind a paywall.
export const defaultCustomerGuides=Object.freeze([
 {title:'Avant de commencer',body:'Vérifiez que le logiciel, sa version et son éditeur correspondent exactement à votre achat. Utilisez uniquement les sources officielles et les versions autorisées par les applications concernées. Conservez les protections de Windows et les systèmes de sécurité actifs. Si un fichier est bloqué, interrompez son installation et contactez le support.'},
 {title:'Accès et configuration',body:'Connectez-vous à Bro Client avec le compte Discord utilisé lors de votre achat. Dans Mes accès, retrouvez les informations de votre commande. Pour la nouvelle version, consultez la documentation du logiciel réellement fourni avant de configurer les widgets, les affichages de performances et les profils. N’utilisez que les options autorisées par l’application concernée.'},
 {title:'Préparer une demande d’assistance',body:'Indiquez le pass, la référence du paiement et le problème rencontré. Si nécessaire, joignez une capture en masquant les données personnelles et les clés de licence. Contactez l’assistance officielle pour les questions sur votre achat, la compatibilité et les fonctionnalités réellement fournies.'}
]);
export async function canReadCustomerGuides(bucket,user){
 if(!user?.discordId)return false;
 return (await listPaidPurchases(bucket,user.discordId)).length>0;
}
export async function readCustomerGuideCatalog(bucket){
 const saved=await bucket.get(CUSTOMER_GUIDES_KEY);
 return {guides:saved?await saved.json():defaultCustomerGuides.map(g=>({...g})),revision:saved?.etag??'initial'};
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderCustomerGuides(guides=null){
 const permitted=Array.isArray(guides);
 const title=permitted?'Guides et ressources':'Accès aux ressources';
 const body=permitted?'<p>Documentation réservée aux clients ayant un achat vérifié. Les anciennes instructions d’installation ont été retirées.</p>'+guides.map((g,i)=>'<article class="bro-guide-step"><span class="bro-guide-kicker">GUIDE '+String(i+1).padStart(2,'0')+'</span><h2>'+esc(g.title)+'</h2><p style="white-space:pre-wrap">'+esc(g.body)+'</p></article>').join(''):'<p>Les ressources clients nécessitent un achat vérifié associé à votre compte Discord. Les anciennes instructions d’installation ne sont plus distribuées.</p>';
 return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+title+' · Bro Client</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/guides.css"></head><body><main class="shell bro-guides-wrap"><a href="/#compte" class="bro-guide-back">← Espace client</a><div class="bro-guide-hero"><span class="bro-guide-kicker">BRO CLIENT / CENTRE D’AIDE</span><h1>'+title+'<span>.</span></h1></div><div class="bro-guide-article">'+body+'</div></main></body></html>';
}
