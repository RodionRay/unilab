/** «Был в сети» (Telegram privacy StatusTimestamp): что применено и нужно ли применять. */
export type LastSeenPrivacy={hidden:boolean;applied:boolean;at:string;error:string};

function asState(raw:unknown):LastSeenPrivacy|null{
 if(!raw||typeof raw!=='object')return null;
 const r=raw as Record<string,unknown>;
 if(typeof r.hidden!=='boolean'||typeof r.applied!=='boolean')return null;
 return {hidden:r.hidden,applied:r.applied,at:String(r.at||''),error:String(r.error||'')};
}

/**
 * Звать воркер при сохранении? Да — если желаемое отличается от применённого, или прошлая
 * попытка не прошла (повтор безопасен). Никогда не применяли и «не скрывать» — Telegram не трогаем.
 * sessionReplaced: сохраняем новую или удаляем сессию — сервер сбрасывает прежнее состояние, оно не в счёт.
 */
export function lastSeenNeedsApply(desiredHidden:boolean,state:unknown,sessionReplaced=false):boolean{
 const s=sessionReplaced?null:asState(state);
 if(!s)return desiredHidden;
 return !s.applied||s.hidden!==desiredHidden;
}

export type LastSeenStatus={tone:'ok'|'error'|'pending'|'none';text:string};

/** Строка состояния под переключателем: честно — применено, ошибка или ждёт сохранения. */
export function lastSeenStatus(desiredHidden:boolean,state:unknown,hasSession:boolean):LastSeenStatus{
 const s=asState(state);
 if(!hasSession)return desiredHidden?{tone:'pending',text:'Применится, когда у аккаунта будет сессия'}:{tone:'none',text:''};
 if(s&&s.hidden===desiredHidden){
  if(s.applied)return {tone:'ok',text:desiredHidden?'Скрыто в Telegram':'Видно в Telegram'};
  return {tone:'error',text:`Не применено: ${s.error||'нет ответа Telegram'}. «Сохранить» повторит попытку`};
 }
 if(!s&&!desiredHidden)return {tone:'none',text:''};
 return {tone:'pending',text:'Применится в Telegram после «Сохранить»'};
}
