import {describe,expect,it} from 'vitest';
import type {D1LikeDatabase} from '@/lib/db';
import {RecordConflictError,updateRecordData} from '@/lib/record-cas';
import {createTestD1} from './helpers/d1-sqlite';

const ID='r1';

function setup(data:string,secret:string|null='old-secret'){
  const t=createTestD1();
  t.sqlite.prepare('INSERT INTO records(id,owner,kind,data,secret,created) VALUES(?,?,?,?,?,?)').run(ID,'o','account',data,secret,'2026-10-01');
  return t;
}

function stored(t:ReturnType<typeof setup>){
  return t.sqlite.prepare('SELECT data,secret FROM records WHERE id=?').get(ID) as {data:string;secret:string|null};
}

/** Another writer changes the row right before each of our first `times` UPDATEs. */
function contended(t:ReturnType<typeof setup>,times:number):D1LikeDatabase{
  let left=times;
  return {
    prepare(q:string){
      const stmt=t.db.prepare(q);
      return {bind(...v:unknown[]){
        const bound=stmt.bind(...v);
        return {...bound,run:async()=>{
          if(left>0&&q.startsWith('UPDATE')){
            left--;
            const cur=JSON.parse(stored(t).data);
            t.sqlite.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...cur,ticks:(cur.ticks??0)+1}),ID);
          }
          return bound.run();
        }};
      }};
    },
  };
}

describe('updateRecordData (CAS)',()=>{
  it('пишет результат mutate от строки «как сейчас»',async()=>{
    const t=setup(JSON.stringify({a:1}));
    const out=await updateRecordData(t.db,'o',ID,'account',fresh=>({...fresh,b:2}));
    expect(out).toEqual({a:1,b:2});
    expect(JSON.parse(stored(t).data)).toEqual({a:1,b:2});
    expect(stored(t).secret).toBe('old-secret');
  });

  it('при параллельной записи перечитывает и не теряет чужое поле',async()=>{
    const t=setup(JSON.stringify({a:1}));
    const seen:unknown[]=[];
    await updateRecordData(contended(t,2),'o',ID,'account',fresh=>{seen.push(fresh);return {...fresh,b:2}});
    expect(seen).toHaveLength(3);
    expect(JSON.parse(stored(t).data)).toEqual({a:1,ticks:2,b:2});
  });

  it('исчерпав попытки — RecordConflictError, запись не тронута нами',async()=>{
    const t=setup(JSON.stringify({a:1}));
    await expect(updateRecordData(contended(t,100),'o',ID,'account',fresh=>({...fresh,b:2}))).rejects.toBeInstanceOf(RecordConflictError);
    expect(JSON.parse(stored(t).data).b).toBeUndefined();
  });

  it('строки нет → null; битый JSON → mutate получает null',async()=>{
    const t=setup('{broken');
    expect(await updateRecordData(t.db,'o','nope','account',()=>({}))).toBeNull();
    let got:unknown='unset';
    await updateRecordData(t.db,'o',ID,'account',fresh=>{got=fresh;return {x:1}});
    expect(got).toBeNull();
    expect(JSON.parse(stored(t).data)).toEqual({x:1});
  });

  it('secret пишется тем же UPDATE только когда передан',async()=>{
    const t=setup(JSON.stringify({}));
    await updateRecordData(t.db,'o',ID,'account',f=>({...f}),{secret:'new'});
    expect(stored(t).secret).toBe('new');
    await updateRecordData(t.db,'o',ID,'account',f=>({...f}),{secret:null});
    expect(stored(t).secret).toBeNull();
  });
});
