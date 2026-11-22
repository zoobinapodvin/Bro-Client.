const envName={
  day:'BRO_DISCORD_WEBHOOK_DAY',
  week:'BRO_DISCORD_WEBHOOK_WEEK',
  month:'BRO_DISCORD_WEBHOOK_MONTH',
  life:'BRO_DISCORD_WEBHOOK_LIFETIME'
};
const label={day:'1 jour',week:'1 semaine',month:'1 mois',life:'Lifetime'};
const id=v=>typeof v==='string'&&/^\d{17,20}$/.test(v);
const sanitize=v=>typeof v==='string'?v.replace(/[@`*|<>]/g,'').slice(0,140):'Non disponible';
export async function notifyVerifiedPurchase(bucket,order,payment){
  if(!order?.planId||!Object.hasOwn(envName,order.planId))return {ok:false,configured:false};
  const url=process.env[envName[order.planId]];
  if(!url)return {ok:false,configured:false};
  const target=new URL(url);
  if(target.protocol!=='https:'||target.hostname!=='discord.com'||
     !/^\/api\/webhooks\/\d+\/[a-zA-Z0-9_-]+$/.test(target.pathname))
    return {ok:false,configured:false};
  const paymentId=payment.id;
  const marker='private/notifications/sent/'+paymentId+'.json';
  if(await bucket.head(marker))return {ok:true,alreadySent:true,configured:true};
  const discordId=id(order.discordId)?order.discordId:null;
  const whopId=payment.user?.id||payment.user_id||payment.member?.id||payment.member_id||null;
  const fields=[
    {name:'Offre',value:label[order.planId],inline:true},
    {name:'Transaction',value:sanitize(paymentId),inline:true},
    {name:'ID Whop',value:sanitize(whopId),inline:true},
    {name:'Discord',value:discordId?`<@${discordId}> (ID : ${discordId})`:'Aucun compte Discord associé',inline:false},
    {name:'Montant',value:`${sanitize(String(payment.amount_charged?.amount??''))} ${sanitize(payment.amount_charged?.currency??'EUR')}`,inline:true}
  ];
  const body={
    username:'Bro Client · Commandes',
    content:discordId?`Nouvel achat validé · <@${discordId}>`:'Nouvel achat validé · Acheteur Discord non lié',
    embeds:[{title:'Paiement Bro Client confirmé',color:5544671,fields,timestamp:new Date().toISOString()}],
    allowed_mentions:{parse:[],users:discordId?[discordId]:[]}
  };
  try {
    const response=await fetch(target.href,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok)return {ok:false,configured:true,status:response.status};
    await bucket.put(marker,JSON.stringify({sentAt:new Date().toISOString(),plan:order.planId}),{onlyIf:{etagDoesNotMatch:'*'}});
    return {ok:true,configured:true};
  }catch{return {ok:false,configured:true};}
}
