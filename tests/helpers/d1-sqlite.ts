import Database from 'better-sqlite3';
import type {D1LikeDatabase} from '@/lib/db';

/** In-memory SQLite behind the D1 prepare/bind/all/first/run surface used by the app. */
export type TestD1={db:D1LikeDatabase;sqlite:Database.Database};

const SCHEMA=`
CREATE TABLE records (id text PRIMARY KEY NOT NULL, owner text NOT NULL, kind text NOT NULL, data text NOT NULL, secret text, created text NOT NULL);
CREATE INDEX idx_records_owner_kind ON records (owner, kind);
CREATE TABLE users (id text PRIMARY KEY NOT NULL, email text, name text);
`;

function toSqlValue(v:unknown){
 if(typeof v==='boolean')return v?1:0;
 if(v===undefined)return null;
 return v;
}

export function createTestD1():TestD1{
 const sqlite=new Database(':memory:');
 sqlite.exec(SCHEMA);
 const db:D1LikeDatabase={
  prepare(sql:string){
   return {
    bind(...raw:unknown[]){
     const values=raw.map(toSqlValue);
     return {
      async all(){
       const stmt=sqlite.prepare(sql);
       if(!stmt.reader){stmt.run(...values);return {results:[]}}
       return {results:stmt.all(...values) as Record<string,unknown>[]};
      },
      async first<T=Record<string,unknown>>(){
       const stmt=sqlite.prepare(sql);
       if(!stmt.reader){stmt.run(...values);return null}
       return (stmt.get(...values) as T|undefined)??null;
      },
      async run(){
       const stmt=sqlite.prepare(sql);
       if(stmt.reader){stmt.all(...values);return {meta:{changes:0}}}
       return {meta:{changes:stmt.run(...values).changes}};
      },
     };
    },
   };
  },
 };
 return {db,sqlite};
}
