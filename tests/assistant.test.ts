import {afterEach,describe,expect,it,vi} from 'vitest';
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

describe('UniLab assistant · ключ и провайдер в паре (REQ-C12)',()=>{
  const KEYS=['AI_API_KEY','DEEPSEEK_API_KEY','OPENAI_API_KEY','ASSISTANT_OPENAI_KEY','AI_API_BASE','OPENAI_API_BASE','ASSISTANT_MODEL','AI_MODEL'];
  const input={message:'Как работает рассылка?',history:[],surface:'site' as const};
  const okReply=()=>Response.json({choices:[{message:{content:'Ответ ассистента'}}]});
  const clearKeys=()=>{for(const k of KEYS)vi.stubEnv(k,'')};
  afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks()});

  it('OpenAI-ключ уходит только на OpenAI, не на DeepSeek',async()=>{
    clearKeys();
    vi.stubEnv('OPENAI_API_KEY','sk-openai-test');
    const fetchImpl=vi.fn<typeof fetch>(async()=>okReply());

    const r=await generateAssistantReply(input,{fetchImpl});

    expect(r.source).toBe('openai');
    const [url,init]=fetchImpl.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(String(url)).not.toMatch(/deepseek/i);
    expect((init.headers as Record<string,string>).Authorization).toBe('Bearer sk-openai-test');
  });

  it('ASSISTANT_OPENAI_KEY при заданном AI_API_BASE (DeepSeek) всё равно идёт на OpenAI',async()=>{
    clearKeys();
    vi.stubEnv('ASSISTANT_OPENAI_KEY','sk-assistant-test');
    vi.stubEnv('AI_API_BASE','https://api.deepseek.com');
    const fetchImpl=vi.fn<typeof fetch>(async()=>okReply());

    await generateAssistantReply(input,{fetchImpl});

    expect(String(fetchImpl.mock.calls[0]?.[0])).toMatch(/^https:\/\/api\.openai\.com\//);
  });

  it('DeepSeek-ключ из окружения идёт на DeepSeek',async()=>{
    clearKeys();
    vi.stubEnv('DEEPSEEK_API_KEY','sk-deepseek-test');
    const fetchImpl=vi.fn<typeof fetch>(async()=>okReply());

    await generateAssistantReply(input,{fetchImpl});

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://api.deepseek.com/chat/completions');
  });

  it('явный ключ проекта (DeepSeek) идёт на DeepSeek, даже если есть OpenAI-ключ',async()=>{
    clearKeys();
    vi.stubEnv('OPENAI_API_KEY','sk-openai-test');
    const fetchImpl=vi.fn<typeof fetch>(async()=>okReply());

    await generateAssistantReply(input,{apiKey:'sk-project-deepseek',fetchImpl});

    const [url,init]=fetchImpl.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init.headers as Record<string,string>).Authorization).toBe('Bearer sk-project-deepseek');
  });

  it('не-OK ответ провайдера логируется (без ключа) и даёт fallback',async()=>{
    clearKeys();
    vi.stubEnv('DEEPSEEK_API_KEY','sk-deepseek-test');
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    const fetchImpl=vi.fn<typeof fetch>(async()=>new Response('invalid api key',{status:401}));

    const r=await generateAssistantReply(input,{fetchImpl});

    expect(r.source).toBe('knowledge');
    expect(warn).toHaveBeenCalled();
    const logged=JSON.stringify(warn.mock.calls);
    expect(logged).toMatch(/401/);
    expect(logged).not.toContain('sk-deepseek-test');
  });

  it('сетевой сбой логируется и даёт fallback',async()=>{
    clearKeys();
    vi.stubEnv('DEEPSEEK_API_KEY','sk-deepseek-test');
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
    const fetchImpl=vi.fn<typeof fetch>(async()=>{throw new Error('ECONNRESET')});

    const r=await generateAssistantReply(input,{fetchImpl});

    expect(r.source).toBe('knowledge');
    expect(JSON.stringify(warn.mock.calls)).toMatch(/ECONNRESET/);
  });
});
