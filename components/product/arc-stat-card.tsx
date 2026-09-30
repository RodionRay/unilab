'use client';

import {AnimatedNumber} from '@/components/product/animated-number';

export type ArcSegment={
  value:number;
  color:string;
  labelColor?:string;
};

function polar(cx:number,cy:number,r:number,angleDeg:number){
  const a=(angleDeg*Math.PI)/180;
  return {x:cx+r*Math.cos(a),y:cy-r*Math.sin(a)};
}

function arcPath(cx:number,cy:number,r:number,start:number,end:number){
  const a=polar(cx,cy,r,start);
  const b=polar(cx,cy,r,end);
  const large=Math.abs(start-end)>180?1:0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

function HalfArc({segments}:{segments:ArcSegment[]}){
  const parts=segments.filter(s=>s.value>0);
  const total=parts.reduce((n,s)=>n+s.value,0);
  if(!total)return null;

  const cx=110;
  const cy=108;
  const r=76;
  const sweep=180;
  const gap=parts.length>1?3.2:0;
  const usable=sweep-gap*Math.max(0,parts.length-1);

  let cursor=180;
  const slices=parts.map(s=>{
    const span=Math.max(4,(s.value/total)*usable);
    const start=cursor;
    const end=cursor-span;
    cursor=end-gap;
    const mid=(start+end)/2;
    const label=polar(cx,cy,r,mid);
    return {...s,start,end,mid,label};
  });

  const first=slices[0];
  const last=slices[slices.length-1];
  const startCap=polar(cx,cy,r,first.start);
  const endCap=polar(cx,cy,r,last.end);

  return (
    <svg className="arc-stat-svg" viewBox="0 0 220 120" aria-hidden>
      <circle cx={startCap.x} cy={startCap.y} r="19" fill={first.color}/>
      <circle cx={endCap.x} cy={endCap.y} r="19" fill={last.color}/>
      {slices.map((s,i)=>(
        <path
          key={`${s.color}-${i}`}
          d={arcPath(cx,cy,r,s.start,s.end)}
          fill="none"
          stroke={s.color}
          strokeWidth="38"
          strokeLinecap="butt"
        />
      ))}
      {slices.map((s,i)=>(
        <text
          key={`l-${i}`}
          x={s.label.x}
          y={s.label.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={s.labelColor||'rgba(255,255,255,0.88)'}
          fontSize={s.value>=1000?11:12}
          fontWeight={600}
          fontFamily="inherit"
        >
          {s.value}
        </text>
      ))}
    </svg>
  );
}

export function ArcStatCard({
  title,
  value,
  segments,
  loading,
  emptyLabel='Нет данных',
  onClick,
}:{
  title:string;
  value:number;
  segments:ArcSegment[];
  loading?:boolean;
  emptyLabel?:string;
  onClick:()=>void;
}){
  const hasData=segments.some(s=>s.value>0);
  return (
    <button type="button" className="arc-stat" onClick={onClick}>
      <div className="arc-stat-copy">
        <span className="arc-stat-title">{title}</span>
        <strong className="arc-stat-value">
          <AnimatedNumber value={loading?'—':value}/>
        </strong>
      </div>
      <div className="arc-stat-chart">
        {hasData?(
          <HalfArc segments={segments}/>
        ):(
          <span className="arc-stat-empty">{emptyLabel}</span>
        )}
      </div>
    </button>
  );
}
