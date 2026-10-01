import {describe,expect,it} from 'vitest';
import {classifyJoinReply} from '@/lib/join-reply';

describe('classifyJoinReply — ответ join_group для очереди вступлений',()=>{
  it('вступили, уже в группе или заявка — успех',()=>{
    expect(classifyJoinReply({ok:true,result:{join:'joined'}})).toEqual({kind:'joined'});
    expect(classifyJoinReply({ok:false,result:{join:'already'}})).toEqual({kind:'joined'});
    expect(classifyJoinReply({ok:false,result:{join:'requested'}})).toEqual({kind:'joined'});
  });

  it('заморозка с переназначением (200 ok:false) — не ошибка, группа снова в очереди',()=>{
    const verdict=classifyJoinReply({ok:false,accountFrozen:true,reassigned:true,rejoinItem:{id:'g1',name:'Чат'},
      result:{join:'frozen',error:'Аккаунт заморожен Telegram — группа переназначена на живой аккаунт'},
      error:'Аккаунт заморожен Telegram — группа переназначена на живой аккаунт'});

    expect(verdict).toEqual({kind:'parked',note:'Аккаунт заморожен Telegram — группа переназначена на живой аккаунт',rejoinItem:{id:'g1',name:'Чат'}});
  });

  it('заморозка без живых аккаунтов — не ошибка, без повторной постановки',()=>{
    expect(classifyJoinReply({ok:false,accountFrozen:true,reassigned:false,error:'живых аккаунтов нет'}))
      .toMatchObject({kind:'parked',rejoinItem:null});
  });

  it('409 deferred после «слепого» ответа — не ошибка',()=>{
    expect(classifyJoinReply({error:'Аккаунт не резолвит @username',deferred:true,accountBlind:true} as never))
      .toMatchObject({kind:'parked',rejoinItem:null});
  });

  it('обычный отказ — ошибка с текстом воркера',()=>{
    expect(classifyJoinReply({ok:false,result:{join:'missing',error:'Слот не видит @x'}})).toEqual({kind:'failed',error:'Слот не видит @x'});
  });
});
