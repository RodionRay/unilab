export type LeadLike={
  id:string;
  kind?:string;
  created?:string;
  data:{
    name?:string;
    message?:string;
    source?:string;
    status?:string;
    draft?:string;
    [key:string]:unknown;
  };
};

export type LeadFilterOptions={
  query?:string;
  status?:'all'|'new'|'working'|'archived';
  onlyWithDraft?:boolean;
};

/** Фильтр списка лидов в UI: поиск, статус, черновики. */
export function filterLeads<T extends LeadLike>(records:T[],options:LeadFilterOptions={}):T[]{
  const query=(options.query??'').trim().toLowerCase();
  const status=options.status??'all';
  return records.filter((r)=>{
    if(r.kind&&r.kind!=='lead')return false;
    if(options.onlyWithDraft&&!r.data.draft)return false;
    if(status!=='all'&&r.data.status!==status)return false;
    if(!query)return true;
    return JSON.stringify(r.data).toLowerCase().includes(query);
  });
}

/** Разбор тем поиска из настроек AI. */
export function parseSearchKeywords(keywords:string):string[]{
  return keywords
    .split(/[,;\n]+/)
    .map((k)=>k.trim().toLowerCase())
    .filter((k)=>k.length>=2);
}

/** Сопоставление сообщения лида с темами поиска (обход на поиск). */
export function matchLeadKeywords(message:string,keywords:string[]):string[]{
  const text=message.toLowerCase();
  return keywords.filter((k)=>text.includes(k));
}

export type LeadQualification={
  matched:string[];
  score:number;
  qualified:boolean;
};

/** Оценка сообщения для автоматического отбора при обходе источников. */
export function qualifyLeadMessage(
  message:string,
  keywords:string|string[],
  minMatches=1,
):LeadQualification{
  const list=Array.isArray(keywords)?keywords:parseSearchKeywords(keywords);
  const matched=matchLeadKeywords(message,list);
  return {
    matched,
    score:matched.length,
    qualified:matched.length>=minMatches,
  };
}

/** Ключ дедупликации при сборе сообщений из групп. */
export function leadDedupKey(source:string,message:string):string{
  const normalized=message.trim().toLowerCase().replace(/\s+/g,' ');
  return `${source.trim().toLowerCase()}::${normalized}`;
}
