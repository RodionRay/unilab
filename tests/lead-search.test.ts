import {describe,expect,it} from 'vitest';
import {
  filterLeads,
  leadDedupKey,
  matchLeadKeywords,
  parseSearchKeywords,
  qualifyLeadMessage,
} from '@/lib/lead-search';

const leads=[
  {id:'1',kind:'lead',data:{name:'Остатки',message:'Нужна синхронизация остатков с МойСклад',status:'new',source:'sellers'}},
  {id:'2',kind:'lead',data:{name:'Цены',message:'Как управлять ценами на WB?',status:'working',source:'chat',draft:'Черновик'}},
  {id:'3',kind:'lead',data:{name:'Отзывы',message:'Автоматизация ответов на отзывы',status:'archived',source:'manual'}},
  {id:'4',kind:'account',data:{name:'acc'}},
];

describe('обход лидов на поиск',()=>{
  it('фильтрует по статусу и текстовому поиску',()=>{
    expect(filterLeads(leads,{status:'working'}).map((l)=>l.id)).toEqual(['2']);
    expect(filterLeads(leads,{query:'мойсклад'}).map((l)=>l.id)).toEqual(['1']);
    expect(filterLeads(leads,{status:'all',onlyWithDraft:true}).map((l)=>l.id)).toEqual(['2']);
  });

  it('игнорирует записи других kind',()=>{
    expect(filterLeads(leads).every((l)=>!l.kind||l.kind==='lead')).toBe(true);
    expect(filterLeads(leads)).toHaveLength(3);
  });

  it('разбирает темы поиска из настроек',()=>{
    expect(parseSearchKeywords('остатки, синхронизация; МойСклад\nцены')).toEqual([
      'остатки',
      'синхронизация',
      'мойсклад',
      'цены',
    ]);
  });

  it('отбирает сообщения по ключевым словам при обходе',()=>{
    const keywords=parseSearchKeywords('остатки, МойСклад, цены, отзывы');
    const hit=qualifyLeadMessage('Нужна синхронизация остатки с МойСклад',keywords);
    expect(hit.qualified).toBe(true);
    expect(hit.matched).toEqual(expect.arrayContaining(['остатки','мойсклад']));
    expect(qualifyLeadMessage('Просто привет',keywords).qualified).toBe(false);
  });

  it('находит пересечение ключевых слов в тексте',()=>{
    expect(matchLeadKeywords('Цены и остатки',['цены','отзывы'])).toEqual(['цены']);
  });

  it('строит стабильный ключ дедупликации',()=>{
    expect(leadDedupKey('sellers','  Нужна   помощь  ')).toBe('sellers::нужна помощь');
    expect(leadDedupKey('Sellers','нужна помощь')).toBe(leadDedupKey('sellers','нужна помощь'));
  });
});
