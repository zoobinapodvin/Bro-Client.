// Payments can be initiated without a Bro Client account.
// Discord authentication is optional; if Whop cannot generate an attributed
// checkout, redirect to the existing official plan URL instead.
const planPath=/^\/checkout\/plan_[A-Za-z0-9]+\/?$/;
const offerPath=/^\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/[a-zA-Z0-9][a-zA-Z0-9_-]*\/?$/;
export const validWhopPlan=(raw)=>{
  const url=new URL(raw);
  if(url.protocol!=='https:'||!['whop.com','www.whop.com'].includes(url.hostname)||
     !(planPath.test(url.pathname)||(offerPath.test(url.pathname)&&!/^\/(checkout|api|settings|discover|login|signup)\//i.test(url.pathname)))||url.username||url.password||
     url.port||url.search||url.hash)throw Error('Invalid official Whop checkout link.');
  return url.href;
};
export async function checkoutDestination(env,user,plan,origin,createCheckout){
  const official=validWhopPlan(plan.checkoutUrl);
  if(!user||!planPath.test(new URL(official).pathname))return official;
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

/** Production: never proceed with an unlinked checkout if Whop refuses.
 * A verified Discord session and a successful attributed API checkout are required.
 */
export async function authenticatedCheckoutDestination(env,user,plan,origin,createCheckout){
  if(!user?.id||!/^\d{17,20}$/.test(user?.discordId||''))throw Error('discord_session_required');
  const official=validWhopPlan(plan.checkoutUrl);
  if(!planPath.test(new URL(official).pathname))throw Error('plan_invalid');
  const target=new URL(await createCheckout(env,user,plan,origin));
  if(target.protocol!=='https:'||!['whop.com','www.whop.com'].includes(target.hostname)||
     !target.pathname.startsWith('/checkout/')||target.username||target.password||target.port)
    throw Error('checkout_url_invalid');
  return {url:target.href,attributed:true};
}
