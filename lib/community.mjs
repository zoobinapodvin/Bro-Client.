// Source publique, sans divulguer le jeton du bot au navigateur.
// L'API des invitations Discord fournit des comptes approximatifs.
export const COMMUNITY_GUILD_ID='1448897452404117558';
export const COMMUNITY_INVITE='https://discord.gg/uRQyKBhhgA';
const discordApi='https://discord.com/api/v10';
const validCount=n=>Number.isSafeInteger(n)&&n>=0;
export function normalizeCounts(data){
  if(!data||String(data.guild?.id??data.id)!==COMMUNITY_GUILD_ID)return null;
  const members=data.approximate_member_count;
  const online=data.approximate_presence_count;
  if(!validCount(members)||!validCount(online))return null;
  return {members,online:Math.min(online,members)};
}
export async function communityStats(fetcher=fetch,token=process.env.BRO_DISCORD_BOT_TOKEN){
  const unavailable={available:false,members:null,online:null,inviteUrl:COMMUNITY_INVITE,approximate:true};
  const endpoints=[
    {url:discordApi+'/invites/uRQyKBhhgA?with_counts=true',headers:{Accept:'application/json'}},
    ...(token?[{url:discordApi+'/guilds/'+COMMUNITY_GUILD_ID+'?with_counts=true',
      headers:{Accept:'application/json',Authorization:'Bot '+token}}]:[])
  ];
  for(const source of endpoints){
    try{
      const response=await fetcher(source.url,{headers:source.headers,redirect:'error',
        signal:AbortSignal.timeout(3500)});
      if(!response.ok)continue;
      const result=normalizeCounts(await response.json());
      if(result)return {...result,available:true,inviteUrl:COMMUNITY_INVITE,approximate:true};
    }catch(error){
      // Les statistiques publiques ne doivent jamais empêcher l'affichage du site.
      console.warn('Discord member counters unavailable',error?.name||'network');
    }
  }
  return unavailable;
}
