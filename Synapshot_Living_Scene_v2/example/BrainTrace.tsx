"use client";
import { useEffect, useRef } from "react";
// Draw paths matching assets/brain-network.svg. Use the same geometry for stroke and spark.
const D = ['M310 440 C292 397 288 360 281 339 C233 340 192 308 186 264 C143 263 127 225 147 192 C124 158 147 123 184 121 C185 83 216 65 249 78 C277 43 323 55 346 78 C380 59 418 76 430 105 C468 107 489 140 483 171 C516 195 517 233 493 256 C504 298 471 330 433 323 C402 348 367 340 344 323 C315 353 311 386 310 440Z', 'M281 339 C263 300 277 280 298 253 C321 219 304 176 271 160 C247 149 230 157 211 176', 'M344 323 C363 282 356 242 335 219 C312 193 318 165 337 147 C364 120 401 133 425 154', 'M161 205 C198 186 215 201 231 229 C254 263 296 262 321 242 C354 220 391 231 412 257 C427 278 454 275 489 250', 'M185 121 C207 141 220 147 248 132 C280 112 306 119 327 143 C349 166 380 168 407 148 C430 131 456 151 483 171', 'M186 264 C223 244 234 267 248 288 C269 314 308 300 327 279 C344 263 374 260 404 276 C431 289 458 302 493 256', 'M249 78 C264 99 280 97 300 90 C325 81 335 91 346 111 C359 129 387 125 403 111 C414 101 424 105 430 105', 'M147 192 C165 162 184 157 206 164 M430 323 C412 306 413 295 404 276'];
const ACTIVE_MS = 14000;
const CYCLE_MS = 18000; // 4s idle before the next cycle; no abrupt active reset.
export default function BrainTrace() {
 const svg = useRef<SVGSVGElement>(null);
 useEffect(()=>{
  const el=svg.current; if(!el) return;
  const paths=Array.from(el.querySelectorAll<SVGPathElement>(".trace-path"));
  const spark=el.querySelector<SVGCircleElement>("#spark");
  const halo=el.querySelector<SVGCircleElement>("#halo");
  if(!spark||!halo)return;
  const lengths=paths.map(p=>p.getTotalLength());
  const total=lengths.reduce((a,b)=>a+b,0);
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  paths.forEach((p,i)=>{p.style.strokeDasharray=`${lengths[i]} ${lengths[i]+2}`;p.style.strokeDashoffset=String(lengths[i]);});
  let id=0; const start=performance.now();
  function frame(now:number){
   if(reduced.matches){paths.forEach((p)=>{p.style.strokeDashoffset="0";p.style.opacity=".18"});spark!.style.opacity="0";halo!.style.opacity="0";return;}
   const cycle=(now-start)%CYCLE_MS;
   const progress=Math.min(1,cycle/ACTIVE_MS);
   const distance=progress*total;
   let preceding=0, active=-1;
   paths.forEach((p,i)=>{
    const local=Math.max(0,Math.min(lengths[i],distance-preceding));
    p.style.strokeDashoffset=String(lengths[i]-local);
    // Trail fades after a path completes; fully gone before the next loop.
    const completedBy=(preceding+lengths[i])/total*ACTIVE_MS;
    const fade=cycle-completedBy;
    const opacity=local<=0?0:Math.max(0,1-Math.max(0,fade)/1300);
    p.style.opacity=String(opacity*.86);
    if(distance>=preceding && distance<preceding+lengths[i])active=i;
    preceding+=lengths[i];
   });
   if(active>=0&&cycle<ACTIVE_MS){
    const before=lengths.slice(0,active).reduce((a,b)=>a+b,0);
    const point=paths[active].getPointAtLength(Math.min(lengths[active],Math.max(0,distance-before)));
    for(const circle of [spark!,halo!]){circle.setAttribute("cx",String(point.x));circle.setAttribute("cy",String(point.y));circle.style.opacity="1";}
   }else{spark!.style.opacity="0";halo!.style.opacity="0";}
   id=requestAnimationFrame(frame);
  }
  id=requestAnimationFrame(frame);
  return()=>cancelAnimationFrame(id);
 },[]);
 return <svg ref={svg} viewBox="0 0 620 520" role="img" aria-label="Animated neural pathways">
 <defs><filter id="synGlow" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="6"/></filter></defs>
 <g fill="none" stroke="#fff0d4" strokeWidth="2.1" strokeLinecap="round" opacity=".48">{D.map((d,i)=><path key={i} d={d}/>)}</g>
 <g fill="none" stroke="#fff6db" strokeWidth="3.5" strokeLinecap="round">{D.map((d,i)=><path key={i} className="trace-path" d={d}/>)}</g>
 <circle id="halo" r="14" fill="#ffe2aa" filter="url(#synGlow)" opacity="0"/><circle id="spark" r="4" fill="#fff9e6" opacity="0"/>
 </svg>;
}
