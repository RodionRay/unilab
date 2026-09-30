import {describe,expect,it} from 'vitest';
import {accountSchema,groupSchema,leadSchema,proxySchema,schemas} from '@/lib/workspace-schemas';
import {
  accountSetupStatus,
  canDeleteConnection,
  isAccountInUse,
  isProxyInUse,
  parseAccount,
} from '@/lib/processes/accounts';

describe('аккаунты',()=>{
  it('принимает валидный телефон и опциональный proxyId',()=>{
    expect(parseAccount({name:'Основной',phone:'+79991234567',proxyId:''})).toMatchObject({
      name:'Основной',
      phone:'+79991234567',
      proxyId:'',
    });
  });

  it('отклоняет телефон без плюса и коротких номеров',()=>{
    expect(()=>accountSchema.parse({name:'A',phone:'79991234567'})).toThrow();
    expect(()=>accountSchema.parse({name:'A',phone:'+123'})).toThrow();
    expect(()=>accountSchema.parse({name:'A',phone:'+0123456789'})).toThrow();
  });

  it('блокирует удаление прокси, назначенного аккаунту',()=>{
    const accounts=[{id:'a1',data:{proxyId:'p1'}}];
    expect(isProxyInUse(accounts,'p1')).toBe(true);
    expect(canDeleteConnection('proxy','p1',accounts)).toEqual({
      ok:false,
      error:'Сначала измените привязку в аккаунтах или группах',
    });
    expect(canDeleteConnection('proxy','p2',accounts)).toEqual({ok:true});
  });

  it('блокирует удаление аккаунта, назначенного группе',()=>{
    const groups=[{id:'g1',data:{accountId:'acc-1'}}];
    expect(isAccountInUse(groups,'acc-1')).toBe(true);
    expect(canDeleteConnection('account','acc-1',groups).ok).toBe(false);
    expect(canDeleteConnection('account','acc-2',groups).ok).toBe(true);
  });

  it('отмечает готовность к авторизации при наличии прокси',()=>{
    expect(accountSetupStatus(false)).toBe('setup');
    expect(accountSetupStatus(true)).toBe('ready_for_auth');
  });

  it('валидирует прокси для привязки к аккаунту',()=>{
    expect(proxySchema.parse({
      name:'EU',
      host:'proxy.example.com',
      port:'1080',
      protocol:'socks5',
      username:'u',
    })).toMatchObject({port:1080,protocol:'socks5'});
    expect(()=>proxySchema.parse({
      name:'bad',
      host:'not a host',
      port:1080,
      protocol:'socks5',
    })).toThrow();
  });

  it('schemas.account совпадает с публичным API валидации',()=>{
    expect(schemas.account).toBe(accountSchema);
  });
});

describe('группы как источники для инвайтов',()=>{
  it('принимает публичные и invite-ссылки',()=>{
    expect(groupSchema.parse({name:'Sellers',url:'https://t.me/sellers_group',accountId:''}).url).toBe(
      'https://t.me/sellers_group',
    );
    expect(groupSchema.parse({name:'Private',url:'https://t.me/+AbCdEf12345',accountId:'a'}).accountId).toBe('a');
    expect(groupSchema.parse({name:'Handle',url:'@seller_chat',accountId:''}).url).toBe('@seller_chat');
  });

  it('отклоняет произвольные URL',()=>{
    expect(()=>groupSchema.parse({name:'X',url:'https://example.com/x'})).toThrow();
  });
});

describe('лиды',()=>{
  it('требует сообщение минимум из 3 символов',()=>{
    expect(leadSchema.parse({name:'Лид',message:'Нужна синхронизация остатков'})).toMatchObject({
      status:'new',
      source:'Вручную',
      draft:'',
    });
    expect(()=>leadSchema.parse({name:'Лид',message:'ab'})).toThrow();
  });
});
