import {describe,expect,it} from 'vitest';
import {
  VK_IMPORT_CHUNK,assignVkProxies,chunkVkImportLines,parseVkAccountLines,proxyLoad,
} from '@/lib/vk/import';

const TOKEN_A='vk1.a.'+'A'.repeat(60);
const TOKEN_B='a'.repeat(85);

describe('parseVkAccountLines (REQ-1, AM-10)',()=>{
  it('accepts a bare token',()=>{
    expect(parseVkAccountLines(TOKEN_A)).toEqual([{line:1,ok:true,token:TOKEN_A,expiresIn:null,userId:null}]);
  });

  it('takes the token from login:password:token and drops the password',()=>{
    const [res]=parseVkAccountLines(`user@mail.ru:pa:ss:word:${TOKEN_B}`);
    expect(res).toEqual({line:1,ok:true,token:TOKEN_B,expiresIn:null,userId:null});
    expect(JSON.stringify(res)).not.toContain('word');
    expect(JSON.stringify(res)).not.toContain('user@mail.ru');
  });

  it('rejects login:password:word when the last part is not token-shaped and never echoes it',()=>{
    const longPassword='Secret_Password_Part_'+'x'.repeat(30);
    for(const line of [`login:pass:word`,`login:pass:${longPassword}`,`login:pass:${'g'.repeat(84)}`]){
      const [res]=parseVkAccountLines(line);
      expect(res).toMatchObject({line:1,ok:false});
      expect(res.ok?'':res.reason).toMatch(/токен/i);
      expect(JSON.stringify(res)).not.toMatch(/word|Secret|ggg|login/);
    }
  });

  it('accepts a vk1.a. or ≥85-char token as the last part of a colon line',()=>{
    const longToken='Z'.repeat(85);
    expect(parseVkAccountLines(`l:p:${TOKEN_A}`)[0]).toMatchObject({ok:true,token:TOKEN_A});
    expect(parseVkAccountLines(`l:p:${longToken}`)[0]).toMatchObject({ok:true,token:longToken});
  });

  it('reads an oauth blank.html redirect with user id and offline expiry',()=>{
    const [res]=parseVkAccountLines(`https://oauth.vk.com/blank.html#access_token=${TOKEN_A}&expires_in=0&user_id=700100`);
    expect(res).toEqual({line:1,ok:true,token:TOKEN_A,expiresIn:0,userId:700100});
  });

  it('warns when the oauth token expires',()=>{
    const [res]=parseVkAccountLines(`https://oauth.vk.com/blank.html#access_token=${TOKEN_A}&expires_in=86400&user_id=1`);
    expect(res.ok&&res.warning).toContain('86400');
  });

  it('reports bad lines with the 1-based line number and skips blank lines',()=>{
    const out=parseVkAccountLines(['', 'login:password', 'short', 'https://oauth.vk.com/blank.html#expires_in=0'].join('\n'));
    expect(out.map((r)=>[r.line,r.ok])).toEqual([[2,false],[3,false],[4,false]]);
  });

  it('marks repeated tokens in one paste as duplicates',()=>{
    const out=parseVkAccountLines([TOKEN_A,`l:p:${TOKEN_A}`,TOKEN_B].join('\r\n'));
    expect(out.map((r)=>r.ok)).toEqual([true,false,true]);
    expect(out[1]).toMatchObject({duplicate:true});
  });
});

describe('chunkVkImportLines',()=>{
  it('splits non-empty lines into chunks of at most 20',()=>{
    const text=Array.from({length:45},(_,i)=>`t${i}`).join('\n\n');
    const chunks=chunkVkImportLines(text);
    expect(chunks.map((c)=>c.split('\n').length)).toEqual([VK_IMPORT_CHUNK,VK_IMPORT_CHUNK,5]);
  });
});

describe('proxy assignment (REQ-1a, AM-11)',()=>{
  const proxies=[
    {id:'p1',data:{status:'active'}},
    {id:'p2',data:{status:'active'}},
    {id:'dead',data:{status:'inactive'}},
  ];

  it('counts Telegram and VK accounts on each proxy, ignoring other kinds',()=>{
    const load=proxyLoad([
      {kind:'account',data:{proxyId:'p1'}},
      {kind:'vk_account',data:{proxyId:'p1'}},
      {kind:'vk_account',data:{proxyId:''}},
      {kind:'lead',data:{proxyId:'p1'}},
    ]);
    expect([...load]).toEqual([['p1',2]]);
  });

  it('spreads accounts over active proxies up to the cap, then no_proxy',()=>{
    const out=assignVkProxies({count:5,proxies,load:new Map([['p1',2]]),cap:3});
    expect(out).toEqual(['p2','p2','p1','p2',null]);
  });

  it('a chosen proxy takes accounts only while it has room',()=>{
    const out=assignVkProxies({count:3,proxies,load:new Map([['p2',2]]),chosenProxyId:'p2'});
    expect(out).toEqual(['p2',null,null]);
  });

  it('no active proxy → every account is no_proxy',()=>{
    expect(assignVkProxies({count:2,proxies:[proxies[2]],load:new Map()})).toEqual([null,null]);
  });
});
