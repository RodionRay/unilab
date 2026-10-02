'use client';

/** «Лиды» manual triage controls (docs/project/specs/manual-lead-triage.md); state model in lib/lead-triage.ts. */
import {Check,CircleX,Undo2} from 'lucide-react';
import type {ComponentProps} from 'react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Tabs,TabsList,TabsTrigger} from '@/components/ui/tabs';
import {
  LEAD_TRIAGE_ACTION_LABELS,
  LEAD_TRIAGE_TABS,
  LEAD_TRIAGE_TAB_LABELS,
  triageActionsFor,
  type LeadTriage,
  type LeadTriageTab,
} from '@/lib/lead-triage';

const ACTION_ICON={lead:Check,rejected:CircleX,new:Undo2} as const;
const ACTION_VARIANT:Record<LeadTriage,ComponentProps<typeof Button>['variant']>={lead:'default',rejected:'outline',new:'ghost'};

export function LeadTriageTabs({value,counts,onChange}:{
  value:LeadTriageTab;
  counts:Record<LeadTriageTab,number>;
  onChange:(tab:LeadTriageTab)=>void;
}){
  return (
    <Tabs value={value} onValueChange={v=>onChange(v as LeadTriageTab)}>
      <TabsList aria-label="Разбор лидов">
        {LEAD_TRIAGE_TABS.map(tab=>(
          <TabsTrigger key={tab} value={tab} data-testid={`lead-tab-${tab}`}>
            {LEAD_TRIAGE_TAB_LABELS[tab]}
            <span className="ml-1 tabular-nums opacity-70">{counts[tab]}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** The two moves available from `current`; `compact` = list row (short buttons, labels kept for clarity). */
export function LeadTriageActions({current,name,disabled,compact,onMove}:{
  current:LeadTriage;
  name:string;
  disabled?:boolean;
  compact?:boolean;
  onMove:(to:LeadTriage)=>void;
}){
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Разбор: ${name}`}>
      {triageActionsFor(current).map(to=>{
        const Icon=ACTION_ICON[to];
        return (
          <Button
            key={to}
            type="button"
            size={compact?'xs':'sm'}
            variant={ACTION_VARIANT[to]}
            disabled={disabled}
            data-testid={`lead-move-${to}`}
            onClick={e=>{e.stopPropagation();onMove(to)}}
          >
            <Icon/>{LEAD_TRIAGE_ACTION_LABELS[to]}
          </Button>
        );
      })}
    </div>
  );
}

/** Selection bar over the list; reuses the «Группы» action bar look (.groups-actionbar). */
export function LeadBulkBar({selected,total,tab,disabled,onSelectAll,onClear,onMove}:{
  selected:number;
  total:number;
  tab:LeadTriageTab;
  disabled?:boolean;
  onSelectAll:(all:boolean)=>void;
  onClear:()=>void;
  onMove:(to:LeadTriage)=>void;
}){
  if(!total)return null;
  const allOn=selected>0&&selected===total;
  const moves:LeadTriage[]=tab==='all'?['lead','rejected','new']:triageActionsFor(tab);
  return (
    <div className={`groups-actionbar ${selected?'has-sel':''}`} data-testid="lead-bulk-bar">
      <div className="groups-actionbar-left">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={allOn}
            onCheckedChange={v=>onSelectAll(v===true)}
            aria-label="Выбрать все лиды в списке"
          />
          {selected?<strong>Выбрано {selected} из {total}</strong>:<span className="muted">Отметьте лиды для разбора</span>}
        </label>
        {selected>0&&<Button size="sm" variant="ghost" onClick={onClear}>Снять</Button>}
      </div>
      {selected>0&&(
        <div className="groups-actionbar-right">
          {moves.map(to=>{
            const Icon=ACTION_ICON[to];
            return (
              <Button key={to} size="sm" variant={ACTION_VARIANT[to]} disabled={disabled} data-testid={`lead-bulk-${to}`} onClick={()=>onMove(to)}>
                <Icon/>{LEAD_TRIAGE_ACTION_LABELS[to]}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
