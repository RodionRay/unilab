import {describe,expect,it} from 'vitest';
import {
  buildAssistantSystemPrompt,
  fallbackAssistantReply,
  matchAssistantFaq,
  PRODUCT_NAME,
} from '@/lib/product-knowledge';
import {
  assistantRequestSchema,
  canAskAssistant,
  generateAssistantReply,
} from '@/lib/assistant-chat';

describe('UniLab assistant',()=>{
  it('system prompt про UniLab',()=>{
    const p=buildAssistantSystemPrompt();
    expect(PRODUCT_NAME).toBe('UniLab');
    expect(p).toContain('UniLab');
    expect(p).toMatch(/антибан|вступлен/i);
    expect(p).toMatch(/тёплые заявки|Telegram/i);
  });

  it('FAQ без ключа',()=>{
    expect(matchAssistantFaq('Что такое UniLab?')).toMatch(/Telegram/i);
    expect(fallbackAssistantReply('xyz')).toMatch(/UniLab/);
  });

  it('валидация и rate limit',()=>{
    expect(assistantRequestSchema.parse({message:'Как работает рассылка?',surface:'admin'}).surface).toBe('admin');
    expect(canAskAssistant(null)).toBe(true);
    expect(canAskAssistant(new Date().toISOString())).toBe(false);
  });

  it('без ключа knowledge fallback',async()=>{
    const prev=process.env.AI_API_KEY;
    delete process.env.AI_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ASSISTANT_OPENAI_KEY;
    const r=await generateAssistantReply({message:'Что такое UniLab?',history:[],surface:'site'},{apiKey:null});
    expect(r.source).toBe('knowledge');
    expect(r.reply).toMatch(/Telegram|UniLab/i);
    if(prev!==undefined)process.env.AI_API_KEY=prev;
  });
});
