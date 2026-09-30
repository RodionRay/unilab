import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {OWNER,SETTINGS_ID,login,postRequest,resetWorkspace,testDb} from './helpers/workspace-harness';

vi.mock('cloudflare:workers',async()=>(await import('./helpers/workspace-harness')).cfModule);
vi.mock('@/lib/auth',async(importOriginal)=>({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  getSessionUser:async()=>(await import('./helpers/workspace-harness')).authState.user,
}));

import {POST} from '@/app/api/workspace/route';
import {GROUP_CATALOG,catalogForProject,isCatalogPlaceholderUrl,nichesFromProjectText} from '@/lib/group-catalog';

const SELLER_PRODUCT={product:'Сервис автоматизации остатков для селлеров Wildberries и Ozon',audience:'селлеры маркетплейсов'};

function setSettings(data:Record<string,unknown>){
  testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({name:'Проект',...data}),SETTINGS_ID);
}
function groupUrls():string[]{
  const rows=testDb().sqlite.prepare("SELECT data FROM records WHERE owner=? AND kind='group'").all(OWNER) as {data:string}[];
  return rows.map(r=>String(JSON.parse(r.data).url));
}
const verifiedCatalog=GROUP_CATALOG.filter(g=>g.verified&&g.url&&!isCatalogPlaceholderUrl(g.url));

describe('catalogForProject',()=>{
  it('берёт только чаты с узкой нишей проекта, не весь каталог',()=>{
    const {niches,groups}=catalogForProject(SELLER_PRODUCT);

    expect(niches).toContain('wildberries');
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThan(verifiedCatalog.length);
    for(const g of groups)expect(g.niches.some(n=>niches.includes(n))).toBe(true);
  });

  it('широкие ниши (блоги, бизнес, маркетинг) сами по себе чат не пропускают',()=>{
    const {niches,groups}=catalogForProject({product:'CRM для салонов красоты, лиды и продажи'});

    expect(niches).not.toContain('business');
    expect(niches).not.toContain('blogs');
    expect(groups.every(g=>g.niches.some(n=>niches.includes(n)))).toBe(true);
    expect(groups.some(g=>g.niches.every(n=>['blogs','business','marketing','smm','content'].includes(n)))).toBe(false);
  });

  it('ниши ищутся по началу слова: «автоматизация» не автомобили, «остатков» — склад',()=>{
    expect(nichesFromProjectText('автоматизация продаж')).not.toContain('auto');
    expect(nichesFromProjectText('учёт остатков на WB')).toEqual(expect.arrayContaining(['inventory','wildberries']));
    expect(catalogForProject(SELLER_PRODUCT).niches).not.toContain('auto');
  });

  it.each([
    ['авторы курсов и блогеры','auto',false],
    ['автосалонов и автодилеров','auto',true],
    ['продаём автомобили','auto',true],
    ['ямы на дорогах','yandex_market',false],
    ['селлеры Яндекс.Маркета','yandex_market',true],
    ['поставщики для WB','wildberries',true],
    ['интеграция с 1С:Предприятие','1c',true],
    ['чат-бот поддержки','bots',true],
    ['дропшиппинг из Китая','dropshipping',true],
    ['оптовые поставки','b2b',true],
    ['внедрение амоCRM','crm',true],
    ['ценообразование товаров','pricing',true],
  ])('«%s» → ниша %s: %s',(text,niche,expected)=>{
    expect(nichesFromProjectText(text).includes(niche as never)).toBe(expected);
  });

  it('общие слова «продажи», «лиды» сами по себе чаты не заливают',()=>{
    expect(catalogForProject({product:'B2B продажи и лиды для бизнеса'})).toEqual({niches:[],groups:[]});
  });

  it('без ниш в настройках — пустой список',()=>{
    expect(catalogForProject({name:'Проект'})).toEqual({niches:[],groups:[]});
  });
});

describe('import_catalog',()=>{
  let errSpy:ReturnType<typeof vi.spyOn>;
  beforeEach(()=>{
    resetWorkspace();
    login(OWNER);
    errSpy=vi.spyOn(console,'error').mockImplementation(()=>{});
  });
  afterEach(()=>errSpy.mockRestore());

  it('заливает только чаты ниш проекта',async()=>{
    setSettings(SELLER_PRODUCT);
    const expected=new Set(catalogForProject(SELLER_PRODUCT).groups.map(g=>g.url.toLowerCase()));

    const res=await POST(postRequest({action:'import_catalog'}));
    const body=await res.json() as {added:number;total:number;niches:string[]};

    expect(res.status).toBe(200);
    expect(body.niches).toContain('wildberries');
    expect(body.added).toBeGreaterThan(0);
    expect(body.added).toBeLessThan(verifiedCatalog.length);
    const urls=groupUrls();
    expect(urls).toHaveLength(body.added);
    for(const u of urls)expect(expected.has(u.toLowerCase())).toBe(true);
  });

  it('повторный вызов ничего не дублирует',async()=>{
    setSettings(SELLER_PRODUCT);
    await POST(postRequest({action:'import_catalog'}));
    const before=groupUrls().length;

    const res=await POST(postRequest({action:'import_catalog'}));
    const body=await res.json() as {added:number};

    expect(body.added).toBe(0);
    expect(groupUrls()).toHaveLength(before);
  });

  it('без ниш в настройках отказывает и ничего не заливает',async()=>{
    const res=await POST(postRequest({action:'import_catalog'}));
    const body=await res.json() as {error:string};

    expect(res.status).toBe(400);
    expect(body.error).toContain('нет ниш продукта');
    expect(groupUrls()).toHaveLength(0);
  });

  it('без записи настроек отказывает 400',async()=>{
    testDb().sqlite.prepare('DELETE FROM records WHERE id=?').run(SETTINGS_ID);

    const res=await POST(postRequest({action:'import_catalog'}));

    expect(res.status).toBe(400);
    expect(groupUrls()).toHaveLength(0);
  });

  it('битый JSON настроек — 400, а не 500',async()=>{
    testDb().sqlite.prepare('UPDATE records SET data=? WHERE id=?').run('{broken',SETTINGS_ID);

    const res=await POST(postRequest({action:'import_catalog'}));

    expect(res.status).toBe(400);
    expect(groupUrls()).toHaveLength(0);
  });
});
