'use client';
import { useId, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  addExample,
  addStopWord,
  MAX_EXAMPLE_LENGTH,
  MAX_EXAMPLES,
  MAX_STOP_WORDS,
  removeAt,
  splitTerms,
  type ListAddResult,
} from './model';

const ADD_ERROR: Record<Exclude<ListAddResult['error'], ''>, string> = {
  empty: '',
  duplicate: 'Уже есть в списке.',
  limit: 'Список заполнен: удалите лишнее, чтобы добавить новое.',
  too_long: 'Слишком длинно.',
};

type StopWordsProps = { value: readonly string[]; onChange: (next: string[]) => void };

/** Stop words as chips inside one input (Octolens negative terms, ref-1c). */
export function StopWordsField({ value, onChange }: StopWordsProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const inputId = useId();
  const helpId = useId();

  function commit(raw: string) {
    let list = [...value];
    let lastError: ListAddResult['error'] = '';
    for (const term of splitTerms(raw)) {
      const r = addStopWord(list, term);
      list = r.list;
      if (r.error) lastError = r.error;
    }
    if (list.length !== value.length) onChange(list);
    setError(lastError ? ADD_ERROR[lastError] : '');
    setInput('');
  }

  return (
    <div className="aiw-field">
      <div className="aiw-label-row">
        <label className="aiw-label" htmlFor={inputId}>Стоп-слова</label>
        <span className="aiw-counter" data-full={value.length >= MAX_STOP_WORDS || undefined}>{value.length} / {MAX_STOP_WORDS}</span>
      </div>
      <p className="aiw-help" id={helpId}>
        Сообщение с таким словом AI даже не читает. Совпадение по началу слова, регистр не важен: «вакансия» уберёт и «Вакансии».
      </p>
      <div className="kw-editor aiw-chips">
        {value.map((term, i) => (
          <span className="kw" key={`${term}-${i}`}>
            {term}
            <button type="button" aria-label={`Убрать «${term}»`} onClick={() => onChange(removeAt(value, i))}><X size={12} /></button>
          </span>
        ))}
        <input
          id={inputId}
          value={input}
          aria-describedby={helpId}
          disabled={value.length >= MAX_STOP_WORDS}
          placeholder={value.length ? 'ещё слово…' : 'например, вакансия'}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;\n]/.test(v)) commit(v);
            else { setInput(v); setError(''); }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(input); }
            if (e.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => { if (input.trim()) commit(input); }}
        />
      </div>
      {error && <p className="aiw-field-error" role="status">{error}</p>}
    </div>
  );
}

type ExampleListProps = {
  label: string;
  help: string;
  tone: 'good' | 'bad';
  value: readonly string[];
  onChange: (next: string[]) => void;
};

/** Example messages as editable rows with a trash icon (Octolens use cases, ref-1). */
export function ExampleList({ label, help, tone, value, onChange }: ExampleListProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const inputId = useId();
  const full = value.length >= MAX_EXAMPLES;

  function add() {
    const r = addExample(value, input);
    if (r.error) { setError(ADD_ERROR[r.error]); return; }
    onChange(r.list);
    setInput('');
    setError('');
  }

  return (
    <div className="aiw-field aiw-examples" data-tone={tone}>
      <div className="aiw-label-row">
        <label className="aiw-label" htmlFor={inputId}>{label}</label>
        <span className="aiw-counter" data-full={full || undefined}>{value.length} / {MAX_EXAMPLES}</span>
      </div>
      <p className="aiw-help">{help}</p>
      {value.length > 0 && (
        <ul className="aiw-example-list">
          {value.map((text, i) => (
            <li key={`${i}-${text.slice(0, 16)}`}>
              <p>{text}</p>
              <Button variant="ghost" size="icon-sm" aria-label="Удалить пример" onClick={() => onChange(removeAt(value, i))}>
                <Trash2 size={15} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="aiw-example-add">
        <Input
          id={inputId}
          value={input}
          disabled={full}
          maxLength={MAX_EXAMPLE_LENGTH}
          placeholder={full ? 'Список заполнен' : 'Вставьте сообщение из чата'}
          onChange={(e) => { setInput(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <Button variant="outline" size="sm" disabled={full || !input.trim()} onClick={add}><Plus size={14} />Добавить</Button>
      </div>
      {error && <p className="aiw-field-error" role="status">{error}</p>}
    </div>
  );
}
