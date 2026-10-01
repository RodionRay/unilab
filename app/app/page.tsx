"use client";
import {useState,useEffect,useCallback,useRef,useMemo,Suspense} from 'react';
import {useSearchParams} from 'next/navigation';
import {Users,Radio,Shield,Sparkles,Plus,ArrowRight,Search,ChevronRight,ExternalLink,Pencil,Trash2,Check,Upload,Plug,Loader2,LogOut,RefreshCw,X,CloudUpload,FileArchive,Ban,ImagePlus,UserRound,UserPlus,Database,ScrollText,History,FilterX,Send,MessageSquare,Timer,Network,Gauge,AlertTriangle,BarChart3,Folder,CircleX,ThumbsUp,ThumbsDown} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {OverviewDashboard} from '@/components/product/overview-dashboard';
import {AiWorkspace} from '@/components/product/ai/ai-workspace';
import {canSeeGroups,canSeeLeadText,isInConversations,isWorkspaceOwner,pluralRu,projectIdOf,projectsFrom} from '@/components/product/ai/model';
import {useActiveProject} from '@/components/product/ai/use-active-project';
import {WorkspaceNav,parseWorkspaceView,persistWorkspaceView,readStoredWorkspaceView,WORKSPACE_VIEW_PARAM,type NavName} from '@/components/product/workspace-nav';
import {NotificationsBell,NotificationsPanel} from '@/components/product/notifications-center';
import {useWorkspaceNotices} from '@/hooks/useWorkspaceNotices';
import {TaskLogDialog} from '@/components/product/task-log-dialog';
import {EmployeesPanel} from '@/components/product/employees-panel';
import {DEFAULT_DM_SOFT_CLOSE} from '@/lib/mailing';
import {LIVE_JOIN_STATES,type LiveJoinState} from '@/lib/processes/join-flow';
import {canAccessNav,type CrmAccess,type WorkspaceInvite,type WorkspaceMember} from '@/lib/staff-types';
import {DEFAULT_NAV} from '@/components/product/workspace-nav';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectTrigger,SelectValue,SelectContent,SelectItem} from '@/components/ui/select';
import {Table,TableHeader,TableRow,TableHead,TableBody,TableCell,SortableTableHead,SortHeaderButton} from '@/components/ui/table';
import {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction} from '@/components/ui/alert-dialog';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {Skeleton} from '@/components/ui/skeleton';
import {Empty,EmptyHeader,EmptyTitle,EmptyDescription} from '@/components/ui/empty';
import {Toaster} from 'sonner';
import {toast} from '@/lib/workspace-notifications';
import {markLeadOpened} from '@/lib/lead-conversation';
import {SidebarProvider,Sidebar,SidebarHeader,SidebarContent,SidebarFooter,SidebarInset,SidebarTrigger} from '@/components/ui/sidebar';
import {parseProxyLine,parseProxyLines,type ProxyProtocol} from '@/lib/proxy-line';
import {accountPhoneKey,canonicalizeTgUrl,duplicateReason,findDuplicate,proxyIdentityKey,telegramEntityKey} from '@/lib/record-identity';
import {accountSessionSecret,formatArchiveSize,parseAccountZip,ACCOUNT_ARCHIVE_ACCEPT,MAX_ACCOUNT_ARCHIVE_BYTES} from '@/lib/account-zip';
import {
  ACCOUNT_STATUS_LABELS,
  ACCOUNT_STATUSES,
  DEFAULT_ACCOUNT_LIMITS,
  TELEGRAM_RECOMMENDED_LIMITS,
  JOIN_GAP_DEFAULT_SEC,
  PROXY_STATUS_LABELS,
  accountAvatarColor,
  accountLimitsUsage,
  accountStatusTone,
  accountUpdatedAt,
  cooldownHoursFromNow,
  cooldownLabel,
  cooldownRemainingShort,
  generateTelegramUsername,
  isAccountUsable,
  isOnCooldown,
  moscowNextMidnightIso,
  relativeTimeRu,
  type AccountStatus,
  type SessionMode,
} from '@/lib/telegram-accounts';
import {
  GROUP_CATALOG,
  GROUP_NICHE_LABELS,
  MARKET_SECTIONS,
  catalogStats,
  isCatalogPlaceholderUrl,
  marketVerifiedCount,
  nichesFromProjectText,
  searchGroupCatalog,
  type CatalogHit,
  type GroupNiche,
} from '@/lib/group-catalog';
import {
  LEAD_TEMPERATURE_LABELS,
  type LeadTemperature,
} from '@/lib/lead-filter';
import {
  parseGroupUrlLines,
  telegramMessageLink,
} from '@/lib/audience-invite';
import {useTableSort} from '@/hooks/useTableSort';
import type {SortValueType} from '@/lib/table-sort';
import {leadVisibleInTab} from '@/lib/lead-search';

/** `project` is read-only here: it is edited only through project_* actions, never generic save. */
type Kind='account'|'proxy'|'group'|'lead'|'settings'|'project';
type RecordItem={id:string;kind:Kind;data:any;hasSecret:boolean;created:string};
type OnboardResult={
  joined:'requested'|'already'|'joined';
  scanned:number;
  matched:number;
  added:number;
  aiUsed:boolean;
  title:string;
  metrics?:{rating?:number;leadsHot?:number}|null;
  addedByTemp?:{hot?:number;warm?:number;cold?:number}|null;
};

const kinds:Record<string,Kind>={'Лиды':'lead','Переписки':'lead','Группы и каналы':'group','Аккаунты':'account','Прокси':'proxy','AI-ассистент':'settings'};
const labels:Record<Kind,string>={account:'аккаунт',proxy:'прокси',group:'группу',lead:'лид',settings:'настройки AI',project:'проект'};
const PROBLEM_ACCOUNT=new Set(['disconnected','unauthorized','frozen','spamblock','proxy_error','cooldown','inactive','setup','error']);
/** Живые состояния ручного вступления (вкладка вступает/сканирует); у фоновой очереди производителя больше нет. */
const JOIN_ACTIVE_STATES=new Set<string>(LIVE_JOIN_STATES);
const defaults:any={
  account:{name:'',phone:'',proxyId:'',status:'setup',format:'manual',sessionMode:'keep',limits:{...DEFAULT_ACCOUNT_LIMITS},cooldownUntil:'',firstName:'',lastName:'',username:'',about:'',hasPhoto:false,error:''},
  proxy:{name:'',host:'',port:'1080',protocol:'socks5',username:'',status:'inactive',exitIp:'',lastChecked:'',checkError:''},
  group:{name:'',url:'',accountId:'',status:'setup',error:'',membership:'none',joinedAt:'',joinState:'',joinStateAt:'',joinStateError:'',leadsTotal:0,leadsHot:0,leadsWarm:0,leadsCold:0,scanMatched:0,rating:0,lastScanned:'',scanLog:[]},
  lead:{name:'',message:'',source:'Вручную',status:'new',temperature:'warm',draft:'',tgMsgId:'',groupId:'',reason:'',viewed:false,viewedAt:'',excludeFromTraining:false,senderId:'',senderUsername:'',senderAccessHash:'',messageKind:'',peerId:'',replyToMsgId:'',replies:[],conversationOpen:false,conversationAt:'',incomingLastText:'',needsManager:false,accountId:''},
  settings:{
    name:'Мой бизнес',
    model:'deepseek-chat',
    provider:'deepseek',
    apiBase:'https://api.deepseek.com',
    projectUrl:'',
    audience:'Люди и компании, которые уже ищут решение в тематических Telegram-чатах: B2B, услуги, SaaS, агентства, подрядчики — аудитория с живым запросом, а не холодный спам.',
    leadCriteria:'Целевой лид ЯВНО ищет сервис/инструмент/подрядчика под ваш продукт (остатки, синхронизация, цены, отзывы, кабинеты, 1С/МойСклад) и готов обсуждать демо или внедрение. Не лид: обычный чат селлеров, жалобы без запроса сервиса, чужая реклама.',
    product:`Опишите здесь ваш продукт или услугу: что продаёте, для кого, чем отличаетесь, как начать работу (демо, созвон, заявка).

AI будет использовать этот текст для отбора тёплых и горячих лидов и для черновиков ответов. Пишите конкретно: боли клиента, ценность, следующий шаг. Не выдумывайте цены и функции вне этого описания.`,
    keywords:'остатки, синхронизация, МойСклад, 1С, управление ценами, ответы на отзывы, автоматизация, несколько кабинетов, интеграция, юнит-экономика, ищу сервис, нужна crm, кто пользуется',
    minusKeywords:'вакансия, резюме, куплю аккаунт, продаю аккаунт, схема, серый, накрутка, казино, крипта, взлом, раздача, курсы инфобиз, заработок без вложений, матрица судьбы, таро, гадание, астролог, нумеролог, эзотерика, писать @',
    tone:'Дружелюбно, по делу, без давления. Короткие абзацы, конкретный следующий шаг.',
    cta:'Предложить короткий созвон, демо или заявку на расчёт.',
    pains:'Клиент тратит время на поиск в чатах; много шума и оффтопа; сложно быстро отличить тёплый запрос от спама; ответ уходит поздно.',
    valueProps:'Быстрый отклик на живой запрос; понятная ценность продукта; понятный следующий шаг без давления.',
    avoidTopics:'вакансии, накрутка, серые схемы, продажа аккаунтов, инфобиз, болтовня селлеров без запроса сервиса, жалобы на СПП без запроса инструмента',
    hotSignals:'ищу сервис, нужен сервис, кто пользуется, подскажите crm, интеграция 1с, мойсклад, остатки синхронизация, ответы на отзывы',
    productNotes:'',
    learnExamples:'',
    dmSoftClose:DEFAULT_DM_SOFT_CLOSE,
    aiQualify:true,
    autoRescanEnabled:true,
    autoRescanMinutes:30,
    lastAutoRescanAt:'',
    lastMinusAdded:[],
    lastMinusAddedAt:'',
    rescanLog:[],
    scanDepthDays:7,
    profileName:'',
    profileAbout:'',
    profileContact:'',
    notifyEnabled:false,
    notifyBotToken:'',
    notifyChatId:'',
  },
};
const TELEGRAM_OFFLINE='Telegram не подключён — проверьте подключение в разделе «Аккаунты».';
const viewCopy:Record<string,string>={'Обзор':'Лиды, чаты и статус подключений — всё важное на одном экране.','Уведомления':'Журнал событий кабинета: сканы, вступления, ошибки и сохранения.','Лиды':'Новые запросы: просмотренные скрываются из общей сетки.','Переписки':'Ответы клиентов: откройте диалог — он уйдёт в «Просмотренные». Новый ответ клиента снова в «Новые».','Группы и каналы':'Поиск тем под AI → вступление → реальные лиды из чатов.','Аккаунты':'Статусы, дневные лимиты, отлёжка, прокси и группы — всё по каждому аккаунту.','Прокси':'host:port:user:password — список или по одному.','AI-ассистент':'Сколько клиентов AI нашёл в ваших чатах и какие ответы ждут вашего одобрения.','Сотрудники':'Роли, доступы к разделам CRM и приглашения коллег по ссылке.','Настройки':'Глубина скана, профиль кабинета и уведомления о лидах в Telegram-бота.'};

/** Дневные лимиты AI владельца (docs/leads-pipeline.md): оценки сообщений и черновики. */
const DEFAULT_JUDGE_DAILY_CAP=3000;
const DEFAULT_DRAFT_DAILY_CAP=200;
const MAX_DAILY_CAP=100000;
function clampCap(v:unknown,fallback:number):number{
  const n=Math.round(Number(v));
  return Number.isFinite(n)&&n>0?Math.min(MAX_DAILY_CAP,n):fallback;
}

/** Ответ POST /api/staff: ошибка или счётчики операции. */
type StaffActionResponse={error?:string;url?:string;removed?:number;members?:number;invites?:number};

async function api(body?:unknown){
  const r=await fetch('/api/workspace',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data:any=await r.json();
  if(!r.ok){
    const err=new Error(data.error||'Ошибка соединения') as Error & {status?:number;data?:any};
    err.status=r.status;
    err.data=data;
    throw err;
  }
  return data;
}

/** Чистый payload группы: не тащим битый joinStateError из records в save. */
function cleanGroupSaveData(data:Record<string,unknown>){
  const err=data.joinStateError;
  const joinStateError=
    err==null||typeof err==='object'?'':String(err).slice(0,500);
  const joinState=String(data.joinState||'');
  const okState=JOIN_ACTIVE_STATES.has(joinState)?joinState:'';
  return{
    ...data,
    joinState:okState,
    joinStateAt:okState?String(data.joinStateAt||''):'',
    joinStateError,
  };
}

function sleep(ms:number){return new Promise(r=>setTimeout(r,ms))}

function proxyPickOptions(proxies:{id:string;data:any}[]){
  const rank=(st:string)=>st==='active'?0:st==='checking'?1:2;
  return [...proxies]
    .sort((a,b)=>rank(String(a.data.status))-rank(String(b.data.status))||String(a.data.name||'').localeCompare(String(b.data.name||''),'ru'))
    .map(r=>({
      id:r.id,
      name:proxyDisplayLabel(r.data)+(r.data.name&&!String(r.data.name).startsWith('Прокси')&&r.data.host?` · ${r.data.name}`:''),
      tone:(r.data.status==='active'?'active':r.data.status==='checking'?'checking':'muted') as 'active'|'checking'|'muted',
      hint:r.data.status==='active'?'активен':r.data.status==='checking'?'проверка…':r.data.status==='inactive'?'неактивен':'',
    }));
}

function proxyDisplayLabel(data:any){
  const host=String(data?.host||'').trim();
  const port=data?.port!=null&&data?.port!==''?String(data.port):'';
  if(host&&port)return `${host}:${port}`;
  const name=String(data?.name||'').trim();
  if(name&&!name.startsWith(':'))return name;
  if(name.startsWith(':')&&port)return `?:${port}`;
  return name||'Прокси';
}

function ProxyRefLabel({proxy}:{proxy:{id:string;data:any}|undefined}){
  if(!proxy)return <span className="muted">Не назначен</span>;
  const st=String(proxy.data.status||'inactive');
  const active=st==='active';
  const label=proxyDisplayLabel(proxy.data);
  return (
    <span className={`proxy-ref ${active?'is-active':st==='checking'?'is-checking':''}`} title={label}>
      <span className="proxy-ref-name">{label}</span>
      {active&&<span className="badge success">активен</span>}
      {st==='checking'&&<span className="badge warning">проверка</span>}
      {st==='inactive'&&<span className="badge neutral">неактивен</span>}
    </span>
  );
}

function Pick({value,onChange,options,placeholder}:{
  value:string;
  onChange:(s:string)=>void;
  options:{id:string;name:string;tone?:'active'|'checking'|'muted';hint?:string}[];
  placeholder:string;
}){
  const selected=options.find(o=>o.id===value);
  return <Select value={value||'none'} onValueChange={v=>onChange(v==='none'?'':v)}>
    <SelectTrigger className={`w-full${selected?.tone==='active'?' pick-trigger-active':''}`}>
      <SelectValue placeholder={placeholder}>
        {selected?(
          <span className={`pick-value ${selected.tone==='active'?'is-active':''}`}>
            {selected.name}
            {selected.hint&&selected.tone==='active'?<span className="badge success">{selected.hint}</span>:null}
          </span>
        ):null}
      </SelectValue>
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="none">{placeholder}</SelectItem>
      {options.map(v=>(
        <SelectItem
          key={v.id}
          value={v.id}
          className={v.tone==='active'?'pick-option-active':v.tone==='checking'?'pick-option-checking':undefined}
        >
          <span className="pick-option-row">
            <span>{v.name}</span>
            {v.hint?(
              <span className={`badge ${v.tone==='active'?'success':v.tone==='checking'?'warning':'neutral'}`}>{v.hint}</span>
            ):null}
          </span>
        </SelectItem>
      ))}
    </SelectContent>
  </Select>;
}

function tempBadge(t?:string){
  const temp=(t==='hot'||t==='warm'||t==='cold'?t:'warm') as LeadTemperature;
  return <span className={`temp-badge ${temp}`}>{LEAD_TEMPERATURE_LABELS[temp]}</span>;
}

function groupRatingStars(rating:number){
  const n=Math.max(0,Math.min(5,Math.round(Number(rating)||0)));
  if(!n)return <span className="muted text-sm">Нет оценки</span>;
  return <span className="group-rating" aria-label={`Рейтинг ${n} из 5`}>{'★'.repeat(n)}{'☆'.repeat(5-n)}</span>;
}

function groupAlreadyIn(item:RecordItem){
  const d=item.data||{};
  if(d.membership==='joined'||d.membership==='pending')return true;
  if(d.status==='pending')return true;
  if(d.joinedAt)return true;
  return false;
}

function groupNeedsJoin(item:RecordItem){
  const d=item.data||{};
  if(!d.accountId||!d.url||isCatalogPlaceholderUrl(d.url))return false;
  if(groupAlreadyIn(item))return false;
  return true;
}

function groupStatusLabel(item:RecordItem){
  const d=item.data||{};
  const js=String(d.joinState||'');
  if(js==='joining')return {label:'Вступаем…',tone:'warning' as const};
  if(js==='scanning')return {label:'Скан…',tone:'warning' as const};
  const s=String(d.status||'setup');
  if(d.membership==='pending'||s==='pending')return {label:'Заявка',tone:'warning' as const};
  if(d.membership==='joined'||(s==='active'&&d.joinedAt)||groupAlreadyIn(item))return {label:'Вступили',tone:'success' as const};
  if(s==='error')return {label:'Ошибка',tone:'danger' as const};
  if(s==='active')return {label:'Не вступили',tone:'warning' as const};
  return {label:'Ждёт вступления',tone:'neutral' as const};
}

function formatGroupSyncAt(raw:string){
  const t=Date.parse(raw||'');
  if(!Number.isFinite(t))return '';
  return new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

function statusBadge(status:string,kind?:Kind){
  if(kind==='account'){
    const label=ACCOUNT_STATUS_LABELS[status as AccountStatus]||status;
    const tone=accountStatusTone(status);
    return <span className={`badge ${tone==='default'?'':tone}`}>{label}</span>;
  }
  if(kind==='proxy'){
    const label=PROXY_STATUS_LABELS[status as keyof typeof PROXY_STATUS_LABELS]||'Неактивный';
    const tone=accountStatusTone(status==='active'?'active':status==='checking'?'setup':'inactive');
    return <span className={`badge ${tone==='default'?'':tone}`}>{label}</span>;
  }
  if(status==='working')return <span className="badge success">В работе</span>;
  if(status==='archived')return <span className="badge neutral">Архив</span>;
  return <span className="badge">Новый</span>;
}

function accountRowStatus(data:any){
  // Отлёжка в UI — только status=cooldown (дневной лимит) или spamblock/frozen.
  if(data.status==='spamblock')return 'spamblock';
  if(data.status==='frozen')return 'frozen';
  if(data.status==='cooldown'&&isOnCooldown(data.cooldownUntil))return 'cooldown';
  if(data.status==='cooldown'&&!isOnCooldown(data.cooldownUntil))return 'active';
  return data.status||'setup';
}

function isAccountWorkable(data:any){
  return isAccountUsable(data);
}

function accountDisplayName(data:any){
  const full=[data.firstName,data.lastName].filter(Boolean).join(' ').trim();
  return full||String(data.name||'').trim()||'Без имени';
}

function accountIdentityLine(data:any,id:string){
  if(data.username)return `@${String(data.username).replace(/^@/,'')}`;
  if(data.phone)return String(data.phone).replace(/\D/g,'')||data.phone;
  return id.replace(/-/g,'').slice(0,12);
}

function AccountStatusCell({status,error,cooldownUntil}:{status:string;error?:string;cooldownUntil?:string}){
  const tone=accountStatusTone(status);
  const label=ACCOUNT_STATUS_LABELS[status as AccountStatus]||status;
  const Icon=
    status==='active'?Check:
    status==='spamblock'||status==='frozen'?AlertTriangle:
    status==='checking'?Loader2:
    status==='cooldown'?Timer:
    status==='disconnected'||status==='unauthorized'||status==='proxy_error'?CircleX:
    status==='setup'?Plug:AlertTriangle;
  const sub=
    status==='spamblock'&&error?.includes('PEER_FLOOD')?'PEER_FLOOD':
    status==='spamblock'&&isOnCooldown(cooldownUntil)?cooldownRemainingShort(cooldownUntil):
    status==='spamblock'?'Требуется проверка':
    status==='setup'?'Нужна сессия':
    status==='checking'?'Идёт проверка…':
    status==='cooldown'?cooldownRemainingShort(cooldownUntil)||cooldownLabel(cooldownUntil):
    error?String(error).slice(0,80):'';
  return (
    <div className={`acc-status acc-status-${tone}`}>
      <span className={`acc-status-icon ${status==='checking'?'is-spin':''}`} aria-hidden>
        <Icon size={14}/>
      </span>
      <div className="acc-status-text">
        <strong>{label}</strong>
        {sub?<span title={error||sub}>{sub}</span>:null}
      </div>
    </div>
  );
}

function AccountLimitsCell({data}:{data:any}){
  const u=accountLimitsUsage(data);
  const fmt=(used:number,limit:number)=>limit>0?`${used}/${limit}`:`${used}/∞`;
  const over=(used:number,limit:number)=>limit>0&&used>=limit;
  return (
    <div className="acc-limits" title={`Сброс лимитов: ${new Date(moscowNextMidnightIso()).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})} МСК`}>
      <span className={over(u.joins,u.inviteLimit)?'is-over':''} title="Вступления в группы">
        <UserPlus size={13}/><em>{fmt(u.joins,u.inviteLimit)}</em>
      </span>
      <span className={over(u.messages,u.messageLimit)?'is-over':''} title="Личные сообщения">
        <Send size={13}/><em>{fmt(u.messages,u.messageLimit)}</em>
      </span>
    </div>
  );
}

function WorkspaceHome(){
  const searchParams=useSearchParams();
  const notices=useWorkspaceNotices();
  const [view,setView]=useState<NavName>(()=>parseWorkspaceView(searchParams.get(WORKSPACE_VIEW_PARAM))),[records,setRecords]=useState<RecordItem[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState('all');
  const [modal,setModal]=useState<{kind:Kind;item?:RecordItem}|null>(null),[form,setForm]=useState<any>({}),[secret,setSecret]=useState(''),[clearSecret,setClearSecret]=useState(false),[formError,setFormError]=useState(''),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState<RecordItem|null>(null),[detail,setDetail]=useState<RecordItem|null>(null),[importOpen,setImportOpen]=useState(false),[importText,setImportText]=useState(''),[importProtocol,setImportProtocol]=useState<ProxyProtocol>('socks5'),[proxyPaste,setProxyPaste]=useState('');
  const [groupImportOpen,setGroupImportOpen]=useState(false);
  const [groupImportText,setGroupImportText]=useState('');
  const [groupImportAccountId,setGroupImportAccountId]=useState('');
  const [accountImportOpen,setAccountImportOpen]=useState(false),[accountImportProxyId,setAccountImportProxyId]=useState(''),[accountImportNames,setAccountImportNames]=useState<string[]>([]);
  const [accountImportFiles,setAccountImportFiles]=useState<File[]>([]);
  const [accountImportSessionMode,setAccountImportSessionMode]=useState<SessionMode>('keep');
  const [accountImportMixProxy,setAccountImportMixProxy]=useState(true);
  const [accountImportProgress,setAccountImportProgress]=useState('');
  const [proxyCheckProgress,setProxyCheckProgress]=useState<{done:number;total:number;active:number;inactive:number}|null>(null);
  const [telegramConnected,setTelegramConnected]=useState(false);
  const [accountCheckProgress,setAccountCheckProgress]=useState<{done:number;total:number;active:number}|null>(null);
  const [catalogOpen,setCatalogOpen]=useState(false);
  const [catalogQuery,setCatalogQuery]=useState('');
  const [catalogNiche,setCatalogNiche]=useState<GroupNiche|null>(null);
  const [catalogSelected,setCatalogSelected]=useState<string[]>([]);
  const [catalogAccountId,setCatalogAccountId]=useState('');
  const [catalogHideAdded,setCatalogHideAdded]=useState(true);
  const [catalogMarket,setCatalogMarket]=useState<string>('all');
  const [catalogTab,setCatalogTab]=useState<'links'|'topics'>('links');
  const [catalogSearching,setCatalogSearching]=useState(false);
  const [catalogHits,setCatalogHits]=useState<CatalogHit[]>([]);
  const [catalogSearchTick,setCatalogSearchTick]=useState(0);
  const [aiMeta,setAiMeta]=useState<{provider?:string;hasEnvKey?:boolean}|null>(null);
  const [leadGroupFilter,setLeadGroupFilter]=useState('all');
  const [groupFilter,setGroupFilter]=useState<'all'|'need'|'joined'|'pending'|'error'>('all');
  const [groupSelected,setGroupSelected]=useState<string[]>([]);
  const [bulkAccountId,setBulkAccountId]=useState('');
  const [accountPicker,setAccountPicker]=useState<null|{mode:'single'|'row';groupId?:string}>(null);
  const [accountPickerQuery,setAccountPickerQuery]=useState('');
  const [accountPickerDraft,setAccountPickerDraft]=useState<string[]>([]);
  const [genSettings,setGenSettings]=useState({
    scanDepthDays:7,
    autoRescanEnabled:true,
    autoRescanMinutes:30,
    judgeDailyCap:DEFAULT_JUDGE_DAILY_CAP,
    draftDailyCap:DEFAULT_DRAFT_DAILY_CAP,
    profileName:'',
    profileAbout:'',
    profileContact:'',
    notifyEnabled:false,
    notifyBotToken:'',
    notifyChatId:'',
  });
  const [accountSelected,setAccountSelected]=useState<string[]>([]);
  const [farmProfileOpen,setFarmProfileOpen]=useState(false);
  const [bulkCooldownOpen,setBulkCooldownOpen]=useState(false);
  const [bulkProxyOpen,setBulkProxyOpen]=useState(false);
  const [bulkProxyId,setBulkProxyId]=useState('');
  const [bulkProxyMix,setBulkProxyMix]=useState(false);
  const [bulkDeleteOpen,setBulkDeleteOpen]=useState(false);
  const [bulkLimitsOpen,setBulkLimitsOpen]=useState(false);
  const [bulkLimits,setBulkLimits]=useState<{invite:number;message:number}>({
    invite:TELEGRAM_RECOMMENDED_LIMITS.invite,
    message:TELEGRAM_RECOMMENDED_LIMITS.message,
  });
  const [farmAbout,setFarmAbout]=useState('');
  const [farmFirstName,setFarmFirstName]=useState('');
  const [farmLastName,setFarmLastName]=useState('');
  const [farmLogoOpen,setFarmLogoOpen]=useState(false);
  const [farmLogoFile,setFarmLogoFile]=useState<File|null>(null);
  const [farmLogoPreview,setFarmLogoPreview]=useState('');
  const [chatMode,setChatMode]=useState<'dm'|'chat'>('dm');
  const [chatText,setChatText]=useState('');
  const [autoRescanRunning,setAutoRescanRunning]=useState(false);
  const [staffMembers,setStaffMembers]=useState<WorkspaceMember[]>([]);
  const [staffInvites,setStaffInvites]=useState<WorkspaceInvite[]>([]);
  const [aiDirty,setAiDirty]=useState(false);
  const [pendingLeave,setPendingLeave]=useState<(()=>void)|null>(null);
  const [workspaceMeta,setWorkspaceMeta]=useState<{isOwner:boolean;role:string;access:CrmAccess;ownerId:string}|null>(null);
  const [meInfo,setMeInfo]=useState<{userId:string;email:string;name:string}|null>(null);
  const [taskLog,setTaskLog]=useState<{title:string;log:any[]}|null>(null);
  const inboxPollLock=useRef(false);
  const busyRef=useRef(false);
  // Одно ручное вступление за раз: параллельные клики по группам одного аккаунта обходили бы темп.
  const joinLock=useRef(false);
  const [joinInFlight,setJoinInFlight]=useState(false);
  const lastInboxPollAt=useRef(0);
  const replySendKeyRef=useRef<{leadId:string;mode:string;text:string;key:string}|null>(null);

  const refreshStaff=useCallback(async()=>{
    try{
      const r=await fetch('/api/staff',{cache:'no-store'});
      if(!r.ok){
        if(r.status===403){setStaffMembers([]);setStaffInvites([]);return}
        return;
      }
      const data=(await r.json()) as {members?:WorkspaceMember[];invites?:typeof staffInvites};
      setStaffMembers(data.members||[]);
      setStaffInvites(data.invites||[]);
    }catch{/* */}
  },[]);

  const refresh=useCallback(async()=>{
    try{
      const data=await api();
      setRecords(data.records);
      setTelegramConnected(!!data.telegramConnected);
      setAiMeta(data.ai||null);
      if(data.workspace){
        setWorkspaceMeta({
          isOwner:!!data.workspace.isOwner,
          role:String(data.workspace.role||'owner'),
          access:data.workspace.access||{},
          ownerId:String(data.workspace.ownerId||''),
        });
      }
      if(data.me)setMeInfo(data.me);
      setError('');
      if(data.workspace?.isOwner)void refreshStaff();
      else {setStaffMembers([]);setStaffInvites([])}
    }catch(e){setError((e as Error).message)}
    finally{setLoading(false)}
  },[refreshStaff]);
  useEffect(()=>{refresh()},[refresh]);
  useEffect(()=>{
    if(searchParams.get(WORKSPACE_VIEW_PARAM))return;
    const stored=readStoredWorkspaceView();
    if(stored&&stored!==view)setView(stored);
    // restore only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  useEffect(()=>{persistWorkspaceView(view)},[view]);
  useEffect(()=>{busyRef.current=busy},[busy]);

  function patchGroupLocal(id:string,patch:Record<string,unknown>){
    setRecords(prev=>prev.map(r=>r.id===id&&r.kind==='group'?{...r,data:{...r.data,...patch}}:r));
  }

  async function persistJoinState(id:string,joinState:''|LiveJoinState,joinStateError=''){
    const joinStateAt=joinState?new Date().toISOString():'';
    const err=String(joinStateError||'').slice(0,500);
    patchGroupLocal(id,{joinState,joinStateAt,joinStateError:err});
    try{await api({action:'set_group_join_state',id,joinState,joinStateError:err})}catch{/* сеть — UI уже обновлён */}
  }

  useEffect(()=>{
    if(view!=='Группы и каналы')return;
    let cancelled=false;
    (async()=>{
      try{
        const r=await api({action:'heal_group_join_state'});
        if(!cancelled&&r.fixed>0)await refresh();
      }catch{/* */}
    })();
    return()=>{cancelled=true};
  },[view,refresh]);

  useEffect(()=>{
    const usable=list('account').filter(a=>isAccountWorkable(a.data));
    if(!bulkAccountId&&usable[0]?.id)setBulkAccountId(usable[0].id);
    if(bulkAccountId&&!usable.some(a=>a.id===bulkAccountId))setBulkAccountId(usable[0]?.id||'');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[records]);
  /** Single exit guard: an unsaved AI project card asks before any view switch. */
  const leaveView=(target:NavName,apply:()=>void)=>{
    if(aiDirty&&view==='AI-ассистент'&&target!==view){setPendingLeave(()=>apply);return}
    apply();
  };
  useEffect(()=>{if(view!=='AI-ассистент')setAiDirty(false)},[view]);
  const navigate=(name:NavName)=>leaveView(name,()=>{setView(name);setQuery('');setFilter('all');setLeadGroupFilter('all');setAccountSelected([]);setGroupFilter('all');setGroupSelected([])});
  const goLeads=(opts?:{groupId?:string;filter?:string})=>leaveView('Лиды',()=>{
    setView('Лиды');
    setQuery('');
    setLeadGroupFilter(opts?.groupId||'all');
    setFilter(opts?.filter||'all');
  });
  const goChats=(filter:'all'|'need'|'joined'|'pending'|'error'='all')=>leaveView('Группы и каналы',()=>{
    setView('Группы и каналы');
    setQuery('');
    setGroupFilter(filter);
    setGroupSelected([]);
  });
  const open=(kind:Kind,item?:RecordItem)=>{
    const data={...defaults[kind],...item?.data};
    if(kind==='account'&&!item){
      const taken=list('account').map(r=>String(r.data.username||''));
      data.username=generateTelegramUsername(taken);
    }
    setModal({kind,item});setForm(data);setSecret('');setClearSecret(false);setFormError('');setProxyPaste('');
  };

  useEffect(()=>{
    const context=(document as any).modelContext;
    if(!context?.registerTool)return;
    const abort=new AbortController();
    Promise.resolve(context.registerTool({
      name:'start_group_creation',
      description:'Открыть форму добавления группы Telegram. Не вступает в группу.',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      annotations:{readOnlyHint:false},
      execute(input:unknown){
        if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('Ожидается пустой объект');
        navigate('Группы и каналы');open('group');return {opened:true};
      }
    },{signal:abort.signal})).catch(()=>{});
    return()=>abort.abort();
  },[]);

  const list=(kind:Kind)=>records.filter(r=>r.kind===kind);
  const settings=list('settings')[0];
  const projects=useMemo(()=>projectsFrom(records),[records]);
  const [activeProjectId,setActiveProjectId]=useActiveProject(projects,!loading);
  const [leadProjectScope,setLeadProjectScope]=useState<'active'|'all'>('active');
  const leadInScope=(r:RecordItem)=>leadProjectScope==='all'||!projects.length||projectIdOf(r.data,projects)===activeProjectId;
  const aiKeyReady=!!(settings?.hasSecret||aiMeta?.hasEnvKey);
  const freshLeads=list('lead').filter(r=>!r.data.viewed&&!r.data.excludeFromTraining);
  const viewedLeads=list('lead').filter(r=>!!r.data.viewed&&!r.data.excludeFromTraining);
  const excludedLeads=list('lead').filter(r=>!!r.data.excludeFromTraining);
  // Auto drafts (draftKind) wait in the AI page queue; «Переписки» = open conversations + manual drafts (REQ-20).
  const chatLeads=list('lead').filter(r=>isInConversations(r.data));
  const freshChats=chatLeads.filter(r=>!r.data.viewed);
  const viewedChats=chatLeads.filter(r=>!!r.data.viewed);

  const allowedNav=useMemo(()=>{
    if(!workspaceMeta||workspaceMeta.isOwner)return null;
    return DEFAULT_NAV.map(n=>n.name).filter(name=>canAccessNav({
      userId:meInfo?.userId||'',
      ownerId:workspaceMeta.ownerId,
      isOwner:false,
      role:(workspaceMeta.role as any)||'viewer',
      access:workspaceMeta.access,
    },name));
  },[workspaceMeta,meInfo]);

  useEffect(()=>{
    if(!allowedNav)return;
    if(!allowedNav.includes(view)){
      setView(allowedNav[0]||'Обзор');
    }
  },[allowedNav,view]);

  const navBadges=useMemo(()=>{
    // Только непрочитанные ответы клиента — не все открытые переписки
    // Бейдж «Переписки» — только needsManager (непрочитанный ответ клиента)
    const needManager=list('lead').filter(r=>!!r.data.needsManager&&!r.data.excludeFromTraining).length;
    const groups=list('group').filter(r=>{
      const d=r.data||{};
      return d.status==='error'||d.membership==='pending'||JOIN_ACTIVE_STATES.has(String(d.joinState||''));
    }).length;
    const accounts=list('account').filter(r=>{
      const st=String(r.data.status||'');
      return PROBLEM_ACCOUNT.has(st);
    }).length;
    const proxies=list('proxy').filter(r=>r.data.status!=='active').length;
    const badges:Partial<Record<NavName,number>>={
      'Уведомления':notices.filter(n=>!n.read).length,
      'Лиды':freshLeads.length,
      'Переписки':needManager,
      'Группы и каналы':groups,
      'Аккаунты':accounts,
      'Прокси':proxies,
      'AI-ассистент':aiKeyReady?0:1,
      'Сотрудники':staffInvites.length,
    };
    return badges;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[records,freshLeads.length,aiKeyReady,notices,staffInvites.length]);

  useEffect(()=>{
    const d=settings?.data||{};
    setGenSettings({
      scanDepthDays:Math.max(1,Math.min(90,Number(d.scanDepthDays)||7)),
      autoRescanEnabled:d.autoRescanEnabled!==false,
      autoRescanMinutes:Math.max(5,Math.min(180,Number(d.autoRescanMinutes)||30)),
      judgeDailyCap:clampCap(d.judgeDailyCap,DEFAULT_JUDGE_DAILY_CAP),
      draftDailyCap:clampCap(d.draftDailyCap,DEFAULT_DRAFT_DAILY_CAP),
      profileName:String(d.profileName||''),
      profileAbout:String(d.profileAbout||''),
      profileContact:String(d.profileContact||''),
      notifyEnabled:!!d.notifyEnabled,
      notifyBotToken:String(d.notifyBotToken||''),
      notifyChatId:String(d.notifyChatId||''),
    });
  },[settings?.id,settings?.data?.scanDepthDays,settings?.data?.autoRescanEnabled,settings?.data?.autoRescanMinutes,settings?.data?.judgeDailyCap,settings?.data?.draftDailyCap,settings?.data?.profileName,settings?.data?.profileAbout,settings?.data?.profileContact,settings?.data?.notifyEnabled,settings?.data?.notifyBotToken,settings?.data?.notifyChatId]);

  // Автообход лидов крутит tg-worker → /api/cron/auto-rescan (24/7, без открытого кабинета).
  // Здесь только кнопка «Собрать лиды» и отображение статуса.

  // Сотрудник без доступа к лидам получил бы 403 на каждый тик: опрос — только при праве видеть лиды.
  const leadAccess=canSeeLeadText(workspaceMeta);
  /** Poller: ответы клиентов в личке, пока кабинет открыт */
  useEffect(()=>{
    if(!telegramConnected||!leadAccess)return;
    const tick=async()=>{
      if(inboxPollLock.current)return;
      // Скрытые вкладки не опрашивают входящие; параллельные опросы сервер отсекает lease
      if(document.visibilityState!=='visible')return;
      if(Date.now()-lastInboxPollAt.current<=15_000)return;
      inboxPollLock.current=true;
      try{
        lastInboxPollAt.current=Date.now();
        const inbox=await api({action:'poll_dm_replies'});
        if(inbox?.opened>0){
          toast.success(`Клиент ответил — откройте «Переписки»: ${inbox.names?.slice(0,3).join(', ')||inbox.opened}`);
          await refresh();
        }
      }catch{/* следующий тик повторит */}
      finally{
        inboxPollLock.current=false;
      }
    };
    const id=window.setInterval(()=>{void tick()},5_000);
    const first=window.setTimeout(()=>{void tick()},1_000);
    return()=>{window.clearInterval(id);window.clearTimeout(first)};
  },[telegramConnected,leadAccess,refresh]);

  /** Скан сразу после вступления: ретраи при лаге Telegram (need_join). */
  async function scanAfterJoin(id:string,name:string){
    let lastErr:Error|null=null;
    for(let attempt=0;attempt<5;attempt++){
      if(attempt>0)await sleep(Math.min(4+attempt*3,12)*1000);
      try{
        const scan=await api({action:'scan_group',id,force:true});
        return scan;
      }catch(e){
        lastErr=e as Error & {data?:any;status?:number};
        const data=(lastErr as any)?.data;
        const retryable=!!data?.needJoin||!!data?.preserved||/скан позже|членств|вступ/i.test(lastErr.message||'');
        if(!retryable)throw lastErr;
      }
    }
    throw lastErr||new Error(`${name}: скан не удался после вступления`);
  }

  function toastOnboard(name:string,r:OnboardResult){
    if(r.joined==='requested'){
      toast.message(`${name}: заявка на вступление отправлена — скан после одобрения`);
      return;
    }
    const temp=r.addedByTemp?` · горячие ${r.addedByTemp.hot||0}, тёплые ${r.addedByTemp.warm||0}, холодные ${r.addedByTemp.cold||0}`:'';
    toast.success(`${name}: ${r.joined==='already'?'уже в группе':'вступили'} · +${r.added} лидов${temp}${r.aiUsed?' (AI)':''}`);
  }

  async function save(e:React.FormEvent){
    e.preventDefault();if(!modal)return;setBusy(true);setFormError('');
    try{
      const readyToJoin=modal.kind==='group'&&!!form.accountId&&!!form.url&&!isCatalogPlaceholderUrl(form.url);
      if(modal.kind==='group'&&isCatalogPlaceholderUrl(form.url||'')){
        setFormError('Это шаблон каталога. Вставьте реальную ссылку t.me/… или инвайт.');
        setBusy(false);
        return;
      }
      const payload={...form};
      // Telegram about ≤70; логин без @
      if(modal.kind==='account'){
        if(payload.about)payload.about=String(payload.about).slice(0,70);
        if(payload.username)payload.username=String(payload.username).replace(/^@/,'').trim();
        if(!payload.username&&!modal.item){
          payload.username=generateTelegramUsername(list('account').map(r=>String(r.data.username||'')));
        }
        if(payload.phone&&!/^\+/.test(String(payload.phone)))payload.phone=`+${String(payload.phone).replace(/\D/g,'')}`;
      }
      if(modal.kind==='group')payload.url=canonicalizeTgUrl(payload.url||'');
      const dup=findDuplicate(modal.kind,payload,records.filter(r=>r.kind===modal.kind),modal.item?.id);
      if(dup){
        setFormError(duplicateReason(modal.kind,payload,dup.data)||'Такая запись уже есть');
        setBusy(false);
        return;
      }
      // Аккаунт: сначала кабинет (быстро). @username в Telegram — фоном, иначе UI зависает на воркере/автообходе.
      const saved=await api({action:'save',kind:modal.kind,id:modal.item?.id,data:payload,secret,clearSecret,provisionUsername:false,...(modal.kind==='group'&&!modal.item?.id&&activeProjectId?{projectId:activeProjectId}:{})});
      const newAccountId=!modal.item&&modal.kind==='account'?String(saved.id||''):'';
      const desiredNick=String(payload.username||saved.username||'').replace(/^@/,'');
      setModal(null);setSecret('');
      if(modal.kind==='group'){
        await refresh();
        toast.success(readyToJoin&&!groupAlreadyIn({id:'',kind:'group',data:payload,hasSecret:false,created:''})
          ?'Группа сохранена — нажмите «Вступить» в строке группы'
          :'Изменения сохранены');
      }else if(modal.kind==='account'){
        await refresh();
        if(newAccountId&&secret){
          toast.success(desiredNick?`Аккаунт сохранён · пишем @${desiredNick} в Telegram…`:'Аккаунт сохранён · проверка сессии…');
          void (async()=>{
            try{
              const r=await api({action:'check_account',id:newAccountId,forceUsername:true,ensureUsername:true,rotateProxy:true});
              const nick=String(r.result?.profile?.username||desiredNick||'').replace(/^@/,'');
              await refresh();
              if(r.result?.ok&&nick)toast.success(`@${nick} записан в Telegram`);
              else if(r.result?.error)toast.error(`Ник не записался: ${String(r.result.error).slice(0,160)}`);
            }catch(e){toast.error(`Ник не записался: ${(e as Error).message.slice(0,160)}`)}
          })();
        }else toast.success(modal.item?.hasSecret?'Аккаунт сохранён в кабинете':'Аккаунт сохранён');
      }else{
        await refresh();
        toast.success('Изменения сохранены');
      }
    }catch(e){setFormError((e as Error).message)}finally{setBusy(false)}
  }
  async function remove(){
    if(!deleting)return;setBusy(true);
    try{
      const r=await api({action:'delete',kind:deleting.kind,id:deleting.id});
      await refresh();
      setDeleting(null);
      if(deleting.kind==='group'&&r.leadsRemoved)toast.success(`Группа удалена · лидов снято: ${r.leadsRemoved}`);
      else toast.success('Запись удалена');
    }
    catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
  }
  async function draft(item:RecordItem){
    setBusy(true);
    try{
      const r=await api({action:'draft',id:item.id});
      await refresh();
      setDetail({...item,data:{...item.data,draft:r.draft}});
      setChatText(r.draft||'');
      toast.success('Черновик готов');
    }
    catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
  }

  async function openLead(item:RecordItem){
    setDetail(item);
    setChatMode('dm');
    setChatText(item.data.draft||'');
    const patch=markLeadOpened(item.data,new Date().toISOString());
    if(!patch)return;
    const before={viewed:item.data.viewed,viewedAt:item.data.viewedAt,needsManager:item.data.needsManager};
    setRecords(prev=>prev.map(r=>r.id===item.id?{...r,data:{...r.data,...patch}}:r));
    setDetail(d=>d&&d.id===item.id?{...d,data:{...d.data,...patch}}:d);
    try{
      await api({action:'mark_lead_viewed',id:item.id});
    }catch(e){
      // Просмотр не блокируем, но и не показываем «просмотрено», если сервер не записал (403 у наблюдателя)
      setRecords(prev=>prev.map(r=>r.id===item.id?{...r,data:{...r.data,...before}}:r));
      setDetail(d=>d&&d.id===item.id?{...d,data:{...d.data,...before}}:d);
      toast.error(`Отметка «просмотрено» не сохранена: ${(e as Error).message}`);
    }
  }

  /** Один ключ на одно сообщение: повтор после таймаута узнаётся сервером и не уходит дублем. */
  function replySendKey(leadId:string,mode:string,text:string){
    const cur=replySendKeyRef.current;
    if(cur&&cur.leadId===leadId&&cur.mode===mode&&cur.text===text)return cur.key;
    const key=crypto.randomUUID();
    replySendKeyRef.current={leadId,mode,text,key};
    return key;
  }

  async function sendLeadReply(force=false){
    if(!detail||!chatText.trim())return;
    if(!telegramConnected){toast.error(TELEGRAM_OFFLINE);return}
    const text=chatText.trim();
    const mode=chatMode;
    const clientMsgId=replySendKey(detail.id,mode,text);
    setBusy(true);
    try{
      const r=await api({action:'send_lead_message',id:detail.id,mode,text,clientMsgId,force});
      if(r.lead)setDetail({...detail,data:r.lead});
      await refresh();
      toast.success(
        mode==='dm'
          ?'Отправлено в личку'
          :(r.link?'Отправлено в чат — ссылка на ответ сохранена':'Отправлено в чат'),
      );
      replySendKeyRef.current=null;
      setChatText('');
    }catch(e){
      const err=e as Error&{status?:number;data?:{unknown?:boolean;lead?:RecordItem['data']}};
      if(err.data?.lead)setDetail({...detail,data:err.data.lead});
      if(err.data?.unknown){
        toast.error(err.message,{action:{label:'Отправить ещё раз',onClick:()=>{void sendLeadReply(true)}}});
      }else{
        toast.error(err.message);
      }
      await refresh();
    }finally{setBusy(false)}
  }

  async function rescanAllGroups(opts?:{quiet?:boolean;force?:boolean;limit?:number}){
    const quiet=!!opts?.quiet;
    const pack=await api({action:'rescan_groups',force:!!opts?.force,limit:opts?.limit??40});
    const ids:string[]=pack.groupIds||[];
    const minutes=Number(pack.rescanMinutes)||Number(settings?.data.autoRescanMinutes)||30;
    // Аккаунт группы недоступен: сервер пропускает скан и не подставляет другой аккаунт.
    const unavailable=Number(pack.unavailableTotal)||0;
    if(!quiet&&unavailable){
      const first=Array.isArray(pack.unavailable)&&pack.unavailable[0]?.name?` («${pack.unavailable[0].name}»${unavailable>1?' и др.':''})`:'';
      toast.error(`Аккаунт недоступен — скан пропущен: ${unavailable} групп${first}. Назначьте рабочий аккаунт.`);
    }
    if(!ids.length){
      if(!quiet&&!unavailable)toast.message(`Нет групп к обходу (лимит: раз в ${minutes} мин)`);
      return {scanned:0,added:0,skipped:true,due:Number(pack.total)||0};
    }
    let added=0,scanned=0,needJoin=0;
    const scanErrors:string[]=[];
    for(const id of ids){
      if(!opts?.force&&busyRef.current)break;
      try{
        const r=await api({action:'scan_group',id,force:!!opts?.force});
        if(r.skipped)continue;
        scanned++;
        added+=r.added||0;
      }catch(err){
        const data=(err as any)?.data;
        // Членство потеряно (409 needJoin): сами не вступаем — группа ждёт ручного «Вступить».
        if(data?.needJoin){
          if(data?.soft||data?.preserved){
            if(data?.usernameMissing&&!quiet){
              const msg=String(data?.error||(err as Error).message||'').slice(0,120);
              if(msg&&!scanErrors.includes(msg))scanErrors.push(msg);
            }
            continue;
          }
          needJoin++;
          continue;
        }
        if(data?.usernameMissing||data?.skipped){
          const msg=String(data?.error||(err as Error).message||'').slice(0,120);
          if(msg&&!scanErrors.includes(msg))scanErrors.push(msg);
          continue;
        }
        const msg=String((err as Error).message||'ошибка').slice(0,140);
        if(msg&&!scanErrors.includes(msg))scanErrors.push(msg);
      }
    }
    if(!quiet&&needJoin)toast.message(`Нужно вступить заново: ${needJoin} групп — «Вступить» в строке группы`);
    if(!quiet&&scanErrors.length){
      const head=scanErrors[0];
      toast.error(scanErrors.length>1?`Скан: ${head} · ещё ${scanErrors.length-1}`:`Скан: ${head}`);
    }
    if(scanned>0||added>0||needJoin>0)await refresh();
    return {scanned,added,due:Number(pack.total)||ids.length};
  }

  async function saveGeneralSettings(){
    setBusy(true);
    try{
      const payload={
        ...defaults.settings,
        ...(settings?.data||{}),
        scanDepthDays:Math.max(1,Math.min(90,Number(genSettings.scanDepthDays)||7)),
        autoRescanEnabled:!!genSettings.autoRescanEnabled,
        autoRescanMinutes:Math.max(5,Math.min(180,Number(genSettings.autoRescanMinutes)||30)),
        judgeDailyCap:clampCap(genSettings.judgeDailyCap,DEFAULT_JUDGE_DAILY_CAP),
        draftDailyCap:clampCap(genSettings.draftDailyCap,DEFAULT_DRAFT_DAILY_CAP),
        profileName:String(genSettings.profileName||'').slice(0,120),
        profileAbout:String(genSettings.profileAbout||'').slice(0,500),
        profileContact:String(genSettings.profileContact||'').slice(0,200),
        notifyEnabled:!!genSettings.notifyEnabled,
        notifyBotToken:String(genSettings.notifyBotToken||'').trim().slice(0,200),
        notifyChatId:String(genSettings.notifyChatId||'').trim().slice(0,100),
        provider:'deepseek',
        model:'deepseek-chat',
        apiBase:'https://api.deepseek.com',
      };
      await api({action:'save',kind:'settings',id:settings?.id,data:payload,secret:'',clearSecret:false});
      await refresh();
      toast.success('Настройки сохранены');
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  async function testNotify(){
    setBusy(true);
    try{
      await api({
        action:'test_notify',
        botToken:String(genSettings.notifyBotToken||'').trim(),
        chatId:String(genSettings.notifyChatId||'').trim(),
      });
      toast.success('Тестовое уведомление отправлено');
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  /** «Хороший лид» / «Не лид»: the lead text becomes a judge example of its project (REQ-21); stop words stay untouched. */
  async function leadFeedback(item:RecordItem,verdict:'good'|'bad'){
    setBusy(true);
    try{
      const r=await api({action:'lead_feedback',id:item.id,verdict});
      if(r.lead){
        setRecords(prev=>prev.map(row=>row.id===item.id?{...row,data:{...row.data,...r.lead}}:row));
        setDetail(d=>d&&d.id===item.id?{...d,data:{...d.data,...r.lead}}:d);
      }
      toast.success(verdict==='good'?'Добавили в примеры хороших лидов проекта':'Добавили в примеры «не лид» проекта');
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  async function generateFarmProfile(notes=''){
    setBusy(true);
    try{
      const r=await api({action:'generate_account_about',notes});
      setFarmAbout(r.about||'');
      setFarmFirstName(r.firstName||'');
      setFarmLastName(r.lastName||'');
      if(modal?.kind==='account'){
        setForm((f:any)=>({...f,about:r.about||f.about,firstName:r.firstName||f.firstName,lastName:r.lastName??f.lastName}));
      }
      toast.success(r.fromAi?'Описание сгенерировано AI':'Шаблон из настроек продукта');
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  async function applyFarmProfiles(ids:string[],pushToTelegram=true){
    if(!ids.length){toast.message('Выберите аккаунты');return}
    if(!farmAbout.trim()&&!farmFirstName.trim()){toast.message('Сгенерируйте или введите описание');return}
    setBusy(true);
    try{
      const r=await api({
        action:'apply_account_profiles',
        ids,
        about:farmAbout.trim().slice(0,70)||undefined,
        firstName:farmFirstName.trim()||undefined,
        lastName:farmLastName.trim()||undefined,
        pushToTelegram,
      });
      await refresh();
      setAccountSelected([]);
      toast.success(`Профили: ${r.updated}/${ids.length}${pushToTelegram?' → Telegram':''}`);
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  async function applyFarmLogo(ids:string[]){
    if(!ids.length){toast.message('Выберите аккаунты');return}
    if(!farmLogoFile){toast.message('Выберите логотип');return}
    if(farmLogoFile.size>4_500_000){toast.error('Файл больше 4.5 МБ');return}
    setBusy(true);
    try{
      const buf=await farmLogoFile.arrayBuffer();
      const bytes=new Uint8Array(buf);
      let binary='';
      for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
      const photoBase64=btoa(binary);
      const r=await api({action:'upload_account_photos',ids,photoBase64});
      await refresh();
      setAccountSelected([]);
      setFarmLogoOpen(false);
      setFarmLogoFile(null);
      setFarmLogoPreview('');
      toast.success(`Логотип: ${r.updated} ок${r.failed?`, ошибок ${r.failed}`:''}`);
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  function toggleAccountSelected(id:string,on:boolean){
    setAccountSelected(prev=>on?Array.from(new Set([...prev,id])):prev.filter(x=>x!==id));
  }
  async function importProxies(){
    setBusy(true);setFormError('');
    try{
      const parsed=parseProxyLines(importText,importProtocol);
      const seen=new Set<string>();
      let done=0,skipped=0;
      for(const row of parsed){
        const key=proxyIdentityKey(row);
        if(seen.has(key)||records.some(r=>r.kind==='proxy'&&proxyIdentityKey(r.data)===key)){
          skipped++;
          continue;
        }
        seen.add(key);
        try{
          await api({action:'save',kind:'proxy',data:{name:row.name,host:row.host,port:row.port,protocol:row.protocol,username:row.username,status:'inactive',exitIp:'',lastChecked:'',checkError:''},secret:row.password});
          done++;
        }catch(e){
          const err=e as Error & {status?:number};
          if(err.status===409){skipped++;continue}
          throw e;
        }
      }
      await refresh();setImportOpen(false);setImportText('');
      if(!done&&skipped)toast.error('Все прокси из списка уже добавлены');
      else toast.success(`Добавлено прокси: ${done}${skipped?` · пропущено дублей ${skipped}`:''}`);
    }catch(e){setFormError((e as Error).message);await refresh()}finally{setBusy(false)}
  }

  function applyProxyPaste(raw:string){
    setProxyPaste(raw);
    if(!raw.trim())return;
    try{
      const row=parseProxyLine(raw.trim(), (form.protocol as ProxyProtocol)||'socks5');
      setForm((f:any)=>({...f,name:row.name,host:row.host,port:String(row.port),protocol:row.protocol,username:row.username}));
      setSecret(row.password);
      setClearSecret(false);
      setFormError('');
    }catch(e){
      setFormError((e as Error).message);
    }
  }

  function addAccountArchiveFiles(list:File[]){
    const next:File[]=[];
    const errs:string[]=[];
    for(const f of list){
      const n=f.name.toLowerCase();
      if(!n.endsWith('.zip')&&!n.endsWith('.rar')){errs.push(`«${f.name}»: только ZIP или RAR`);continue}
      if(f.size>MAX_ACCOUNT_ARCHIVE_BYTES){errs.push(`«${f.name}»: больше 1 МБ`);continue}
      next.push(f);
    }
    setAccountImportFiles(prev=>{
      const map=new Map(prev.map(f=>[f.name,f]));
      for(const f of next)map.set(f.name,f);
      return [...map.values()].slice(0,50);
    });
    setAccountImportNames([]);
    setFormError(errs.slice(0,3).join(' · '));
  }

  async function importAccounts(){
    setBusy(true);setFormError('');setAccountImportProgress('');
    try{
      if(!accountImportFiles.length||accountImportFiles.length>50)throw new Error('Выберите от 1 до 50 архивов ZIP/RAR');
      const activeProxies=list('proxy').filter(p=>p.data.status==='active').map(p=>p.id);
      const allProxies=list('proxy').map(p=>p.id);
      let proxyPool:string[]=[];
      const mix=accountImportMixProxy;
      if(mix){
        proxyPool=activeProxies.length?activeProxies:[...allProxies];
        for(let i=proxyPool.length-1;i>0;i--){
          const j=Math.floor(Math.random()*(i+1));
          [proxyPool[i],proxyPool[j]]=[proxyPool[j],proxyPool[i]];
        }
        if(!proxyPool.length)throw new Error('Нет прокси для смеси — сначала добавьте прокси');
      }else if(accountImportProxyId){
        proxyPool=[accountImportProxyId];
      }
      const seenPhones=new Set(list('account').map(r=>accountPhoneKey(r.data.phone)).filter(Boolean));
      const takenUsernames=new Set(list('account').map(r=>String(r.data.username||'').replace(/^@/,'').toLowerCase()).filter(Boolean));
      let done=0,skipped=0;
      const savedIds:string[]=[];
      const total=accountImportFiles.length;
      for(let i=0;i<accountImportFiles.length;i++){
        const file=accountImportFiles[i];
        setAccountImportProgress(`${i+1}/${total}`);
        const parsed=await parseAccountZip(file);
        const phoneKey=accountPhoneKey(parsed.phone);
        if(phoneKey&&seenPhones.has(phoneKey)){
          skipped++;
          continue;
        }
        if(phoneKey)seenPhones.add(phoneKey);
        const username=generateTelegramUsername(takenUsernames);
        takenUsernames.add(username);
        const proxyId=proxyPool.length?proxyPool[i%proxyPool.length]:'';
        try{
          // Без sync-provision: иначе каждый ZIP ждёт Telegram 20–60с и UI «Загрузка…» зависает.
          const saved=await api({
            action:'save',
            kind:'account',
            data:{
              name:parsed.name,
              phone:parsed.phone,
              proxyId,
              status:'setup',
              format:parsed.format,
              sessionMode:accountImportSessionMode,
              limits:{...DEFAULT_ACCOUNT_LIMITS},
              cooldownUntil:'',
              firstName:'',lastName:'',username,about:'',hasPhoto:false,error:'',
            },
            secret:accountSessionSecret(parsed),
            provisionUsername:false,
          });
          if(saved.id)savedIds.push(String(saved.id));
          done++;
        }catch(e){
          const err=e as Error & {status?:number};
          if(err.status===409){skipped++;continue}
          throw e;
        }
      }
      await refresh();
      setAccountImportOpen(false);
      setAccountImportFiles([]);
      setAccountImportNames([]);
      setAccountImportProxyId('');
      setAccountImportSessionMode('keep');
      setAccountImportMixProxy(true);
      setAccountImportProgress('');
      const mixNote=mix&&proxyPool.length
        ?` · прокси смешаны (${proxyPool.length})`
        :proxyPool.length?' · один прокси':'';
      if(!done&&skipped)toast.error('Все выбранные аккаунты уже есть в кабинете');
      else toast.success(`Загружено: ${done}${skipped?` · дубли пропущены ${skipped}`:''}${mixNote}${savedIds.length?' · пишем @username…':''}`);

      if(savedIds.length){
        void (async()=>{
          let nicks=0;
          for(const id of savedIds){
            try{
              const r=await api({action:'check_account',id,forceUsername:true,ensureUsername:true,rotateProxy:true});
              if(r.result?.profile?.username||r.result?.ok)nicks++;
            }catch{/* следующий */ }
          }
          await refresh();
          if(nicks)toast.success(`@username в Telegram: ${nicks}/${savedIds.length}`);
          else toast.message('Аккаунты в кабинете — никы можно дописать проверкой сессии');
        })();
      }
    }catch(e){setFormError((e as Error).message);await refresh()}
    finally{setBusy(false);setAccountImportProgress('')}
  }

  async function setAccountCooldown(item:RecordItem,hours:number|null){
    setBusy(true);
    try{
      const data={
        ...defaults.account,
        ...item.data,
        cooldownUntil:hours===null?'':cooldownHoursFromNow(hours),
        cooldownReason:hours===null?'':(item.data.cooldownReason||'manual'),
        status:hours===null?(item.data.status==='cooldown'||item.data.status==='spamblock'?'active':item.data.status):'cooldown',
        error:hours===null&&(item.data.error==='PEER_FLOOD'||/too many requests/i.test(String(item.data.error||'')))?'':item.data.error,
      };
      await api({action:'save',kind:'account',id:item.id,data});
      await refresh();
      toast.success(hours===null?'Отлежка снята':`Отлежка на ${hours} ч`);
    }catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
  }

  function selectedAccountItems(){
    const set=new Set(accountSelected);
    return list('account').filter(r=>set.has(r.id));
  }

  async function bulkSetAccountCooldown(hours:number|null){
    const items=selectedAccountItems();
    if(!items.length){toast.message('Выберите аккаунты');return}
    setBusy(true);
    let ok=0;
    try{
      for(const item of items){
        try{
          const data={
            ...defaults.account,
            ...item.data,
            cooldownUntil:hours===null?'':cooldownHoursFromNow(hours),
            cooldownReason:hours===null?'':(item.data.cooldownReason||'manual'),
            status:hours===null?(item.data.status==='cooldown'||item.data.status==='spamblock'?'active':item.data.status):'cooldown',
            error:hours===null?'':item.data.error,
          };
          await api({action:'save',kind:'account',id:item.id,data});
          ok++;
        }catch{/* next */}
      }
      await refresh();
      setBulkCooldownOpen(false);
      setAccountSelected([]);
      toast.success(hours===null?`Отлежка снята: ${ok}`:`Отлежка ${hours} ч · ${ok} акк.`);
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  async function bulkSetAccountProxy(){
    const items=selectedAccountItems();
    if(!items.length){toast.message('Выберите аккаунты');return}
    const activeProxies=list('proxy').filter(p=>p.data.status==='active').map(p=>p.id);
    const pool=bulkProxyMix
      ?(activeProxies.length?activeProxies:list('proxy').map(p=>p.id))
      :(bulkProxyId?[bulkProxyId]:['']);
    if(bulkProxyMix&&!pool.length){toast.error('Нет прокси для смеси');return}
    setBusy(true);
    let ok=0;
    try{
      for(let i=0;i<items.length;i++){
        const item=items[i];
        try{
          const proxyId=pool.length?pool[i%pool.length]:'';
          await api({action:'save',kind:'account',id:item.id,data:{...defaults.account,...item.data,proxyId}});
          ok++;
        }catch{/* next */}
      }
      await refresh();
      setBulkProxyOpen(false);
      setAccountSelected([]);
      toast.success(bulkProxyMix?`Прокси смешаны · ${ok} акк.`:`Прокси обновлены · ${ok} акк.`);
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  async function bulkSetAccountLimits(){
    const items=selectedAccountItems();
    if(!items.length){toast.message('Выберите аккаунты');return}
    const limits={
      invite:Math.max(0,Math.min(10000,Number(bulkLimits.invite)||0)),
      message:Math.max(0,Math.min(10000,Number(bulkLimits.message)||0)),
    };
    setBusy(true);
    let ok=0;
    try{
      for(const item of items){
        try{
          await api({action:'save',kind:'account',id:item.id,data:{
            ...defaults.account,
            ...item.data,
            limits:{...(item.data.limits||{}),...limits},
          }});
          ok++;
        }catch{/* next */}
      }
      await refresh();
      setBulkLimitsOpen(false);
      setAccountSelected([]);
      toast.success(`Лимиты: вступления ${limits.invite} · ЛС ${limits.message} · ${ok} акк.`);
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  function openBulkLimitsDialog(){
    setBulkLimits({
      invite:TELEGRAM_RECOMMENDED_LIMITS.invite,
      message:TELEGRAM_RECOMMENDED_LIMITS.message,
    });
    setBulkLimitsOpen(true);
  }

  async function bulkDeleteAccounts(){
    const ids=[...accountSelected];
    if(!ids.length){toast.message('Выберите аккаунты');return}
    setBusy(true);
    let ok=0;
    try{
      for(const id of ids){
        try{
          await api({action:'delete',kind:'account',id});
          ok++;
        }catch{/* next */}
      }
      await refresh();
      setBulkDeleteOpen(false);
      setAccountSelected([]);
      toast.success(`Удалено аккаунтов: ${ok}`);
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  async function checkOneProxy(item:RecordItem,opts?:{silent?:boolean}){
    if(!opts?.silent)setBusy(true);
    setRecords(prev=>prev.map(r=>r.id===item.id?{...r,data:{...r.data,status:'checking',checkError:'',checkingAt:new Date().toISOString()}}:r));
    try{
      const res=await api({action:'check_proxy',id:item.id});
      const result=res.result;
      setRecords(prev=>prev.map(r=>{
        if(r.id!==item.id)return r;
        return {...r,data:{
          ...r.data,
          status:result?.ok?'active':'inactive',
          exitIp:result?.exitIp||r.data.exitIp||'',
          lastChecked:new Date().toISOString(),
          checkError:result?.ok
            ?(result?.telegramOk===false?(result?.error||''):'')
            :(result?.error||'Ошибка проверки'),
          telegramOk:result?.ok?result?.telegramOk!==false:false,
          protocol:result?.protocol||r.data.protocol,
          checkingAt:'',
        }};
      }));
      if(!opts?.silent){
        if(result?.ok){
          const tg=result.telegramOk===false?' · TG?' : ' · TG ok';
          const proto=result.protocol?` · ${String(result.protocol).toUpperCase()}`:'';
          toast.success(`Активен · IP ${result.exitIp||'—'}${tg}${proto} · ${result.latencyMs} мс`);
        }else toast.error(result?.error||'Прокси неактивен');
      }
      return result;
    }catch(e){
      setRecords(prev=>prev.map(r=>r.id===item.id?{...r,data:{...r.data,status:'inactive',telegramOk:false,checkingAt:'',checkError:(e as Error).message}}:r));
      if(!opts?.silent)toast.error((e as Error).message);
      return {ok:false,error:(e as Error).message};
    }finally{
      if(!opts?.silent){setBusy(false);await refresh()}
    }
  }

  async function checkProxies(mode:'all'|'inactive'){
    const targets=list('proxy').filter(r=>mode==='all'||r.data.status!=='active');
    if(!targets.length){toast.message(mode==='inactive'?'Нет неактивных прокси':'Нет прокси для проверки');return}
    setBusy(true);
    const total=Math.min(targets.length,100);
    const queue=targets.slice(0,100);
    let done=0,active=0,inactive=0;
    setProxyCheckProgress({done:0,total,active:0,inactive:0});
    setRecords(prev=>prev.map(r=>queue.some(t=>t.id===r.id)?{...r,data:{...r.data,status:'checking',checkError:''}}:r));

    const concurrency=8;
    try{
      for(let i=0;i<queue.length;i+=concurrency){
        const batch=queue.slice(i,i+concurrency);
        const results=await Promise.all(batch.map(item=>checkOneProxy(item,{silent:true})));
        for(const r of results){
          done++;
          if(r?.ok)active++;else inactive++;
        }
        setProxyCheckProgress({done,total,active,inactive});
      }
      await refresh();
      toast.success(`Массовая проверка: ${done}. Активных: ${active}, неактивных: ${inactive}`);
    }catch(e){
      toast.error((e as Error).message);
      await refresh();
    }finally{
      setBusy(false);
      setProxyCheckProgress(null);
    }
  }

  async function checkOneAccount(item:RecordItem,opts?:{silent?:boolean;deep?:boolean}){
    if(!opts?.silent)setBusy(true);
    setRecords(prev=>prev.map(r=>r.id===item.id?{...r,data:{...r.data,status:'checking',error:'',checkingAt:new Date().toISOString()}}:r));
    try{
      const res=await api({action:'check_account',id:item.id,deep:!!opts?.deep,rotateProxy:true});
      const result=res.result;
      setRecords(prev=>prev.map(r=>{
        if(r.id!==item.id)return r;
        return {...r,data:{
          ...r.data,
          status:result?.status||'disconnected',
          error:result?.error||'',
          checkingAt:'',
          cooldownUntil:result?.status==='cooldown'?(result?.cooldownUntil||r.data.cooldownUntil):(result?.status==='active'||result?.status==='unauthorized'?'':r.data.cooldownUntil),
          proxyId:result?.proxyRotated||r.data.proxyId,
          firstName:result?.profile?.firstName??r.data.firstName,
          lastName:result?.profile?.lastName??r.data.lastName,
          username:result?.profile?.username??r.data.username,
        }};
      }));
      if(!opts?.silent){
        const st=result?.status||'disconnected';
        const proxyNote=result?.proxyRotated?' · прокси сменён':'';
        if(st==='active')toast.success(`Активен · ${result?.profile?.username? '@'+result.profile.username : item.data.phone}${proxyNote}${result?.sessionRefreshed?' · сессия обновлена':''}`);
        else if(st==='cooldown')toast.message(`Отлёжка по лимиту / спамблоку${proxyNote}`);
        else if(st==='disconnected'||st==='proxy_error')toast.error(`Не удалось подключить${proxyNote}. Проверьте прокси и сессию.`);
        else if(st==='unauthorized')toast.error(`Сессия недействительна — загрузите свежий tdata/session${proxyNote}`);
        else toast.error((ACCOUNT_STATUS_LABELS[st as AccountStatus]||st)+(result?.error?`: ${String(result.error).slice(0,120)}`:'')+proxyNote);
      }
      return result;
    }catch(e){
      setRecords(prev=>prev.map(r=>r.id===item.id?{...r,data:{...r.data,status:'disconnected',error:(e as Error).message,checkingAt:''}}:r));
      if(!opts?.silent)toast.error((e as Error).message);
      return {ok:false,status:'disconnected',error:(e as Error).message};
    }finally{
      if(!opts?.silent){setBusy(false);await refresh()}
    }
  }

  async function resetStuckChecks(){
    try{
      const r=await api({action:'reset_checking_accounts'});
      await refresh();
      toast.message(r.fixed?`Сброшено проверок: ${r.fixed}`:'Нет залипших проверок');
    }catch(e){toast.error((e as Error).message)}
  }

  async function checkAccounts(mode:'all'|'problem'){
    const targets=list('account').filter(r=>mode==='all'||r.data.status!=='active');
    if(!targets.length){toast.message(mode==='problem'?'Нет проблемных аккаунтов':'Нет аккаунтов');return}
    if(!telegramConnected){toast.error(TELEGRAM_OFFLINE);return}
    const queue=targets.slice(0,40);
    let done=0,active=0,rotated=0,refreshed=0;
    setAccountCheckProgress({done:0,total:queue.length,active:0});
    setRecords(prev=>prev.map(r=>queue.some(t=>t.id===r.id)?{...r,data:{...r.data,status:'checking',error:'',checkingAt:new Date().toISOString()}}:r));
    const concurrency=3;
    try{
      for(let i=0;i<queue.length;i+=concurrency){
        const batch=queue.slice(i,i+concurrency);
        const results=await Promise.all(batch.map(item=>checkOneAccount(item,{silent:true,deep:false})));
        for(const r of results){
          done++;
          if(r?.status==='active')active++;
          if(r?.proxyRotated)rotated++;
          if(r?.sessionRefreshed)refreshed++;
        }
        setAccountCheckProgress({done,total:queue.length,active});
      }
      await refresh();
      const extra=[rotated?`смена прокси: ${rotated}`:'',refreshed?`сессия обновлена: ${refreshed}`:''].filter(Boolean).join(' · ');
      toast.success(`Проверено: ${done}. Активных: ${active}${extra?` · ${extra}`:''}`);
    }catch(e){
      toast.error((e as Error).message);
      try{await api({action:'reset_checking_accounts'})}catch{/* */}
      await refresh();
    }finally{
      setAccountCheckProgress(null);
    }
  }

  function fixGroupUrl(item:RecordItem){
    setModal({kind:'group',item});
    setForm({...defaults.group,...item.data,url:''});
    setSecret('');
    setClearSecret(false);
    setFormError('Вставьте реальную ссылку t.me/… или инвайт. После сохранения нажмите «Вступить» в строке группы.');
  }

  function openAccountPicker(mode:'single'|'row',groupId?:string){
    setAccountPickerQuery('');
    const usable=list('account').filter(a=>isAccountWorkable(a.data));
    if(mode==='single'){
      const cur=bulkAccountId&&usable.some(a=>a.id===bulkAccountId)?bulkAccountId:(usable[0]?.id||'');
      setAccountPickerDraft(cur?[cur]:[]);
    }else{
      const gid=groupId?String(list('group').find(g=>g.id===groupId)?.data.accountId||''):'';
      const ok=gid&&usable.some(a=>a.id===gid)?[gid]:[];
      setAccountPickerDraft(ok);
    }
    setAccountPicker({mode,groupId});
  }

  async function confirmAccountPicker(){
    if(!accountPicker)return;
    if(accountPicker.mode==='single'){
      const id=accountPickerDraft[0]||'';
      if(!id){toast.message('Выберите аккаунт');return}
      setBulkAccountId(id);
      setAccountPicker(null);
      if(groupSelected.length){
        // сразу предложить назначить выбранным
        toast.message(`Аккаунт выбран · нажмите «Назначить» для ${groupSelected.length} групп`);
      }
      return;
    }
    if(accountPicker.mode==='row'&&accountPicker.groupId){
      const id=accountPickerDraft[0]||'';
      setBusy(true);
      try{
        if(!id){
          const g=list('group').find(x=>x.id===accountPicker.groupId);
          if(g)await api({action:'save',kind:'group',id:g.id,data:cleanGroupSaveData({...g.data,accountId:''})});
        }else{
          await api({action:'assign_group_accounts',mode:'single',groupIds:[accountPicker.groupId],accountIds:[id]});
        }
        await refresh();
        setAccountPicker(null);
        toast.success('Аккаунт назначен');
      }catch(e){toast.error((e as Error).message)}
      finally{setBusy(false)}
    }
  }

  async function assignAccountToGroups(groupIds:string[],accountId:string){
    if(!groupIds.length){toast.message('Выберите группы');return}
    if(!accountId){toast.error('Выберите аккаунт');return}
    setBusy(true);
    try{
      const r=await api({action:'assign_group_accounts',mode:'single',groupIds,accountIds:[accountId]});
      await refresh();
      setGroupSelected([]);
      const skipped=Number(r.skipped)||0;
      if(!r.updated&&skipped){
        toast.message(`Уже вступившие (${skipped}) не трогали — аккаунт меняется только у групп без вступления`);
      }else{
        toast.success(`Назначен аккаунт на ${r.updated} групп${skipped?` · ${skipped} вступивших без изменений`:''}`);
      }
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  function toggleGroupSelected(id:string,on:boolean){
    setGroupSelected(prev=>on?([...new Set([...prev,id])]):prev.filter(x=>x!==id));
  }

  async function joinGroup(item:RecordItem){
    if(!item.data.accountId){toast.error('Назначьте аккаунт группе');return}
    if(isCatalogPlaceholderUrl(item.data.url||'')){
      toast.message('Нужна реальная ссылка группы');
      fixGroupUrl(item);
      return;
    }
    if(!telegramConnected){toast.error(TELEGRAM_OFFLINE);return}
    // Одна группа за клик, без очереди и ожиданий в браузере: отказ сервера (темп, дневной лимит) показываем как есть.
    if(joinLock.current){toast.message('Дождитесь окончания текущего вступления');return}
    joinLock.current=true;
    setJoinInFlight(true);
    const name=String(item.data.name||'Группа');
    try{
      await persistJoinState(item.id,'joining');
      const join=await api({action:'join_group',id:item.id});
      const joinKind=String(join.result?.join||'');
      if(!join.ok&&joinKind!=='already'&&joinKind!=='requested'){
        throw new Error(join.result?.error||join.error||'Не удалось вступить в группу');
      }
      if(joinKind==='requested'){
        await persistJoinState(item.id,'');
        toastOnboard(name,{joined:'requested',scanned:0,matched:0,added:0,aiUsed:false,title:''});
        return;
      }
      await persistJoinState(item.id,'scanning');
      try{
        const scan=await scanAfterJoin(item.id,name);
        toastOnboard(name,{
          joined:joinKind==='already'?'already':'joined',
          scanned:scan.scanned||0,
          matched:scan.matched??scan.added??0,
          added:scan.added||0,
          aiUsed:!!scan.aiUsed,
          title:scan.title||'',
          metrics:scan.metrics||null,
          addedByTemp:scan.addedByTemp||null,
        });
      }catch(scanErr){
        const scanData=(scanErr as Error & {data?:any}).data;
        if(scanData?.soft||scanData?.preserved)toast.message(`${name}: вступили, скан подхватит автообход`);
        else toast.error(`${name}: вступили, но скан не прошёл — ${String(scanData?.error||(scanErr as Error).message||'').slice(0,140)}`);
      }
      await persistJoinState(item.id,'');
    }catch(e){
      const msg=(e as Error).message;
      await persistJoinState(item.id,'',msg);
      toast.error(`${name}: ${msg}`);
    }finally{
      try{await refresh()}finally{
        joinLock.current=false;
        setJoinInFlight(false);
      }
    }
  }

  /** Вступить в обсуждение уже вступленного канала: тот же гейт темпа и дневного лимита на сервере. */
  async function joinDiscussion(item:RecordItem){
    if(!telegramConnected){toast.error(TELEGRAM_OFFLINE);return}
    if(joinLock.current){toast.message('Дождитесь окончания текущего вступления');return}
    joinLock.current=true;
    setJoinInFlight(true);
    const name=String(item.data.name||'Группа');
    try{
      const join=await api({action:'join_group',id:item.id,target:'discussion'});
      const joinKind=String(join.result?.join||'');
      if(!join.ok&&joinKind!=='already'){
        throw new Error(join.result?.error||join.error||'Не удалось вступить в обсуждение');
      }
      if(joinKind==='requested')toast.message(`${name}: заявка в обсуждение отправлена`);
      else toast.success(`${name}: ${joinKind==='already'?'уже в обсуждении':'вступили в обсуждение'} — следующий скан возьмёт комментарии`);
    }catch(e){
      toast.error(`${name}: ${(e as Error).message}`);
    }finally{
      try{await refresh()}finally{
        joinLock.current=false;
        setJoinInFlight(false);
      }
    }
  }

  async function scanGroup(item:RecordItem){
    if(!item.data.accountId){toast.error('Назначьте аккаунт группе');return}
    if(isCatalogPlaceholderUrl(item.data.url||'')){
      toast.message('Нужна реальная ссылка группы');
      fixGroupUrl(item);
      return;
    }
    if(!telegramConnected){toast.error(TELEGRAM_OFFLINE);return}
    setBusy(true);
    try{
      const res=await api({action:'scan_group',id:item.id});
      await refresh();
      if(res.skipped){
        toast.message(res.message||`Скан по настройкам: раз в ${settings?.data.autoRescanMinutes||30} мин`);
        return;
      }
      toast.success(
        `Скан: прочитано ${res.fetched??res.scanned??0}, AI оценил ${res.judged??0} → +${res.added??0} лидов${res.judgeError?` · ошибок AI ${res.judgeError}`:''}`,
      );
    }catch(e){
      const msg=(e as Error).message;
      if(/шаблон|реальн/i.test(msg))fixGroupUrl(item);
      toast.error(msg);
      await refresh();
    }finally{setBusy(false)}
  }

  function openCatalog(preferredMarket?:string){
    // Полная база / «В базе» — без сужения AI в «Маркетплейсы».
    const hasDb=list('group').length>0;
    const marketId=preferredMarket||(hasDb?'db':'all');
    setCatalogMarket(marketId);
    setCatalogNiche(null);
    setCatalogHideAdded(false);
    setCatalogTab('links');
    setCatalogQuery('');
    setCatalogSelected([]);
    setCatalogAccountId(list('account').filter(a=>isAccountWorkable(a.data))[0]?.id||'');
    setCatalogOpen(true);
    setCatalogSearching(true);
    setCatalogSearchTick(t=>t+1);
  }

  /** Одним запросом залить весь каталог в «Группы и каналы» текущего кабинета. */
  async function importFullCatalogToDb(){
    setBusy(true);
    try{
      const accountId=catalogAccountId||list('account').filter(a=>isAccountWorkable(a.data))[0]?.id||'';
      const r=await api({action:'import_catalog',accountId:accountId||undefined,projectId:activeProjectId||undefined});
      await refresh();
      const added=Number(r.added)||0;
      const skipped=Number(r.skipped)||0;
      toast.success(added?`В базу добавлено ${added} чатов`:`Уже в базе · ${skipped} чатов`);
      setCatalogOpen(false);
      navigate('Группы и каналы');
      setGroupFilter('all');
    }catch(e){toast.error((e as Error).message)}
    finally{setBusy(false)}
  }

  function openManualGroup(){
    navigate('Группы и каналы');
    open('group');
  }

  function openMassGroups(){
    navigate('Группы и каналы');
    setGroupImportText('');
    setFormError('');
    setGroupImportAccountId(bulkAccountId||list('account').filter(a=>isAccountWorkable(a.data))[0]?.id||'');
    setGroupImportOpen(true);
  }

  async function importGroupsMass(){
    const parsed=parseGroupUrlLines(groupImportText);
    if(!parsed.length){setFormError('Не нашёл ни одной ссылки t.me / @username');return}
    setBusy(true);
    setFormError('');
    try{
      const byUrl=new Map(list('group').map(r=>{
        const k=telegramEntityKey(r.data.url);
        return [k,r] as const;
      }).filter(([k])=>k));
      let added=0,skipped=0;
      for(const g of parsed){
        const key=telegramEntityKey(g.url);
        const existing=key?byUrl.get(key):undefined;
        if(existing){
          skipped++;
          continue;
        }
        try{
          const saved=await api({
            action:'save',
            kind:'group',
            projectId:activeProjectId||undefined,
            data:{
              name:g.name,
              url:canonicalizeTgUrl(g.url),
              accountId:groupImportAccountId,
              status:'setup',
              error:'',
              membership:'none',
              joinedAt:'',
              leadsTotal:0,leadsHot:0,leadsWarm:0,leadsCold:0,scanMatched:0,rating:0,lastScanned:'',
            },
          });
          if(saved.id){
            added++;
            if(key)byUrl.set(key,{id:saved.id,kind:'group',data:{name:g.name,url:g.url,accountId:groupImportAccountId},hasSecret:false,created:''} as RecordItem);
          }
        }catch(e){
          const err=e as Error & {status?:number};
          if(err.status===409){skipped++;continue}
          throw e;
        }
      }
      setGroupImportOpen(false);
      setGroupImportText('');
      await refresh();
      toast.success(`Добавлено ${added}${skipped?` · пропущено (уже есть) ${skipped}`:''}`);
    }catch(e){setFormError((e as Error).message)}
    finally{setBusy(false)}
  }

  function selectCatalogNiche(n:GroupNiche|null){
    setCatalogNiche(n);
    setCatalogSelected([]);
    setCatalogSearching(true);
    setCatalogSearchTick(t=>t+1);
  }

  function selectMarket(marketId:string){
    setCatalogMarket(marketId);
    setCatalogNiche(null);
    setCatalogSelected([]);
    setCatalogTab('links');
    setCatalogSearching(true);
    setCatalogSearchTick(t=>t+1);
  }

  /** Сохранить чаты каталога в «Группы и каналы» без вступления: вступают по кнопке «Вступить» в строке группы. */
  async function saveCatalogGroupsToDb(ids:string[]):Promise<{added:number;ready:number}|null>{
    const picks=GROUP_CATALOG.filter(g=>ids.includes(g.id));
    const ready=picks.filter(g=>g.verified&&g.url&&!isCatalogPlaceholderUrl(g.url));
    if(!ready.length){toast.message('Нет чатов со ссылкой');return null}
    setBusy(true);
    try{
      const byUrl=new Map(list('group').map(r=>{
        const k=telegramEntityKey(r.data.url);
        return [k,r as RecordItem] as const;
      }).filter(([k])=>k));
      let added=0;
      const accountId=catalogAccountId||'';
      for(const g of ready){
        const key=telegramEntityKey(g.url);
        const existing=key?byUrl.get(key):undefined;
        if(existing){
          if(accountId&&!existing.data.accountId){
            await api({action:'save',kind:'group',id:existing.id,data:cleanGroupSaveData({...existing.data,accountId})});
          }
          continue;
        }
        try{
          const saved=await api({action:'save',kind:'group',projectId:activeProjectId||undefined,data:cleanGroupSaveData({
            name:g.name,
            url:canonicalizeTgUrl(g.url),
            accountId,
            status:'setup',
            error:'',
            membership:'none',
            joinedAt:'',
            joinState:'',
            joinStateAt:'',
            joinStateError:'',
            leadsTotal:0,
            leadsHot:0,
            leadsWarm:0,
            leadsCold:0,
            scanMatched:0,
            rating:0,
            lastScanned:'',
          })});
          added++;
          if(saved.id&&key)byUrl.set(key,{id:saved.id,kind:'group',data:{name:g.name,url:g.url,accountId,status:'setup'},hasSecret:false,created:''});
        }catch(e){
          const err=e as Error & {status?:number};
          if(err.status===409)continue;
          throw e;
        }
      }
      setCatalogSelected(prev=>prev.filter(id=>!ids.includes(id)));
      await refresh();
      return {added,ready:ready.length};
    }catch(e){toast.error((e as Error).message);return null}
    finally{setBusy(false)}
  }

  async function addCatalogGroupsToDb(ids:string[]){
    const r=await saveCatalogGroupsToDb(ids);
    if(!r)return;
    toast.success(r.added?`В базу добавлено: ${r.added}`:`Уже в базе · показано ${r.ready}`);
    navigate('Группы и каналы');
    setCatalogOpen(false);
  }

  async function addCatalogGroupToDb(catalogId:string){
    const r=await saveCatalogGroupsToDb([catalogId]);
    if(!r)return;
    toast.success(r.added?'Чат в базе — «Вступить» в разделе «Группы и каналы»':'Этот чат уже в базе');
  }

  const currentKind=kinds[view];
  const displayed=records.filter(r=>{
    if(r.kind!==(currentKind||'lead'))return false;
    if(view==='Переписки'&&!isInConversations(r.data))return false;
    const leadTabs=currentKind==='lead'&&(view==='Лиды'||view==='Переписки');
    if(leadTabs){
      if(!leadVisibleInTab(r.data,filter))return false;
      if(view==='Лиды'&&!leadInScope(r))return false;
      if(view==='Лиды'&&leadGroupFilter!=='all'&&r.data.groupId!==leadGroupFilter)return false;
    }else if(filter!=='all'&&filter!=='viewed'&&filter!=='ignored'){
      if(currentKind==='lead'){
        if(filter==='hot'||filter==='warm'||filter==='cold'){
          if((r.data.temperature||'warm')!==filter)return false;
        }else if(r.data.status!==filter)return false;
      }else if(currentKind==='account'){
        const st=accountRowStatus(r.data);
        if(st!==filter)return false;
      }else if(r.data.status!==filter)return false;
    }
    return JSON.stringify(r.data).toLowerCase().includes(query.toLowerCase());
  });

  const listRows=useMemo(()=>{
    if(currentKind==='group'){
      return displayed.filter(r=>{
        if(groupFilter==='need')return groupNeedsJoin(r);
        if(groupFilter==='joined')return groupAlreadyIn(r);
        if(groupFilter==='pending')return r.data.status==='pending';
        if(groupFilter==='error')return r.data.status==='error';
        return true;
      });
    }
    if(view==='Переписки'){
      return [...displayed].sort((a,b)=>{
        const am=a.data.needsManager?1:0;
        const bm=b.data.needsManager?1:0;
        if(am!==bm)return bm-am;
        const at=Date.parse(String(a.data.conversationAt||a.created||''))||0;
        const bt=Date.parse(String(b.data.conversationAt||b.created||''))||0;
        return bt-at;
      });
    }
    return displayed;
  },[displayed,currentKind,groupFilter,view]);

  const listSortTypes=useMemo(():Record<string,SortValueType>=>{
    if(currentKind==='lead')return{name:'string',temperature:'status',status:'status',source:'string',created:'date'};
    if(currentKind==='group')return{name:'string',account:'string',status:'status',sync:'date'};
    if(currentKind==='account')return{name:'string',status:'status',cooldown:'date',updated:'date',proxy:'string'};
    if(currentKind==='proxy')return{name:'string',host:'string',protocol:'string',status:'status'};
    return{};
  },[currentKind]);

  const getListSortValue=useCallback((r:RecordItem,key:string)=>{
    if(currentKind==='lead'){
      if(key==='name')return r.data.name||'';
      if(key==='temperature')return LEAD_TEMPERATURE_LABELS[(r.data.temperature||'warm') as LeadTemperature]||r.data.temperature;
      if(key==='status')return r.data.excludeFromTraining?'Не для обучения':(r.data.status||'');
      if(key==='source')return r.data.source||'';
      if(key==='created')return r.created;
    }
    if(currentKind==='group'){
      if(key==='name')return r.data.name||'';
      if(key==='account')return records.find(x=>x.id===r.data.accountId)?.data.name||'';
      if(key==='status')return groupStatusLabel(r).label;
      if(key==='sync')return r.data.lastScanned||'';
    }
    if(currentKind==='account'){
      if(key==='name')return accountDisplayName(r.data);
      if(key==='phone')return r.data.phone||'';
      if(key==='proxy')return records.find(x=>x.id===r.data.proxyId)?.data.name||'';
      if(key==='status')return accountRowStatus(r.data);
      if(key==='cooldown'){
        const st=String(r.data.status||'');
        if(st==='cooldown'||st==='spamblock'){
          return isOnCooldown(r.data.cooldownUntil)?r.data.cooldownUntil:'';
        }
        return '';
      }
      if(key==='updated')return accountUpdatedAt(r.data,r.created);
    }
    if(currentKind==='proxy'){
      if(key==='name')return r.data.name||'';
      if(key==='host')return `${r.data.host||''}:${r.data.port||''}`;
      if(key==='protocol')return String(r.data.protocol||'').toUpperCase();
      if(key==='status')return r.data.status||'';
    }
    return'';
  },[currentKind,records]);

  const {sorted:sortedList,sortKey,sortDir,onSort}=useTableSort(listRows,getListSortValue,{
    types:listSortTypes,
    defaultKey:currentKind==='lead'?'created':currentKind==='account'?'updated':null,
    defaultDir:currentKind==='lead'||currentKind==='account'?'desc':'asc',
    resetKey:`${view}-${filter}-${groupFilter}-${leadGroupFilter}-${currentKind||''}`,
  });

  const change=(key:string,value:string)=>setForm((f:any)=>({...f,[key]:value}));
  const changeLimit=(key:'invite'|'message',value:string)=>setForm((f:any)=>({...f,limits:{...(f.limits||DEFAULT_ACCOUNT_LIMITS),[key]:value}}));
  const field=(key:string,label:string,type='text',placeholder='')=><label className="field">{label}<Input type={type} value={form[key]??''} placeholder={placeholder} onChange={e=>change(key,e.target.value)} required={!['username','source','firstName','lastName','about','projectUrl','audience'].includes(key)} maxLength={key==='phone'?16:key==='projectUrl'?500:250}/></label>;

  useEffect(()=>{
    if(!catalogOpen)return;
    setCatalogSearching(true);
    const handle=window.setTimeout(()=>{
      if(catalogMarket==='db'){
        const q=catalogQuery.trim().toLowerCase();
        const groups=list('group');
        const hits=groups
          .map(r=>{
            const url=String(r.data.url||'');
            const name=String(r.data.name||'Без названия');
            const hay=`${name} ${url}`.toLowerCase();
            const matched=!q||hay.includes(q);
            const joined=r.data.membership==='joined'||!!r.data.joinedAt;
            return {
              id:`db:${r.id}`,
              name,
              url,
              verified:!!url&&!isCatalogPlaceholderUrl(url),
              description:joined?'В кабинете · можно сканировать лиды':'В кабинете · нужно вступить',
              audience:String(r.data.source||'workspace'),
              niches:[] as GroupNiche[],
              searchHint:url||'Нет ссылки',
              score:joined?20:10,
              matched,
              overlap:0,
              recordId:r.id,
            };
          })
          .filter(h=>h.matched)
          .sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ru'));
        setCatalogHits(hits as any);
        setCatalogSearching(false);
        return;
      }
      const section=MARKET_SECTIONS.find(m=>m.id===catalogMarket);
      const niches=catalogNiche
        ?[catalogNiche]
        :(section?.niches?.length?section.niches:[]);
      const hits=searchGroupCatalog({
        query:catalogQuery,
        niches,
        mergeProject:false,
        onlyMatched:niches.length>0,
      });
      setCatalogHits(hits);
      setCatalogSearching(false);
    },220);
    return()=>window.clearTimeout(handle);
  },[catalogOpen,catalogQuery,catalogNiche,catalogMarket,catalogSearchTick,records]);

  const existingGroupUrlSet=new Set(list('group').map(r=>telegramEntityKey(r.data.url)).filter(Boolean));
  const catalogMarketNiches=MARKET_SECTIONS.find(m=>m.id===catalogMarket)?.niches||[];
  const catalogBaseHits=catalogHits.filter(h=>{
    if(catalogMarket==='db')return true;
    if(!catalogHideAdded)return true;
    if(!h.url)return true;
    return !existingGroupUrlSet.has(telegramEntityKey(h.url));
  });
  const catalogLinkHits=catalogBaseHits.filter(h=>h.verified&&h.url&&!isCatalogPlaceholderUrl(h.url));
  const catalogTopicHits=catalogBaseHits.filter(h=>!h.verified||!h.url||isCatalogPlaceholderUrl(h.url));
  const catalogVisibleHits=catalogTab==='links'?catalogLinkHits:catalogTopicHits;
  const catalogHiddenAdded=catalogHits.filter(h=>h.url&&existingGroupUrlSet.has(telegramEntityKey(h.url))).length;
  const catalogReadyCount=catalogLinkHits.length;
  const catalogActiveMarket=MARKET_SECTIONS.find(m=>m.id===catalogMarket);

  const EmptyLeads=()=> (
    <Empty className="empty-state border-0">
      <EmptyHeader>
        <div className="icon-box mx-auto mb-3"><Search size={22}/></div>
        <EmptyTitle>
          {view==='Переписки'
            ?(filter==='viewed'?'Пока нет просмотренных диалогов':'Нет новых диалогов')
            :'Пока нет подходящих запросов'}
        </EmptyTitle>
        <EmptyDescription>
          {view==='Переписки'
            ?(filter==='viewed'
              ?'Откройте диалог во вкладке «Новые» — он появится здесь.'
              :'Когда клиент ответит или появится черновик — диалог будет здесь. Открытие переносит в «Просмотренные».')
            :'Добавьте тематические группы или внесите первый лид вручную.'}
        </EmptyDescription>
      </EmptyHeader>
      {view!=='Переписки'&&(
        <Button variant="outline" onClick={()=>open('lead')}><Plus size={16}/>Добавить лид</Button>
      )}
    </Empty>
  );

  const renderLeads=(items:RecordItem[])=>{
    return items.length?(
    <>
      {/* Row checkboxes are gone: the header drops their 28px gutter so «Лид» lines up with the row names. */}
      <div className="leads-list-cols">
        <SortHeaderButton columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Лид</SortHeaderButton>
        <SortHeaderButton columnKey="temperature" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Темп.</SortHeaderButton>
        <SortHeaderButton columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Статус</SortHeaderButton>
        <SortHeaderButton columnKey="source" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Источник</SortHeaderButton>
        <SortHeaderButton columnKey="created" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="justify-self-end">Дата</SortHeaderButton>
      </div>
      {items.map(r=>(
    <div className={`lead-row ${r.data.excludeFromTraining?'ignored':''}`} key={r.id}>
      <button className="text-left flex-1 min-w-0" onClick={()=>openLead(r)}>
        <div className="flex gap-3 items-center flex-wrap">
          <span className="row-title">{r.data.name}</span>
          {tempBadge(r.data.temperature)}
          {statusBadge(r.data.status)}
          {r.data.needsManager&&<span className="badge warning">Клиент ответил</span>}
          {!r.data.needsManager&&r.data.conversationOpen&&<span className="badge success">Переписка</span>}
          {r.data.excludeFromTraining&&<span className="badge neutral">Не для обучения</span>}
          {r.data.feedback==='good'&&<span className="badge success">Отмечен: хороший</span>}
          {r.data.feedback==='bad'&&<span className="badge neutral">Отмечен: не лид</span>}
        </div>
        <p className="mt-2 text-[14px] leading-6 line-clamp-2 muted">
          {r.data.incomingLastText||r.data.message}
        </p>
        {r.data.incomingLastText&&r.data.message&&r.data.incomingLastText!==r.data.message&&(
          <p className="small-note mt-1 line-clamp-1">Исходный лид: {r.data.message}</p>
        )}
        {r.data.reason&&!r.data.incomingLastText&&<p className="small-note mt-1">AI: {r.data.reason}</p>}
        <p className="small-note mt-2">{r.data.source} · {new Date(r.data.conversationAt||r.created).toLocaleDateString('ru-RU')}</p>
      </button>
      <div className="flex flex-col gap-1 shrink-0">
        <Button variant="ghost" onClick={()=>openLead(r)}>Открыть<ChevronRight size={16}/></Button>
        <Button variant="ghost" size="sm" disabled={busy} aria-pressed={r.data.feedback==='good'} title="Добавить в примеры хороших лидов проекта" onClick={()=>void leadFeedback(r,'good')}>
          <ThumbsUp size={15}/>Хороший лид
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} aria-pressed={r.data.feedback==='bad'} title="Добавить в примеры «не лид» проекта" onClick={()=>void leadFeedback(r,'bad')}>
          <ThumbsDown size={15}/>Не лид
        </Button>
      </div>
    </div>
  ))}
    </>
  ):<EmptyLeads/>;
  };

  const shortErr=(msg:string)=>String(msg||'').replace(/\s+/g,' ').trim().slice(0,90);

  const renderConnectedGroups=(items:RecordItem[])=>{
    if(!items.length){
      return (
        <Empty className="border-0 py-10">
          <EmptyHeader>
            <EmptyTitle>В кабинете пока нет групп</EmptyTitle>
            <EmptyDescription>
              Залейте полный каталог ({catalogStats().uniqueUrls} чатов со ссылкой) — затем вступайте и собирайте лиды.
            </EmptyDescription>
          </EmptyHeader>
          <div className="flex flex-wrap gap-2 justify-center">
            <Button disabled={busy} onClick={()=>void importFullCatalogToDb()}>
              <Database size={16}/>Залить все в базу ({catalogStats().uniqueUrls})
            </Button>
            <Button variant="outline" onClick={()=>openCatalog('all')}><Search size={16}/>Открыть каталог</Button>
            <Button variant="outline" onClick={openManualGroup}><Plus size={16}/>Ссылка</Button>
          </div>
        </Empty>
      );
    }
    const joinActive=new Set(items.filter(r=>JOIN_ACTIVE_STATES.has(String(r.data.joinState||''))).map(r=>r.id));
    const allSelected=items.length>0&&items.every(r=>groupSelected.includes(r.id));
    return (
      <div className="groups-list">
        <div className="groups-list-cols">
          <label className="groups-check">
            <Checkbox checked={allSelected} onCheckedChange={v=>setGroupSelected(v===true?items.map(r=>r.id):[])} aria-label="Выбрать все"/>
          </label>
          <SortHeaderButton columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Группа</SortHeaderButton>
          <SortHeaderButton columnKey="account" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Аккаунт</SortHeaderButton>
          <SortHeaderButton columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Статус</SortHeaderButton>
          <SortHeaderButton columnKey="sync" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Синк</SortHeaderButton>
          <span className="text-right">Действие</span>
        </div>
        {items.map(r=>{
          const st=groupStatusLabel(r);
          const accountName=records.find(x=>x.id===r.data.accountId)?.data.name||'';
          const inFlight=joinActive.has(r.id);
          const canJoin=groupNeedsJoin(r)&&!inFlight;
          const joined=r.data.membership==='joined'||!!r.data.joinedAt;
          const syncAt=formatGroupSyncAt(String(r.data.lastScanned||''));
          const err=r.data.status==='error'?shortErr(r.data.error||r.data.joinStateError||''):'';
          return (
            <div className={`groups-row ${inFlight?'is-queue':''} ${groupSelected.includes(r.id)?'is-selected':''}`} key={r.id}>
              <label className="groups-check">
                <Checkbox checked={groupSelected.includes(r.id)} onCheckedChange={v=>toggleGroupSelected(r.id,v===true)} aria-label={`Выбрать ${r.data.name}`}/>
              </label>
              <div className="groups-main min-w-0">
                <div className="groups-name">{r.data.name||'Без названия'}</div>
                <div className="groups-meta">
                  <span className="truncate">{r.data.url||'Нет ссылки'}</span>
                  {(r.data.leadsTotal||0)>0&&(
                    <span className="groups-leads" title={`Горячие ${r.data.leadsHot||0} · тёплые ${r.data.leadsWarm||0}`}>
                      · лиды {r.data.leadsTotal}
                    </span>
                  )}
                </div>
                {err&&<div className="groups-err" title={r.data.error||r.data.joinStateError}>{err}{(r.data.error||r.data.joinStateError||'').length>90?'…':''}</div>}
              </div>
              <button type="button" className="groups-acc" disabled={busy} onClick={()=>openAccountPicker('row',r.id)} title={accountName||'Назначить аккаунт'}>
                <span className="truncate">{accountName||'Назначить'}</span>
                <ChevronRight size={14}/>
              </button>
              <div className="groups-status">
                <span className={`badge ${st.tone==='neutral'?'':st.tone}`}>{st.label}</span>
              </div>
              <div className="groups-sync" title={syncAt?`Последний скан ${syncAt}`:'Ещё не синхронизировали'}>
                <span className="groups-sync-label">Синк</span>
                {syncAt||'—'}
              </div>
              <div className="groups-actions">
                {canJoin&&(
                  <Button size="sm" disabled={busy||joinInFlight||!telegramConnected||!r.data.accountId} onClick={()=>joinGroup(r)}>
                    <Plug size={14}/>Вступить
                  </Button>
                )}
                {r.data.status==='pending'&&(
                  <Button size="sm" variant="outline" disabled={busy||!telegramConnected} onClick={()=>scanGroup(r)}>Проверить</Button>
                )}
                {r.data.needDiscussionJoin&&joined&&!canJoin&&(
                  <Button size="sm" disabled={busy||joinInFlight||!telegramConnected||!r.data.accountId} onClick={()=>joinDiscussion(r)} aria-label="Вступить в обсуждение" title="Вступить в обсуждение">
                    <Plug size={14}/>Обсуждение
                  </Button>
                )}
                {joined&&!canJoin&&r.data.status!=='pending'&&(
                  <Button size="sm" variant="outline" disabled={busy||!telegramConnected} onClick={()=>scanGroup(r)}>
                    <Search size={14}/>Скан
                  </Button>
                )}
                <div className="groups-tools">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="История переобхода"
                    aria-label="История переобхода"
                    onClick={()=>setTaskLog({
                      title:r.data.name||'Группа',
                      log:Array.isArray(r.data.scanLog)&&r.data.scanLog.length
                        ?r.data.scanLog
                        :[{at:r.data.lastScanned||new Date().toISOString(),level:'info',text:r.data.lastScanned?'Последний скан зафиксирован, детальный журнал появится после следующего переобхода':'Переобходов ещё не было'}],
                    })}
                  >
                    <ScrollText size={14}/>
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={()=>open('group',r)} aria-label="Изменить"><Pencil size={14}/></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={()=>setDeleting(r)} aria-label="Удалить"><Trash2 size={14}/></Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const allLeads=list('lead').filter(r=>!r.data.excludeFromTraining);
  const groupsAll=list('group');
  const groupsJoined=groupsAll.filter(g=>g.data.membership==='joined'||!!g.data.joinedAt);
  const groupsNeedJoin=groupsAll.filter(groupNeedsJoin);
  const accountsAll=list('account');
  const accountsActive=accountsAll.filter(a=>isAccountWorkable(a.data));
  const accountsUsableOpts=accountsActive.map(r=>({id:r.id,name:r.data.name,data:r.data}));
  const proxiesAll=list('proxy');
  const proxiesActive=proxiesAll.filter(p=>p.data.status==='active');
  const hotN=allLeads.filter(r=>r.data.temperature==='hot'&&!r.data.viewed).length;
  const warmN=allLeads.filter(r=>r.data.temperature==='warm'&&!r.data.viewed).length;
  const coldN=allLeads.filter(r=>r.data.temperature==='cold'&&!r.data.viewed).length;
  const leadCountByGroup=new Map<string,number>();
  const freshByGroup=new Map<string,number>();
  const hotByGroup=new Map<string,number>();
  for(const r of allLeads){
    const gid=String(r.data.groupId||'');
    if(!gid)continue;
    leadCountByGroup.set(gid,(leadCountByGroup.get(gid)||0)+1);
    if(!r.data.viewed)freshByGroup.set(gid,(freshByGroup.get(gid)||0)+1);
    if(r.data.temperature==='hot'&&!r.data.viewed)hotByGroup.set(gid,(hotByGroup.get(gid)||0)+1);
  }
  const overviewChats=groupsAll.map(g=>({
    id:g.id,
    name:String(g.data.name||'Без названия'),
    leads:leadCountByGroup.get(g.id)||Number(g.data.leadsTotal||0)||0,
    fresh:freshByGroup.get(g.id)||0,
    hot:hotByGroup.get(g.id)||0,
    joined:g.data.membership==='joined'||!!g.data.joinedAt,
    pending:g.data.membership==='pending'||g.data.status==='pending',
    queue:JOIN_ACTIVE_STATES.has(String(g.data.joinState||'')),
    lastScanned:String(g.data.lastScanned||''),
  }));
  const overviewLeads=allLeads.map(r=>{
    const t=r.data.temperature;
    const temperature=(t==='hot'||t==='warm'||t==='cold'?t:'warm') as 'hot'|'warm'|'cold';
    return {
      id:r.id,
      created:r.created,
      name:String(r.data.name||''),
      message:String(r.data.message||''),
      source:String(r.data.source||''),
      temperature,
      status:String(r.data.status||'new'),
      viewed:!!r.data.viewed,
      groupId:String(r.data.groupId||''),
      draft:isInConversations(r.data),
    };
  });

  return (
    <SidebarProvider className="spike-shell" style={{'--sidebar-width':'270px'} as React.CSSProperties}>
      <Toaster position="bottom-right" richColors/>
      <Sidebar>
        <SidebarHeader className="p-5">
          <div className="spike-brand">
            <div className="spike-brand-mark">U</div>
            <div className="spike-brand-text">
              <strong>UniLab</strong>
              <span>Тёплые заявки</span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <WorkspaceNav view={view} onNavigate={navigate} badges={navBadges} allowed={allowedNav}/>
        </SidebarContent>
        <SidebarFooter>
          <div className="sidebar-help">
            <Plug size={18}/>
            <p>{telegramConnected?'Telegram подключён':'Telegram ещё не подключён'}</p>
            <button onClick={()=>navigate('Аккаунты')}>Настроить аккаунты <ArrowRight size={13}/></button>
          </div>
          <div className="foot-account">
            <span className="workspace-avatar">UL</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{meInfo?.name||'Пользователь'}</p>
              <p className="small-note">{workspaceMeta&&!workspaceMeta.isOwner?'Сотрудник кабинета':(meInfo?.email||'UniLab')}</p>
            </div>
            <a className="text-link" href="/api/auth/logout?return_to=%2F" title="Выйти" aria-label="Выйти"><LogOut size={16}/></a>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="topbar">
          <div className="flex items-center gap-3 text-sm">
            <SidebarTrigger/>
            <span className="muted hidden sm:inline">UniLab</span>
            <ChevronRight size={14} className="text-[var(--spike-muted)]"/>
            <span className="font-semibold">{view}</span>
          </div>
          <div className="topbar-actions">
            <NotificationsBell
              onOpenAll={()=>navigate('Уведомления')}
              onOpenItem={(next)=>{if(next)navigate(next)}}
            />
            <a className="text-link flex items-center gap-2" href="/" target="_blank" rel="noreferrer">
              О сервисе<ExternalLink size={13}/>
            </a>
          </div>
        </header>

        <div className="workspace" key={view}>
          <div className="page-heading">
            <div>
              <div className="eyebrow">Telegram · UniLab</div>
              <h1>{view==='Обзор'?'Обзор':view==='Аккаунты'?'Менеджер аккаунтов':view}</h1>
              <p className="muted mt-2">{viewCopy[view]}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              {view==='Обзор'?(
                <Button onClick={()=>{navigate('Группы и каналы');openCatalog()}}><Search size={16}/>Поиск по темам</Button>
              ):view==='Группы и каналы'?(
                <>
                  <Button variant="outline" onClick={openManualGroup}><Plus size={16}/>Добавить группу</Button>
                  <Button variant="outline" onClick={openMassGroups}><Upload size={16}/>Добавить массово</Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={()=>void importFullCatalogToDb()}
                  >Залить каталог ({catalogStats().uniqueUrls})</Button>
                  <Button onClick={()=>openCatalog()}><Search size={16}/>Поиск по темам</Button>
                </>
              ):view==='Настройки'||view==='Уведомления'||view==='Сотрудники'||view==='AI-ассистент'?null:(
                <Button onClick={()=>open(currentKind||'group',currentKind==='settings'?settings:undefined)}>
                  {currentKind==='settings'?<><Plus size={16}/>Настроить AI</>:currentKind==='account'?<><Plus size={16}/>Добавить аккаунты</>:<><Plus size={16}/>Добавить {labels[currentKind||'group']}</>}
                </Button>
              )}
            </div>
          </div>

          {error&&!(view==='AI-ассистент'&&!records.length)&&(
            <div role="alert" className="error-banner">
              {error}
              <Button variant="ghost" onClick={refresh}>Повторить</Button>
              {error.includes('Войдите')&&<a href="/login?return_to=%2F" target="_top" className="text-link">Войти</a>}
            </div>
          )}

          {view==='Уведомления'&&(
            <NotificationsPanel onOpenItem={(next)=>{if(next)navigate(next)}}/>
          )}

          {view==='Обзор'&&(
            <OverviewDashboard
              loading={loading}
              telegramConnected={telegramConnected}
              leads={overviewLeads}
              chats={overviewChats}
              freshCount={freshLeads.length}
              hotCount={hotN}
              warmCount={warmN}
              coldCount={coldN}
              draftCount={chatLeads.length}
              joinedChats={groupsJoined.length}
              needJoin={groupsNeedJoin.length}
              farm={{
                accountsActive:accountsActive.length,
                accountsTotal:accountsAll.length,
                proxiesActive:proxiesActive.length,
                proxiesTotal:proxiesAll.length,
              }}
              onRefresh={()=>{void refresh()}}
              onGoLeads={goLeads}
              onGoChats={goChats}
              onGoAccounts={()=>navigate('Аккаунты')}
              onGoProxies={()=>navigate('Прокси')}
              onOpenLead={(id)=>{const item=records.find(r=>r.id===id);if(item)void openLead(item)}}
              onSearchTopics={()=>{goChats();openCatalog()}}
              onOpenDrafts={()=>navigate('Переписки')}
            />
          )}

          {view==='Сотрудники'&&(
            workspaceMeta&&!workspaceMeta.isOwner?(
              <div className="empty-panel">
                <p className="font-semibold">Нет доступа</p>
                <p className="small-note mt-1">Сотрудниками управляет только владелец кабинета.</p>
              </div>
           ):(
              <EmployeesPanel
                members={staffMembers}
                invites={staffInvites}
                busy={busy}
                onCreateInvite={async(input)=>{
                  setBusy(true);
                  try{
                    const r=await fetch('/api/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create_invite',...input})});
                    const data=(await r.json()) as StaffActionResponse;
                    if(!r.ok)throw new Error(data.error||'Не удалось создать приглашение');
                    await refreshStaff();
                    toast.success('Ссылка-приглашение создана');
                    return data.url as string;
                  }catch(e){toast.error((e as Error).message);return null}
                  finally{setBusy(false)}
                }}
                onRevokeInvite={(id)=>{void (async()=>{
                  setBusy(true);
                  try{
                    const r=await fetch('/api/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'revoke_invite',id})});
                    const data=(await r.json()) as StaffActionResponse;
                    if(!r.ok)throw new Error(data.error||'Не удалось отозвать');
                    await refreshStaff();
                    toast.success('Приглашение отозвано');
                  }catch(e){toast.error((e as Error).message)}
                  finally{setBusy(false)}
                })()}}
                onRevokeInvites={(ids)=>{void (async()=>{
                  setBusy(true);
                  try{
                    const r=await fetch('/api/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'revoke_invites',ids})});
                    const data=(await r.json()) as StaffActionResponse;
                    if(!r.ok)throw new Error(data.error||'Не удалось отозвать');
                    await refreshStaff();
                    toast.success(`Отозвано: ${data.removed||ids.length}`);
                  }catch(e){toast.error((e as Error).message)}
                  finally{setBusy(false)}
                })()}}
                onUpdateMember={(input)=>{void (async()=>{
                  setBusy(true);
                  try{
                    const r=await fetch('/api/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_member',...input})});
                    const data=(await r.json()) as StaffActionResponse;
                    if(!r.ok)throw new Error(data.error||'Не удалось сохранить');
                    await refreshStaff();
                    toast.success('Доступы обновлены');
                  }catch(e){toast.error((e as Error).message)}
                  finally{setBusy(false)}
                })()}}
                onRemoveMember={(id)=>{void (async()=>{
                  setBusy(true);
                  try{
                    const r=await fetch('/api/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove_member',id})});
                    const data=(await r.json()) as StaffActionResponse;
                    if(!r.ok)throw new Error(data.error||'Не удалось удалить');
                    await refreshStaff();
                    toast.success('Сотрудник удалён');
                  }catch(e){toast.error((e as Error).message)}
                  finally{setBusy(false)}
                })()}}
                onRemoveMembers={(ids)=>{void (async()=>{
                  setBusy(true);
                  try{
                    const r=await fetch('/api/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove_members',ids})});
                    const data=(await r.json()) as StaffActionResponse;
                    if(!r.ok)throw new Error(data.error||'Не удалось удалить');
                    await refreshStaff();
                    toast.success(`Удалено: ${data.removed||ids.length}`);
                  }catch(e){toast.error((e as Error).message)}
                  finally{setBusy(false)}
                })()}}
                onClearAll={()=>{void (async()=>{
                  setBusy(true);
                  try{
                    const r=await fetch('/api/staff',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'clear_all'})});
                    const data=(await r.json()) as StaffActionResponse;
                    if(!r.ok)throw new Error(data.error||'Не удалось очистить');
                    await refreshStaff();
                    toast.success(`Удалено сотрудников: ${data.members||0}, приглашений: ${data.invites||0}`);
                  }catch(e){toast.error((e as Error).message)}
                  finally{setBusy(false)}
                })()}}
              />
            )
          )}

          {view!=='Обзор'&&view!=='Уведомления'&&view!=='AI-ассистент'&&view!=='Настройки'&&view!=='Сотрудники'&&<>
            <div className="toolbar">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-2.5 text-[var(--spike-muted)]" size={16}/>
                <Input className="pl-9" placeholder="Поиск по списку…" aria-label="Поиск по списку" value={query} onChange={e=>setQuery(e.target.value)}/>
              </div>
              {view==='Переписки'?(
                <div className="flex flex-wrap items-center gap-3">
                  <Tabs value={filter==='viewed'?'viewed':'all'} onValueChange={(v)=>setFilter(v)}>
                    <TabsList>
                      <TabsTrigger value="all">Новые{freshChats.length?` (${freshChats.length})`:''}</TabsTrigger>
                      <TabsTrigger value="viewed">Просмотренные{viewedChats.length?` (${viewedChats.length})`:''}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <span className="badge neutral">{chatLeads.length} {pluralRu(chatLeads.length,'диалог','диалога','диалогов')}</span>
                </div>
              ):currentKind==='lead'?(
                <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                  <Button
                    disabled={busy||!telegramConnected||autoRescanRunning}
                    onClick={async()=>{
                      setBusy(true);
                      setAutoRescanRunning(true);
                      try{
                        const r=await rescanAllGroups({force:true,limit:40});
                        try{await api({action:'mark_auto_rescan'})}catch{/* */}
                        toast.success(`Собрано: ${r.scanned} групп, +${r.added} лидов`);
                        await refresh();
                      }catch(e){toast.error((e as Error).message)}
                      finally{setBusy(false);setAutoRescanRunning(false)}
                    }}
                  >
                    <RefreshCw size={15} className={autoRescanRunning?'animate-spin':''}/>
                    {autoRescanRunning?'Сбор…':'Собрать лиды'}
                  </Button>
                  {projects.length>0&&(
                    <Select
                      value={leadProjectScope==='all'?'all':activeProjectId}
                      onValueChange={v=>{
                        setLeadGroupFilter('all');
                        if(v==='all'){setLeadProjectScope('all');return}
                        setLeadProjectScope('active');
                        setActiveProjectId(v);
                      }}
                    >
                      <SelectTrigger className="w-[220px] max-w-full" aria-label="Проект"><SelectValue placeholder="Проект"/></SelectTrigger>
                      <SelectContent>
                        {projects.map(p=>(
                          <SelectItem key={p.id} value={p.id}>{p.data.name}</SelectItem>
                        ))}
                        <SelectItem value="all">Все проекты</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={leadGroupFilter} onValueChange={setLeadGroupFilter}>
                    <SelectTrigger className="w-[220px] max-w-full" aria-label="Группа"><SelectValue placeholder="Группа"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все группы</SelectItem>
                      {list('group').filter(g=>leadProjectScope==='all'||!projects.length||projectIdOf(g.data,projects)===activeProjectId).map(g=>(
                        <SelectItem key={g.id} value={g.id}>{g.data.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Tabs className="min-w-0 max-w-full overflow-x-auto" value={filter} onValueChange={(v)=>setFilter(v)}>
                    <TabsList>
                      <TabsTrigger value="all">Все</TabsTrigger>
                      <TabsTrigger value="hot">Горячие</TabsTrigger>
                      <TabsTrigger value="warm">Тёплые</TabsTrigger>
                      <TabsTrigger value="cold">Холодные</TabsTrigger>
                      <TabsTrigger value="new">Новые</TabsTrigger>
                      <TabsTrigger value="working">В работе</TabsTrigger>
                      <TabsTrigger value="viewed">Просмотренные{viewedLeads.length?` (${viewedLeads.length})`:''}</TabsTrigger>
                      <TabsTrigger value="ignored">Игнор{excludedLeads.length?` (${excludedLeads.length})`:''}</TabsTrigger>
                      <TabsTrigger value="archived">Архив</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              ):currentKind==='proxy'?(
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={busy||!list('proxy').length} onClick={()=>checkProxies('all')}><Plug size={15}/>Проверить все</Button>
                  <Button variant="outline" disabled={busy||!list('proxy').some(r=>r.data.status!=='active')} onClick={()=>checkProxies('inactive')}><RefreshCw size={15}/>Перезапуск неактивных</Button>
                  <Button variant="outline" onClick={()=>{setImportOpen(true);setFormError('');setImportProtocol('socks5')}}><Upload size={15}/>Импорт списком</Button>
                </div>
              ):currentKind==='account'?(
                <>
                  <Tabs value={filter} onValueChange={(v)=>{setFilter(v);setAccountSelected([])}}>
                    <TabsList>
                      <TabsTrigger value="all">Все</TabsTrigger>
                      <TabsTrigger value="active">Активные</TabsTrigger>
                      <TabsTrigger value="spamblock">Спамблок</TabsTrigger>
                      <TabsTrigger value="frozen">Заморозка</TabsTrigger>
                      <TabsTrigger value="unauthorized">Не авторизован</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Button variant="outline" disabled={!!accountCheckProgress||!list('account').length} onClick={()=>checkAccounts('all')}><Plug size={15}/>Проверить все</Button>
                  <Button variant="outline" disabled={!!accountCheckProgress||!list('account').some(r=>r.data.status!=='active')} onClick={()=>checkAccounts('problem')}><RefreshCw size={15}/>Перепроверить проблемные</Button>
                  {list('account').some(r=>r.data.status==='checking')&&(
                    <Button variant="outline" onClick={()=>void resetStuckChecks()}><X size={15}/>Сбросить проверку</Button>
                  )}
                  <Button variant="outline" disabled={busy} onClick={async()=>{setFarmProfileOpen(true);if(!farmAbout)await generateFarmProfile()}}><UserRound size={15}/>Профили фермы</Button>
                  <Button variant="outline" onClick={()=>{setFarmLogoOpen(true);setFarmLogoFile(null);setFarmLogoPreview('')}}><ImagePlus size={15}/>Логотип фермы</Button>
                  <Button variant="outline" onClick={()=>{setAccountImportOpen(true);setFormError('');setAccountImportFiles([]);setAccountImportNames([]);setAccountImportProxyId('');setAccountImportSessionMode('keep');setAccountImportMixProxy(true)}}><Upload size={15}/>Импорт ZIP/RAR</Button>
                </>
              ):currentKind==='group'?(
                <div className="flex flex-wrap gap-2 items-center">
                  <span className={`badge ${telegramConnected?'success':'warning'}`}>
                    {telegramConnected?'Воркер онлайн':'Воркер офлайн'}
                  </span>
                </div>
              ):(
                <span className="badge neutral">{displayed.length} записей</span>
              )}
            </div>
            {currentKind!=='lead'&&currentKind!=='group'&&(
              <div className="status-note">
                {currentKind==='account'
                  ? `Ферма: описание и логотип → ко всем или выбранным. Воркер: ${telegramConnected?'онлайн':'выключен'}. Проверка по 3 параллельно; при сбое — авто смена сессии/прокси.`
                  : currentKind==='proxy'
                    ? 'Массовая проверка: до 100 прокси, по 8 параллельно (~5–8 с на штуку). Неактивные можно перезапустить.'
                    : 'Источники сообщений.'}
              </div>
            )}
            {currentKind==='lead'&&(
              <div className="status-note">
                Автообход каждые {settings?.data.autoRescanMinutes||30} мин
                {settings?.data.lastAutoRescanAt?` · последний ${new Date(settings.data.lastAutoRescanAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:''}
                {autoRescanRunning?' · идёт…':''}
              </div>
            )}
            {accountCheckProgress&&currentKind==='account'&&(
              <div className="status-note" role="status">
                Аккаунты {accountCheckProgress.done} / {accountCheckProgress.total} · активных {accountCheckProgress.active}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--spike-border)]">
                  <div className="h-full rounded-full bg-[var(--spike-primary)] transition-all" style={{width:`${accountCheckProgress.total?Math.round(accountCheckProgress.done/accountCheckProgress.total*100):0}%`}}/>
                </div>
              </div>
            )}
            {proxyCheckProgress&&currentKind==='proxy'&&(
              <div className="status-note" role="status">
                Проверка {proxyCheckProgress.done} / {proxyCheckProgress.total}
                {' · '}активных {proxyCheckProgress.active}
                {' · '}неактивных {proxyCheckProgress.inactive}
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--spike-border)]">
                  <div
                    className="h-full rounded-full bg-[var(--spike-primary)] transition-all"
                    style={{width:`${proxyCheckProgress.total?Math.round(proxyCheckProgress.done/proxyCheckProgress.total*100):0}%`}}
                  />
                </div>
              </div>
            )}
            <section className={currentKind==='group'?'':'panel table-panel'}>
              {loading?(
                <div className="p-6 space-y-4 panel"><Skeleton className="h-12 w-full"/><Skeleton className="h-12 w-full"/></div>
              ):currentKind==='lead'?(
                <div className="panel table-panel">{renderLeads(sortedList)}</div>
              ):currentKind==='group'?(
                <div className="groups-page">
                  <div className="groups-top">
                    <div className="groups-top-actions">
                      <Button onClick={()=>openCatalog()} disabled={busy}><Search size={15}/>Найти темы</Button>
                      <Button variant="outline" onClick={openManualGroup}><Plus size={15}/>Ссылка</Button>
                      <Button variant="outline" onClick={openMassGroups} disabled={busy}><Upload size={15}/>Массово</Button>
                      <Button
                        variant="outline"
                        disabled={busy||!telegramConnected||autoRescanRunning}
                        onClick={async()=>{
                          setBusy(true);
                          try{
                            const r=await rescanAllGroups({force:true,limit:15});
                            toast.success(`Переобход: ${r.scanned} групп, +${r.added} лидов`);
                            await refresh();
                          }catch(e){toast.error((e as Error).message)}
                          finally{setBusy(false)}
                        }}
                      >
                        <RefreshCw size={15} className={autoRescanRunning?'animate-spin':''}/>
                        {autoRescanRunning?'Обход…':'Переобход'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={()=>{
                          const globalLog=Array.isArray(settings?.data?.rescanLog)?settings.data.rescanLog:[];
                          const fromGroups=list('group')
                            .flatMap(g=>(Array.isArray(g.data.scanLog)?g.data.scanLog:[]).map((e:any)=>({
                              ...e,
                              text:`${g.data.name||'Группа'}: ${e.text}`,
                            })));
                          const merged=[...globalLog,...fromGroups]
                            .filter(e=>e&&e.at)
                            .sort((a,b)=>String(b.at).localeCompare(String(a.at)))
                            .slice(0,120);
                          setTaskLog({
                            title:'Переобход групп',
                            log:merged.length?merged:[{
                              at:settings?.data?.lastAutoRescanAt||new Date().toISOString(),
                              level:'info',
                              text:settings?.data?.lastAutoRescanAt
                                ?`Последний автообход ${new Date(settings.data.lastAutoRescanAt).toLocaleString('ru-RU')} · детальный журнал появится после следующих сканов`
                                :'Журнал пуст — запустите «Переобход» или дождитесь автообхода',
                            }],
                          });
                        }}
                      >
                        <History size={15}/>История
                      </Button>
                    </div>
                    <p className="groups-hint">
                      Назначьте аккаунт → «Вступить» в строке группы. Одна группа за раз, пауза одного аккаунта ~{Math.round(JOIN_GAP_DEFAULT_SEC/60)} мин.
                      {settings?.data?.lastAutoRescanAt?` · автообход ${new Date(settings.data.lastAutoRescanAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:''}
                      {autoRescanRunning?' · идёт сейчас…':''}
                    </p>
                  </div>

                  <div className="groups-filters">
                    {([
                      ['all',`Все ${list('group').length}`],
                      ['need',`Ждут ${list('group').filter(groupNeedsJoin).length}`],
                      ['joined',`Вступили ${list('group').filter(groupAlreadyIn).length}`],
                      ['pending',`Заявки ${list('group').filter(g=>g.data.status==='pending').length}`],
                      ['error',`Ошибки ${list('group').filter(g=>g.data.status==='error').length}`],
                    ] as const).map(([id,label])=>(
                      <button
                        key={id}
                        type="button"
                        className={`groups-filter ${groupFilter===id?'on':''}`}
                        onClick={()=>{setGroupFilter(id);setGroupSelected([])}}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className={`groups-actionbar ${groupSelected.length?'has-sel':''}`}>
                    <div className="groups-actionbar-left">
                      {groupSelected.length?(
                        <>
                          <strong>Выбрано {groupSelected.length}</strong>
                          <Button size="sm" variant="outline" onClick={()=>setGroupSelected(sortedList.map(r=>r.id))}>Выбрать все</Button>
                          <Button size="sm" variant="ghost" onClick={()=>setGroupSelected([])}>Снять</Button>
                        </>
                      ):(
                        <>
                          <span className="muted text-sm">Отметьте группы, чтобы назначить им аккаунт</span>
                          {sortedList.length>0&&(
                            <Button size="sm" variant="outline" onClick={()=>setGroupSelected(sortedList.map(r=>r.id))}>
                              Выбрать все ({sortedList.length})
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="groups-actionbar-right">
                      <Button size="sm" variant="outline" disabled={busy||!accountsActive.length} onClick={()=>openAccountPicker('single')}>
                        <Users size={14}/>
                        {accountsActive.find(a=>a.id===bulkAccountId)?.data.name
                          ? String(accountsActive.find(a=>a.id===bulkAccountId)?.data.name).slice(0,22)
                          : 'Аккаунт'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy||!bulkAccountId||!groupSelected.length}
                        onClick={()=>void assignAccountToGroups(groupSelected,bulkAccountId)}
                      >
                        Назначить
                      </Button>
                    </div>
                  </div>

                  <section className="panel groups-list-panel">
                    {renderConnectedGroups(sortedList)}
                  </section>
                </div>
              ):displayed.length?(
                <>
                {currentKind==='account'&&accountSelected.length>0&&(
                  <div className="lead-bulk-bar mb-3">
                    <span>Выбрано аккаунтов: <strong>{accountSelected.length}</strong></span>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={()=>setBulkCooldownOpen(true)}>
                        <Timer size={14}/>Отлежка
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={()=>{setBulkProxyMix(false);setBulkProxyId(list('proxy').filter(p=>p.data.status==='active')[0]?.id||'');setBulkProxyOpen(true)}}>
                        <Network size={14}/>Прокси
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={openBulkLimitsDialog} title="Свои лимиты или рекомендации TG">
                        <Gauge size={14}/>Лимиты
                      </Button>
                      <Button size="sm" disabled={busy} onClick={async()=>{setFarmProfileOpen(true);if(!farmAbout)await generateFarmProfile()}}><UserRound size={14}/>Профили</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={()=>setFarmLogoOpen(true)}><ImagePlus size={14}/>Логотип</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={()=>setBulkDeleteOpen(true)} className="text-[var(--spike-danger,#fb977d)]">
                        <Trash2 size={14}/>Удалить
                      </Button>
                      <Button size="sm" variant="outline" onClick={()=>setAccountSelected(sortedList.map(r=>r.id))}>Выбрать все</Button>
                      <Button size="sm" variant="ghost" onClick={()=>setAccountSelected([])}>Снять</Button>
                    </div>
                  </div>
                )}
                {currentKind==='account'&&!accountSelected.length&&sortedList.length>0&&(
                  <div className="lead-bulk-hint mb-3">
                    <Button size="sm" variant="outline" onClick={()=>setAccountSelected(sortedList.map(r=>r.id))}>
                      Выбрать все ({sortedList.length})
                    </Button>
                  </div>
                )}
                {currentKind==='account'?(
                <Table className="accounts-table accounts-manager">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={sortedList.length>0&&sortedList.every(r=>accountSelected.includes(r.id))}
                          onCheckedChange={v=>setAccountSelected(v===true?sortedList.map(r=>r.id):[])}
                          aria-label="Выбрать все аккаунты"
                        />
                      </TableHead>
                      <SortableTableHead columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Аккаунт</SortableTableHead>
                      <TableHead>
                        <span className="acc-limits-head">
                          Дневные лимиты
                          <button
                            type="button"
                            className="acc-limits-refresh"
                            title={`Сброс в полночь МСК (~${new Date(moscowNextMidnightIso()).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})})`}
                            onClick={()=>toast.message(`Дневные лимиты сбрасываются в полночь МСК (~${new Date(moscowNextMidnightIso()).toLocaleTimeString('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'})})`)}
                          >
                            <RefreshCw size={13}/>
                          </button>
                        </span>
                      </TableHead>
                      <SortableTableHead columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Статус</SortableTableHead>
                      <SortableTableHead columnKey="cooldown" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Отлёжка</SortableTableHead>
                      <SortableTableHead columnKey="proxy" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Связи</SortableTableHead>
                      <SortableTableHead columnKey="updated" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Обновлено</SortableTableHead>
                      <TableHead className="text-right w-[148px]">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedList.map(r=>{
                      const rowStatus=accountRowStatus(r.data);
                      const displayName=accountDisplayName(r.data);
                      const identity=accountIdentityLine(r.data,r.id);
                      const avatarLetter=(displayName.replace(/^@/,'').trim()[0]||'?').toUpperCase();
                      const proxy=records.find(x=>x.id===r.data.proxyId);
                      const linkedGroups=records.filter(g=>g.kind==='group'&&(g.data.accountId===r.id||g.data.joinedAccountId===r.id));
                      const coolLeft=(rowStatus==='cooldown'||(rowStatus==='spamblock'&&isOnCooldown(r.data.cooldownUntil)))
                        ?cooldownRemainingShort(r.data.cooldownUntil)
                        :'';
                      const updatedIso=accountUpdatedAt(r.data,r.created);
                      const usage=accountLimitsUsage(r.data);
                      return (
                        <TableRow key={r.id} className={accountSelected.includes(r.id)?'bg-[rgba(255,169,44,0.06)]':''}>
                          <TableCell>
                            <Checkbox checked={accountSelected.includes(r.id)} onCheckedChange={v=>toggleAccountSelected(r.id,v===true)} aria-label={`Выбрать ${displayName}`}/>
                          </TableCell>
                          <TableCell className="min-w-0">
                            <div className="acc-identity">
                              <span className="acc-avatar" style={{background:accountAvatarColor(r.id+displayName)}} aria-hidden>{avatarLetter}</span>
                              <div className="acc-identity-text min-w-0">
                                <strong className="truncate" title={displayName}>{displayName}</strong>
                                <span className="acc-id-line" title={identity}>{identity}</span>
                                <div className="acc-meta-badges">
                                  {r.data.format&&r.data.format!=='manual'&&<span className="badge neutral">{r.data.format}</span>}
                                  {r.data.hasPhoto&&<span className="badge success">фото</span>}
                                  {!r.hasSecret&&<span className="badge warning">нет сессии</span>}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell><AccountLimitsCell data={r.data}/></TableCell>
                          <TableCell className="min-w-0">
                            <AccountStatusCell status={rowStatus} error={r.data.error} cooldownUntil={r.data.cooldownUntil}/>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {coolLeft?(
                              <span className="acc-cooldown is-on" title={cooldownLabel(r.data.cooldownUntil)}>{coolLeft}</span>
                            ):(
                              <span className="acc-cooldown is-off">Отключена</span>
                            )}
                          </TableCell>
                          <TableCell className="min-w-0">
                            <div className="acc-links">
                              <span className={`acc-chip ${proxy?.data.status==='active'?'is-ok':proxy?'is-warn':'is-muted'}`} title={proxy?proxyDisplayLabel(proxy.data):'Прокси не назначен'}>
                                <Network size={12}/>
                                {proxy?proxyDisplayLabel(proxy.data).slice(0,18):'Без прокси'}
                              </span>
                              <span className={`acc-chip ${linkedGroups.length?'is-ok':'is-muted'}`} title={linkedGroups.length?linkedGroups.map(g=>g.data.name).join(', '):'Нет привязанных групп'}>
                                <Folder size={12}/>
                                {linkedGroups.length
                                  ?(linkedGroups.length===1?String(linkedGroups[0]!.data.name||'Группа').slice(0,16):`${linkedGroups.length} групп`)
                                  :'Нет групп'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap muted text-sm" title={updatedIso?new Date(updatedIso).toLocaleString('ru-RU'):''}>
                            {relativeTimeRu(updatedIso)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="acc-actions">
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={busy||r.data.status==='checking'}
                                title="Проверить статус"
                                aria-label={'Проверить '+displayName}
                                onClick={()=>checkOneAccount(r)}
                              >{r.data.status==='checking'?<Loader2 className="animate-spin" size={15}/>:<Plug size={15}/>}</Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Статистика лимитов"
                                aria-label={'Статистика '+displayName}
                                onClick={()=>setTaskLog({
                                  title:`Статистика · ${displayName}`,
                                  log:[
                                    {at:new Date().toISOString(),level:'info',text:`Статус: ${ACCOUNT_STATUS_LABELS[rowStatus as AccountStatus]||rowStatus}`},
                                    {at:new Date().toISOString(),level:'info',text:`Вступления сегодня: ${usage.joins}/${usage.inviteLimit||'∞'}`},
                                    {at:new Date().toISOString(),level:'info',text:`Сообщения сегодня: ${usage.messages}/${usage.messageLimit||'∞'}`},
                                    {at:new Date().toISOString(),level:coolLeft?'warn':'info',text:coolLeft?`Отлёжка ещё ${coolLeft} (${cooldownLabel(r.data.cooldownUntil)})`:'Отлёжка отключена'},
                                    {at:new Date().toISOString(),level:'info',text:proxy?`Прокси: ${proxyDisplayLabel(proxy.data)} (${proxy.data.status||'?'})`:'Прокси не назначен'},
                                    {at:new Date().toISOString(),level:'info',text:linkedGroups.length?`Групп: ${linkedGroups.map(g=>g.data.name||'—').join(', ')}`:'Групп не назначено'},
                                    ...(r.data.error?[{at:new Date().toISOString(),level:'error',text:String(r.data.error)}]:[]),
                                  ],
                                })}
                              ><BarChart3 size={15}/></Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={isOnCooldown(r.data.cooldownUntil)?'Снять отлёжку':'Отлёжка 24ч'}
                                aria-label="Отлёжка"
                                onClick={()=>setAccountCooldown(r,isOnCooldown(r.data.cooldownUntil)?null:24)}
                              ><Timer size={15}/></Button>
                              <Button variant="ghost" size="icon" aria-label={'Изменить '+displayName} onClick={()=>open(r.kind,r)}><Pencil size={15}/></Button>
                              <Button variant="ghost" size="icon" className="text-[var(--spike-danger,#fb977d)]" aria-label={'Удалить '+displayName} onClick={()=>setDeleting(r)}><Trash2 size={15}/></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                ):(
                <Table className="proxies-table">
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Название</SortableTableHead>
                      <SortableTableHead columnKey="host" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Адрес</SortableTableHead>
                      <SortableTableHead columnKey="protocol" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Тип</SortableTableHead>
                      <SortableTableHead columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Состояние</SortableTableHead>
                      <TableHead className="text-right w-[140px]">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedList.map(r=>{
                      const rowStatus=r.data.status||'inactive';
                      return (
                      <TableRow key={r.id}>
                        <TableCell className="font-semibold min-w-0">
                          <span className={`proxy-ref ${r.data.status==='active'?'is-active':r.data.status==='checking'?'is-checking':''}`} title={proxyDisplayLabel(r.data)}>
                            <span className="proxy-ref-name">{proxyDisplayLabel(r.data)}</span>
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-variant-numeric tabular-nums">
                          {r.data.host&&r.data.port?`${r.data.host}:${r.data.port}`:'—'}
                        </TableCell>
                        <TableCell className="min-w-0">{String(r.data.protocol||'').toUpperCase()}</TableCell>
                        <TableCell className="proxy-status-cell min-w-0">
                          <>
                            {statusBadge(rowStatus,'proxy')}
                            {(()=>{
                              const bits:string[]=[];
                              if(r.data.status!=='checking'&&r.data.exitIp){
                                bits.push(`IP ${r.data.exitIp}${r.data.telegramOk===false?' · TG?':r.data.telegramOk===true?' · TG ok':''}`);
                              }
                              if(r.data.checkError)bits.push(String(r.data.checkError));
                              if(!bits.length)return null;
                              const text=bits.join(' · ');
                              return (
                                <p className={`proxy-status-meta small-note${r.data.status==='inactive'||r.data.telegramOk===false?' text-[var(--spike-error)]':''}`} title={text}>
                                  {text}
                                </p>
                              );
                            })()}
                          </>
                        </TableCell>
                        <TableCell className="text-right w-[140px]">
                          <div className="proxy-actions">
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={busy||r.data.status==='checking'}
                              title={r.data.status==='active'?'Проверить снова':'Перезапустить проверку'}
                              aria-label={'Проверить '+r.data.name}
                              onClick={()=>checkOneProxy(r)}
                            >{r.data.status==='checking'?<Loader2 className="animate-spin" size={15}/>:<RefreshCw size={15}/>}</Button>
                            <Button variant="ghost" size="icon" aria-label={'Изменить '+r.data.name} onClick={()=>open(r.kind,r)}><Pencil size={15}/></Button>
                            <Button variant="ghost" size="icon" aria-label={'Удалить '+r.data.name} onClick={()=>setDeleting(r)}><Trash2 size={15}/></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )})}
                  </TableBody>
                </Table>
                )}
                </>
              ):(
                <Empty className="empty-state border-0">
                  <EmptyHeader>
                    <div className="icon-box mx-auto mb-3"><Radio size={22}/></div>
                    <EmptyTitle>{query?'Ничего не найдено':'Здесь пока нет записей'}</EmptyTitle>
                    <EmptyDescription>{query?'Попробуйте другой запрос.':'Добавьте первое подключение для рабочего пространства.'}</EmptyDescription>
                  </EmptyHeader>
                  {!query&&<Button variant="outline" onClick={()=>open(currentKind)}><Plus size={15}/>Добавить {labels[currentKind]}</Button>}
                </Empty>
              )}
            </section>
          </>}

          {view==='AI-ассистент'&&(
            <AiWorkspace
              records={records}
              projects={projects}
              loading={loading}
              error={error}
              aiKeyReady={aiKeyReady}
              leadTextVisible={canSeeLeadText(workspaceMeta)}
              groupsVisible={canSeeGroups(workspaceMeta)}
              isOwner={isWorkspaceOwner(workspaceMeta)}
              telegramConnected={telegramConnected}
              activeProjectId={activeProjectId}
              onSelectProject={setActiveProjectId}
              onRefresh={refresh}
              onOpenThread={(id)=>{const item=records.find(r=>r.id===id);if(item)void openLead(item)}}
              onGoGroups={()=>goChats()}
              onOpenSettings={()=>navigate('Настройки')}
              onOpenLeads={()=>{setLeadProjectScope('active');goLeads()}}
              onDirtyChange={setAiDirty}
              onRescan={async()=>{
                try{
                  const r=await rescanAllGroups({force:true});
                  if(!r.skipped)toast.success(`Обход: ${r.scanned} групп, +${r.added} лидов`);
                }catch(e){toast.error((e as Error).message)}
              }}
            />
          )}

          {view==='Настройки'&&(
            <div className="settings-page">
              <section className="settings-card">
                <div className="settings-card-head">
                  <div className="title-icon">
                    <div className="icon-box"><Search size={20}/></div>
                    <div>
                      <h2>Глубина просмотра чатов</h2>
                      <p className="small-note">Сколько дней истории читать при скане и автообходе</p>
                    </div>
                  </div>
                  <span className={`badge ${telegramConnected?'success':'warning'}`}>
                    {telegramConnected?'Воркер онлайн':'Воркер офлайн'}
                  </span>
                </div>
                <div className="settings-fields">
                  <div className="settings-row">
                    <label className="field">Глубина, дней
                      <Input
                        type="number"
                        min={1}
                        max={90}
                        value={genSettings.scanDepthDays}
                        onChange={e=>setGenSettings(s=>({...s,scanDepthDays:Math.max(1,Math.min(90,Number(e.target.value)||7))}))}
                      />
                      <span className="settings-hint">От 1 до 90. Больше дней — дольше скан.</span>
                    </label>
                    <label className="field">Интервал автообхода, минут
                      <Input
                        type="number"
                        min={5}
                        max={180}
                        value={genSettings.autoRescanMinutes}
                        disabled={!genSettings.autoRescanEnabled}
                        onChange={e=>setGenSettings(s=>({...s,autoRescanMinutes:Math.max(5,Math.min(180,Number(e.target.value)||30))}))}
                      />
                      <span className="settings-hint">Круглосуточно через tg-worker (кабинет не нужен). Интервал — минимум между сканами одной группы. Кнопка «Собрать лиды» — сразу.</span>
                    </label>
                  </div>
                  <div className="settings-row">
                    <label className="field">Лимит оценок AI в день
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_DAILY_CAP}
                        value={genSettings.judgeDailyCap}
                        onChange={e=>setGenSettings(s=>({...s,judgeDailyCap:clampCap(e.target.value,DEFAULT_JUDGE_DAILY_CAP)}))}
                      />
                      <span className="settings-hint">Сколько сообщений AI прочитает за сутки по всем проектам. Остальные подождут следующего дня в шаге «Без оценки».</span>
                    </label>
                    <label className="field">Лимит черновиков в день
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_DAILY_CAP}
                        value={genSettings.draftDailyCap}
                        onChange={e=>setGenSettings(s=>({...s,draftDailyCap:clampCap(e.target.value,DEFAULT_DRAFT_DAILY_CAP)}))}
                      />
                      <span className="settings-hint">Сколько черновиков ответа AI напишет за сутки: и сам для горячих лидов, и по кнопке.</span>
                    </label>
                  </div>
                  <label className="settings-check">
                    <Checkbox checked={genSettings.autoRescanEnabled} onCheckedChange={v=>setGenSettings(s=>({...s,autoRescanEnabled:v===true}))}/>
                    <span>
                      Автообход подключённых чатов
                      {settings?.data.lastAutoRescanAt?` · последний ${new Date(settings.data.lastAutoRescanAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:''}
                      {autoRescanRunning?' · идёт сейчас…':''}
                    </span>
                  </label>
                </div>
              </section>

              <section className="settings-card">
                <div className="settings-card-head">
                  <div className="title-icon">
                    <div className="icon-box"><UserRound size={20}/></div>
                    <div>
                      <h2>Профиль</h2>
                      <p className="small-note">Данные кабинета для подписей и контакта в ответах</p>
                    </div>
                  </div>
                </div>
                <div className="settings-fields">
                  <div className="settings-row">
                    <label className="field">Имя / бренд
                      <Input value={genSettings.profileName} onChange={e=>setGenSettings(s=>({...s,profileName:e.target.value}))} placeholder="UniLab · Мой бизнес"/>
                    </label>
                    <label className="field">Контакт
                      <Input value={genSettings.profileContact} onChange={e=>setGenSettings(s=>({...s,profileContact:e.target.value}))} placeholder="@username или телефон"/>
                    </label>
                  </div>
                  <label className="field">О себе
                    <Textarea rows={3} value={genSettings.profileAbout} onChange={e=>setGenSettings(s=>({...s,profileAbout:e.target.value}))} placeholder="Кратко, чем занимаетесь и кому помогаете"/>
                  </label>
                </div>
              </section>

              <section className="settings-card">
                <div className="settings-card-head">
                  <div className="title-icon">
                    <div className="icon-box"><MessageSquare size={20}/></div>
                    <div>
                      <h2>Уведомления в Telegram</h2>
                      <p className="small-note">Бот: новые лиды и ответы клиентов в «Переписках»</p>
                    </div>
                  </div>
                  <span className={`badge ${genSettings.notifyEnabled&&genSettings.notifyBotToken&&genSettings.notifyChatId?'success':'neutral'}`}>
                    {genSettings.notifyEnabled?'Вкл.':'Выкл.'}
                  </span>
                </div>
                <div className="settings-fields">
                  <label className="settings-check">
                    <Checkbox checked={genSettings.notifyEnabled} onCheckedChange={v=>setGenSettings(s=>({...s,notifyEnabled:v===true}))}/>
                    <span>Включить уведомления (лиды + переписки)</span>
                  </label>
                  <ol className="settings-steps">
                    <li>Создайте бота у <strong>@BotFather</strong> → команда /newbot → скопируйте token.</li>
                    <li>Напишите боту <strong>/start</strong> в Telegram.</li>
                    <li>Узнайте свой Chat ID (например через <strong>@userinfobot</strong>) и вставьте ниже.</li>
                  </ol>
                  <div className="settings-row">
                    <label className="field">Bot token
                      <Input
                        type="password"
                        autoComplete="off"
                        value={genSettings.notifyBotToken}
                        onChange={e=>setGenSettings(s=>({...s,notifyBotToken:e.target.value}))}
                        placeholder="123456:AA…"
                      />
                      <span className="settings-hint">Токен от @BotFather</span>
                    </label>
                    <label className="field">Chat ID
                      <Input
                        value={genSettings.notifyChatId}
                        onChange={e=>setGenSettings(s=>({...s,notifyChatId:e.target.value}))}
                        placeholder="123456789"
                      />
                      <span className="settings-hint">Число или @username канала</span>
                    </label>
                  </div>
                  <div className="settings-actions-btns">
                    <Button
                      variant="outline"
                      disabled={busy||!genSettings.notifyBotToken.trim()||!genSettings.notifyChatId.trim()}
                      onClick={testNotify}
                    >
                      <MessageSquare size={15}/>Тест уведомления
                    </Button>
                    <Button variant="ghost" onClick={()=>navigate('AI-ассистент')}>
                      <Sparkles size={15}/>К AI-ассистенту
                    </Button>
                  </div>
                </div>
              </section>

              <div className="settings-actions">
                <p className="settings-actions-note">
                  Изменения применяются к следующим сканам и уведомлениям о лидах.
                </p>
                <div className="settings-actions-btns">
                  <Button disabled={busy} onClick={saveGeneralSettings}>
                    <Check size={15}/>Сохранить настройки
                  </Button>
                </div>
              </div>
            </div>
          )}

          <footer className="app-footer">
            <span>UniLab · Тёплые заявки из Telegram</span>
            <span>Тёплые заявки из Telegram</span>
          </footer>
        </div>
      </SidebarInset>

      <Dialog open={!!modal} onOpenChange={o=>{if(!o&&!busy){setModal(null);setSecret('')}}}>
        <DialogContent className={`max-h-[90vh] overflow-y-auto `}>
          <DialogHeader>
            <DialogTitle>{
              `${modal?.item?'Изменить':'Добавить'} ${modal?labels[modal.kind]:''}`
            }</DialogTitle>
            <DialogDescription>{
              'Запись будет сохранена в вашем рабочем пространстве.'
            }</DialogDescription>
          </DialogHeader>
          <form className="form-stack" onSubmit={save}>
            {modal?.kind!=='settings'&&field('name','Название')}
            {modal?.kind==='account'&&<>
              {field('phone','Телефон','tel','+79991234567')}
              <label className="field">Прокси
                <Pick value={form.proxyId} onChange={v=>change('proxyId',v)} options={proxyPickOptions(list('proxy'))} placeholder="Без прокси"/>
              </label>
              <label className="field">Статус
                <Select value={form.status||'setup'} onValueChange={v=>change('status',v)}>
                  <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_STATUSES.map(s=>(
                      <SelectItem key={s} value={s}>{ACCOUNT_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="field">Вступления
                  <Input type="number" min={0} max={10000} value={form.limits?.invite??10} onChange={e=>changeLimit('invite',e.target.value)}/>
                </label>
                <label className="field">Сообщения
                  <Input type="number" min={0} max={10000} value={form.limits?.message??10} onChange={e=>changeLimit('message',e.target.value)}/>
                </label>
              </div>
              <p className="small-note">Дневные лимиты (сброс 00:00 МСК). «Вступления» — join в группы; «Сообщения» — ответы лидам в личку.</p>
              <div className="grid grid-cols-2 gap-4">
                {field('firstName','Имя','text','Бренд или имя')}
                {field('lastName','Фамилия','text','опционально')}
              </div>
              {field('username','Логин Telegram','text','сгенерируется сам')}
              <p className="small-note">Без @username нельзя вступать в группы. При создании аккаунта ник генерируется и сразу записывается в Telegram.</p>
              <label className="field">О себе (в диалогах с клиентом, до 70 символов в Telegram)
                <Textarea rows={2} value={form.about||''} onChange={e=>change('about',e.target.value)} maxLength={70} placeholder="Коротко о сервисе / компании"/>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>generateFarmProfile()}>
                  <Sparkles size={14}/>Сгенерировать описание
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy||!modal.item||!form.about}
                  onClick={async()=>{
                    if(!modal.item)return;
                    setFarmAbout(form.about||'');
                    setFarmFirstName(form.firstName||'');
                    setFarmLastName(form.lastName||'');
                    await applyFarmProfiles([modal.item.id],true);
                  }}
                >
                  <UserRound size={14}/>Записать в Telegram
                </Button>
              </div>
              <p className="small-note">«Сохранить» для нового аккаунта пишет профиль и @username в Telegram (нужен воркер и сессия). Правки имени/о себе — кнопка «Записать в Telegram».</p>
              <label className="field">Отлежка до (ISO или пусто)
                <Input value={form.cooldownUntil||''} placeholder="Оставьте пустым или задайте через кнопку в таблице" onChange={e=>change('cooldownUntil',e.target.value)}/>
              </label>
              <p className="small-note">
                {modal.item?.hasSecret
                  ? `Формат сессии: ${form.format||'tdata'}. Прокси и лимиты можно менять в любой момент.`
                  : 'Или импортируйте zip (tdata / session). Имя файла = номер телефона.'}
              </p>
            </>}
            {modal?.kind==='proxy'&&<>
              <label className="field">Вставить строку прокси
                <Input
                  value={proxyPaste}
                  placeholder="host:port:user:password или socks5://user:pass@host:port"
                  onChange={e=>applyProxyPaste(e.target.value)}
                />
              </label>
              <p className="small-note">Строка сразу заполняет поля ниже. Можно править вручную.</p>
              <div className="grid grid-cols-2 gap-4">{field('host','IP или хост','text','192.0.2.1')}{field('port','Порт','number','1080')}</div>
              <label className="field">Протокол
                <Select value={form.protocol} onValueChange={v=>change('protocol',v)}>
                  <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
                  <SelectContent><SelectItem value="socks5">SOCKS5</SelectItem><SelectItem value="http">HTTP</SelectItem></SelectContent>
                </Select>
              </label>
              {field('username','Логин')}
              <label className="field">Пароль
                <Input type="password" autoComplete="new-password" value={secret} onChange={e=>{setSecret(e.target.value);setClearSecret(false)}} placeholder={modal.item?.hasSecret?'Сохранён. Оставьте пустым, чтобы не менять':'Пароль прокси'}/>
              </label>
            </>}
            {modal?.kind==='group'&&<>
              {field('url','Ссылка на группу или канал','text','https://t.me/… или https://t.me/+invite')}
              <label className="field">Аккаунт<Pick value={form.accountId} onChange={v=>change('accountId',v)} options={accountsActive.map(r=>({id:r.id,name:r.data.name}))} placeholder={accountsActive.length?'Назначить позже':'Нет рабочих аккаунтов'}/></label>
              <p className="small-note">
                {!modal.item
                  ? 'После сохранения нажмите «Вступить» в строке группы — аккаунт вступит и просканирует сообщения на лиды.'
                  : 'Нужна живая ссылка из Telegram. Шаблоны вроде @mp_automation не работают.'}
              </p>
            </>}
            {modal?.kind==='lead'&&<>
              {field('source','Источник','text','Название группы')}
              <label className="field">Сообщение клиента<Textarea required rows={5} value={form.message||''} onChange={e=>change('message',e.target.value)}/></label>
              <div className="grid grid-cols-2 gap-4">
                <label className="field">Статус
                  <Select value={form.status} onValueChange={v=>change('status',v)}>
                    <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Новый</SelectItem>
                      <SelectItem value="working">В работе</SelectItem>
                      <SelectItem value="archived">Архив</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="field">Температура
                  <Select value={form.temperature||'warm'} onValueChange={v=>change('temperature',v)}>
                    <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hot">Горячий</SelectItem>
                      <SelectItem value="warm">Тёплый</SelectItem>
                      <SelectItem value="cold">Холодный</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              {form.draft&&<label className="field">Черновик<Textarea rows={5} value={form.draft} onChange={e=>change('draft',e.target.value)}/></label>}
            </>}
            {modal?.item?.hasSecret&&['proxy'].includes(modal.kind)&&(
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={clearSecret} onCheckedChange={v=>{setClearSecret(v===true);if(v)setSecret('')}}/>
                Удалить сохранённый пароль
              </label>
            )}
            {formError&&<p role="alert" className="form-error">{formError}</p>}
            <Button type="submit" disabled={busy}>{busy&&<Loader2 className="animate-spin" size={15}/>}Сохранить</Button>
          </form>
        </DialogContent>
      </Dialog>

      <TaskLogDialog open={taskLog} onClose={()=>setTaskLog(null)}/>

      <Dialog open={groupImportOpen} onOpenChange={o=>{if(!busy){setGroupImportOpen(o);if(!o){setGroupImportText('');setFormError('')}}}}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Добавить группы массово</DialogTitle>
            <DialogDescription>
              Список ссылок <code>https://t.me/…</code>, инвайтов <code>t.me/+…</code> или <code>@username</code> — по одной в строке или через запятую. До 200 штук.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Список групп"
            rows={8}
            value={groupImportText}
            onChange={e=>{setGroupImportText(e.target.value);setFormError('')}}
            placeholder={'https://t.me/MarketplaceChati\nhttps://t.me/mp_seller\n@wbhelper\nhttps://t.me/+AbCdEf'}
          />
          <label className="field">Или загрузите .txt
            <Input type="file" accept=".txt,.csv" onChange={async e=>{
              const f=e.target.files?.[0];
              if(!f)return;
              if(f.size>500000){setFormError('Файл больше 500 КБ');return}
              setGroupImportText(await f.text());
              setFormError('');
            }}/>
          </label>
          <label className="field">Аккаунт
            <Pick
              value={groupImportAccountId}
              onChange={setGroupImportAccountId}
              options={list('account').map(r=>({id:r.id,name:r.data.name}))}
              placeholder="Назначить позже"
            />
          </label>
          <p className="small-note">
            Найдено ссылок: {parseGroupUrlLines(groupImportText).length}. Группы добавятся без вступления — «Вступить» в строке группы.
          </p>
          {formError&&<p className="form-error">{formError}</p>}
          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="ghost" disabled={busy} onClick={()=>setGroupImportOpen(false)}>Отменить</Button>
            <Button disabled={busy||!groupImportText.trim()} onClick={()=>void importGroupsMass()}>
              {busy?'Сохранение…':'Добавить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={o=>{if(!busy){setImportOpen(o);if(!o){setImportText('');setFormError('')}}}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Импорт прокси</DialogTitle>
            <DialogDescription>
              Как в TGLab: <code>ip:port:login:password</code> или с названием <code>:имя</code>. Строки или через запятую. Также URL <code>socks5://…</code>
            </DialogDescription>
          </DialogHeader>
          <label className="field">Протокол по умолчанию (для строк без схемы)
            <Select value={importProtocol} onValueChange={v=>setImportProtocol(v as ProxyProtocol)}>
              <SelectTrigger className="w-full"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="socks5">SOCKS5</SelectItem>
                <SelectItem value="http">HTTP</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Textarea aria-label="Список прокси" rows={7} value={importText} onChange={e=>setImportText(e.target.value)} placeholder={'192.0.2.10:5545:user:pass\n198.51.100.20:5545:user:pass'}/>
          <label className="field">Или загрузите .txt
            <Input type="file" accept=".txt" onChange={async e=>{const f=e.target.files?.[0];if(f){if(f.size>500000){setFormError('Файл больше 500 КБ');return}setImportText(await f.text());setFormError('')}}}/>
          </label>
          {formError&&<p className="form-error">{formError}</p>}
          <Button disabled={busy} onClick={importProxies}>{busy?'Сохранение…':'Импортировать'}</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={accountImportOpen} onOpenChange={o=>{if(!busy){setAccountImportOpen(o);if(!o){setAccountImportFiles([]);setAccountImportNames([]);setFormError('')}}}}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Выберите аккаунты для загрузки</DialogTitle>
            <DialogDescription>
              Архивы Tdata / Session+Json / Session — ZIP или RAR до 1 МБ. Имя файла = номер телефона.
            </DialogDescription>
          </DialogHeader>
          <div className="form-stack">
            <div>
              <p className="text-sm font-semibold mb-2">Выбор сессии</p>
              <div className="session-toggle">
                <button type="button" className={accountImportSessionMode==='keep'?'active':''} onClick={()=>setAccountImportSessionMode('keep')}>Использовать текущую</button>
                <button type="button" className={accountImportSessionMode==='new'?'active':''} onClick={()=>setAccountImportSessionMode('new')}>Создать новую</button>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold mb-2">Прокси</p>
              <label className="inline-flex items-center gap-2 text-sm mb-2">
                <Checkbox checked={accountImportMixProxy} onCheckedChange={v=>setAccountImportMixProxy(v===true)}/>
                Смешать активные прокси по аккаунтам
              </label>
              {!accountImportMixProxy&&(
                <label className="field">
                  Один прокси на всех
                  <Pick value={accountImportProxyId} onChange={setAccountImportProxyId} options={proxyPickOptions(list('proxy'))} placeholder="Без прокси"/>
                </label>
              )}
              {accountImportMixProxy&&(
                <p className="small-note">
                  Активных прокси: {list('proxy').filter(p=>p.data.status==='active').length || list('proxy').length}.
                  Раздаются по кругу при загрузке.
                </p>
              )}
            </div>
            <div
              className="account-dropzone"
              onDragOver={e=>{e.preventDefault();e.stopPropagation()}}
              onDrop={e=>{
                e.preventDefault();
                e.stopPropagation();
                addAccountArchiveFiles(Array.from(e.dataTransfer.files||[]));
              }}
            >
              <CloudUpload size={36} className="text-[var(--spike-primary)] mb-3"/>
              <p className="text-sm font-medium text-center leading-6">
                Переместите архивы с аккаунтами<br/>Tdata / Session+Json / Session или
              </p>
              <label className="mt-3 inline-flex cursor-pointer">
                <input
                  type="file"
                  className="sr-only"
                  accept={ACCOUNT_ARCHIVE_ACCEPT}
                  multiple
                  onChange={e=>{
                    addAccountArchiveFiles(Array.from(e.target.files||[]));
                    e.target.value='';
                  }}
                />
                <span className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--spike-primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95">
                  <Upload size={15}/>Выбрать аккаунты
                </span>
              </label>
              <p className="small-note mt-4 text-center">Допустимые форматы: ZIP, RAR · Максимум 1 МБ на архив</p>
            </div>
            {!!accountImportFiles.length&&(
              <ul className="account-file-list">
                {accountImportFiles.map(f=>(
                  <li key={f.name}>
                    <FileArchive size={16}/>
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="small-note shrink-0">{formatArchiveSize(f.size)}</span>
                    <button
                      type="button"
                      className="text-[var(--spike-muted)] hover:text-[var(--spike-text)]"
                      aria-label={`Убрать ${f.name}`}
                      onClick={()=>setAccountImportFiles(prev=>prev.filter(x=>x.name!==f.name))}
                    ><X size={15}/></button>
                  </li>
                ))}
              </ul>
            )}
            {formError&&<p className="form-error">{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" disabled={busy} onClick={()=>!busy&&setAccountImportOpen(false)}>Отменить</Button>
              <Button type="button" disabled={busy||!accountImportFiles.length} onClick={importAccounts}>
                {busy?<Loader2 className="animate-spin" size={15}/>:null}
                {busy
                  ?(accountImportProgress?`Сохранение ${accountImportProgress}…`:'Загрузка…')
                  :`Загрузить аккаунты${accountImportFiles.length?` (${accountImportFiles.length})`:''}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className="catalog-dialog max-h-[92vh] overflow-hidden flex flex-col sm:max-w-4xl p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-[var(--spike-border)] shrink-0">
            <DialogTitle>Найти чаты с клиентами</DialogTitle>
            <DialogDescription>
              «В базе» — ваши группы для сбора лидов. «Все чаты» — полный каталог ({catalogStats().uniqueUrls} ссылок). «Залить в базу» добавит их в «Группы и каналы».
            </DialogDescription>
          </DialogHeader>

          <div className="catalog-layout flex-1 min-h-0 overflow-hidden">
            <aside className="catalog-side">
              <p className="catalog-step-label">Рынок</p>
              <div className="catalog-side-list">
                {MARKET_SECTIONS.map(m=>(
                  <button
                    key={m.id}
                    type="button"
                    className={`catalog-side-item ${catalogMarket===m.id?'active':''}`}
                    onClick={()=>selectMarket(m.id)}
                  >
                    <strong>{m.title} <em className="opacity-70 font-normal">· {m.id==='db'?list('group').length:marketVerifiedCount(m.id)}</em></strong>
                    <span>{m.hint}</span>
                  </button>
                ))}
              </div>

              {catalogMarket!=='db'&&(
              <>
              <p className="catalog-step-label mt-4">Ниша</p>
              <div className="catalog-side-list catalog-niche-list">
                <button
                  type="button"
                  className={`catalog-niche-btn ${catalogNiche===null?'active':''}`}
                  onClick={()=>selectCatalogNiche(null)}
                >Все ниши</button>
                {catalogMarketNiches.map(n=>(
                  <button
                    key={n}
                    type="button"
                    className={`catalog-niche-btn ${catalogNiche===n?'active':''}`}
                    onClick={()=>selectCatalogNiche(n)}
                  >{GROUP_NICHE_LABELS[n]}</button>
                ))}
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3 w-full"
                onClick={()=>{
                  const s=list('settings')[0]?.data||defaults.settings;
                  const auto=nichesFromProjectText(s.product,s.audience,s.keywords,s.leadCriteria,s.name,s.pains,s.valueProps,s.hotSignals);
                  if(!auto.length){toast.message('В AI нет явных ниш — выберите рынок вручную');return}
                  let best={id:MARKET_SECTIONS.find(m=>m.niches.length)?.id||'all',score:0};
                  for(const m of MARKET_SECTIONS){
                    if(!m.niches.length)continue;
                    const score=m.niches.filter(n=>auto.includes(n)).length;
                    if(score>best.score)best={id:m.id,score};
                  }
                  setCatalogMarket(best.id);
                  setCatalogNiche(null);
                  setCatalogTab('links');
                  setCatalogSearching(true);
                  setCatalogSearchTick(t=>t+1);
                }}
              ><Sparkles size={14}/>Подобрать по AI</Button>
              </>
              )}
              {catalogMarket==='db'&&(
                <Button
                  type="button"
                  size="sm"
                  className="mt-3 w-full"
                  disabled={busy}
                  onClick={()=>void importFullCatalogToDb()}
                ><Database size={14}/>Дозалить каталог ({catalogStats().uniqueUrls})</Button>
              )}
            </aside>

            <div className="catalog-main">
              <div className="catalog-main-toolbar">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-2.5 text-[var(--spike-muted)]" size={16}/>
                  <Input
                    className="pl-9"
                    placeholder="Уточнить поиск…"
                    value={catalogQuery}
                    onChange={e=>{setCatalogQuery(e.target.value);setCatalogSearching(true);setCatalogSearchTick(t=>t+1)}}
                  />
                  {catalogSearching&&<Loader2 className="absolute right-3 top-2.5 animate-spin text-[var(--spike-primary)]" size={16}/>}
                </div>
                <label className="catalog-toggle">
                  <Checkbox
                    checked={catalogHideAdded}
                    disabled={catalogMarket==='db'}
                    onCheckedChange={v=>setCatalogHideAdded(v===true)}
                  />
                  Скрыть добавленные
                </label>
              </div>

              <div className="catalog-params">
                <span className="catalog-param">{catalogActiveMarket?.title||'—'}</span>
                <span className="catalog-param-sep">/</span>
                <span className="catalog-param accent">{catalogMarket==='db'?'Ваш кабинет':(catalogNiche?GROUP_NICHE_LABELS[catalogNiche]:'Все ниши')}</span>
                <span className="small-note ml-auto">{catalogSearching?'Ищем…':`${catalogVisibleHits.length} результатов · база ${catalogStats().uniqueUrls}`}</span>
              </div>

              <div className="catalog-tabs">
                <button type="button" className={catalogTab==='links'?'active':''} onClick={()=>{setCatalogTab('links');setCatalogSelected([])}}>
                  {catalogMarket==='db'?'Группы':'Со ссылкой'} <em>{catalogLinkHits.length}</em>
                </button>
                {catalogMarket!=='db'&&(
                <button type="button" className={catalogTab==='topics'?'active':''} onClick={()=>{setCatalogTab('topics');setCatalogSelected([])}}>
                  Темы без ссылки <em>{catalogTopicHits.length}</em>
                </button>
                )}
              </div>

              {catalogTab==='topics'&&catalogVisibleHits.length>0&&(
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={catalogVisibleHits.length>0&&catalogVisibleHits.every(g=>catalogSelected.includes(g.id))}
                      onCheckedChange={v=>setCatalogSelected(v===true?catalogVisibleHits.map(g=>g.id):[])}
                      aria-label="Выбрать все темы"
                    />
                    Выбрать все ({catalogVisibleHits.length})
                  </label>
                  {catalogSelected.length>0&&(
                    <button type="button" className="text-sm text-[var(--spike-muted)] hover:text-[var(--spike-text)]" onClick={()=>setCatalogSelected([])}>
                      Снять ({catalogSelected.length})
                    </button>
                  )}
                </div>
              )}

              <label className="field catalog-account">
                Аккаунт
                <Pick value={catalogAccountId} onChange={setCatalogAccountId} options={accountsActive.map(r=>({id:r.id,name:r.data.name}))} placeholder={accountsActive.length?'Аккаунт для новых групп':'Нет рабочих аккаунтов'}/>
              </label>

              <div className="catalog-results">
                {catalogSearching&&!catalogVisibleHits.length?(
                  <div className="catalog-searching">
                    <Loader2 className="animate-spin" size={18}/>
                    <span>Ищем чаты по параметрам…</span>
                  </div>
                ):catalogVisibleHits.length?catalogVisibleHits.map(g=>{
                  const canJoin=g.verified&&!!g.url&&!isCatalogPlaceholderUrl(g.url);
                  const checked=catalogSelected.includes(g.id);
                  const dbId=catalogMarket==='db'&&String(g.id).startsWith('db:')?String(g.id).slice(3):'';
                  const dbRec=dbId?list('group').find(x=>x.id===dbId):undefined;
                  const dbJoined=!!(dbRec&&(dbRec.data.membership==='joined'||dbRec.data.joinedAt));
                  return (
                    <div key={g.id} className={`catalog-card ${checked?'is-checked':''} ${canJoin?'has-link':''}`}>
                      {catalogTab==='topics'?(
                        <Checkbox
                          checked={checked}
                          onCheckedChange={v=>{
                            setCatalogSelected(prev=>v===true?(prev.includes(g.id)?prev:[...prev,g.id]):prev.filter(id=>id!==g.id));
                          }}
                        />
                      ):null}
                      <span className="min-w-0 flex-1">
                        <span className="catalog-card-title">
                          {g.name}
                          {canJoin?<span className="badge success">t.me</span>:<span className="badge neutral">нужен инвайт</span>}
                          {dbJoined&&<span className="badge success">вступили</span>}
                        </span>
                        <span className="text-sm muted block mt-1">{g.description}</span>
                        <span className="small-note block mt-1">{g.audience}</span>
                        <span className="small-note block mt-1 font-medium text-[var(--spike-primary)]">{canJoin?g.url:g.searchHint}</span>
                      </span>
                      {catalogMarket==='db'&&dbRec?(
                        dbJoined?(
                          <Button
                            size="sm"
                            disabled={busy||!telegramConnected}
                            onClick={()=>{setCatalogOpen(false);void scanGroup(dbRec)}}
                          >Скан лидов</Button>
                        ):(
                          <Button
                            size="sm"
                            disabled={busy||joinInFlight||!telegramConnected||!dbRec.data.accountId}
                            onClick={()=>{setCatalogOpen(false);void joinGroup(dbRec)}}
                          >Вступить</Button>
                        )
                      ):canJoin?(
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={()=>void addCatalogGroupToDb(g.id)}
                        ><Plus size={14}/>В базу</Button>
                      ):(
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={()=>{
                            setCatalogOpen(false);
                            setForm({...defaults.group,name:g.name,url:'',accountId:catalogAccountId,status:'setup',error:''});
                            setModal({kind:'group'});
                            toast.message('Вставьте t.me — затем «Вступить» в строке группы');
                          }}
                        >Ссылка</Button>
                      )}
                    </div>
                  );
                }):(
                  <p className="muted text-sm py-6">
                    {catalogMarket==='db'
                      ? 'В кабинете пока нет групп — нажмите «Дозалить каталог» или откройте «Все чаты».'
                      : catalogTab==='links'&&catalogTopicHits.length
                      ? 'Нет готовых ссылок в этой нише — откройте «Темы без ссылки» или смените нишу.'
                      : catalogHiddenAdded&&catalogHideAdded
                        ? 'В этой нише всё уже добавлено. Снимите «Скрыть добавленные» или выберите другую нишу.'
                        : 'Пусто. Выберите другой рынок или нишу.'}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-[var(--spike-border)] flex flex-wrap gap-2 shrink-0">
            {catalogMarket==='db'?(
              <>
                <Button
                  disabled={busy||!telegramConnected||!list('group').filter(g=>g.data.membership==='joined'||g.data.joinedAt).length}
                  onClick={()=>{
                    setCatalogOpen(false);
                    navigate('Группы и каналы');
                    void (async()=>{
                      setBusy(true);
                      try{
                        const r=await api({action:'rescan_groups',force:true});
                        toast.message(`Переобход: ${r.queued||0} групп`);
                        await refresh();
                      }catch(e){toast.error((e as Error).message)}
                      finally{setBusy(false)}
                    })();
                  }}
                >Собрать лиды со вступивших</Button>
                <Button variant="outline" disabled={busy} onClick={()=>void importFullCatalogToDb()}>
                  Дозалить каталог ({catalogStats().uniqueUrls})
                </Button>
                <Button variant="ghost" onClick={()=>selectMarket('all')}>Все чаты каталога</Button>
              </>
            ):catalogTab==='links'?(
              <>
                <Button
                  disabled={busy||!catalogReadyCount}
                  variant="default"
                  onClick={()=>catalogMarket==='all'?void importFullCatalogToDb():void addCatalogGroupsToDb(catalogLinkHits.map(g=>g.id))}
                >{busy?'Сохраняем…':catalogMarket==='all'?`Залить весь каталог (${catalogStats().uniqueUrls})`:`Залить в базу (${catalogReadyCount})`}</Button>
              </>
            ):(
              <Button
                variant="outline"
                disabled={busy||!catalogSelected.length}
                onClick={()=>{
                  const first=GROUP_CATALOG.find(g=>catalogSelected.includes(g.id));
                  if(!first)return;
                  setCatalogOpen(false);
                  setForm({...defaults.group,name:first.name,url:'',accountId:catalogAccountId,status:'setup',error:''});
                  setModal({kind:'group'});
                  toast.message(`Вставьте t.me для «${first.name}» — затем «Вступить» в строке группы`);
                }}
              >Вставить ссылку</Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={()=>{setCatalogOpen(false);openManualGroup()}}><Plus size={15}/>Своя группа</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={o=>{if(!o){setDetail(null);setChatText('')}}}>
        <DialogContent className="max-h-[92vh] overflow-hidden flex flex-col sm:max-w-2xl p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-[var(--spike-border)]">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detail?.data.name}
              {detail&&tempBadge(detail.data.temperature)}
            </DialogTitle>
            <DialogDescription>
              {detail?.data.source}
              {detail?.data.senderUsername?` · @${detail.data.senderUsername}`:''}
              {detail?.data.conversationOpen?' · переписка':''}
              {detail?.data.needsManager?' · нужен менеджер':''}
              {' · '}живой чат
            </DialogDescription>
          </DialogHeader>
          <div className="chat-thread px-6 py-4 overflow-y-auto flex-1 min-h-[280px] max-h-[48vh]">
            <div className="chat-bubble in">
              <span className="chat-meta">{detail?.data.name} · входящее</span>
              <p>{detail?.data.message}</p>
              {(()=>{
                const g=list('group').find(x=>x.id===detail?.data.groupId);
                const href=telegramMessageLink(String(g?.data.url||''),String(detail?.data.tgMsgId||''));
                return href?(
                  <a className="chat-msg-link" href={href} target="_blank" rel="noreferrer">
                    Открыть исходное в Telegram <ExternalLink size={12}/>
                  </a>
                ):null;
              })()}
            </div>
            {(detail?.data.replies||[]).map((rep:any,i:number)=>{
              const g=list('group').find(x=>x.id===detail?.data.groupId);
              const href=String(rep.link||'')||telegramMessageLink(String(g?.data.url||''),String(rep.messageId||''),String(rep.chatId||''));
              const incoming=rep.from==='client';
              return (
              <div className={`chat-bubble ${incoming?'in':'out'} ${!incoming&&!rep.ok?'fail':''}`} key={`${rep.at}-${i}`}>
                <span className="chat-meta">{incoming?'Клиент · входящее':(rep.mode==='dm'?'Личка':'В чат')} · {new Date(rep.at).toLocaleString('ru-RU')}{!incoming&&!rep.ok?(rep.status==='pending'?' · отправляется':rep.status==='unknown'?' · не подтверждено':' · ошибка'):''}</span>
                <p>{rep.text}</p>
                {rep.error&&<p className="chat-err">{rep.error}</p>}
                {href&&rep.ok&&(
                  <a className="chat-msg-link" href={href} target="_blank" rel="noreferrer">
                    {incoming?'Открыть в Telegram':'Смотреть ответ в Telegram'} <ExternalLink size={12}/>
                  </a>
                )}
              </div>
              );
            })}
            {detail?.data.draft&&!(detail.data.replies||[]).some((x:any)=>x.text===detail.data.draft)&&(
              <div className="chat-bubble draft-bubble">
                <span className="chat-meta">Черновик AI</span>
                <p>{detail.data.draft}</p>
              </div>
            )}
          </div>
          <div className="chat-composer px-6 py-4 border-t border-[var(--spike-border)] space-y-3">
            <Tabs value={chatMode} onValueChange={v=>setChatMode(v as 'dm'|'chat')}>
              <TabsList>
                <TabsTrigger value="dm">В личку</TabsTrigger>
                <TabsTrigger value="chat">В чат (ответ)</TabsTrigger>
              </TabsList>
            </Tabs>
            <Textarea
              rows={3}
              value={chatText}
              onChange={e=>setChatText(e.target.value)}
              placeholder={chatMode==='dm'?'Личное сообщение клиенту…':'Ответ в группу (reply)…'}
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy||!chatText.trim()} onClick={()=>{void sendLeadReply()}}>
                {busy?<Loader2 className="animate-spin" size={15}/>:null}
                {chatMode==='dm'?'Отправить в ЛС':'Отправить в чат'}
              </Button>
              <Button variant="outline" disabled={busy} onClick={async()=>{if(!detail)return;await draft(detail);const updated=records.find(r=>r.id===detail.id)||detail;setChatText(prev=>prev||updated.data.draft||'')}}>
                <Sparkles size={15}/>Черновик AI
              </Button>
              <Button variant="ghost" disabled={busy||!detail} onClick={()=>{if(detail)void leadFeedback(detail,'good')}}>
                <ThumbsUp size={15}/>Хороший лид
              </Button>
              <Button variant="ghost" disabled={busy||!detail} onClick={()=>{if(detail)void leadFeedback(detail,'bad')}}>
                <ThumbsDown size={15}/>Не лид
              </Button>
              <Button variant="outline" disabled={!chatText} onClick={async()=>{try{await navigator.clipboard.writeText(chatText);toast.success('Скопировано')}catch{toast.error('Не удалось скопировать')}}}>Копировать</Button>
              <Button variant="ghost" onClick={()=>{if(detail){open('lead',detail);setDetail(null)}}}>Правки</Button>
              <Button variant="ghost" onClick={()=>{setDeleting(detail);setDetail(null)}}><Trash2 size={15}/></Button>
            </div>
            <p className="small-note">
              {chatMode==='dm'
                ? (detail?.data.senderId||detail?.data.senderUsername
                  ? 'ЛС через аккаунт группы. Если privacy закрыт — Telegram отклонит.'
                  : 'Нет senderId — пересканируйте группу, иначе ЛС недоступны.')
                : 'Сообщение уйдёт в группу ответом на исходный пост.'}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!accountPicker} onOpenChange={o=>{if(!o){setAccountPicker(null);setAccountPickerQuery('')}}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {accountPicker?.mode==='row'?'Аккаунт для группы':'Выберите аккаунт'}
            </DialogTitle>
            <DialogDescription>
              Один аккаунт на группу: он вступает и сканирует. Если он недоступен, группа ждёт — другой аккаунт сам не подставляется.
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-[var(--spike-muted)]" size={16}/>
            <Input
              className="pl-9"
              placeholder="Поиск аккаунта…"
              value={accountPickerQuery}
              onChange={e=>setAccountPickerQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className="account-picker-list">
            {accountsActive
              .filter(a=>{
                const q=accountPickerQuery.trim().toLowerCase();
                if(!q)return true;
                return String(a.data.name||'').toLowerCase().includes(q)||String(a.data.phone||'').includes(q);
              })
              .map(a=>{
                const on=accountPickerDraft.includes(a.id);
                return (
                  <button
                    type="button"
                    key={a.id}
                    className={`account-picker-row ${on?'on':''}`}
                    onClick={()=>setAccountPickerDraft([a.id])}
                  >
                    <span className={`account-picker-check ${on?'on':''}`}>{on?<Check size={14}/>:null}</span>
                    <span className="min-w-0 flex-1 text-left">
                      <strong className="block truncate">{a.data.name}</strong>
                      <span className="small-note">{a.data.phone||'активен'}</span>
                    </span>
                  </button>
                );
              })}
            {!accountsActive.length&&(
              <p className="small-note p-3">Нет рабочих аккаунтов — в отлёжке, спамблоке или не подключены.</p>
            )}
            {accountsActive.length>0&&accountsAll.length>accountsActive.length&&(
              <p className="small-note px-3 pb-2">Скрыто {accountsAll.length-accountsActive.length} в отлёжке/блоке</p>
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={()=>setAccountPickerDraft([])}>
              Сбросить
            </Button>
            <div className="flex gap-2 ml-auto">
              <Button type="button" variant="outline" onClick={()=>setAccountPicker(null)}>Отмена</Button>
              <Button type="button" disabled={busy||(!accountPickerDraft[0]&&accountPicker?.mode!=='row')} onClick={confirmAccountPicker}>
                Готово
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkCooldownOpen} onOpenChange={o=>{if(!busy)setBulkCooldownOpen(o)}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Отлежка · {accountSelected.length} акк.</DialogTitle>
            <DialogDescription>
              После дневного лимита / PEER_FLOOD / заморозки — пауза или снимите, если лимит уже прошёл.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} variant="outline" onClick={()=>void bulkSetAccountCooldown(null)}>Снять отлежку</Button>
            <Button disabled={busy} variant="outline" onClick={()=>void bulkSetAccountCooldown(12)}>12 ч</Button>
            <Button disabled={busy} onClick={()=>void bulkSetAccountCooldown(24)}>24 ч</Button>
            <Button disabled={busy} variant="outline" onClick={()=>void bulkSetAccountCooldown(48)}>48 ч</Button>
            <Button disabled={busy} variant="outline" onClick={()=>void bulkSetAccountCooldown(72)}>72 ч</Button>
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="ghost" disabled={busy} onClick={()=>setBulkCooldownOpen(false)}>Закрыть</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkLimitsOpen} onOpenChange={o=>{if(!busy)setBulkLimitsOpen(o)}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Лимиты · {accountSelected.length} акк.</DialogTitle>
            <DialogDescription>
              Задайте суточные лимиты сами. Кнопка ниже подставляет рекомендации под Telegram API (мягкие квоты фермы).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={()=>setBulkLimits({
                invite:TELEGRAM_RECOMMENDED_LIMITS.invite,
                message:TELEGRAM_RECOMMENDED_LIMITS.message,
              })}
            >
              Подставить рекомендации TG
            </Button>
            <p className="small-note">
              Рекомендация: вступления {TELEGRAM_RECOMMENDED_LIMITS.invite} · ЛС {TELEGRAM_RECOMMENDED_LIMITS.message}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="field">Вступления / день
                <Input type="number" min={0} max={10000} value={bulkLimits.invite} onChange={e=>setBulkLimits(s=>({...s,invite:Number(e.target.value)||0}))}/>
              </label>
              <label className="field">ЛС / день
                <Input type="number" min={0} max={10000} value={bulkLimits.message} onChange={e=>setBulkLimits(s=>({...s,message:Number(e.target.value)||0}))}/>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" disabled={busy} onClick={()=>setBulkLimitsOpen(false)}>Отмена</Button>
            <Button disabled={busy} onClick={()=>void bulkSetAccountLimits()}>{busy?'Сохранение…':'Применить'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkProxyOpen} onOpenChange={o=>{if(!busy)setBulkProxyOpen(o)}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Прокси · {accountSelected.length} акк.</DialogTitle>
            <DialogDescription>
              Один прокси на всех или перемешать активные по кругу.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <Checkbox checked={bulkProxyMix} onCheckedChange={v=>setBulkProxyMix(v===true)}/>
              Смешать активные прокси
            </label>
            {!bulkProxyMix&&(
              <label className="field">
                Прокси
                <Pick
                  value={bulkProxyId}
                  onChange={setBulkProxyId}
                  options={proxyPickOptions(list('proxy'))}
                  placeholder="Без прокси"
                />
              </label>
            )}
            {bulkProxyMix&&(
              <p className="small-note">
                Активных: {list('proxy').filter(p=>p.data.status==='active').length || list('proxy').length}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" disabled={busy} onClick={()=>setBulkProxyOpen(false)}>Отмена</Button>
            <Button disabled={busy} onClick={()=>void bulkSetAccountProxy()}>{busy?'Сохранение…':'Применить'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={o=>{if(!busy)setBulkDeleteOpen(o)}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {accountSelected.length} аккаунт(ов)?</AlertDialogTitle>
            <AlertDialogDescription>
              Сессии и привязки к задачам/группам пропадут. Действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e)=>{e.preventDefault();void bulkDeleteAccounts()}}>
              {busy?'Удаление…':'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={farmProfileOpen} onOpenChange={o=>{if(!busy)setFarmProfileOpen(o)}}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Профили фермы</DialogTitle>
            <DialogDescription>
              Короткое описание сервиса для имени и «О себе». Примените ко всем или выбранным аккаунтам и запишите в Telegram.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="field">Имя
                <Input value={farmFirstName} onChange={e=>setFarmFirstName(e.target.value)} maxLength={32}/>
              </label>
              <label className="field">Фамилия
                <Input value={farmLastName} onChange={e=>setFarmLastName(e.target.value)} maxLength={32}/>
              </label>
            </div>
            <label className="field">О себе ({farmAbout.length}/70)
              <Textarea rows={3} value={farmAbout} onChange={e=>setFarmAbout(e.target.value.slice(0,70))} maxLength={70}/>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={()=>generateFarmProfile()}>
                <Sparkles size={15}/>{busy?'…':'Сгенерировать заново'}
              </Button>
            </div>
            <p className="small-note">
              Цель: {accountSelected.length?`${accountSelected.length} выбранных`:`все ${list('account').length} аккаунтов`}.
              Нужно подключение к Telegram.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy||!list('account').length} onClick={()=>applyFarmProfiles(accountSelected.length?accountSelected:list('account').map(r=>r.id),true)}>
                Применить в Telegram
              </Button>
              <Button variant="outline" disabled={busy||!list('account').length} onClick={()=>applyFarmProfiles(accountSelected.length?accountSelected:list('account').map(r=>r.id),false)}>
                Только в кабинет
              </Button>
              <Button variant="ghost" onClick={()=>setFarmProfileOpen(false)}>Закрыть</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={farmLogoOpen} onOpenChange={o=>{if(!busy){setFarmLogoOpen(o);if(!o){setFarmLogoFile(null);setFarmLogoPreview('')}}}}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Логотип фермы</DialogTitle>
            <DialogDescription>
              Один логотип на много аккаунтов — фото профиля в Telegram. JPG/PNG до 4.5 МБ.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="account-dropzone block cursor-pointer">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={e=>{
                  const f=e.target.files?.[0]||null;
                  setFarmLogoFile(f);
                  if(farmLogoPreview)URL.revokeObjectURL(farmLogoPreview);
                  setFarmLogoPreview(f?URL.createObjectURL(f):'');
                }}
              />
              {farmLogoPreview?(
                // eslint-disable-next-line @next/next/no-img-element
                <img src={farmLogoPreview} alt="Превью логотипа" className="farm-logo-preview"/>
              ):(
                <span className="muted text-sm">Нажмите или перетащите логотип</span>
              )}
            </label>
            {farmLogoFile&&<p className="small-note">{farmLogoFile.name} · {(farmLogoFile.size/1024).toFixed(0)} КБ</p>}
            <p className="small-note">
              Цель: {accountSelected.length?`${accountSelected.length} выбранных`:`все ${list('account').length} аккаунтов`}. Между аккаунтами пауза ~1.5 с.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy||!farmLogoFile||!list('account').length} onClick={()=>applyFarmLogo(accountSelected.length?accountSelected:list('account').map(r=>r.id))}>
                <ImagePlus size={15}/>Загрузить на аккаунты
              </Button>
              <Button variant="ghost" onClick={()=>setFarmLogoOpen(false)}>Закрыть</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingLeave} onOpenChange={o=>{if(!o)setPendingLeave(null)}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Карточка проекта не сохранена</AlertDialogTitle>
            <AlertDialogDescription>
              Изменения в описании проекта для AI пропадут, если уйти со страницы без сохранения.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Остаться</AlertDialogCancel>
            <AlertDialogAction onClick={()=>{const apply=pendingLeave;setPendingLeave(null);setAiDirty(false);apply?.()}}>Перейти без сохранения</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!deleting} onOpenChange={o=>{if(!o&&!busy)setDeleting(null)}}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{deleting?.data.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.kind==='group'
                ? 'Группа и все лиды из неё будут удалены из админки. Из Telegram аккаунт не выйдет.'
                : 'Запись будет удалена из админки. Это не удаляет аккаунт Telegram и не выходит из группы.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={e=>{e.preventDefault();remove()}}>Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  );
}

export default function Home(){
  return (
    <Suspense fallback={null}>
      <WorkspaceHome/>
    </Suspense>
  );
}
