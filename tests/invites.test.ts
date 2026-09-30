import {describe,expect,it} from 'vitest';
import {
  inviteQueuePriority,
  inviteReadiness,
  parseGroupSource,
  parseInviteTarget,
} from '@/lib/processes/invites';

describe('инвайты / вступление в группы',()=>{
  it('разбирает username, invite и joinchat цели',()=>{
    expect(parseInviteTarget('@sellers_group')).toEqual({kind:'username',value:'sellers_group'});
    expect(parseInviteTarget('https://t.me/sellers_group')).toEqual({kind:'username',value:'sellers_group'});
    expect(parseInviteTarget('https://t.me/+InviteHash99')).toEqual({kind:'invite',value:'InviteHash99'});
    expect(parseInviteTarget('https://t.me/joinchat/AbCdEf')).toEqual({kind:'joinchat',value:'AbCdEf'});
    expect(parseInviteTarget('https://evil.example/x')).toBeNull();
  });

  it('не готов без аккаунта, готов с назначенным аккаунтом',()=>{
    expect(inviteReadiness({url:'https://t.me/sellers_group'})).toEqual({
      status:'needs_account',
      reason:'Назначьте аккаунт для вступления',
    });
    expect(inviteReadiness({url:'https://t.me/sellers_group',accountId:'acc-1'}).status).toBe('ready');
    expect(inviteReadiness({url:'bad'}).status).toBe('invalid');
  });

  it('приоритизирует публичные username выше invite-hash',()=>{
    expect(inviteQueuePriority('https://t.me/public_chat')).toBeLessThan(
      inviteQueuePriority('https://t.me/+hash'),
    );
    expect(inviteQueuePriority('https://t.me/+hash')).toBeLessThan(
      inviteQueuePriority('https://t.me/joinchat/x'),
    );
    expect(inviteQueuePriority('nope')).toBe(99);
  });

  it('parseGroupSource использует ту же схему, что и API',()=>{
    const g=parseGroupSource({
      name:'Канал',
      url:'https://t.me/joinchat/SecretLink',
      accountId:'11111111-1111-4111-8111-111111111111',
    });
    expect(g.name).toBe('Канал');
  });
});
