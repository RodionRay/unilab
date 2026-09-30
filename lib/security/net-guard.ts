/**
 * SSRF guard for user-supplied proxy targets (host + port).
 *
 * Only a syntactic check: it rejects literal non-public IPs (every notation inet_aton accepts,
 * IPv6 incl. IPv4-mapped) and hostnames that resolve inside the deployment (localhost, *.local,
 * *.internal, single-label docker service names). DNS rebinding is out of scope here — the
 * telegram-worker must re-validate the resolved address before connecting.
 */

export type ProxyTargetCheck = {ok:true}|{ok:false;reason:string};

const REASON_PRIVATE='Адрес прокси во внутренней сети запрещён';
const REASON_INVALID='Некорректный адрес прокси';
const REASON_PORT='Порт прокси должен быть целым числом от 1 до 65535';

/** [network, prefixLength] — non-public IPv4 ranges. */
const BLOCKED_V4:ReadonlyArray<readonly [number,number]>=[
 [0x00000000,8], // 0.0.0.0/8 "this network"
 [0x0a000000,8], // 10/8
 [0x64400000,10], // 100.64/10 CGNAT
 [0x7f000000,8], // 127/8 loopback
 [0xa9fe0000,16], // 169.254/16 link-local, cloud metadata
 [0xac100000,12], // 172.16/12
 [0xc0000000,24], // 192.0.0/24 IETF protocol assignments
 [0xc0a80000,16], // 192.168/16
 [0xc6120000,15], // 198.18/15 benchmarking
 [0xe0000000,4], // 224/4 multicast
 [0xf0000000,4], // 240/4 reserved + broadcast
];

const NUMERIC_V4=/^(?:0x[0-9a-f]*|\d+)(?:\.(?:0x[0-9a-f]*|\d+)){0,3}$/i;
const HOST_LABEL=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BLOCKED_SUFFIXES=['.localhost','.local','.internal','.localdomain','.home.arpa'];

function parseV4Part(part:string):number|null{
 if(/^0x/i.test(part))return part.length>2?parseInt(part.slice(2),16):0;
 if(part.length>1&&part.startsWith('0'))return /^[0-7]+$/.test(part)?parseInt(part,8):null;
 return parseInt(part,10);
}

/** inet_aton semantics: a, a.b, a.b.c, a.b.c.d with decimal/octal/hex parts. */
function parseLooseIPv4(host:string):number|null{
 if(!NUMERIC_V4.test(host))return null;
 const parts=host.split('.').map(parseV4Part);
 if(parts.some(p=>p==null||!Number.isFinite(p)))return null;
 const nums=parts as number[];
 const last=nums[nums.length-1];
 const head=nums.slice(0,-1);
 if(head.some(n=>n>255))return null;
 const lastMax=2**(8*(4-head.length))-1;
 if(last>lastMax)return null;
 let value=0;
 head.forEach((n,i)=>{value+=n*2**(8*(3-i))});
 return value+last;
}

function isBlockedV4(ip:number):boolean{
 return BLOCKED_V4.some(([net,bits])=>{
  const size=2**(32-bits);
  return Math.floor(ip/size)===Math.floor(net/size);
 });
}

/** Returns 8 x 16-bit groups or null. */
function parseIPv6(raw:string):number[]|null{
 let host=raw;
 const dotted=host.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
 if(dotted){
  const v4=parseLooseIPv4(dotted[2]);
  if(v4==null||!/^\d+\.\d+\.\d+\.\d+$/.test(dotted[2]))return null;
  host=dotted[1]+Math.floor(v4/65536).toString(16)+':'+(v4%65536).toString(16);
 }
 const halves=host.split('::');
 if(halves.length>2)return null;
 const toGroups=(s:string)=>s===''?[]:s.split(':');
 const left=toGroups(halves[0]);
 const right=halves.length===2?toGroups(halves[1]):[];
 if([...left,...right].some(g=>!/^[0-9a-f]{1,4}$/i.test(g)))return null;
 const missing=8-left.length-right.length;
 if(halves.length===2?missing<1:missing!==0)return null;
 return [...left,...Array(Math.max(0,missing)).fill('0'),...right].map(g=>parseInt(g,16));
}

function isBlockedV6(g:number[]):boolean{
 const firstFiveZero=g.slice(0,5).every(x=>x===0);
 if(firstFiveZero&&(g[5]===0xffff||g[5]===0))return true; // ::, ::1, IPv4-mapped, IPv4-compatible
 if((g[0]&0xfe00)===0xfc00)return true; // fc00::/7 unique local
 if((g[0]&0xffc0)===0xfe80)return true; // fe80::/10 link-local
 if((g[0]&0xffc0)===0xfec0)return true; // fec0::/10 deprecated site-local
 if((g[0]&0xff00)===0xff00)return true; // ff00::/8 multicast
 if(g[0]===0x64&&g[1]===0xff9b)return isBlockedV4(g[6]*65536+g[7]); // NAT64 wrapping a private v4
 return false;
}

function hostnameReason(name:string):string|null{
 if(name.length>253)return REASON_INVALID;
 const labels=name.split('.');
 if(!labels.every(l=>HOST_LABEL.test(l)))return REASON_INVALID;
 if(labels.length<2)return REASON_PRIVATE; // localhost, docker service names
 if(BLOCKED_SUFFIXES.some(s=>name.endsWith(s)))return REASON_PRIVATE;
 return null;
}

/** null = host may be used as a proxy target; otherwise a user-facing reason. */
export function forbiddenHostReason(rawHost:string):string|null{
 let host=String(rawHost??'').trim().toLowerCase();
 if(host.startsWith('[')&&host.endsWith(']'))host=host.slice(1,-1);
 if(host.endsWith('.'))host=host.slice(0,-1);
 if(!host)return REASON_INVALID;
 if(host.includes(':')){
  const groups=parseIPv6(host);
  if(!groups)return REASON_INVALID;
  return isBlockedV6(groups)?REASON_PRIVATE:null;
 }
 if(NUMERIC_V4.test(host)){
  const v4=parseLooseIPv4(host);
  if(v4==null)return REASON_INVALID;
  return isBlockedV4(v4)?REASON_PRIVATE:null;
 }
 return hostnameReason(host);
}

export function checkProxyTarget(host:string,port:unknown):ProxyTargetCheck{
 const reason=forbiddenHostReason(host);
 if(reason)return {ok:false,reason};
 if(typeof port!=='number'||!Number.isInteger(port)||port<1||port>65535)return {ok:false,reason:REASON_PORT};
 return {ok:true};
}
