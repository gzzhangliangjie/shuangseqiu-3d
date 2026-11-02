/* 镜像 index.html（勿忘草 Myosotis 真机比例版 DESIGN.md）的物理逻辑
   结构：完整玻璃球（管子插入，不开口）+ 等长管环形预览架（管内球沿管滑落）
        → 双转子搅拌（内盘/外环带反向）→ 底部小孔出球（开一颗关一颗）
        → 滑道（右行→下行→左行到取球位）→ 出过的球留在滑道排成一行 */
const R_BALL = 0.089, G = 22, REST_BALL = 0.55, REST_WALL = 0.62, DT = 1 / 120;

const RAIL_PTS = [
  [0.00, 2.72, 0.66], [0.00, 2.70, 1.00], [0.98, 2.63, 0.98],
  [1.22, 2.60, 0.60], [0.00, 2.62, 0.52], [-1.10, 2.61, 0.52],
];

const CFG = [
  { key:'red', cx:-3.8, cz:0, count:33, R:1.18, cy:3.74, discY:3.05, rHub:0.20, gapInner:0.25, rOuter:0.85, wInner:4.5, wOuter:-2.8,
    inletHalf:50*Math.PI/180, exitHalf:5.5*Math.PI/180, exitDir:[0,-0.85,0.527],
    holeUX:0.0, holeUZ:0.62,
    rackN:12, rackRR:0.95, rackInset:0.30, draws:6 },
  { key:'blue', cx:3.8, cz:0, count:16, R:1.18, cy:3.74, discY:3.05, rHub:0.20, gapInner:0.25, rOuter:0.85, wInner:4.5, wOuter:-2.8,
    inletHalf:50*Math.PI/180, exitHalf:5.5*Math.PI/180, exitDir:[0,-0.85,0.527],
    holeUX:0.0, holeUZ:0.62,
    rackN:12, rackRR:0.95, rackInset:0.30, draws:1 },
];

/* ---------- 滑道折线：预计算分段弧长 ---------- */
function buildRail(){
  const segs=[]; let total=0;
  for(let i=0;i<RAIL_PTS.length-1;i++){
    const a=RAIL_PTS[i], b=RAIL_PTS[i+1];
    const d=[b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const len=Math.hypot(d[0],d[1],d[2]);
    segs.push({a, d, len, t0:total, slope:d[1]/len, tan:d.map(v=>v/len)});
    total+=len;
  }
  return {segs, total};
}
const RAIL = buildRail();
function railAt(s){
  const s2=Math.max(0,Math.min(RAIL.total,s));
  for(const g of RAIL.segs){
    if(s2<=g.t0+g.len||g===RAIL.segs[RAIL.segs.length-1]){
      const t=(s2-g.t0)/g.len;
      return { pos:[g.a[0]+g.d[0]*t, g.a[1]+g.d[1]*t, g.a[2]+g.d[2]*t], slope:g.slope, tan:g.tan };
    }
  }
}

/* ---------- 预览架（与 index.html 同公式）：等长管环形排列插球壳后半部 ---------- */
function buildRack(cfg){
  const defs=[];
  const N=cfg.rackN, rt=cfg.rackRR*cfg.R;
  const per=Math.floor(cfg.count/N), rem=cfg.count%N;
  const step=(R_BALL*2+0.005)/rt;              /* 相邻管相切：弧距 = 管径，紧密排列 */
  for(let i=0;i<N;i++){
    const a=(i-(N-1)/2)*step;                  /* 0 = 正后方，全部竖直 */
    const bx=cfg.cx+Math.sin(a)*rt;
    const bz=cfg.cz-Math.cos(a)*rt;
    const ddx=Math.hypot(bx-cfg.cx, bz-cfg.cz);
    const by=cfg.cy+Math.sqrt(Math.max(0.15, cfg.R*cfg.R-ddx*ddx))-cfg.rackInset;
    defs.push({base:[bx,by,bz], dir:[0,1,0], n:i<rem?per+1:per});
  }
  return defs;
}

function makeMachine(cfg){
  const rackDefs=buildRack(cfg);
  const balls=[]; let num=0;
  for(const td of rackDefs){
    for(let k=0;k<td.n;k++){
      if(++num>cfg.count) break;
      const sT=R_BALL+0.12+k*(R_BALL*2+0.01);
      const p=[td.base[0]+td.dir[0]*sT, td.base[1]+td.dir[1]*sT, td.base[2]+td.dir[2]*sT];
      balls.push({num, p, home:p.slice(), tube:td, sT, vsT:0,
                  v:[0,0,0], state:'in', placed:false, railT:0, s:0, vs:0});
    }
  }
  return {...cfg, rackDefs, balls, agit:1, loadOpen:true, holeOpen:false, captured:null,
    cosExit:Math.cos(cfg.exitHalf),
    exitW:[cfg.cx+cfg.exitDir[0]*cfg.R, cfg.cy+cfg.exitDir[1]*cfg.R, cfg.cz+cfg.exitDir[2]*cfg.R]};
}

function stepInBall(b,m,dt){
  const v=b.v,p=b.p;

  // 预览管内：沿管轴一维下滑，到管底削尖端脱离进球壳
  if(b.tube){
    b.vsT+=-G*b.tube.dir[1]*dt;
    b.vsT*=(1-0.25*dt);
    b.sT+=b.vsT*dt;
    if(b.sT<=R_BALL+0.08) b.tube=null;
    else{
      p[0]=b.tube.base[0]+b.tube.dir[0]*b.sT;
      p[1]=b.tube.base[1]+b.tube.dir[1]*b.sT;
      p[2]=b.tube.base[2]+b.tube.dir[2]*b.sT;
      for(let k=0;k<3;k++) v[k]=b.tube.dir[k]*b.vsT;
      return;
    }
  }

  v[1]-=G*dt;
  if(m.agit>0.01){
    // 同轴双转子：内盘/外环带反向不同速，以刻缝中点分界
    const dx=p[0]-m.cx, dz=p[2]-m.cz, rr=Math.hypot(dx,dz);
    if(Math.abs(p[1]-m.discY)<0.55){
      const w=rr<(m.rHub+m.gapInner)/2?m.wInner:(rr<m.rOuter?m.wOuter:0);
      if(w!==0){
        const sp=w*m.agit*Math.min(rr,m.rOuter);
        v[0]+=-dz/(rr+1e-4)*sp*dt; v[2]+=dx/(rr+1e-4)*sp*dt;
        if(p[1]<m.discY+0.34&&p[1]>m.discY-0.16&&Math.random()<0.06) v[1]+=3.2*m.agit*dt*(0.5+Math.random());
      }
    }
  }
  if(m.holeOpen){
    const dx=m.exitW[0]-p[0],dy=m.exitW[1]-p[1],dz=m.exitW[2]-p[2];
    const dd=Math.hypot(dx,dy,dz);
    if(dd<m.R*1.8){ const s=55*(1-dd/(m.R*1.8))/dd*dt; v[0]+=dx*s; v[1]+=dy*s; v[2]+=dz*s; }
  }
  const damp=m.agit>0.01?0.4:0.15;
  for(let i=0;i<3;i++) v[i]*=Math.max(0,1-damp*dt);
  const spd=Math.hypot(v[0],v[1],v[2]);
  if(spd>5){ const k=5/spd; for(let i=0;i<3;i++) v[i]*=k; }
  for(let i=0;i<3;i++) p[i]+=v[i]*dt;

  // 转子顶面支撑：出球孔正上方留缺口
  const floorC=m.discY+0.05+R_BALL;
  const holeD=Math.hypot(p[0]-m.cx-m.holeUX, p[2]-m.cz-m.holeUZ);
  if(p[1]<floorC&&holeD>0.15){ p[1]=floorC; if(v[1]<-2.2)v[1]*=-0.25; else v[1]=0; }

  // 落球收拢：落到开口边缘外侧的球向心收
  if(m.loadOpen && p[1]>m.cy+0.4){
    const dx=p[0]-m.cx, dz=p[2]-m.cz;
    const rho=Math.hypot(dx,dz);
    const maxRho=m.R*Math.sin(m.inletHalf)-R_BALL-0.04;
    if(rho>maxRho&&rho>0.05){ v[0]-=dx/rho*30*dt; v[2]-=dz/rho*30*dt; }
  }

  // 完整球壳约束：仅出球孔可穿
  const rx=p[0]-m.cx, ry=p[1]-m.cy, rz=p[2]-m.cz;
  const d=Math.hypot(rx,ry,rz);
  if(d>m.R-R_BALL){
    const nx=rx/d,ny=ry/d,nz=rz/d;
    const inExit=m.holeOpen&&(nx*m.exitDir[0]+ny*m.exitDir[1]+nz*m.exitDir[2])>m.cosExit;
    if(inExit&&d>m.R+R_BALL*0.7&&!m.captured){
      b.state='rail'; b.placed=false; b.s=0; b.vs=2.0; m.captured=b; m.holeOpen=false;
      return;
    }
    if(!inExit){
      const push=m.R-R_BALL;
      p[0]=m.cx+nx*push; p[1]=m.cy+ny*push; p[2]=m.cz+nz*push;
      const vn=v[0]*nx+v[1]*ny+v[2]*nz;
      if(vn>0){ const f=(1+REST_WALL)*vn;
        v[0]-=f*nx; v[1]-=f*ny; v[2]-=f*nz;
        v[0]*=0.985; v[1]*=0.985; v[2]*=0.985; }
    }
  }
}

function stepRailBall(b,m,dt){
  b.railT+=dt;
  const q=railAt(b.s);
  b.vs+=-G*q.slope*dt;
  b.vs*=(1-0.55*dt);
  b.s+=b.vs*dt;
  if(b.s<0){ b.s=0; b.vs*=-0.25; }
  if(b.s>RAIL.total){ b.s=RAIL.total; b.vs*=-0.25; }
  const q2=railAt(b.s);
  b.p[0]=m.cx+q2.pos[0]; b.p[1]=q2.pos[1]+R_BALL; b.p[2]=m.cz+q2.pos[2];
  for(let k=0;k<3;k++) b.v[k]=q2.tan[k]*b.vs;
  if(!b.placed&&((b.railT>1.5&&Math.abs(b.vs)<0.35)||b.railT>5)) b.placed=true;
}

function collideTubes(m){
  const byTube=new Map();
  for(const b of m.balls){ if(!b.tube) continue;
    if(!byTube.has(b.tube)) byTube.set(b.tube,[]);
    byTube.get(b.tube).push(b); }
  const minD=R_BALL*2+0.005;
  for(const arr of byTube.values()){
    arr.sort((a,c)=>a.sT-c.sT);
    for(let i=0;i<arr.length-1;i++){
      const lo=arr[i],up=arr[i+1];
      if(up.sT<lo.sT+minD) up.sT=lo.sT+minD;
    }
  }
}

function collideRail(arr,m){
  arr.sort((a,c)=>a.s-c.s);
  const minD=R_BALL*2+0.02;
  for(let i=0;i<arr.length-1;i++){
    const a=arr[i],c=arr[i+1];
    const d=c.s-a.s;
    if(d<minD){
      const push=(minD-d)/2;
      a.s=Math.max(0,a.s-push);
      c.s=Math.min(RAIL.total,c.s+push);
      if(a.vs>c.vs){ const t=a.vs; a.vs=c.vs; c.vs=t*0.5; }
    }
  }
}

function collideGroup(arr){
  for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){
    const a=arr[i],b=arr[j];
    const rx=b.p[0]-a.p[0],ry=b.p[1]-a.p[1],rz=b.p[2]-a.p[2];
    const d=Math.hypot(rx,ry,rz),min=R_BALL*2;
    if(d>1e-6&&d<min){
      const nx=rx/d,ny=ry/d,nz=rz/d,ov=(min-d)/2;
      a.p[0]-=nx*ov; a.p[1]-=ny*ov; a.p[2]-=nz*ov;
      b.p[0]+=nx*ov; b.p[1]+=ny*ov; b.p[2]+=nz*ov;
      const rv=(b.v[0]-a.v[0])*nx+(b.v[1]-a.v[1])*ny+(b.v[2]-a.v[2])*nz;
      if(rv<0){ const imp=-(1+REST_BALL)*rv*0.5;
        for(let k=0;k<3;k++){ a.v[k]-=[nx,ny,nz][k]*imp; b.v[k]+=[nx,ny,nz][k]*imp; } }
    }
  }
}

function runMachine(m, log){
  let t=0, placedCount=0, stirT=0, holePhase=false;
  while(t<150){
    t+=DT;
    if(!m.captured){
      if(!holePhase){ stirT+=DT; if(stirT>3){ m.holeOpen=true; holePhase=true; stirT=0; } }
      else { stirT+=DT; if(stirT>3.5){ stirT=1.0; // 防堵：定期给最近球冲量 + 全场抖动
          let best=null,bd=1e9;
          for(const b of m.balls){ if(b.state!=='in'||b.tube)continue;
            const dd=Math.hypot(m.exitW[0]-b.p[0],m.exitW[1]-b.p[1],m.exitW[2]-b.p[2]);
            if(dd<bd){bd=dd;best=b;} }
          if(best){ const dx=m.exitW[0]-best.p[0],dy=m.exitW[1]-best.p[1],dz=m.exitW[2]-best.p[2];
            const dd=Math.hypot(dx,dy,dz)||1; best.v[0]+=dx/dd*3.5; best.v[1]+=dy/dd*3.5; best.v[2]+=dz/dd*3.5; }
          for(const b of m.balls){ if(b.state!=='in'||b.tube)continue;
            b.v[0]+=(Math.random()-0.5)*1.2; b.v[1]+=Math.random()*1.0; b.v[2]+=(Math.random()-0.5)*1.2; } } }
    } else if(m.captured&&m.captured.placed){
      m.captured=null; placedCount++; holePhase=false; stirT=0;
    }
    for(const b of m.balls){
      if(b.state==='in') stepInBall(b,m,DT);
      else if(b.state==='rail') stepRailBall(b,m,DT);
    }
    collideGroup(m.balls.filter(b=>b.state==='in'&&!b.tube));
    collideTubes(m);
    collideRail(m.balls.filter(b=>b.state==='rail'),m);
    if(placedCount>=m.draws) break;
  }
  if(placedCount<m.draws){ log(`${m.key}: FAIL 只出球 ${placedCount}/${m.draws} (t=${t.toFixed(1)}s)`); return false; }
  const done=m.balls.filter(b=>b.placed);
  const ss=done.map(b=>+b.s.toFixed(2)).sort((a,b)=>a-b);
  const gaps=[];
  for(let i=1;i<ss.length;i++) gaps.push(+(ss[i]-ss[i-1]).toFixed(3));
  log(`${m.key}: OK ${placedCount}/${m.draws} 出球耗时 ${t.toFixed(1)}s  排队s=[${ss.join(',')}]
     排成一行=${done.every(b=>b.s>RAIL.total-1.6)}  球间距=[${gaps.join(',')}]（应≈0.20）`);
  return true;
}

console.log('=== 勿忘草真机比例仿真（完整球壳+环形预览架→双转子搅拌→底部小孔→滑道排队）===');
console.log(`滑道总长 ${RAIL.total.toFixed(2)}`);
let allOK=true;
for(const cfg of CFG){
  for(let round=1;round<=3;round++){
    const m=makeMachine(cfg);
    const lines=[];
    const ok=runMachine(m,l=>lines.push(l));
    if(round===1||!ok) console.log(lines.join('\n'));
    if(!ok) allOK=false;
  }
}
console.log(allOK?'\n全部通过 ✓':'\n存在失败 ✗');
