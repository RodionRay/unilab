import {describe,expect,it} from 'vitest';
import {
  canPrepareDraft,
  draftConcurrencyOk,
  extractOpenAiDraft,
  isMailingReady,
  mailingPayload,
  secretMutationOk,
} from '@/lib/processes/mailings';

describe('рассылки / подготовка черновиков',()=>{
  it('ограничивает AI-черновик одним запросом в минуту',()=>{
    const now=new Date('2026-09-18T12:00:00.000Z');
    expect(canPrepareDraft(null,now)).toBe(true);
    expect(canPrepareDraft('2026-09-18T11:59:30.000Z',now)).toBe(false);
    expect(canPrepareDraft('2026-09-18T11:58:59.000Z',now)).toBe(true);
  });

  it('достаёт текст из Responses API',()=>{
    expect(extractOpenAiDraft({
      output:[
        {content:[{type:'output_text',text:'Здравствуйте! '},{type:'refusal',text:'x'}]},
        {content:[{type:'output_text',text:'Можем помочь с остатками.'}]},
      ],
    })).toBe('Здравствуйте! \nМожем помочь с остатками.');
    expect(extractOpenAiDraft({output:[]})).toBe('');
    expect(extractOpenAiDraft(null)).toBe('');
  });

  it('не сохраняет черновик при изменённом сообщении лида',()=>{
    expect(draftConcurrencyOk('старое','старое')).toBe(true);
    expect(draftConcurrencyOk('новое','старое')).toBe(false);
  });

  it('считает лид готовым к рассылке только с черновиком и не в архиве',()=>{
    expect(isMailingReady({message:'Нужна помощь',draft:'Ответ',status:'working'})).toBe(true);
    expect(isMailingReady({message:'Нужна помощь',draft:'',status:'new'})).toBe(false);
    expect(isMailingReady({message:'Нужна помощь',draft:'Ответ',status:'archived'})).toBe(false);
  });

  it('формирует пейлоуд копирования/отправки',()=>{
    expect(mailingPayload({draft:'  Текст  ',status:'new'})).toEqual({text:'Текст',ok:true});
    expect(mailingPayload({draft:'',status:'new'}).ok).toBe(false);
    expect(mailingPayload({draft:'x',status:'archived'}).reason).toBe('Лид в архиве');
  });

  it('запрещает одновременную замену и очистку секрета',()=>{
    expect(secretMutationOk(true,'sk-new').ok).toBe(false);
    expect(secretMutationOk(true,undefined).ok).toBe(true);
    expect(secretMutationOk(false,'sk-new').ok).toBe(true);
    expect(secretMutationOk('yes',undefined).ok).toBe(false);
  });
});
