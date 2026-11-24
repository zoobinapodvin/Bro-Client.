// Payments can be initiated without a Bro Client account.
// Discord authentication is optional; if Whop cannot generate an attributed
// checkout, redirect to the existing official plan URL instead.
const validWhopPlan=(raw)=>{
  const url=new URL(raw);
  if(url.protocol!=='https:'||!['whop.com','www.whop.com'].includes(url.hostname)||
     !/^\/checkout\/plan_[A-Za-z0-9]+\/?$/.test(url.pathname)||url.username||url.password||
     url.port||url.search||url.hash)throw Error('Invalid official Whop checkout link.');
  return url.href;
};
export async function checkoutDestination(env,user,plan,origin,createCheckout){
  const official=validWhopPlan(plan.checkoutUrl);
  if(!user)return official;
  try{
    const target=await createCheckout(env,user,plan,origin);
    const parsed=new URL(target);
    if(parsed.protocol!=='https:'||!['whop.com','www.whop.com'].includes(parsed.hostname)||
       !parsed.pathname.startsWith('/checkout/')||parsed.username||parsed.password||parsed.port)
      throw Error('Invalid Whop checkout redirect.');
    return parsed.href;
  }catch(e){
    console.warn('Attributed checkout unavailable; using original Whop plan',plan.id,e?.name||'Error');
    return official;
  }
}

/** Production checkout: require a verified Discord session. Prefer attribution;
 * if Whop explicitly refuses checkout creation, use the original offer URL.
 * Direct payments remain unassigned until independently verified by support.
 */
export async function authenticatedCheckoutDestination(env,user,plan,origin,createCheckout){
  if(!user?.id||!/^\d{17,20}$/.test(user?.discordId||''))throw Error('discord_session_required');
  const official=validWhopPlan(plan.checkoutUrl);
  try{
    const target=new URL(await createCheckout(env,user,plan,origin));
    if(target.protocol!=='https:'||!['whop.com','www.whop.com'].includes(target.hostname)||
       !target.pathname.startsWith('/checkout/')||target.username||target.password||target.port)
      throw Error('checkout_url_invalid');
    return {url:target.href,attributed:true};
  }catch(error){
    if(!['whop_api_403','whop_api_401'].includes(error?.message))throw error;
    console.warn('Bro checkout direct fallback',{plan:plan.id,reason:error.message});
    return {url:official,attributed:false};
  }
}
