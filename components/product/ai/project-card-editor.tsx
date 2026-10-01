'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import { Check, Loader2, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/lib/workspace-notifications';
import { errorMessage, workspaceAction } from './api';
import { diffProjectPatch, isPatchEmpty, patchForViewer, type ProjectData, type ProjectRecord } from './model';
import { ExampleList, StopWordsField } from './term-fields';

type Props = {
  project: ProjectRecord;
  aiKeyReady: boolean;
  /** Without lead access the examples arrive blanked: show them read-only and never send them back. */
  leadTextVisible: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: () => Promise<void> | void;
  onDelete: () => void;
};

type TextKey = 'product' | 'valueProps' | 'audience' | 'leadCriteria' | 'notLead' | 'tone' | 'cta';

export function ProjectCardEditor({ project, aiKeyReady, leadTextVisible, onDirtyChange, onSaved, onDelete }: Props) {
  const [draft, setDraft] = useState<ProjectData>(project.data);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const titleId = useId();
  const patch = useMemo(
    () => patchForViewer(diffProjectPatch(project.data, draft), leadTextVisible),
    [project.data, draft, leadTextVisible],
  );
  const dirty = !isPatchEmpty(patch);

  // Server copy changed (save, rebuild, feedback): take it unless the user has unsaved edits.
  // Another project = new instance (parent keys the editor by project id).
  useEffect(() => {
    setDraft((cur) => (isPatchEmpty(diffProjectPatch(project.data, cur)) ? project.data : cur));
  }, [project.data]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof ProjectData>(key: K, value: ProjectData[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function save() {
    if (!dirty) return;
    if (!draft.name.trim()) { toast.error('Название проекта не может быть пустым'); return; }
    setSaving(true);
    try {
      await workspaceAction({ action: 'project_update', id: project.id, patch });
      setSavedAt(Date.now());
      toast.success('Карточка проекта сохранена');
      await onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function rebuild() {
    setRebuilding(true);
    try {
      await workspaceAction({ action: 'rebuild_product', projectId: project.id });
      toast.success('AI заполнил карточку по сайту — проверьте и поправьте');
      await onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRebuilding(false);
    }
  }

  const area = (key: TextKey, label: string, help: string, rows: number, max: number) => (
    <TextField label={label} help={help} rows={rows} max={max} value={draft[key]} onChange={(v) => set(key, v)} />
  );

  return (
    <section className="panel aiw-card" aria-labelledby={titleId}>
      <div className="aiw-panel-head aiw-card-head">
        <div className="min-w-0">
          <h2 id={titleId}>Карточка проекта</h2>
          <p className="aiw-help">AI читает её целиком, когда решает, лид ли это, и когда пишет черновик. Пишите так, как объяснили бы новому менеджеру.</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Действия с проектом"><MoreHorizontal size={18} /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onDelete}><Trash2 size={15} />Удалить проект</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <fieldset className="aiw-group">
        <legend>Что продаём</legend>
        <div className="aiw-grid-2">
          <label className="aiw-field">
            <span className="aiw-label">Название проекта</span>
            <Input value={draft.name} maxLength={120} onChange={(e) => set('name', e.target.value)} />
          </label>
          <div className="aiw-field">
            <label className="aiw-label" htmlFor={`${titleId}-url`}>Сайт</label>
            <div className="aiw-inline">
              <Input id={`${titleId}-url`} type="url" inputMode="url" value={draft.url} maxLength={500} placeholder="https://" onChange={(e) => set('url', e.target.value)} />
              <Button
                variant="outline"
                size="sm"
                disabled={rebuilding || !aiKeyReady || !project.data.url || dirty}
                title={dirty ? 'Сначала сохраните изменения' : !aiKeyReady ? 'Нужен ключ AI' : !project.data.url ? 'Сохраните адрес сайта' : undefined}
                onClick={() => void rebuild()}
              >
                <RefreshCw size={14} className={rebuilding ? 'animate-spin' : ''} />Пересобрать по сайту
              </Button>
            </div>
          </div>
        </div>
        {area('product', 'Продукт', 'Что продаёте, кому, сколько стоит и как начать работу. Без цен и обещаний, которых нет на самом деле.', 5, 12000)}
        {area('valueProps', 'Чем вы лучше', 'Два-три факта, которые AI может упомянуть в ответе.', 2, 4000)}
      </fieldset>

      <fieldset className="aiw-group">
        <legend>Кто лид</legend>
        <div className="aiw-grid-2">
          {area('audience', 'Ваши клиенты', 'Кто покупает: ниша, размер, ситуация.', 3, 2000)}
          {area('leadCriteria', 'Признаки лида', 'Что человек пишет, когда ему нужен ваш продукт прямо сейчас.', 3, 4000)}
        </div>
      </fieldset>

      <fieldset className="aiw-group">
        <legend>Кто не лид</legend>
        {area('notLead', 'Кого пропускать', 'Конкуренты, соискатели, жалобы без запроса — всё, на что не стоит тратить время.', 3, 4000)}
        <StopWordsField value={draft.stopWords} onChange={(v) => set('stopWords', v)} />
      </fieldset>

      <fieldset className="aiw-group">
        <legend>Примеры</legend>
        <p className="aiw-help">Настоящие сообщения из чатов. Кнопки «Хороший лид» и «Не лид» в разделе «Лиды» добавляют их сюда сами.</p>
        {leadTextVisible ? (
          <div className="aiw-grid-2">
            <ExampleList label="Это лид" tone="good" help="Так пишет человек, которому нужен ваш продукт." value={draft.goodExamples} onChange={(v) => set('goodExamples', v)} />
            <ExampleList label="Это не лид" tone="bad" help="Похоже на запрос, но не ваш клиент." value={draft.badExamples} onChange={(v) => set('badExamples', v)} />
          </div>
        ) : (
          <p className="aiw-locked">Примеры видны только с доступом к лидам</p>
        )}
      </fieldset>

      <fieldset className="aiw-group">
        <legend>Тон и призыв</legend>
        <div className="aiw-grid-2">
          {area('tone', 'Как пишем', 'Например: на «вы», коротко, без восклицательных знаков.', 2, 500)}
          {area('cta', 'К чему ведём', 'Следующий шаг для клиента: расчёт, созвон, разбор.', 2, 500)}
        </div>
      </fieldset>

      <fieldset className="aiw-group">
        <legend>Правила</legend>
        <div className="aiw-setting">
          <div className="min-w-0">
            <label className="aiw-label" htmlFor={`${titleId}-score`}>С какой оценки считать лидом</label>
            <p className="aiw-help">AI ставит каждому сообщению балл от 0 до 100. Ниже порога — «Не лид». От 80 — горячий.</p>
          </div>
          <div className="aiw-range">
            <input id={`${titleId}-score`} type="range" min={0} max={100} step={5} value={draft.minScore} onChange={(e) => set('minScore', Number(e.target.value))} />
            <output htmlFor={`${titleId}-score`}>{draft.minScore}</output>
          </div>
        </div>
        <div className="aiw-setting">
          <div className="min-w-0">
            <label className="aiw-label" htmlFor={`${titleId}-auto`}>Писать черновик горячим лидам сразу?</label>
            <p className="aiw-help">Черновик попадает в «На одобрении». Отправляете вы, AI сам ничего не шлёт.</p>
          </div>
          <Switch id={`${titleId}-auto`} checked={draft.autoDraft} onCheckedChange={(v) => set('autoDraft', v)} />
        </div>
        <div className="aiw-setting">
          <div className="min-w-0">
            <label className="aiw-label" htmlFor={`${titleId}-depth`}>Сколько дней истории читать</label>
            <p className="aiw-help">Сообщения старше попадают в шаг «Старые».</p>
          </div>
          <Input id={`${titleId}-depth`} className="aiw-number" type="number" inputMode="numeric" min={1} max={30} value={draft.scanDepthDays}
            onChange={(e) => set('scanDepthDays', Math.max(1, Math.min(30, Number(e.target.value) || 1)))} />
        </div>
      </fieldset>

      <div className="aiw-savebar" data-dirty={dirty || undefined}>
        <p className="aiw-save-state" role="status">
          {dirty
            ? `Есть несохранённые изменения: ${Object.keys(patch).length}`
            : savedAt ? <><Check size={15} aria-hidden />Сохранено</> : 'Все изменения сохранены'}
        </p>
        <div className="aiw-draft-actions">
          <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(project.data)}>Отменить</Button>
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            {saving && <Loader2 size={15} className="animate-spin" />}Сохранить
          </Button>
        </div>
      </div>
    </section>
  );
}

type TextFieldProps = { label: string; help: string; rows: number; max: number; value: string; onChange: (v: string) => void };

function TextField({ label, help, rows, max, value, onChange }: TextFieldProps) {
  const id = useId();
  const near = value.length > max * 0.9;
  return (
    <div className="aiw-field">
      <div className="aiw-label-row">
        <label className="aiw-label" htmlFor={id}>{label}</label>
        {near && <span className="aiw-counter" data-full>{value.length} / {max}</span>}
      </div>
      <p className="aiw-help" id={`${id}-help`}>{help}</p>
      <Textarea id={id} aria-describedby={`${id}-help`} rows={rows} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
