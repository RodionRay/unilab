/** Правила подготовки и готовности ответов (будущие рассылки в Telegram). */

export const AI_GUARD_WINDOW_MS=60_000;

/** Лимит: один AI-черновик в минуту на владельца. */
export function canPrepareDraft(lastGuardAt:string|null|undefined,now=new Date(),windowMs=AI_GUARD_WINDOW_MS):boolean{
  if(!lastGuardAt)return true;
  const prev=Date.parse(lastGuardAt);
  if(Number.isNaN(prev))return true;
  return now.getTime()-prev>=windowMs;
}

/** Извлечение текста из ответа OpenAI Responses API. */
export function extractOpenAiDraft(result:unknown):string{
  const output=(result as {output?:Array<{content?:Array<{type?:string;text?:string}>}>})?.output;
  if(!Array.isArray(output))return '';
  return output
    .flatMap((v)=>v.content||[])
    .filter((v)=>v.type==='output_text'&&typeof v.text==='string')
    .map((v)=>v.text as string)
    .join('\n')
    .trim();
}

/** Оптимистичная блокировка: сообщение лида не должно измениться во время генерации. */
export function draftConcurrencyOk(currentMessage:string,expectedMessage:string):boolean{
  return currentMessage===expectedMessage;
}

export type MailingLead={
  status?:string;
  draft?:string;
  message?:string;
  name?:string;
};

/** Готовность к ручной/будущей отправке (рассылка по лиду). */
export function isMailingReady(lead:MailingLead):boolean{
  return Boolean(lead.draft?.trim())&&lead.status!=='archived'&&Boolean(lead.message?.trim());
}

/** Пейлоуд копирования/отправки черновика. */
export function mailingPayload(lead:MailingLead):{text:string;ok:boolean;reason?:string}{
  if(lead.status==='archived')return {text:'',ok:false,reason:'Лид в архиве'};
  const text=(lead.draft||'').trim();
  if(!text)return {text:'',ok:false,reason:'Нет черновика ответа'};
  return {text,ok:true};
}

/** Секрет нельзя одновременно заменить и очистить. */
export function secretMutationOk(clearSecret:unknown,secret:unknown):{ok:true}|{ok:false;error:string}{
  if(clearSecret!==undefined&&typeof clearSecret!=='boolean'){
    return {ok:false,error:'Некорректная команда очистки секрета'};
  }
  if(clearSecret&&secret){
    return {ok:false,error:'Нельзя одновременно заменить и удалить секрет'};
  }
  return {ok:true};
}
