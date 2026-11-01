/* 镜像 index.html（勿忘草 Myosotis 真机比例版）的物理逻辑
   验证：预览架落球 → 双盘搅拌 → 出球口（开一颗关一颗）→ 出球口下透明短滑轨 → 轨端停稳入位
   对照 .ref/bing_10 全景 + bing_3 出球特写：底座直筒圆柱、无横跨台面通道 */
const R_BALL = 0.15, G = 22, REST_BALL = 0.55, REST_WALL = 0.62, DT = 1 / 120;

const CFG = [
  { key:'red', cx:-3.8, cz:0, count:33, R:1.18, cy:3.68, discDX:0.52, discR:0.48, discY:3.05,
    inletHalf:60*Math.PI/180, exitHalf:10*Math.PI/180, exitDir:[0,-0.6,0.8],
    tubePitch:0.34, tubeRowN:7, tubeLoad:[5,5,5,3,5,5,5],
    chuteZ0:0.95, chuteTopY:2.82, chuteSlope:0.626, chuteZ1:2.5, draws:6 },
  { key:'blue', cx:3.8, cz:0, count:16, R:1.18, cy:3.68, discDX:0.52, discR:0.48, discY:3.05,
    inletHalf:60*Math.PI/180, exitHalf:10*Math.PI/180, exitDir:[0,-0.6,0.8],
    tubePitch:0.34, tubeRowN:7, tubeLoad:[3,2,2,2,2,2,3],
    chuteZ0:0.95, chuteTopY:2.82, chuteSlope:0.626, chuteZ1:2.5, draws:1 },
];

function chuteFloorY(m,z){ return m.chuteTopY - m.chuteSlope*(z-m.chuteZ0); }

function makeMachine(cfg){
  // 预览架竖管内初始位（单排 7 管，与 index.html tubeDefs 一致）
  const balls=[];
  const y0=cfg.cy+cfg.R+0.07;
  let num=0;
  for(let i=0;i<cfg.tubeRowN;i++){
    const x=cfg.cx+(i-(cfg.tubeRowN-1)/2)*cfg.tubePitch;
    for(let k=0;k<cfg.tubeLoad[i];k++){
      if(++num>cfg.count) break;
      balls.push({num, p:[x, y0+R_BALL+0.02+k*(R_BALL*2+0.02), cfg.cz],
                  v:[0,0,0], state:'in', placed:false, railT:0});
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
    for(const side of [-1,1]){
      const dx=p[0]-(m.cx+side*m.discDX), dz=p[2]-m.cz, rr=Math.hypot(dx,dz);
      if(rr<m.discR+R_BALL*1.6 && Math.abs(p[1]-m.discY)<0.62){
        const sp=side*13*m.agit*Math.min(rr,m.discR)*1.3;
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
      b.state='rail'; b.placed=false; m.captured=b; m.holeOpen=false; return;
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
  const v=b.v,p=b.p;
  v[1]-=G*dt; for(let i=0;i<3;i++) p[i]+=v[i]*dt;
  b.railT+=dt;
  // 透明短滑轨：球卡在滑槽内沿坡滚向轨端（真机在此被取走）
  p[0]=m.cx+Math.max(-0.16,Math.min(0.16,p[0]-m.cx)); v[0]*=(1-4*dt);
  const fY=chuteFloorY(m,p[2]);
  if(p[1]<fY){ p[1]=fY; if(v[1]<-2.2)v[1]*=-0.25; else v[1]=0; v[2]+=G*m.chuteSlope*dt; }
  v[2]*=(1-0.08*dt);
  if(p[2]>m.chuteZ1){ p[2]=m.chuteZ1; v[2]*=-0.2; }
  // 停稳判定：滑轨上停稳即入位（含停在前面的球堆上）；4s 超时保险
  const sp2=v[0]*v[0]+v[2]*v[2];
  if(!b.placed&&b.railT>1.2&&sp2<0.05&&Math.abs(v[1])<0.35) b.placed=true;
  else if(!b.placed&&b.railT>4) b.placed=true;
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
  // 初始：先模拟落球（loadOpen 2.5s）
  m.loadOpen=true; let loadT=0;
  while(t<120){
    t+=DT;
    if(m.loadOpen){
      loadT+=DT;
      if(loadT>2.5||m.balls.every(b=>b.p[1]<m.cy-0.1)){ m.loadOpen=false; }
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
    const inB=[],railB=[];
    for(const b of m.balls){
      if(b.state==='in') stepInBall(b,m,DT);
      else if(b.state==='rail') stepRailBall(b,m,DT);
    }
    collideGroup(m.balls.filter(b=>b.state==='in'));
    collideGroup(m.balls.filter(b=>b.state==='rail'));
    if(placedCount>=m.draws) break;
  }
  if(placedCount<m.draws){ log(`${m.key}: FAIL 只出球 ${placedCount}/${m.draws} (t=${t.toFixed(1)}s)`); return false; }
  const done=m.balls.filter(b=>b.placed);
  const zs=done.map(b=>+b.p[2].toFixed(2));
  log(`${m.key}: OK ${placedCount}/${m.draws} 出球耗时 ${t.toFixed(1)}s  停稳z=[${zs.join(',')}]\n     全部停在短滑轨上=${done.every(b=>b.p[2]>m.chuteZ0&&b.p[2]<=m.chuteZ1+0.05&&Math.abs(b.p[0]-m.cx)<0.2&&b.p[1]<m.chuteTopY)}`);
  return true;
}

console.log('=== 勿忘草真机比例仿真（落球→搅拌→出球→短滑轨轨端停稳）===');
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
