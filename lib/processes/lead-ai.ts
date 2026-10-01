import {aiChatText} from '@/lib/ai-client';
import {buildProjectBrief,parseLeadTemperature} from '@/lib/lead-filter';
import {scanStopTerms} from '@/lib/lead-stopwords';
import type {AiBatchOutcome,AiPick} from '@/lib/processes/scan-flow';

/**
 * Строгий AI-шлюз: подтверждает кандидатов ядра. Лучше 0, чем шум.
 * Итог по батчам (lib/processes/scan-flow.ts::applyAiVerdicts): ответ модели — вердикт, сбой — fallback на ядро.
 */
export async function qualifyLeadsWithAi(
 apiKey:string,
 settings:any,
 messages:{tgMsgId:string;message:string;name:string;coreScore?:number;coreReasons?:string[]}[],
):Promise<AiBatchOutcome[]>{
 if(!messages.length)return [];
 const brief=buildProjectBrief(settings);
 const stop=scanStopTerms(settings).join(', ');
 const batchSize=20;
 const out:AiBatchOutcome[]=[];
 for(let offset=0;offset<messages.length;offset+=batchSize){
  const batch=messages.slice(offset,offset+batchSize);
  const ids=batch.map(m=>String(m.tgMsgId));
  const listed=batch.map((m,i)=>{
   const core=m.coreScore!=null?`Ядро: score ${m.coreScore}/100 · ${(m.coreReasons||[]).slice(0,3).join('; ')}`:'';
   return `#${i+1} id=${m.tgMsgId}\nАвтор: ${m.name}\n${core}\n${m.message.slice(0,900)}`;
  }).join('\n\n---\n\n');
  try{
   const text=await aiChatText({
    apiKey,
    settings,
    maxTokens:1600,
    temperature:0.1,
    system:
     'Ты — строгий квалификатор лидов. Опирайся ТОЛЬКО на настройки AI-ассистента в контексте (продукт, аудитория, критерии лида, плюс-слова, горячие сигналы, стоп).\n'+
     'Лид = человек ИЩЕТ сервис/инструмент/подрядчика под ЭТОТ продукт (демо/КП/внедрение).\n'+
     'Обычный чат, жалобы, советы другим без своего запроса услуги — НЕ лид.\n'+
     'Сообщение про другую нишу, даже с «ищу сервис», — НЕ лид, если не совпадает с продуктом/критериями/плюс-словами.\n\n'+
     'БЕРИ (warm/hot) ТОЛЬКО при явном запросе решения под продукт из настроек.\n'+
     'ОТКЛОНЯЙ: болтовню без запроса услуги; чужую рекламу; эзотерику; CTA «писать @»; вакансии; накрутку; темы вне продукта.\n'+
     'Учитывай «Ядро score/reasons»: не повышай слабых кандидатов без запроса сервиса.\n\n'+
     'Верни ТОЛЬКО JSON-массив {"id":"<tgMsgId>","reason":"кратко","temperature":"hot|warm"}.\n'+
     'При сомнении — []. Пустой массив — нормально. Без markdown.\n'+
     (stop?`Стоп-слова: ${stop}.\n`:'')+
     '\nКонтекст проекта (настройки AI-ассистента):\n'+brief,
    user:'Отметь ТОЛЬКО тех, кто ищет сервис/внедрение под продукт из настроек. Остальных пропусти:\n\n'+listed,
   });
   const match=text.match(/\[[\s\S]*\]/);
   if(!match)throw new Error('AI: ответ без JSON-массива');
   const arr=JSON.parse(match[0]) as {id?:string;tgMsgId?:string;reason?:string;temperature?:string}[];
   if(!Array.isArray(arr))throw new Error('AI: ответ не массив');
   const allowIds=new Set(ids);
   const picked:AiPick[]=[];
   for(const x of arr){
    const tgMsgId=String(x?.id||x?.tgMsgId||'');
    if(!tgMsgId||!allowIds.has(tgMsgId))continue;
    const temperature=parseLeadTemperature(x.temperature);
    if(temperature!=='hot'&&temperature!=='warm')continue;
    picked.push({tgMsgId,reason:String(x.reason||'').slice(0,500),temperature});
   }
   out.push({ids,ok:true,picked});
  }catch(e){
   // Сбой батча (429/таймаут/мусор) — не вердикт: его кандидаты пойдут по ядру
   console.warn('[workspace] qualify_leads_ai batch failed:',String((e as Error)?.message||e).slice(0,200));
   out.push({ids,ok:false,picked:[]});
  }
 }
 return out;
}
