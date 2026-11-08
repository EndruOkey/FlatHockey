// Interpolace podle SERVEROVÉHO času (tick), render-clock plyne reálně + jemně dohání. Buffer kryje jitter, extrapolace kryje podtečení.
function mulberry(s){let a=s>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const truth=(ms)=>{const s=ms/1000;return{x:540+140*Math.sin(s*2.2),y:228+90*Math.sin(s*1.3+1)};};
function run({useServerTime, extrapCap, floor=90, profile='mild', jitterCap=Infinity}){
  const rng=mulberry(42); const SEND=1000/30, REND=1000/170, BASE=20;
  // 'mild' = původní syntetický jitter; 'harsh' = kalibrováno na reálnou telemetrii hráče
  // (snapMax 45–59, časté stalls): víc i větších špiček + občas dvě pozdě za sebou (shluk).
  const P = profile==='harsh' ? {drop:0.02, baseJ:12, holP:0.03, holMin:100, holMax:300} : {drop:0.03, baseJ:25, holP:0, holMin:80, holMax:200};
  // TCP head-of-line: občas se doručení zasekne (ztráta→retransmit); vše poslané během zámku
  // dorazí AŽ po jeho uvolnění, naráz (burst). Arrival je monotónní (ordered TCP).
  const arr=[]; let blockedUntil=0; for(let s=0;s<6000;s+=SEND){ if(rng()<P.drop)continue;
    const j=rng()*P.baseJ; let at=s+BASE+j;
    if(profile==='harsh' && rng()<P.holP) blockedUntil=Math.max(blockedUntil, at + P.holMin + rng()*(P.holMax-P.holMin));
    at=Math.max(at, blockedUntil);           // zablokované pakety čekají na uvolnění
    arr.push({at, st:s, pos:truth(s)});}
  arr.sort((a,b)=>a.at-b.at); let ai=0;
  const buf=[]; let snapMax=33,lastArr=null,bufDelay=100,prev=null,maxJump=0,freeze=0,tot=0,stalls=0,errSum=0,errN=0,interpT=null;
  for(let now=300;now<5800;now+=REND){
    while(ai<arr.length&&arr[ai].at<=now){const a=arr[ai++]; if(lastArr!=null){snapMax=Math.max(snapMax*0.9,Math.min(a.at-lastArr,jitterCap));} lastArr=a.at; buf.push({t:a.at,st:a.st,pos:a.pos}); while(buf.length>2&&buf[0].st<a.st-1200)buf.shift();}
    if(buf.length<2)continue;
    const target=Math.max(floor,Math.min(260,snapMax*1.5+25));
    bufDelay=target>bufDelay?bufDelay+(target-bufDelay)*0.08:bufDelay+(target-bufDelay)*0.02;
    const nw=buf[buf.length-1],pn=buf[buf.length-2];
    let renderT;
    if(useServerTime){ const tgt=nw.st-bufDelay; if(interpT==null)interpT=tgt; interpT+=REND; interpT+=(tgt-interpT)*Math.min(1,2*(REND/1000)); renderT=interpT; }
    else renderT=now-bufDelay;
    const key=useServerTime?'st':'t';
    let A=null,B=null; for(const f of buf){if(f[key]<=renderT)A=f;else{B=f;break;}}
    let pos;
    if(A&&B){const al=Math.min(1,Math.max(0,(renderT-A[key])/((B[key]-A[key])||1)));pos={x:A.pos.x+(B.pos.x-A.pos.x)*al,y:A.pos.y+(B.pos.y-A.pos.y)*al};}
    else{stalls++; const ahead=Math.min((renderT-nw[key])/1000,extrapCap); const iv=(nw[key]-pn[key])/1000; pos={x:nw.pos.x+(nw.pos.x-pn.pos.x)/iv*ahead, y:nw.pos.y+(nw.pos.y-pn.pos.y)/iv*ahead};}
    if(prev){const jmp=Math.hypot(pos.x-prev.x,pos.y-prev.y); maxJump=Math.max(maxJump,jmp); if(jmp<0.03)freeze++;}
    const want=truth(renderT); errSum+=Math.hypot(pos.x-want.x,pos.y-want.y); errN++; prev=pos; tot++;
  }
  return {maxJump:+maxJump.toFixed(1),freezePct:+(100*freeze/tot).toFixed(1),stalls,avgErr:+(errSum/errN).toFixed(1)};
}
console.log('podle PŘÍCHODU (teď):     ', JSON.stringify(run({useServerTime:false,extrapCap:0.22})));
console.log('podle SERV. času + extrap:', JSON.stringify(run({useServerTime:true, extrapCap:0.22})));
console.log('\n=== kalibrovaný "harsh" profil (TCP HoL dle telemetrie), sweep podlahy bufferu ===');
for(const floor of [90,110,130,150,170]){
  const r=run({useServerTime:true,extrapCap:0.22,floor,profile:'harsh'});
  console.log(`floor ${String(floor).padStart(3)} ms →`, JSON.stringify(r));
}
console.log('\n=== totéž + cap jitter špiček na 80 ms (ať DELAY negumuje) ===');
for(const floor of [90,110,130,150,170]){
  const r=run({useServerTime:true,extrapCap:0.22,floor,profile:'harsh',jitterCap:80});
  console.log(`floor ${String(floor).padStart(3)} ms →`, JSON.stringify(r));
}
console.log('\n=== vyšší extrapolace (0.35 s) místo delší podlahy, floor 110 ===');
console.log('extrap 0.35 →', JSON.stringify(run({useServerTime:true,extrapCap:0.35,floor:110,profile:'harsh',jitterCap:80})));
