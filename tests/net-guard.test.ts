import {describe,expect,it} from 'vitest';
import {checkProxyTarget,forbiddenHostReason} from '@/lib/security/net-guard';

describe('net-guard: запрещённые адреса прокси (SSRF)',()=>{
  it.each([
    ['127.0.0.1'],['127.8.9.10'],['0.0.0.0'],['0.1.2.3'],
    ['10.0.0.1'],['10.255.255.255'],
    ['172.16.0.1'],['172.31.255.254'],
    ['192.168.1.1'],
    ['169.254.169.254'],
    ['100.64.0.1'],['100.127.255.255'],
    ['224.0.0.1'],['239.255.255.250'],['255.255.255.255'],['240.0.0.1'],
    // альтернативные записи IPv4, которые понимает inet_aton
    ['2130706433'],['0x7f000001'],['0x7f.0.0.1'],['0177.0.0.1'],['127.1'],['10.1'],
    ['::1'],['[::1]'],['::'],['0:0:0:0:0:0:0:1'],
    ['fc00::1'],['fd12:3456::1'],
    ['fe80::1'],['febf::1'],
    ['ff02::1'],
    ['::ffff:127.0.0.1'],['::ffff:8.8.8.8'],['::ffff:7f00:1'],['[::ffff:10.0.0.1]'],
    ['localhost'],['LOCALHOST'],['localhost.'],['api.localhost'],
    ['printer.local'],['metadata.google.internal'],['db.internal'],
    ['redis'],['tg-worker'],
    [''],['bad host'],['-bad.example.com'],['a..b.com'],
  ])('отклоняет %s',(host)=>{
    expect(forbiddenHostReason(host)).not.toBeNull();
  });

  it.each([
    ['8.8.8.8'],['1.1.1.1'],['176.9.0.1'],['172.15.255.255'],['172.32.0.1'],['100.63.255.255'],['100.128.0.1'],
    ['192.0.2.10'],['198.51.100.20'],
    ['proxy.example.com'],['Proxy-1.Example.COM'],['proxy.example.com.'],
    ['2a00:1450:4001::200e'],['[2001:4860:4860::8888]'],
  ])('пропускает публичный %s',(host)=>{
    expect(forbiddenHostReason(host)).toBeNull();
  });

  it.each([
    [0],[65536],[-1],[1.5],[Number.NaN],['80'],[null],
  ])('отклоняет порт %s',(port)=>{
    expect(checkProxyTarget('8.8.8.8',port as unknown).ok).toBe(false);
  });

  it.each([[1],[1080],[65535]])('пропускает порт %s',(port)=>{
    expect(checkProxyTarget('proxy.example.com',port)).toEqual({ok:true});
  });

  it('возвращает причину для запрещённого хоста',()=>{
    const r=checkProxyTarget('127.0.0.1',1080);
    expect(r.ok).toBe(false);
    if(!r.ok)expect(r.reason).toMatch(/адрес/i);
  });
});
