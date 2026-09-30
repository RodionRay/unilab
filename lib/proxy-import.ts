export type ParsedProxy={
  data:{
    name:string;
    host:string;
    port:string;
    protocol:string;
    username:string;
  };
  secret:string;
};

/** Разбор списка прокси (по строке) для импорта в аккаунты. */
export function parseProxyLines(text:string):ParsedProxy[]{
  const lines=text.split(/\r?\n/).map((s)=>s.trim()).filter(Boolean);
  if(!lines.length||lines.length>100){
    throw new Error('Введите от 1 до 100 прокси');
  }
  return lines.map((line,i)=>{
    let u:URL;
    try{
      u=new URL(line.includes('://')?line:'socks5://'+line);
    }catch{
      throw new Error(`Строка ${i+1}: проверьте формат`);
    }
    const port=u.port||(u.protocol==='http:'?'80':'');
    if(
      !['socks5:','http:'].includes(u.protocol)||
      !u.hostname||
      !port||
      Number(port)>65535||
      (u.pathname&&u.pathname!=='/')||
      u.search||
      u.hash
    ){
      throw new Error(`Строка ${i+1}: нужен socks5://login:password@host:port`);
    }
    return {
      data:{
        name:'Прокси '+u.hostname+':'+port,
        host:u.hostname,
        port,
        protocol:u.protocol.slice(0,-1),
        username:decodeURIComponent(u.username),
      },
      secret:decodeURIComponent(u.password),
    };
  });
}
