'use client';
/** Digit transitions inspired by Animate Digits on 21st.dev; CSS implementation. */
export function AnimatedNumber({value}:{value:number|string}){
 const text=String(value);
 return <span className="animated-number" aria-label={text}><span className="sr-only">{text}</span><span aria-hidden="true">{text.split('').map((digit,index)=><span className="digit-window" key={index}><span className="digit-enter" key={index+':'+digit}>{digit}</span></span>)}</span></span>;
}
