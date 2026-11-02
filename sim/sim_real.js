/* 镜像 index.html（勿忘草 Myosotis 真机比例版 DESIGN.md）的物理逻辑
   验证：预览管落球 → 双转子搅拌（内盘/外环带反向）→ 底部小孔出球（开一颗关一颗）
        → 滑道（竖井→右行→右端下行→左行到取球位）→ 取球位停稳入位 */
const R_BALL = 0.089, G = 22, REST_BALL = 0.55, REST_WALL = 0.62, DT = 1 / 120;

const RAIL_PTS = [
  [0.00, 2.52, 0.40], [0.00, 2.46, 0.90], [0.92, 2.44, 0.90],
  [1.12, 2.37, 0.60], [0.00, 2.31, 0.55], [-1.10, 2.27, 0.55],
];

const CFG = [
  { key:'red', cx:-3.8, cz:0, count:33, R:1.18, cy:3.68, discY:2.66, rHub:0.40, gapInner:0.52, rOuter:1.02, wInner:14, wOuter:-9,
    inletHalf:50*Math.PI/180, exitHalf:5.5*Math.PI/180, exitDir:[0,-0.95,0.31],
    holeUX:0.0, holeUZ:0.40, tubePitch:0.25, tubeRowN:7, tubeLoad:[5,5,5,3,5,5,5], tubeInset:0.25, draws:6 },
  { key:'blue', cx:3.8, cz:0, count:16, R:1.18, cy:3.68, discY:2.66, rHub:0.40, gapInner:0.52, rOuter:1.02, wInner:14, wOuter:-9,
    inletHalf:50*Math.PI/180, exitHalf:5.5*Math.PI/180, exitDir:[0,-0.95,0.31],
    holeUX:0.0, holeUZ:0.40, tubePitch:0.25, tubeRowN:7, tubeLoad:[3,2,2,2,2,2,3], tubeInset:0.25, draws:1 },
];

/* ---------- 滑道折线：预计算分段弧长，s → 位置/坡度/切向 ---------- */
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

function makeMachine(cfg){
  // 预览架竖管内初始位（管底 = 开口平面下方 tubeInset，管插入球壳）
  const balls=[];
  const y0=cfg.cy+cfg.R*Math.cos(cfg.inletHalf)-cfg.tubeInset;
  let num=0;
  for(let i=0;i<cfg.tubeRowN;i++){
    const x=cfg.cx+(i-(cfg.tubeRowN-1)/2)*cfg.tubePitch;
    for(let k=0;k<cfg.tubeLoad[i];k++){
      if(++num>cfg.count) break;
      balls.push({num, p:[x, y0+R_BALL+0.02+k*(R_BALL*2+0.02), cfg.cz],
                  v:[0,0,0], state:'in', placed:false, railT:0, s:0, vs:0});
    }
  }
  return {...cfg, balls, agit:1, loadOpen:false, holeOpen:false, captured:null,
    cosInlet:Math.cos(cfg.inletHalf), cosExit:Math.cos(cfg.exitHalf),
    exitW:[cfg.cx+cfg.exitDir[0]*cfg.R, cfg.cy+cfg.exitDir[1]*cfg.R, cfg.cz+cfg.exitDir[2]*cfg.R]};
}

function stepInBall(b,m,dt){
  const v=b.v,p=b.p;
  v[1]-=G*dt;
  if(m.agit>0.01){
    // 同轴双转子（专利 US6145836）：内盘/外环带反向不同速，以刻缝中点分界
    const dx=p[0]-m.cx, dz=p[2]-m.cz, rr=Math.hypot(dx,dz);
    if(Math.abs(p[1]-m.discY)<0.55){
      const w=rr<(m.rHub+m.gapInner)/2?m.wInner:(rr<m.rOuter?m.wOuter:0);
      if(w!==0){
        const sp=w*m.agit*Math.min(rr,m.rOuter)*1.3;
        v[0]+=-dz/(rr+1e-4)*sp*dt; v[2]+=dx/(rr+1e-4)*sp*dt;
        if(p[1]<m.discY+0.34&&p[1]>m.discY-0.16&&Math.random()<0.24) v[1]+=7.5*m.agit*dt*(0.5+Math.random());
      }
    }
  }
  if(m.holeOpen){
    const dx=m.exitW[0]-p[0],dy=m.exitW[1]-p[1],dz=m.exitW[2]-p[2];
    const dd=Math.hypot(dx,dy,dz);
    if(dd<m.R*1.8){ const s=130*(1-dd/(m.R*1.8))/dd*dt; v[0]+=dx*s; v[1]+=dy*s; v[2]+=dz*s; }
  }
  const damp=m.agit>0.01?0.4:0.15;
  for(let i=0;i<3;i++) v[i]*=Math.max(0,1-damp*dt);
  for(let i=0;i<3;i++) p[i]+=v[i]*dt;

  // 转子顶面支撑：球坐在双转子上；出球孔正上方留缺口，球滚到那里就掉进孔
  const floorC=m.discY+0.05+R_BALL;
  const holeD=Math.hypot(p[0]-m.cx-m.holeUX, p[2]-m.cz-m.holeUZ);
  if(p[1]<floorC&&holeD>0.15){ p[1]=floorC; if(v[1]<-2.2)v[1]*=-0.25; else v[1]=0; }

  // 落球收拢：仅对落到开口边缘外侧的球施加向心力（与 index.html 一致）
  if(m.loadOpen && p[1]>m.cy+0.4){
    const dx=p[0]-m.cx, dz=p[2]-m.cz;
    const rho=Math.hypot(dx,dz);
    const maxRho=m.R*Math.sin(m.inletHalf)-R_BALL-0.04;
    if(rho>maxRho&&rho>0.05){ v[0]-=dx/rho*30*dt; v[2]-=dz/rho*30*dt; }
  }

  const rx=p[0]-m.cx, ry=p[1]-m.cy, rz=p[2]-m.cz;
  const d=Math.hypot(rx,ry,rz);
  if(d>m.R-R_BALL){
    const nx=rx/d,ny=ry/d,nz=rz/d;
    const inInlet=m.loadOpen&&ny>m.cosInlet;
    const inExit=m.holeOpen&&(nx*m.exitDir[0]+ny*m.exitDir[1]+nz*m.exitDir[2])>m.cosExit;
    if(inExit&&d>m.R+R_BALL*0.7&&!m.captured){
      b.state='rail'; b.placed=false; b.s=0; b.vs=2.0; m.captured=b; m.holeOpen=false;
      for(const ob of m.balls) if(ob!==b&&ob.placed&&ob.state==='rail') ob.state='done';
      return;
    }
    if(!inInlet&&!inExit){
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
  p_set(b.p, m.cx+q2.pos[0], q2.pos[1]+R_BALL, m.cz+q2.pos[2]);
  for(let k=0;k<3;k++) b.v[k]=q2.tan[k]*b.vs;
  if(!b.placed&&((b.railT>1.5&&Math.abs(b.vs)<0.35)||b.railT>5)) b.placed=true;
}
function p_set(p,x,y,z){ p[0]=x; p[1]=y; p[2]=z; }

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
  m.loadOpen=true; let loadT=0;
  while(t<150){
    t+=DT;
    if(m.loadOpen){
      loadT+=DT;
      if(loadT>2.5||m.balls.every(b=>b.p[1]<m.cy+m.R*0.45)){ m.loadOpen=false; }
    } else if(!m.captured){
      if(!holePhase){ stirT+=DT; if(stirT>3){ m.holeOpen=true; holePhase=true; stirT=0; } }
      else { stirT+=DT; if(stirT>3.5){ stirT=1.0; // 防堵：定期给最近球冲量 + 全场抖动（模拟真机持续搅拌防拱）
          let best=null,bd=1e9;
          for(const b of m.balls){ if(b.state!=='in')continue;
            const dd=Math.hypot(m.exitW[0]-b.p[0],m.exitW[1]-b.p[1],m.exitW[2]-b.p[2]);
            if(dd<bd){bd=dd;best=b;} }
          if(best){ const dx=m.exitW[0]-best.p[0],dy=m.exitW[1]-best.p[1],dz=m.exitW[2]-best.p[2];
            const dd=Math.hypot(dx,dy,dz)||1; best.v[0]+=dx/dd*7; best.v[1]+=dy/dd*7; best.v[2]+=dz/dd*7; }
          for(const b of m.balls){ if(b.state!=='in')continue;
            b.v[0]+=(Math.random()-0.5)*3; b.v[1]+=Math.random()*2.5; b.v[2]+=(Math.random()-0.5)*3; } } }
    } else if(m.captured&&m.captured.placed){
      m.captured=null; placedCount++; holePhase=false; stirT=0;
    }
    for(const b of m.balls){
      if(b.state==='in') stepInBall(b,m,DT);
      else if(b.state==='rail') stepRailBall(b,m,DT);
    }
    collideGroup(m.balls.filter(b=>b.state==='in'));
    collideRail(m.balls.filter(b=>b.state==='rail'),m);
    if(placedCount>=m.draws) break;
  }
  if(placedCount<m.draws){ log(`${m.key}: FAIL 只出球 ${placedCount}/${m.draws} (t=${t.toFixed(1)}s)`); return false; }
  const done=m.balls.filter(b=>b.placed);
  const ss=done.map(b=>+b.s.toFixed(2));
  log(`${m.key}: OK ${placedCount}/${m.draws} 出球耗时 ${t.toFixed(1)}s  取球位s=[${ss.join(',')}]
     全部到达取球端=${done.every(b=>b.s>RAIL.total*0.8)}`);
  return true;
}

console.log('=== 勿忘草真机比例仿真（落球→双转子搅拌→底部小孔→滑道→取球位）===');
console.log(`滑道总长 ${RAIL.total.toFixed(2)}，取球位在 s=${RAIL.total.toFixed(2)}`);
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
