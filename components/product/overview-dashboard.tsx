'use client';

import {useCallback,useMemo,useState} from 'react';
import {
  ArrowRight,
  Flame,
  MessageSquare,
  Plug,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Input} from '@/components/ui/input';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {ArcStatCard} from '@/components/product/arc-stat-card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  SortableTableHead,
} from '@/components/ui/table';
import {
  LEAD_TEMPERATURE_LABELS,
  type LeadTemperature,
} from '@/lib/lead-filter';
import {useTableSort} from '@/hooks/useTableSort';
import type {SortValueType} from '@/lib/table-sort';

export type OverviewLead={
  id:string;
  created:string;
  name:string;
  message:string;
  source:string;
  temperature:LeadTemperature;
  status:string;
  viewed:boolean;
  groupId:string;
  draft:boolean;
};

export type OverviewChat={
  id:string;
  name:string;
  leads:number;
  fresh:number;
  hot:number;
  joined:boolean;
  pending:boolean;
  queue:boolean;
  lastScanned:string;
};

export type OverviewJoinItem={
  id:string;
  name:string;
  status:string;
  waitSec?:number;
};

export type OverviewFarmStats={
  audienceCollected:number;
  audienceInvited:number;
  inviteOrdinary:number;
  inviteAdvanced:number;
  mailingSent:number;
  mailingFailed:number;
  accountsActive:number;
  accountsTotal:number;
  proxiesActive:number;
  proxiesTotal:number;
  tasksOk:number;
  tasksWarn:number;
  tasksError:number;
};

function tempClass(t:LeadTemperature){
  return t==='hot'?'studio-pill hot':t==='cold'?'studio-pill cold':'studio-pill warm';
}

function statusLabel(status:string,viewed:boolean){
  if(viewed)return {label:'Просмотрен',tone:'muted' as const};
  if(status==='working')return {label:'В работе',tone:'info' as const};
  if(status==='archived')return {label:'Архив',tone:'muted' as const};
  return {label:'Новый',tone:'ok' as const};
}

export function OverviewDashboard({
  loading,
  telegramConnected,
  leads,
  chats,
  joinQueue,
  freshCount,
  hotCount,
  warmCount: _warmCount,
  coldCount: _coldCount,
  draftCount,
  joinedChats,
  needJoin,
  farm,
  onRefresh,
  onGoLeads,
  onGoChats,
  onGoAccounts,
  onGoAudience,
  onGoInvite,
  onGoMailing,
  onGoProxies,
  onOpenLead,
  onSearchTopics,
  onOpenDrafts,
}:{
  loading:boolean;
  telegramConnected:boolean;
  leads:OverviewLead[];
  chats:OverviewChat[];
  joinQueue:OverviewJoinItem[];
  freshCount:number;
  hotCount:number;
  warmCount:number;
  coldCount:number;
  draftCount:number;
  joinedChats:number;
  needJoin:number;
  farm:OverviewFarmStats;
  onRefresh:()=>void;
  onGoLeads:(opts?:{groupId?:string;filter?:string})=>void;
  onGoChats:(filter?:'all'|'need'|'joined'|'pending'|'error')=>void;
  onGoAccounts:()=>void;
  onGoAudience:()=>void;
  onGoInvite:()=>void;
  onGoMailing:()=>void;
  onGoProxies:()=>void;
  onOpenLead:(id:string)=>void;
  onSearchTopics:()=>void;
  onOpenDrafts:()=>void;
}){
  const [chatId,setChatId]=useState('all');
  const [chatQuery,setChatQuery]=useState('');
  const [leadQuery,setLeadQuery]=useState('');
  const [tempFilter,setTempFilter]=useState<'all'|LeadTemperature>('all');
  const [showViewed,setShowViewed]=useState(false);

  const filteredChats=useMemo(()=>{
    const q=chatQuery.trim().toLowerCase();
    const list=[...chats].sort((a,b)=>b.fresh-a.fresh||b.leads-a.leads||a.name.localeCompare(b.name,'ru'));
    if(!q)return list;
    return list.filter(c=>c.name.toLowerCase().includes(q));
  },[chats,chatQuery]);

  const filteredLeads=useMemo(()=>{
    const q=leadQuery.trim().toLowerCase();
    return leads.filter(l=>{
      if(!showViewed&&l.viewed)return false;
      if(showViewed&&!l.viewed)return false;
      if(chatId!=='all'&&l.groupId!==chatId)return false;
      if(tempFilter!=='all'&&l.temperature!==tempFilter)return false;
      if(!q)return true;
      return (
        l.name.toLowerCase().includes(q)||
        l.message.toLowerCase().includes(q)||
        l.source.toLowerCase().includes(q)
      );
    });
  },[leads,chatId,tempFilter,leadQuery,showViewed]);

  const leadSortTypes=useMemo<Record<string,SortValueType>>(()=>({
    name:'string',
    temperature:'status',
    status:'status',
    source:'string',
    created:'date',
  }),[]);

  const getLeadSortValue=useCallback((lead:OverviewLead,key:string)=>{
    if(key==='name')return lead.name||'';
    if(key==='temperature')return LEAD_TEMPERATURE_LABELS[lead.temperature]||lead.temperature;
    if(key==='status')return statusLabel(lead.status,lead.viewed).label;
    if(key==='source')return lead.source||'';
    if(key==='created')return lead.created;
    return '';
  },[]);

  const {sorted:sortedLeads,sortKey,sortDir,onSort}=useTableSort(filteredLeads,getLeadSortValue,{
    types:leadSortTypes,
    defaultKey:'created',
    defaultDir:'desc',
    resetKey:`${showViewed}-${chatId}-${tempFilter}`,
  });

  const tableLeads=useMemo(()=>sortedLeads.slice(0,12),[sortedLeads]);

  const joinActive=joinQueue.filter(q=>['queued','waiting','joining','scanning'].includes(q.status));
  const selectedChat=chats.find(c=>c.id===chatId);
  const visibleFresh=leads.filter(l=>{
    if(l.viewed)return false;
    if(chatId!=='all'&&l.groupId!==chatId)return false;
    if(tempFilter!=='all'&&l.temperature!==tempFilter)return false;
    return true;
  }).length;

  const audienceRest=Math.max(0,farm.audienceCollected-farm.audienceInvited);
  const accountsProblem=Math.max(0,farm.accountsTotal-farm.accountsActive);
  const proxiesInactive=Math.max(0,farm.proxiesTotal-farm.proxiesActive);
  const mailingTotal=farm.mailingSent+farm.mailingFailed;
  const tasksTotal=farm.tasksOk+farm.tasksWarn+farm.tasksError;
  const inviteTotal=farm.inviteOrdinary+farm.inviteAdvanced;

  return (
    <div className="studio-dash">
      <div className="studio-toolbar">
        <div className="studio-toolbar-actions">
          <Button size="sm" onClick={()=>onGoLeads({filter:'hot'})} disabled={!hotCount}>
            <Flame size={14}/>Горячие ({hotCount})
          </Button>
          <Button size="sm" variant="outline" onClick={()=>onGoLeads()} disabled={!freshCount}>
            <Users size={14}/>Новые ({freshCount})
          </Button>
          <Button size="sm" variant="outline" onClick={()=>onGoChats('need')} disabled={!needJoin}>
            <Plug size={14}/>Вступить ({needJoin})
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenDrafts} disabled={!draftCount}>
            <MessageSquare size={14}/>Черновики ({draftCount})
          </Button>
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14}/>Обновить
          </Button>
        </div>
        <div className="studio-toolbar-meta">
          <Badge variant={telegramConnected?'default':'secondary'}>
            {telegramConnected?'Worker онлайн':'Worker оффлайн'}
          </Badge>
        </div>
      </div>

      <div className="studio-metrics">
        <ArcStatCard
          title="Аудитория"
          value={farm.audienceCollected}
          loading={loading}
          onClick={onGoAudience}
          segments={[
            {value:farm.audienceInvited,color:'#ffa92c',labelColor:'#1a1208'},
            {value:audienceRest,color:'rgba(255,255,255,0.14)',labelColor:'rgba(255,255,255,0.7)'},
          ]}
        />
        <ArcStatCard
          title="Приглашения"
          value={inviteTotal}
          loading={loading}
          onClick={onGoInvite}
          segments={[
            {value:farm.inviteOrdinary,color:'#46caeb',labelColor:'#0b1a1f'},
            {value:farm.inviteAdvanced,color:'rgba(70,202,235,0.35)',labelColor:'#dff6fb'},
          ]}
        />
        <ArcStatCard
          title="Рассылки"
          value={mailingTotal}
          loading={loading}
          onClick={onGoMailing}
          segments={[
            {value:farm.mailingSent,color:'#ffa92c',labelColor:'#1a1208'},
            {value:farm.mailingFailed,color:'#fb977d',labelColor:'#2a1210'},
          ]}
        />
        <ArcStatCard
          title="Аккаунты"
          value={farm.accountsTotal}
          loading={loading}
          onClick={onGoAccounts}
          segments={[
            {value:farm.accountsActive,color:'#4bd08b',labelColor:'#0d1f16'},
            {value:accountsProblem,color:'#fb977d',labelColor:'#2a1210'},
          ]}
        />
        <ArcStatCard
          title="Прокси"
          value={farm.proxiesTotal}
          loading={loading}
          onClick={onGoProxies}
          segments={[
            {value:farm.proxiesActive,color:'#4bd08b',labelColor:'#0d1f16'},
            {value:proxiesInactive,color:'rgba(255,255,255,0.14)',labelColor:'rgba(255,255,255,0.7)'},
          ]}
        />
        <ArcStatCard
          title="Задачи"
          value={tasksTotal}
          loading={loading}
          onClick={onGoAudience}
          segments={[
            {value:farm.tasksOk,color:'#4bd08b',labelColor:'#0d1f16'},
            {value:farm.tasksWarn,color:'#ffd58a',labelColor:'#1a1208'},
            {value:farm.tasksError,color:'#fb977d',labelColor:'#2a1210'},
          ]}
        />
      </div>

      <div className="studio-split">
        <Card className="studio-chats-card">
          <CardHeader className="border-b">
            <div>
              <CardTitle>Чаты</CardTitle>
              <CardDescription>
                {chats.length} всего · {joinedChats} в сети · {needJoin} ждут
              </CardDescription>
            </div>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={()=>onGoChats()}>Все <ArrowRight size={14}/></Button>
            </CardAction>
          </CardHeader>
          <CardContent className="studio-chats-body">
            <div className="studio-search">
              <Search size={14}/>
              <Input
                value={chatQuery}
                onChange={e=>setChatQuery(e.target.value)}
                placeholder="Найти чат…"
                aria-label="Поиск чата"
              />
            </div>
            <div className="studio-chat-tabs">
              <button type="button" className={chatId==='all'?'is-on':''} onClick={()=>setChatId('all')}>
                Все <strong>{freshCount}</strong>
              </button>
              <button type="button" onClick={()=>onGoChats('joined')}>В сети <strong>{joinedChats}</strong></button>
              <button type="button" onClick={()=>onGoChats('need')}>Ждут <strong>{needJoin}</strong></button>
            </div>
            <div className="studio-chat-list">
              {filteredChats.length===0?(
                <div className="studio-empty">
                  <p className="small-note">{chatQuery?'Ничего не найдено':'Пока нет чатов — добавьте на странице «Группы и каналы»'}</p>
                </div>
              ):filteredChats.map(c=>(
                <button
                  type="button"
                  key={c.id}
                  className={`studio-chat-row ${chatId===c.id?'is-on':''}`}
                  onClick={()=>setChatId(c.id)}
                  onDoubleClick={()=>onGoLeads({groupId:c.id})}
                  title="Двойной клик — лиды чата"
                >
                  <div className="min-w-0">
                    <strong className="truncate block">{c.name}</strong>
                    <span className="small-note">
                      {c.queue?'В очереди':c.pending?'Заявка':c.joined?'Вступили':'Ждёт'}
                      {c.hot?` · 🔥 ${c.hot}`:''}
                      {c.leads?` · ${c.leads}`:''}
                    </span>
                  </div>
                  <span className={`studio-count ${c.fresh?'has-new':''}`}>{c.fresh||c.leads||0}</span>
                </button>
              ))}
            </div>
            {chatId!=='all'&&(
              <div className="studio-chat-foot">
                <Button size="sm" variant="outline" onClick={()=>onGoLeads({groupId:chatId,filter:tempFilter==='all'?'all':tempFilter})}>
                  Лиды «{selectedChat?.name||'чат'}» <ArrowRight size={14}/>
                </Button>
              </div>
            )}
            {joinActive.length>0&&(
              <div className="studio-queue">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">Очередь вступлений</span>
                  <Badge variant="secondary">{joinActive.length}</Badge>
                </div>
                {joinActive.slice(0,3).map(q=>(
                  <div className="studio-queue-row" key={q.id}>
                    <span className="truncate">{q.name}</span>
                    <span className="small-note">
                      {q.status==='waiting'?`пауза ${q.waitSec||0}с`:q.status==='joining'?'вступаем':q.status==='scanning'?'скан':'очередь'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="studio-side-actions">
              <Button variant="outline" className="w-full justify-between" onClick={onSearchTopics}>
                Поиск тем <Search size={15}/>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="studio-table-card">
          <CardHeader className="border-b">
            <div>
              <CardTitle>
                {showViewed
                  ?`Просмотренные${chatId==='all'?'':` · ${selectedChat?.name||'чат'}`}`
                  :`${visibleFresh} новых лидов${chatId==='all'?'':` · ${selectedChat?.name||'чат'}`}`}
              </CardTitle>
              <CardDescription>
                {showViewed
                  ?'Уже открытые лиды. Можно вернуться к новым.'
                  :'Откройте лид — он сразу уйдёт в просмотренные и скроется из этого списка.'}
              </CardDescription>
            </div>
            <CardAction>
              <Button variant="outline" size="sm" onClick={()=>onGoLeads({groupId:chatId==='all'?undefined:chatId,filter:showViewed?'viewed':tempFilter==='all'?'all':tempFilter})}>
                Все лиды <ArrowRight size={14}/>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="studio-table-body">
            <div className="studio-table-filters">
              <div className="studio-search grow">
                <Search size={14}/>
                <Input
                  value={leadQuery}
                  onChange={e=>setLeadQuery(e.target.value)}
                  placeholder="Поиск лидов…"
                  aria-label="Поиск лидов"
                />
              </div>
              <Select value={tempFilter} onValueChange={v=>setTempFilter(v as 'all'|LeadTemperature)}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="Температура"/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="hot">Горячие</SelectItem>
                  <SelectItem value="warm">Тёплые</SelectItem>
                  <SelectItem value="cold">Холодные</SelectItem>
                </SelectContent>
              </Select>
              <div className="studio-view-tabs">
                <button type="button" className={!showViewed?'is-on':''} onClick={()=>setShowViewed(false)}>
                  Новые <strong>{freshCount}</strong>
                </button>
                <button type="button" className={showViewed?'is-on':''} onClick={()=>setShowViewed(true)}>
                  Просмотренные
                </button>
              </div>
            </div>
            <div className="studio-table-wrap">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead columnKey="name" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Лид</SortableTableHead>
                    <SortableTableHead columnKey="temperature" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Температура</SortableTableHead>
                    <SortableTableHead columnKey="status" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Статус</SortableTableHead>
                    <SortableTableHead columnKey="source" sortKey={sortKey} sortDir={sortDir} onSort={onSort}>Источник</SortableTableHead>
                    <SortableTableHead columnKey="created" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="text-right">Дата</SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableLeads.length===0?(
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-10">
                        <p className="small-note mb-3">
                          {showViewed?'Нет просмотренных лидов':'Нет новых лидов в этой выборке'}
                        </p>
                      </TableCell>
                    </TableRow>
                  ):tableLeads.map(lead=>{
                    const st=statusLabel(lead.status,lead.viewed);
                    return (
                      <TableRow
                        key={lead.id}
                        className="studio-lead-row"
                        onClick={()=>onOpenLead(lead.id)}
                      >
                        <TableCell>
                          <div className="studio-lead-main">
                            <strong>{lead.name||'Без имени'}</strong>
                            <span className="small-note line-clamp-1">{lead.message}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={tempClass(lead.temperature)}>
                            {LEAD_TEMPERATURE_LABELS[lead.temperature]}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={`studio-status ${st.tone}`}>{st.label}</span>
                          {lead.draft&&<span className="studio-status info ml-1">Черновик</span>}
                        </TableCell>
                        <TableCell className="max-w-[160px]">
                          <span className="truncate block small-note">{lead.source||'—'}</span>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap small-note">
                          {new Date(lead.created).toLocaleString('ru-RU',{
                            day:'2-digit',
                            month:'2-digit',
                            hour:'2-digit',
                            minute:'2-digit',
                          })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
