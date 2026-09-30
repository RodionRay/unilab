import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {scoreLead,type LeadCoreSettings} from '@/lib/lead-core';
import {hasBuyerIntent,hasSoftAsk,leadMessageFingerprint,plusTermHit} from '@/lib/lead-filter';

type Fixture={
  plus:{text:string;term:string;hit:boolean}[];
  intent:{text:string;buyer:boolean;soft:boolean}[];
};

const FIXTURE:Fixture=JSON.parse(readFileSync(path.resolve(__dirname,'fixtures/lead-match.json'),'utf8'));

describe('REQ-L5 plus-words match Russian word forms (shared fixture with the worker)',()=>{
  it.each(FIXTURE.plus)('$term in "$text" → $hit',({text,term,hit})=>{
    expect(plusTermHit(text.toLowerCase(),term)).toBe(hit);
  });
});

describe('REQ-L4 buyer / soft intent (shared fixture with the worker prefilter)',()=>{
  it.each(FIXTURE.intent)('"$text" → buyer $buyer, soft $soft',({text,buyer,soft})=>{
    expect(hasBuyerIntent(text)).toBe(buyer);
    expect(hasSoftAsk(text)).toBe(soft);
  });
});

describe('REQ-L5 core scoring uses word forms for plus, signals and criteria',()=>{
  const settings:LeadCoreSettings={
    keywords:'синхронизация, несколько кабинетов',
    minusKeywords:'',
    avoidTopics:'',
    leadCriteria:'Учёт остатков',
    hotSignals:'интеграция мойсклад',
    product:'',
  };

  it('counts inflected plus-words and signals as hits',()=>{
    const r=scoreLead('Подскажите сервис: нужна синхронизации для нескольких кабинетов и интеграцию МойСклад',settings);
    expect(r.plusHits).toEqual(['синхронизация','несколько кабинетов']);
    expect(r.signalHits).toEqual(['интеграция мойсклад']);
  });

  it('treats ё and е as the same letter in criteria',()=>{
    const r=scoreLead('Ищу сервис, где учет остатков нормальный',settings);
    expect(r.criteriaHits).toContain('учёт остатков');
  });
});

describe('REQ-L8 dedupe fingerprint',()=>{
  it('is groupId:tgMsgId when the message id exists, so an edit keeps the key',()=>{
    expect(leadMessageFingerprint('Текст 1','g1','42')).toBe('g1:42');
    expect(leadMessageFingerprint('Текст 2 (изменено)','g1','42')).toBe(leadMessageFingerprint('Текст 1','g1','42'));
  });

  it('falls back to the text when there is no message id',()=>{
    expect(leadMessageFingerprint('Текст','g1','')).not.toBe(leadMessageFingerprint('Другой','g1',''));
  });
});
