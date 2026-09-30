import {describe,expect,it} from 'vitest';
import {parseProxyLines} from '@/lib/proxy-import';
import {safeRelativeReturnPath,chatGPTSignInPath} from '@/lib/auth-paths';
import {seal,unseal} from '@/lib/crypto-secrets';

describe('импорт прокси для аккаунтов',()=>{
  it('парсит socks5 и http строки',()=>{
    const rows=parseProxyLines([
      'socks5://user:pass@192.0.2.1:1080',
      'http://u:p@proxy.test:8080',
      'login:secret@host.example:9050',
    ].join('\n'));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      data:{host:'192.0.2.1',port:'1080',protocol:'socks5',username:'user'},
      secret:'pass',
    });
    expect(rows[1].data.protocol).toBe('http');
    expect(rows[2].data.protocol).toBe('socks5');
  });

  it('отклоняет пустой список, мусор и >100 строк',()=>{
    expect(()=>parseProxyLines('')).toThrow(/1 до 100/);
    expect(()=>parseProxyLines('not-a-proxy')).toThrow(/Строка 1/);
    expect(()=>parseProxyLines(Array.from({length:101},()=>'socks5://a:b@h:1').join('\n'))).toThrow(/1 до 100/);
  });
});

describe('auth return paths',()=>{
  it('блокирует open-redirect',()=>{
    expect(safeRelativeReturnPath('https://evil.example')).toBe('/');
    expect(safeRelativeReturnPath('//evil.example')).toBe('/');
    expect(safeRelativeReturnPath('/leads?x=1')).toBe('/leads?x=1');
    expect(safeRelativeReturnPath('/login')).toBe('/');
    expect(chatGPTSignInPath('/workspace')).toContain('return_to=%2Fworkspace');
    expect(chatGPTSignInPath('/workspace')).toContain('/login');
  });
});

describe('шифрование секретов',()=>{
  it('round-trip с привязкой к owner',async()=>{
    process.env.ENCRYPTION_KEY='ab'.repeat(32);
    const sealed=await seal('sk-test-key', 'owner-a');
    expect(JSON.parse(sealed)).toHaveProperty('iv');
    expect(await unseal(sealed,'owner-a')).toBe('sk-test-key');
    await expect(unseal(sealed,'owner-b')).rejects.toThrow();
  });

  it('требует корректный ENCRYPTION_KEY',async()=>{
    process.env.ENCRYPTION_KEY='short';
    await expect(seal('x','o')).rejects.toThrow(/секретов/);
  });
});
