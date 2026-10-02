import {describe,expect,it} from 'vitest';
import {
  INBOX_CURSOR_MARGIN_SEC,SEND_BLOCK_WINDOW_MS,type ReplyEntry,
  applySendOutcome,findSendBlock,hasIncomingDm,leadReplies,nextInboxCursor,withPendingSend,
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

  it('повтор с тем же ключом после failed: исход ложится на новую запись, зависшей pending нет',()=>{
    const ctx={sendKey:'k-1',mode:'dm' as const,accountId:'a1',peerId:'42',accessHash:'',nowIso:new Date(T0).toISOString()};
    const failed=applySendOutcome(
      withPendingSend({replies:[]},ours({status:'pending',sendKey:'k-1'})),ctx,{status:'failed',error:'boom'},
    );
    expect(findSendBlock(failed,{clientMsgId:'k-1',text:'Привет',mode:'dm'},T0)).toBeNull();

    const retried=applySendOutcome(withPendingSend(failed,ours({status:'pending',sendKey:'k-1'})),ctx,{status:'sent',error:''});

    const mine=leadReplies(retried).filter(x=>x.sendKey==='k-1');
    expect(mine.map(x=>x.status)).toEqual(['sent']);
    expect(findSendBlock(retried,{clientMsgId:'k-1',text:'Привет',mode:'dm'},T0)?.kind).toBe('delivered');
  });

  it('исход ищет последнюю запись с ключом, даже если старая failed осталась в истории',()=>{
    const ctx={sendKey:'k-2',mode:'dm' as const,accountId:'a1',peerId:'42',accessHash:'',nowIso:new Date(T0).toISOString()};
    const lead={replies:[ours({status:'failed',sendKey:'k-2'}),ours({status:'pending',sendKey:'k-2'})]};

    const out=leadReplies(applySendOutcome(lead,ctx,{status:'failed',error:'boom'}));

    expect(out.map(x=>x.status)).toEqual(['failed','failed']);
  });
});

describe('lead-conversation · дедупликация ЛС',()=>{
  it('старая запись без accountId относится к аккаунту лида',()=>{
    const lead={accountId:'acc-1',replies:[{...ours({}),from:'client' as const,messageId:'5'}]};

    expect(hasIncomingDm(lead,'acc-1','5')).toBe(true);
    expect(hasIncomingDm(lead,'acc-2','5')).toBe(false);
  });
});
