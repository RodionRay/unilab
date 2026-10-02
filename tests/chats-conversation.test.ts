import {describe,expect,it} from 'vitest';
import {
  INBOX_CURSOR_MARGIN_SEC,SEND_BLOCK_WINDOW_MS,type ReplyEntry,
  findSendBlock,hasIncomingDm,nextInboxCursor,applySendOutcome,failedAttemptIndex,withPendingSend,
} from '@/lib/lead-conversation';

const T0=Date.parse('2026-09-30T10:00:00.000Z');
const ours=(over:Partial<ReplyEntry>):ReplyEntry=>({
  text:'Привет',mode:'dm',at:new Date(T0).toISOString(),ok:false,error:'',messageId:'',link:'',chatId:'',from:'us',...over,
});

describe('lead-conversation · курсор входящих',()=>{
  it('полный проход: пол = старт прохода минус запас, но никогда не назад',()=>{
    expect(nextInboxCursor({inboxSinceTs:1000},{complete:true,scanStartedTs:5000},0).inboxSinceTs).toBe(5000-INBOX_CURSOR_MARGIN_SEC);
    expect(nextInboxCursor({inboxSinceTs:9000},{complete:true,scanStartedTs:5000},0).inboxSinceTs).toBe(9000);
  });

  it('старый воркер без scanStartedTs: пол по последнему сообщению (fallback)',()=>{
    expect(nextInboxCursor({inboxSinceTs:1000},{},4000).inboxSinceTs).toBe(4000);
  });

  it('завершение постраничного прохода двигает пол к старту первой страницы',()=>{
    const next=nextInboxCursor({inboxSinceTs:1000,inboxPageOffset:3000,inboxPageStartTs:5000},{complete:true,scanStartedTs:6000},0);

    expect(next).toEqual({inboxSinceTs:5000-INBOX_CURSOR_MARGIN_SEC,inboxPageOffset:0,inboxPageStartTs:0});
  });
});

describe('lead-conversation · блок повторной отправки',()=>{
  it('pending/unknown старше окна не блокирует',()=>{
    const lead={replies:[ours({status:'unknown',at:new Date(T0-SEND_BLOCK_WINDOW_MS-1).toISOString()})]};

    expect(findSendBlock(lead,{clientMsgId:'',text:'Привет',mode:'dm'},T0)).toBeNull();
  });

  it('другой текст без ключа не блокируется',()=>{
    const lead={replies:[ours({status:'pending'})]};

    expect(findSendBlock(lead,{clientMsgId:'',text:'Другое',mode:'dm'},T0)).toBeNull();
    expect(findSendBlock(lead,{clientMsgId:'',text:'Привет',mode:'dm'},T0)?.kind).toBe('inflight');
  });
});

describe('lead-conversation · дедупликация ЛС',()=>{
  it('старая запись без accountId относится к аккаунту лида',()=>{
    const lead={accountId:'acc-1',replies:[{...ours({}),from:'client' as const,messageId:'5'}]};

    expect(hasIncomingDm(lead,'acc-1','5')).toBe(true);
    expect(hasIncomingDm(lead,'acc-2','5')).toBe(false);
  });
});

describe('lead-conversation · повтор неудачной отправки',()=>{
  it('находит неудачную попытку: сначала по ключу, затем по тексту и режиму; pending/unknown/доставленные — нет',()=>{
    const lead={replies:[
      ours({text:'A',status:'failed',sendKey:'k1'}),
      ours({text:'B',status:'failed',sendKey:'k2'}),
      ours({text:'C',status:'unknown',sendKey:'k3'}),
      ours({text:'D',ok:true,status:'sent',sendKey:'k4'}),
    ]};

    expect(failedAttemptIndex(lead,{clientMsgId:'k1',text:'другой',mode:'dm'})).toBe(0);
    expect(failedAttemptIndex(lead,{clientMsgId:'new',text:'B',mode:'dm'})).toBe(1);
    expect(failedAttemptIndex(lead,{clientMsgId:'new',text:'B',mode:'chat'})).toBe(-1);
    expect(failedAttemptIndex(lead,{clientMsgId:'k3',text:'C',mode:'dm'})).toBe(-1);
    expect(failedAttemptIndex(lead,{clientMsgId:'k4',text:'D',mode:'dm'})).toBe(-1);
  });

  it('повтор заменяет запись failed, а исход применяется к самой новой записи с ключом',()=>{
    const lead={replies:[ours({text:'A',status:'failed',sendKey:'k1',error:'PEER_FLOOD'})]};
    const pending=withPendingSend(lead,ours({text:'A',status:'pending',sendKey:'k1'}),'',0);
    const done=applySendOutcome(pending,{sendKey:'k1',mode:'dm',accountId:'acc',peerId:'777',accessHash:'',nowIso:new Date(T0).toISOString()},{status:'sent',error:'',messageId:'5'});

    expect(done.replies).toHaveLength(1);
    expect((done.replies as ReplyEntry[])[0]).toMatchObject({status:'sent',ok:true,sendKey:'k1'});
  });

  it('две записи с одним ключом: исход достаётся последней, старая не трогается',()=>{
    const lead={replies:[ours({text:'A',status:'failed',sendKey:'k1'}),ours({text:'A',status:'pending',sendKey:'k1'})]};
    const done=applySendOutcome(lead,{sendKey:'k1',mode:'dm',accountId:'acc',peerId:'',accessHash:'',nowIso:new Date(T0).toISOString()},{status:'sent',error:''});

    expect((done.replies as ReplyEntry[]).map(x=>x.status)).toEqual(['failed','sent']);
  });

  it('по тексту и режиму не находит failed, если позже то же сообщение доставлено или в пути',()=>{
    const delivered={replies:[ours({text:'A',status:'failed',sendKey:'k1'}),ours({text:'A',ok:true,status:'sent',sendKey:'k2'})]};
    const inFlight={replies:[ours({text:'A',status:'failed',sendKey:'k1'}),ours({text:'A',status:'pending',sendKey:'k2'})]};

    expect(failedAttemptIndex(delivered,{clientMsgId:'new',text:'A',mode:'dm'})).toBe(-1);
    expect(failedAttemptIndex(inFlight,{clientMsgId:'new',text:'A',mode:'dm'})).toBe(-1);
    // the same client key still finds its own failed attempt
    expect(failedAttemptIndex(delivered,{clientMsgId:'k1',text:'A',mode:'dm'})).toBe(0);
  });
});
