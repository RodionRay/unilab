import {describe,expect,it} from 'vitest';
import {
  leadInTriageTab,
  leadTriage,
  leadUnread,
  leadsLinkTarget,
  triageActionsFor,
  triageCounts,
} from '@/lib/lead-triage';
import {markLeadOpened} from '@/lib/lead-conversation';

const openedNew={status:'new',temperature:'hot',viewed:true};
const unreadNew={status:'new',temperature:'cold',viewed:false};
const qualified={status:'working',temperature:'warm',viewed:true};
const rejected={status:'archived',temperature:'hot',viewed:true};

describe('REQ-1 открытие лида не переносит его',()=>{
  it('патч открытия меняет только отметку прочтения, вкладка остаётся «Новые»',()=>{
    const patch=markLeadOpened(unreadNew,'2026-10-02T09:00:00.000Z');
    const opened={...unreadNew,...patch};

    expect(leadTriage(opened)).toBe('new');
    expect(leadInTriageTab(opened,'new')).toBe(true);
    expect(leadUnread(opened)).toBe(false);
  });

  it('ранее авто-просмотренный лид (viewed=true, status=new) снова в «Новых»',()=>{
    expect(leadInTriageTab(openedNew,'new')).toBe(true);
    expect(leadInTriageTab(openedNew,'lead')).toBe(false);
  });
});

describe('REQ-2 вкладки и счётчики',()=>{
  it('status → вкладка: new → Новые, working → Лиды, archived → Отклонённые, мусор → Новые',()=>{
    expect(leadTriage(openedNew)).toBe('new');
    expect(leadTriage(qualified)).toBe('lead');
    expect(leadTriage(rejected)).toBe('rejected');
    expect(leadTriage({})).toBe('new');
    expect(leadTriage({status:'weird'})).toBe('new');
  });

  it('«Все» показывает любой разбор, температура фильтрует внутри вкладки',()=>{
    expect([openedNew,unreadNew,qualified,rejected].every(l=>leadInTriageTab(l,'all'))).toBe(true);
    expect(leadInTriageTab(openedNew,'new','hot')).toBe(true);
    expect(leadInTriageTab(unreadNew,'new','hot')).toBe(false);
    expect(leadInTriageTab({status:'new'},'new','warm')).toBe(true);
  });

  it('счётчики по вкладкам',()=>{
    expect(triageCounts([openedNew,unreadNew,qualified,rejected])).toEqual({new:2,lead:1,rejected:1,all:4});
    expect(triageCounts([])).toEqual({new:0,lead:0,rejected:0,all:0});
  });
});

describe('REQ-3 действия разбора',()=>{
  it('предлагаются два перехода, кроме текущего',()=>{
    expect(triageActionsFor('new')).toEqual(['lead','rejected']);
    expect(triageActionsFor('lead')).toEqual(['rejected','new']);
    expect(triageActionsFor('rejected')).toEqual(['lead','new']);
  });
});

describe('REQ-7 непрочитанные',()=>{
  it('не открыт или клиент ответил после открытия',()=>{
    expect(leadUnread(unreadNew)).toBe(true);
    expect(leadUnread({...qualified,needsManager:true})).toBe(true);
    expect(leadUnread(qualified)).toBe(false);
  });
});

describe('REQ-8 ссылки из обзора',()=>{
  it('новые значения и наследие (viewed, температуры, старые статусы)',()=>{
    expect(leadsLinkTarget(undefined)).toEqual({tab:'new',temperature:'all'});
    expect(leadsLinkTarget('lead')).toEqual({tab:'lead',temperature:'all'});
    expect(leadsLinkTarget('all')).toEqual({tab:'all',temperature:'all'});
    expect(leadsLinkTarget('hot')).toEqual({tab:'new',temperature:'hot'});
    expect(leadsLinkTarget('viewed')).toEqual({tab:'new',temperature:'all'});
    expect(leadsLinkTarget('working')).toEqual({tab:'lead',temperature:'all'});
    expect(leadsLinkTarget('archived')).toEqual({tab:'rejected',temperature:'all'});
  });
});
