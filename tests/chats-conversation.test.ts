import {describe,expect,it} from 'vitest';
import {
  INBOX_CURSOR_MARGIN_SEC,SEND_BLOCK_WINDOW_MS,type ReplyEntry,
  findSendBlock,hasIncomingDm,nextInboxCursor,
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
