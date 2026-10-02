import {describe,expect,it} from 'vitest';
import type {ReplyEntry} from '@/lib/lead-conversation';
import {
  AVATAR_TONES,buildThread,chatListItem,dateSeparatorLabel,defaultMode,describeSendError,initials,avatarTone,isSendShortcut,
  listTimeLabel,listWithOpened,makeOutbox,openedFrom,pendingFor,unreadCountOf,unreadOnOpen,
  type ChatLead,type ThreadItem,type ThreadMessage,
} from '@/lib/chat-view';

// Local-time constructors keep the tests independent of the machine time zone.
const NOW=new Date(2026,9,2,18,0);
const at=(day:number,h:number,m=0)=>new Date(2026,9,day,h,m).toISOString();
const us=(text:string,iso:string,over:Partial<ReplyEntry>={}):ReplyEntry=>({text,mode:'dm',at:iso,ok:true,error:'',messageId:'1',link:'',chatId:'',from:'us',status:'sent',...over});
const client=(text:string,iso:string):ReplyEntry=>({text,mode:'dm',at:iso,ok:true,error:'',messageId:'2',link:'',chatId:'',from:'client'});
const lead=(data:Record<string,unknown>,created=at(1,9)):ChatLead=>({id:'lead-1',created,data:{name:'Анна Демидова',message:'Ищу сервис для остатков',viewed:true,...data}});
const messages=(items:ThreadItem[])=>items.filter((i):i is ThreadMessage=>i.kind==='message');

describe('chat-view · thread',()=>{
  it('starts with the source post, then replies in time order, ours on the right',()=>{
    const t=buildThread(lead({replies:[client('Да',at(2,10,5)),us('Здравствуйте',at(2,10))]}),{now:NOW});
    const m=messages(t.items);

    expect(m.map(x=>[x.source,x.side,x.text])).toEqual([[true,'in','Ищу сервис для остатков'],[false,'out','Здравствуйте'],[false,'in','Да']]);
  });

  it('puts date separators Сегодня / Вчера / «d MMMM» before each new day',()=>{
    const t=buildThread(lead({replies:[us('a',at(1,12)),us('b',at(2,9))]},new Date(2026,8,28,9).toISOString()),{now:NOW});
    const dates=t.items.filter(i=>i.kind==='date').map(i=>i.kind==='date'?i.label:'');

    expect(dates).toEqual(['28 сентября','Вчера','Сегодня']);
    expect(dateSeparatorLabel(new Date(2025,11,31,9).toISOString(),NOW)).toBe('31 декабря 2025 г.');
  });

  it('groups one side within 5 minutes: only the last bubble of a run has the tail',()=>{
    const t=buildThread(lead({replies:[us('1',at(2,10,0)),us('2',at(2,10,4)),us('3',at(2,10,12)),client('4',at(2,10,13))]}),{now:NOW});
    const m=messages(t.items).filter(x=>!x.source);

    expect(m.map(x=>[x.text,x.first,x.last])).toEqual([['1',true,false],['2',false,true],['3',true,true],['4',true,true]]);
  });

  it('a date separator breaks a group even inside the window',()=>{
    const t=buildThread(lead({replies:[us('late',at(1,23,58)),us('early',at(2,0,1))]}),{now:NOW});
    const m=messages(t.items).filter(x=>!x.source);

    expect(m.every(x=>x.first&&x.last)).toBe(true);
  });

  it('ticks: pending clock, failed with error, unknown, sent ✓, read ✓✓ once the client wrote later',()=>{
    const t=buildThread(lead({replies:[
      us('read',at(2,9)),client('reply',at(2,9,30)),us('sent',at(2,10)),
      us('fail',at(2,11),{ok:false,status:'failed',error:'PEER_FLOOD'}),
      us('unk',at(2,12),{ok:false,status:'unknown'}),
      us('legacy fail',at(2,13),{ok:false,status:undefined,error:'x'}),
    ]}),{now:NOW,pending:{text:'sending',mode:'dm',at:at(2,14)}});
    const out=messages(t.items).filter(x=>x.side==='out');

    expect(out.map(x=>[x.text,x.tick])).toEqual([['read','read'],['sent','sent'],['fail','failed'],['unk','unknown'],['legacy fail','failed'],['sending','pending']]);
    expect(out.find(x=>x.text==='fail')?.error).toBe('PEER_FLOOD');
    expect(messages(t.items).filter(x=>x.side==='in').every(x=>x.tick===null)).toBe(true);
  });

  it('a reply sent into the group quotes the source post; a DM does not',()=>{
    const t=buildThread(lead({replies:[us('in group',at(2,9),{mode:'chat'}),us('dm',at(2,10))]}),{now:NOW});
    const out=messages(t.items).filter(x=>x.side==='out');

    expect(out.map(x=>x.quote)).toEqual(['Ищу сервис для остатков','']);
  });

  it('unread divider sits before the first client message after our last one',()=>{
    const t=buildThread(lead({viewed:false,replies:[client('old',at(2,8)),us('ours',at(2,9)),client('new 1',at(2,10)),client('new 2',at(2,10,1))]}),{now:NOW});

    expect(t.unreadIndex).toBeGreaterThan(-1);
    expect(t.items[t.unreadIndex]?.kind).toBe('unread');
    const next=t.items[t.unreadIndex+1];
    expect(next?.kind==='message'&&next.text).toBe('new 1');
  });

  it('no unread divider for a viewed chat, or when the caller captured it as read',()=>{
    const replies=[us('ours',at(2,9)),client('new',at(2,10))];

    expect(buildThread(lead({viewed:true,replies}),{now:NOW}).unreadIndex).toBe(-1);
    expect(buildThread(lead({viewed:false,replies}),{now:NOW,unread:false}).unreadIndex).toBe(-1);
    expect(buildThread(lead({viewed:true,replies}),{now:NOW,unread:true}).unreadIndex).toBeGreaterThan(-1);
  });

  it('source post created after the first reply is placed first and still shows its stored time',()=>{
    const t=buildThread(lead({replies:[us('hi',at(2,9))]},at(2,17)),{now:NOW});
    const [source,first]=messages(t.items);

    expect(source?.source).toBe(true);
    expect(source?.time).toBe('17:00');
    expect(first?.text).toBe('hi');
  });

  it('empty thread = only the source post (with its time)',()=>{
    const m=messages(buildThread(lead({replies:[]},at(2,9,7)),{now:NOW}).items);

    expect(m).toHaveLength(1);
    expect(m[0]?.time).toBe('09:07');
  });
});

describe('chat-view · list item',()=>{
  it('prefixes our last message with «Вы: »',()=>{
    const row=chatListItem(lead({replies:[client('Привет',at(2,9)),us('Добрый   день!\nСейчас',at(2,10))]}),{now:NOW});

    expect([row.prefix,row.preview,row.lastTick]).toEqual(['Вы: ','Добрый день! Сейчас','sent']);
  });

  it('shows an unsent AI draft with «Черновик: » but not one that was already sent',()=>{
    const draftOnly=chatListItem(lead({draft:'Предлагаю демо',replies:[]}),{now:NOW});
    const sentDraft=chatListItem(lead({draft:'Предлагаю демо',replies:[us('Предлагаю демо',at(2,9))]}),{now:NOW});

    expect([draftOnly.prefix,draftOnly.preview]).toEqual(['Черновик: ','Предлагаю демо']);
    expect([sentDraft.prefix,sentDraft.preview]).toEqual(['Вы: ','Предлагаю демо']);
  });

  it('a waiting client message beats the draft in the preview',()=>{
    const row=chatListItem(lead({viewed:false,draft:'Ответ',replies:[us('Здравствуйте',at(2,9)),client('Сколько стоит?',at(2,10))]}),{now:NOW});

    expect([row.prefix,row.preview,row.unreadCount]).toEqual(['','Сколько стоит?',1]);
  });

  it('unread count = client messages after our last; ≥1 for an unviewed chat with client messages; 0 otherwise',()=>{
    expect(unreadCountOf({viewed:false,replies:[us('a',at(2,8)),client('b',at(2,9)),client('c',at(2,9,1))]})).toBe(2);
    expect(unreadCountOf({viewed:false,replies:[client('b',at(2,8)),us('a',at(2,9))]})).toBe(1);
    expect(unreadCountOf({viewed:false,replies:[us('a',at(2,9))]})).toBe(0);
    expect(unreadCountOf({viewed:true,replies:[client('b',at(2,9))]})).toBe(0);
  });

  it('flags a failed last send',()=>{
    const row=chatListItem(lead({replies:[us('x',at(2,9),{ok:false,status:'failed',error:'PEER_FLOOD'})]}),{now:NOW});

    expect(row.failed).toBe(true);
    expect(row.lastTick).toBe('failed');
  });

  it('falls back to the client text/source post when there are no replies',()=>{
    expect(chatListItem(lead({replies:[]}),{now:NOW}).preview).toBe('Ищу сервис для остатков');
  });

  it('time labels: HH:mm today · «вчера» · weekday within 7 days · dd.MM.yy',()=>{
    expect(listTimeLabel(at(2,9,5),NOW)).toBe('09:05');
    expect(listTimeLabel(at(1,23,59),NOW)).toBe('вчера');
    expect(listTimeLabel(new Date(2026,8,29,12).toISOString(),NOW)).toBe('вт');
    expect(listTimeLabel(new Date(2026,8,20,12).toISOString(),NOW)).toBe('20.09.26');
    expect(listTimeLabel('garbage',NOW)).toBe('');
  });
});

describe('chat-view · avatar, keys',()=>{
  it('initials from the first two words with letters',()=>{
    expect(initials('Анна Демидова')).toBe('АД');
    expect(initials('Студия «Лён и хлопок»')).toBe('СЛ');
    expect(initials('igor')).toBe('I');
    expect(initials('  ')).toBe('?');
  });

  it('avatar tone is stable per id and within the palette',()=>{
    expect(avatarTone('lead-1')).toBe(avatarTone('lead-1'));
    for(const id of ['a','b','c','8b1f2c3d-0000-4000-8000-000000000001'])expect(avatarTone(id)).toBeLessThan(AVATAR_TONES);
  });

  it('Enter sends; Shift/Alt+Enter, IME composition and other keys do not',()=>{
    expect(isSendShortcut({key:'Enter'})).toBe(true);
    expect(isSendShortcut({key:'Enter',shiftKey:true})).toBe(false);
    expect(isSendShortcut({key:'Enter',altKey:true})).toBe(false);
    expect(isSendShortcut({key:'Enter',isComposing:true})).toBe(false);
    expect(isSendShortcut({key:'Enter',nativeEvent:{isComposing:true}})).toBe(false);
    expect(isSendShortcut({key:'Enter',keyCode:229})).toBe(false);
    expect(isSendShortcut({key:'a'})).toBe(false);
  });
});

describe('chat-view · panel state',()=>{
  const withReplies=(replies:ReplyEntry[],id='lead-1'):ChatLead=>({...lead({replies}),id});

  it('pending bubble shows until the server stores a new copy of the text, then disappears',()=>{
    const before=withReplies([us('Привет',at(2,9))]);
    const box=makeOutbox(before,'  Привет  ','dm',{now:NOW});

    expect(pendingFor(box,before)).toEqual({text:'Привет',mode:'dm',at:NOW.toISOString()});
    // server clock earlier than ours: still recognised by the copy count, not by time
    expect(pendingFor(box,withReplies([us('Привет',at(2,9)),us('Привет',at(2,8))]))).toBeNull();
    // failed send stored by the server also ends the pending state
    expect(pendingFor(box,withReplies([us('Привет',at(2,9)),us('Привет',at(2,18),{ok:false,status:'failed'})]))).toBeNull();
  });

  it('pending bubble belongs to its chat only; no outbox = nothing',()=>{
    const a=withReplies([],'a');
    const box=makeOutbox(a,'x','chat',{now:NOW});

    expect(pendingFor(box,withReplies([],'b'))).toBeNull();
    expect(pendingFor(null,a)).toBeNull();
    expect(pendingFor(box,null)).toBeNull();
  });

  it('opened chat stays in its list slot only while search and folder are unchanged',()=>{
    const a=withReplies([],'a'),b=withReplies([],'b'),c=withReplies([],'c');
    const opened=openedFrom(b,[a,b,c],'',"all");
    const afterViewed=[a,c];

    expect(listWithOpened(afterViewed,b,opened,{query:'',folder:'all'}).map(l=>l.id)).toEqual(['a','b','c']);
    expect(listWithOpened(afterViewed,b,opened,{query:'ozon',folder:'all'}).map(l=>l.id)).toEqual(['a','c']);
    expect(listWithOpened(afterViewed,b,opened,{query:'',folder:'viewed'}).map(l=>l.id)).toEqual(['a','c']);
    expect(listWithOpened([a,b,c],b,opened,{query:'',folder:'all'})).toHaveLength(3);
    expect(listWithOpened(afterViewed,null,opened,{query:'',folder:'all'})).toBe(afterViewed);
  });

  it('unread state is the one captured at click time',()=>{
    const unreadLead={...withReplies([client('?',at(2,9))],'a'),data:{...withReplies([client('?',at(2,9))],'a').data,viewed:false}};
    const opened=openedFrom(unreadLead,[unreadLead],'','all');
    const nowViewed={...unreadLead,data:{...unreadLead.data,viewed:true}};

    expect(unreadOnOpen(nowViewed,opened)).toBe(true);
    expect(unreadOnOpen(nowViewed,null)).toBe(false);
  });

  it('default mode: DM when the client is reachable, group reply when only the group is',()=>{
    expect(defaultMode({senderUsername:'demo_x'},true)).toBe('dm');
    expect(defaultMode({},true)).toBe('chat');
    expect(defaultMode({},false)).toBe('dm');
  });
});

describe('chat-view · send errors',()=>{
  it('maps Telegram codes to plain Russian with the next step; code kept for the tooltip',()=>{
    expect(describeSendError('PEER_FLOOD: аккаунт временно ограничен Telegram')).toEqual({
      text:'Telegram временно ограничил этот аккаунт для новых диалогов. Ответьте позже или в группе.',code:'PEER_FLOOD',
    });
    expect(describeSendError('USER_PRIVACY_RESTRICTED').text).toMatch(/закрыл личные сообщения/);
    expect(describeSendError('rpc error USER_IS_BLOCKED').code).toBe('USER_IS_BLOCKED');
    expect(describeSendError('INPUT_USER_DEACTIVATED').text).toMatch(/удалён/);
    expect(describeSendError('CHAT_WRITE_FORBIDDEN').text).toMatch(/Ответьте в личку/);
  });

  it('FLOOD_WAIT_N becomes a human wait time',()=>{
    expect(describeSendError('FLOOD_WAIT_45')).toEqual({text:'Telegram просит подождать 45 с. Повторите после паузы.',code:'FLOOD_WAIT_45'});
    expect(describeSendError('A wait of FLOOD_WAIT_600 seconds').text).toMatch(/10 мин/);
  });

  it('unknown code → generic next step; server Russian text without a code → as is; empty → retry hint',()=>{
    expect(describeSendError('SOME_NEW_ERROR').text).toMatch(/Telegram отклонил сообщение/);
    expect(describeSendError('Аккаунт на отлежке — отправка недоступна')).toEqual({text:'Аккаунт на отлежке — отправка недоступна',code:''});
    expect(describeSendError('').text).toBe('Не отправлено. Повторите попытку.');
  });
});

describe('chat-view · retry',()=>{
  it('a failed message is retryable until a later copy (same text+mode) is delivered or in flight',()=>{
    const failed=us('Привет',at(2,9),{ok:false,status:'failed',error:'PEER_FLOOD'});
    const only=messages(buildThread(lead({replies:[failed]}),{now:NOW}).items).find(m=>m.tick==='failed');
    const afterRetry=messages(buildThread(lead({replies:[failed,us('Привет',at(2,9,1))]}),{now:NOW}).items).find(m=>m.tick==='failed');
    const inFlight=messages(buildThread(lead({replies:[failed]}),{now:NOW,pending:{text:'Привет',mode:'dm',at:at(2,9,2)}}).items).find(m=>m.tick==='failed');
    const otherMode=messages(buildThread(lead({replies:[failed,us('Привет',at(2,9,1),{mode:'chat'})]}),{now:NOW}).items).find(m=>m.tick==='failed');

    expect(only?.retryable).toBe(true);
    expect(afterRetry?.retryable).toBe(false);
    expect(inFlight?.retryable).toBe(false);
    expect(otherMode?.retryable).toBe(true);
  });

  it('retry in place: the failed bubble itself shows the clock, no second copy',()=>{
    const failed=us('Привет',at(2,9),{ok:false,status:'failed',error:'PEER_FLOOD'});
    const l=lead({replies:[failed]});
    const box=makeOutbox(l,'Привет','dm',{now:NOW,retry:true});
    const out=messages(buildThread(l,{now:NOW,pending:pendingFor(box,l)}).items).filter(m=>m.side==='out');

    expect(out.map(m=>[m.text,m.tick,m.error,m.retryable,m.time])).toEqual([['Привет','pending','',false,'18:00']]);
    // a retry stays «sending» until the request settles even though the server keeps one entry
    expect(pendingFor(box,lead({replies:[us('Привет',at(2,9,1))]}))).toMatchObject({retry:true});
  });
});

describe('chat-view · host statuses (deferred replies)',()=>{
  it('a scheduled reply ticks as «on its way», a cancelled one never as failed and is not the list preview',()=>{
    const scheduled=us('Позже',at(2,10),{ok:false,status:'scheduled' as ReplyEntry['status']});
    const cancelled=us('Отменён',at(2,11),{ok:false,status:'cancelled' as ReplyEntry['status']});
    const l=lead({replies:[client('Вопрос',at(2,9)),scheduled,cancelled]});
    const out=messages(buildThread(l,{now:NOW}).items).filter(m=>m.side==='out');
    const row=chatListItem(l,{now:NOW});

    expect(out.map(m=>m.tick)).toEqual(['pending','unknown']);
    expect(out.every(m=>m.entry!==null)).toBe(true);
    expect([row.prefix,row.preview,row.failed]).toEqual(['Вы: ','Позже',false]);
  });

  it('source post uses the stored post time (msgAt) when the scanner saved it',()=>{
    const m=messages(buildThread(lead({msgAt:at(1,8,30),replies:[]},at(2,9)),{now:NOW}).items);

    expect(m[0]?.time).toBe('08:30');
  });
});

