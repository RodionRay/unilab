import {describe,expect,it} from 'vitest';
import {leadVisibleInTab,type LeadTabData} from '@/lib/lead-search';

const fresh:LeadTabData={status:'new',temperature:'hot',viewed:false};
const viewedHot:LeadTabData={status:'new',temperature:'hot',viewed:true};
const viewedWarmWorking:LeadTabData={status:'working',temperature:'warm',viewed:true};
const viewedArchived:LeadTabData={status:'archived',temperature:'warm',viewed:true};
const ignored:LeadTabData={status:'new',temperature:'hot',viewed:true,excludeFromTraining:true};

describe('REQ-L3 lead tabs: viewed split only in «Все» / «Новые»',()=>{
  it('«Все» and «Новые» hide viewed leads',()=>{
    expect(leadVisibleInTab(fresh,'all')).toBe(true);
    expect(leadVisibleInTab(viewedHot,'all')).toBe(false);
    expect(leadVisibleInTab(fresh,'new')).toBe(true);
    expect(leadVisibleInTab(viewedHot,'new')).toBe(false);
  });

  it('«Горячие», «Тёплые», «В работе», «Архив» show viewed leads',()=>{
    expect(leadVisibleInTab(viewedHot,'hot')).toBe(true);
    expect(leadVisibleInTab(viewedWarmWorking,'warm')).toBe(true);
    expect(leadVisibleInTab(viewedWarmWorking,'working')).toBe(true);
    expect(leadVisibleInTab(viewedArchived,'archived')).toBe(true);
  });

  it('status and temperature tabs still filter by their own field',()=>{
    expect(leadVisibleInTab(viewedHot,'warm')).toBe(false);
    expect(leadVisibleInTab(viewedWarmWorking,'archived')).toBe(false);
    expect(leadVisibleInTab({status:'new',viewed:false},'warm')).toBe(true);
  });

  it('«Просмотренные» shows only viewed, «Игнор» only ignored, ignored hidden elsewhere',()=>{
    expect(leadVisibleInTab(viewedHot,'viewed')).toBe(true);
    expect(leadVisibleInTab(fresh,'viewed')).toBe(false);
    expect(leadVisibleInTab(ignored,'ignored')).toBe(true);
    expect(leadVisibleInTab(fresh,'ignored')).toBe(false);
    expect(leadVisibleInTab(ignored,'hot')).toBe(false);
    expect(leadVisibleInTab(ignored,'viewed')).toBe(false);
  });
});
