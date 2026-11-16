export const DEFAULT_BASE='http://127.0.0.1:47821';
export const base=document.querySelector('meta[name=streamsnipe-transport]')?.getAttribute('content')==='local'?location.origin:DEFAULT_BASE;
export const root=base+'/api/v1';
const tokenKey='streamsnipe.token.v1';
export const getToken=()=>localStorage.getItem(tokenKey)||'';
export const setToken=(token:string)=>token?localStorage.setItem(tokenKey,token):localStorage.removeItem(tokenKey);
export async function request(path:string, options:RequestInit={}, token=getToken()){
 const headers=new Headers(options.headers); if(token) headers.set('Authorization',`Bearer ${token}`); if(options.body) headers.set('Content-Type','application/json');
 const response=await fetch(root+path,{...options,headers}); const data=await response.json().catch(()=>({})); if(!response.ok) throw new Error(data.error||`Request failed (${response.status})`); return data;
}
export const send=(path:string,data:unknown,method='POST')=>request(path,{method,body:JSON.stringify(data)});
export function events(onUpdate:()=>void){const ws=new WebSocket(root.replace(/^http/,'ws')+'/events');ws.onopen=()=>ws.send(JSON.stringify({type:'auth',token:getToken()}));ws.onmessage=()=>onUpdate();return ()=>ws.close()}
export const bytes=(n:number)=>!n?'0 B':`${(n/1024**Math.min(4,Math.floor(Math.log(n)/Math.log(1024)))).toFixed(1)} ${['B','KB','MB','GB','TB'][Math.min(4,Math.floor(Math.log(n)/Math.log(1024)))]}`;
