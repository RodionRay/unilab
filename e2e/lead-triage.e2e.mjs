#!/usr/bin/env node
/**
 * e2e «Лиды» manual triage (docs/project/specs/manual-lead-triage.md, REQ-1/3/4/5/8) against a served production
 * build with an EMPTY synthetic workspace: seeds 7 fictional leads — never point it at a real workspace.
 * Needs @playwright/test resolvable from cwd (or PLAYWRIGHT_FROM=<dir with node_modules>).
 * Usage: DEMO_URL=http://127.0.0.1:5380 DEMO_PASSWORD=... OUT=artifacts/manual-lead-triage node e2e/lead-triage.e2e.mjs
 */
import {createRequire} from 'node:module';
import path from 'node:path';

const {chromium,expect}=createRequire(path.join(process.env.PLAYWRIGHT_FROM||process.cwd(),'noop.js'))('@playwright/test');

const base=(process.env.DEMO_URL||'http://127.0.0.1:5380').replace(/\/$/,'');
const out=process.env.OUT||'artifacts/manual-lead-triage';
const email=process.env.DEMO_EMAIL||'admin@uniseller.local';
const password=process.env.DEMO_PASSWORD;
if(!password){console.error('DEMO_PASSWORD is required');process.exit(2)}
const log=(...a)=>console.log('[e2e]',...a);

const LEADS=[
  ['Анна Демидова','Ищу фулфилмент под WB, 300 заказов в день, кто посоветует?','hot','new',false],
  ['Игорь Север','Подскажите CRM для учёта остатков на Ozon и WB одновременно','hot','new',true],
  ['Ольга Тестова','Нужен менеджер маркетплейсов на аутсорс, бюджет обсуждаем','warm','new',true],
  ['Пётр Образцов','Кто делает инфографику для карточек? Нужно 40 карточек','warm','new',false],
  ['Мария Пример','Сколько стоит выход на Яндекс Маркет под ключ?','cold','new',true],
  ['Сергей Макет','Продам аккаунт селлера, писать в лс','cold','archived',true],
  ['Дарья Шаблон','Ищем сервис аналитики продаж, 3 магазина на WB','hot','working',true],
];

async function login(ctx){
  const r=await ctx.request.post(base+'/api/auth/login',{data:{email,password},headers:{origin:base}});
  if(!r.ok())throw new Error('login '+r.status());
}

async function seed(ctx){
  const save=async(kind,data)=>{
    const r=await ctx.request.post(base+'/api/workspace',{data:{action:'save',kind,data},headers:{origin:base}});
    if(!r.ok())throw new Error(`save ${kind} ${r.status()}`);
    return (await r.json()).id;
  };
  const groupId=await save('group',{name:'Селлеры WB · обсуждение',url:'https://t.me/demo_sellers_wb',status:'active'});
  for(const [name,message,temperature,status,viewed] of LEADS){
    await save('lead',{name,message,source:'Селлеры WB · обсуждение',temperature,status,viewed,groupId,reason:'Запрос на сервис для селлера'});
  }
}

async function counts(page){
  const r={};
  for(const t of ['new','lead','rejected','all'])r[t]=Number((await page.getByTestId(`lead-tab-${t}`).innerText()).replace(/\D+/g,''));
  return r;
}

async function journey(page){
  const c0=await counts(page);
  expect(c0).toEqual({new:5,lead:1,rejected:1,all:7});
  const row=name=>page.getByTestId('lead-row').filter({hasText:name});
  const dlg=page.getByRole('dialog');
  // REQ-1: open + close keeps the lead in «Новые», the unread mark goes away
  const anna=row('Анна Демидова');
  await expect(anna.getByRole('img',{name:'Не прочитан'})).toBeVisible();
  await anna.getByRole('button',{name:/Анна Демидова/}).first().click();
  await dlg.waitFor();
  await expect(dlg.getByTestId('lead-card-triage')).toContainText('Сейчас: «Новые»');
  await page.waitForTimeout(500);
  await page.screenshot({path:`${out}/1280-02-card.png`});
  await page.keyboard.press('Escape');
  await dlg.waitFor({state:'hidden'});
  await expect(anna).toBeVisible();
  await expect(anna.getByRole('img',{name:'Не прочитан'})).toHaveCount(0);
  expect(await counts(page)).toEqual(c0);
  log('REQ-1 ok: open/close keeps the tab, read mark gone');
  // REQ-3 card action + REQ-5 undo from the toast
  await anna.getByRole('button',{name:/Анна Демидова/}).first().click();
  await dlg.waitFor();
  await dlg.getByTestId('lead-move-lead').click();
  await expect(dlg.getByTestId('lead-card-triage')).toContainText('Сейчас: «Лиды»');
  await page.keyboard.press('Escape');
  await dlg.waitFor({state:'hidden'});
  expect(await counts(page)).toEqual({...c0,new:4,lead:2});
  await page.getByRole('button',{name:'Отменить'}).first().click();
  await expect.poll(()=>counts(page)).toEqual(c0);
  log('REQ-3 card + REQ-5 undo ok');
  // REQ-3 row action
  const igor=row('Игорь Север');
  await igor.getByTestId('lead-move-rejected').click();
  await expect(igor).toHaveCount(0);
  expect(await counts(page)).toEqual({...c0,new:4,rejected:2});
  log('REQ-3 row ok');
  // REQ-4 bulk
  for(const n of ['Ольга Тестова','Пётр Образцов'])await row(n).getByRole('checkbox').click();
  await expect(page.getByTestId('lead-bulk-bar')).toContainText('Выбрано 2');
  await page.screenshot({path:`${out}/1280-03-bulk.png`});
  await page.getByTestId('lead-bulk-lead').click();
  const c1={new:2,lead:3,rejected:2,all:7};
  await expect.poll(()=>counts(page)).toEqual(c1);
  log('REQ-4 bulk ok');
  await page.reload();
  await page.getByTestId('lead-tab-new').waitFor();
  await expect.poll(()=>counts(page)).toEqual(c1);
  log('persisted after reload');
}

async function overview(page){
  await page.goto(base+'/app?view=overview');
  await expect(page.getByRole('button',{name:'Новые 2'}).first()).toBeVisible();
  await page.getByRole('button',{name:'Лиды 3'}).click();
  await page.getByRole('button',{name:'Лиды 3'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/1280-05-overview-leads.png`});
  await page.getByRole('button',{name:/Все лиды/}).click();
  await expect(page.getByTestId('lead-tab-lead')).toHaveAttribute('data-state','active');
  log('REQ-8 overview ok: Новые 2 · Лиды 3 · «Все лиды» → tab «Лиды»');
}

/** 390 px: card actions, bulk bar and the undo toast are reachable on a phone (after the desktop journey). */
async function mobile(page){
  const c=await counts(page);
  const first=page.getByTestId('lead-row').first();
  await first.getByRole('button').first().click();
  const dlg=page.getByRole('dialog');
  await dlg.waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({path:`${out}/390-02-card.png`});
  await page.keyboard.press('Escape');
  await dlg.waitFor({state:'hidden'});
  await first.getByRole('checkbox').click();
  await expect(page.getByTestId('lead-bulk-bar')).toContainText('Выбрано 1');
  await page.getByTestId('lead-bulk-bar').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${out}/390-03-bulk.png`});
  await page.getByTestId('lead-bulk-rejected').click();
  await expect.poll(()=>counts(page)).toEqual({...c,new:c.new-1,rejected:c.rejected+1});
  const undo=page.getByRole('button',{name:'Отменить'}).first();
  await undo.waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({path:`${out}/390-04-undo-toast.png`});
  await undo.click({trial:true});
  await undo.click();
  await expect.poll(()=>counts(page)).toEqual(c);
  log('390 ok: card, bulk «Не подходит», undo toast reachable');
}

try{
  const browser=await chromium.launch();
  for(const vp of [{w:1280,h:860,n:'1280'},{w:390,h:844,n:'390'}]){
    const ctx=await browser.newContext({viewport:{width:vp.w,height:vp.h},colorScheme:'dark'});
    await login(ctx);
    if(vp.n==='1280')await seed(ctx);
    const page=await ctx.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(base+'/app?view=leads');
    await page.getByTestId('lead-tab-new').waitFor();
    await page.getByTestId('lead-row').first().waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({path:`${out}/${vp.n}-01-new-tab.png`});
    if(vp.n==='1280'){
      await journey(page);
      await overview(page);
    }else{
      await mobile(page);
    }
    if(errors.length)throw new Error('page errors: '+errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  log('PASS');
}catch(e){console.error('[e2e] FAIL',e.message);process.exit(1)}
