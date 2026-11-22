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
