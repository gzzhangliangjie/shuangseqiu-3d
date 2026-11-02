/* 镜像 index.html（勿忘草 Myosotis 真机比例版 DESIGN.md）的物理逻辑
   结构：完整玻璃球（管子插入，不开口）+ 等长管环形预览架（管内球沿管滑落）
        → 双转子搅拌（内盘/外环带反向）→ 底部小孔出球（开一颗关一颗）
        → 滑道（右行→下行→左行到取球位）→ 出过的球留在滑道排成一行 */
const R_BALL = 0.089, G = 22, REST_BALL = 0.55, REST_WALL = 0.62, DT = 1 / 120;

const UPPER_PTS = [   /* 上层滑道：出球孔正下方 → 右端，微下坡向右；末端=洞 */
  [0.00, 2.30, 0.70], [0.60, 2.28, 0.70], [1.18, 2.26, 0.70],
];
const LOWER_PTS = [   /* 下层滑道：右端接球口（上轨末端洞正下偏右） → 左行下坡 → 取球位 */
  [1.28, 2.16, 0.70], [0.00, 2.12, 0.52], [-1.10, 2.09, 0.52],
];
const INTRO_PTS = [   /* 出球孔 → 上层滑道口的接引短槽 */
  [0.00, 2.69, 0.68], [0.00, 2.30, 0.70],
];

const CFG = [
  { key:'red', cx:-3.8, cz:0, count:33, R:1.18, cy:3.66, discY:2.62, rHub:0.22, gapInner:0.25, rOuter:0.53, wInner:9.0, wOuter:-6.0,
    inletHalf:50*Math.PI/180, exitHalf:12*Math.PI/180, exitDir:[0,-0.826,0.564],
    rackN:12, rackRR:0.95, rackInset:0.30, draws:6 },
  { key:'blue', cx:3.8, cz:0, count:16, R:1.18, cy:3.66, discY:2.62, rHub:0.22, gapInner:0.25, rOuter:0.53, wInner:9.0, wOuter:-6.0,
    inletHalf:50*Math.PI/180, exitHalf:12*Math.PI/180, exitDir:[0,-0.826,0.564],
    rackN:12, rackRR:0.95, rackInset:0.30, draws:1 },
];

/* ---------- 滑道（全 3D 刚性管道）：球保留完整自由度，管壁=胶囊体内壁约束 ----------
   段格式 [a, b, openA, openB]：open 端=洞（球可自由进出，如上轨末端洞），
   闭端=端板（球心停在板前一个球半径处）。 */
const RAIL_SEGS = [
  [INTRO_PTS[0], INTRO_PTS[1], false, true],      /* 出球孔接引短管（下端与上轨连通） */
  [UPPER_PTS[0], UPPER_PTS[1], true, true],       /* 内部接口全部开敞（管道连续） */
  [UPPER_PTS[1], UPPER_PTS[2], true, true],       /* 上轨末端 = 洞，球滚出后自由掉落 */
  [LOWER_PTS[0], LOWER_PTS[1], false, true],      /* 下轨右端板：接住掉落球（兜底） */
  [LOWER_PTS[1], LOWER_PTS[2], true, false],      /* 左端板 = 取球位挡块 */
];
const TUBE_IN = 0.035;                        /* 管壁限位（轴心距）= 管内半径 - 球半径 */
const TUBE_BORE = R_BALL + 0.035;             /* 管膛半径（球心在膛内才参与管壁碰撞） */

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
  /* 编号随机洗牌（Fisher–Yates），与页面一致：物理选位置，编号每局随机 */
  const nums=Array.from({length:cfg.count},(_,i)=>i+1);
  for(let i=nums.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [nums[i],nums[j]]=[nums[j],nums[i]]; }
  const balls=[]; let idx=0;
  for(const td of rackDefs){
    for(let k=0;k<td.n;k++){
      if(idx>=nums.length) break;
      const num=nums[idx++];
      const sT=R_BALL+0.12+k*(R_BALL*2+0.01);
      const p=[td.base[0]+td.dir[0]*sT, td.base[1]+td.dir[1]*sT, td.base[2]+td.dir[2]*sT];
      balls.push({num, p, home:p.slice(), tube:td, sT, vsT:0,
                  v:[0,0,0], state:'in', placed:false, railT:0, s:0, vs:0});
    }
  }
  return {...cfg, rackDefs, balls, agit:1, loadOpen:true, holeOpen:false, captured:null,
    cosExit:Math.cos(cfg.exitHalf),
    exitW:[cfg.cx+cfg.exitDir[0]*cfg.R, cfg.cy+cfg.exitDir[1]*cfg.R, cfg.cz+cfg.exitDir[2]*cfg.R],
    // 拨块：真实物理件（与页面视觉梯形块同尺寸同转速），碰撞实际拨动小球
    pegList:[
      {r:cfg.rHub*0.62, rp:0.055, w:cfg.wInner, rot:0, n:2, ph:0.4},
      {r:cfg.gapInner+(cfg.rOuter-cfg.gapInner)*0.93, rp:0.065, w:cfg.wOuter, rot:1, n:4, ph:0},
    ],
    rotPhase:[0,0]};
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
    // 盘面摩擦拖带（球接触转盘被摩擦带动）；主要搅拌动力来自拨块碰撞
    const dx=p[0]-m.cx, dz=p[2]-m.cz, rr=Math.hypot(dx,dz);
    if(Math.abs(p[1]-m.discY)<0.30){
      const w=rr<(m.rHub+m.gapInner)/2?m.wInner:(rr<m.rOuter?m.wOuter:0);
      if(w!==0){
        const sp=w*m.agit*Math.min(rr,m.rOuter)*0.42;
        v[0]+=-dz/(rr+1e-4)*sp*dt; v[2]+=dx/(rr+1e-4)*sp*dt;
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
  const prr=Math.hypot(p[0]-m.cx,p[2]-m.cz);
  const maxR=Math.min(Math.sqrt(Math.max(0,(m.R-R_BALL)**2-(m.cy-floorC)**2)), m.rOuter);
  if(p[1]<floorC){ p[1]=floorC;
    if(prr>maxR){ const k=maxR/prr; p[0]=m.cx+(p[0]-m.cx)*k; p[2]=m.cz+(p[2]-m.cz)*k; }
    if(v[1]<-2.2)v[1]*=-0.25; else v[1]=0; }

  // 落球收拢：落到开口边缘外侧的球向心收
  if(m.loadOpen && p[1]>m.cy+0.4){
    const dx=p[0]-m.cx, dz=p[2]-m.cz;
    const rho=Math.hypot(dx,dz);
    const maxRho=m.R*Math.sin(m.inletHalf)-R_BALL-0.04;
    if(rho>maxRho&&rho>0.05){ v[0]-=dx/rho*30*dt; v[2]-=dz/rho*30*dt; }
  }

  // 出球捕获：独立于球壳约束 —— 开阀窗口内球到达孔口锥区并越过捕获深度即入滑道
  const rx=p[0]-m.cx, ry=p[1]-m.cy, rz=p[2]-m.cz;
  const d=Math.hypot(rx,ry,rz);
  if(m.holeOpen&&!m.captured&&d>1e-6){
    const nx=rx/d,ny=ry/d,nz=rz/d;
    if((nx*m.exitDir[0]+ny*m.exitDir[1]+nz*m.exitDir[2])>m.cosExit&&d>m.R-R_BALL*1.6){
      b.state='rail'; b.placed=false; b.settle=0; b.railT=0;
      b.p=[m.cx+m.exitDir[0]*m.R, m.cy+m.exitDir[1]*m.R, m.cz+m.exitDir[2]*m.R];
      b.v=[m.exitDir[0]*0.8, m.exitDir[1]*0.8, m.exitDir[2]*0.8];
      m.captured=b; m.holeOpen=false;
      return;
    }
  }
  // 完整球壳约束：仅出球孔可穿
  if(d>m.R-R_BALL){
    const nx=rx/d,ny=ry/d,nz=rz/d;
    const inExit=m.holeOpen&&(nx*m.exitDir[0]+ny*m.exitDir[1]+nz*m.exitDir[2])>m.cosExit;
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

/* 管壁碰撞（全 3D）：球心在管膛内才参与；侧壁=轴心距限位+反弹+滚动阻力；
   闭式端=端板（球心停在板前 R_BALL），开式端=洞（自由穿过） */
function railWallCollide(b,m,dt){
  for(const [a,c,openA,openB] of RAIL_SEGS){
    const ax=m.cx+a[0], ay=a[1], az=m.cz+a[2];
    const dx=m.cx+c[0]-ax, dy=c[1]-ay, dz=m.cz+c[2]-az;
    const L=Math.hypot(dx,dy,dz), L2=L*L;
    const ux=dx/L, uy=dy/L, uz=dz/L;
    let t=((b.p[0]-ax)*dx+(b.p[1]-ay)*dy+(b.p[2]-az)*dz)/L2;
    const rawT=t;
    t=t<0?0:(t>1?1:t);
    const px=ax+dx*t, py=ay+dy*t, pz=az+dz*t;
    const rx=b.p[0]-px, ry=b.p[1]-py, rz=b.p[2]-pz;
    const d=Math.hypot(rx,ry,rz);
    const inBore=d<TUBE_BORE&&d>1e-6;
    const touching=d>TUBE_IN-0.002;              /* 接触余量：贴面静置也算接触（否则振荡不衰减） */
    if(inBore){
      /* 侧壁约束：仅在本段中段（两端由端板/洞负责）；开口槽=法向朝上不约束（球可从上方落入） */
      if(rawT>0&&rawT<1&&touching&&!(ry>0.35*d)){
        if(d>TUBE_IN){
          const nx=rx/d, ny=ry/d, nz=rz/d;
          b.p[0]=px+nx*TUBE_IN; b.p[1]=py+ny*TUBE_IN; b.p[2]=pz+nz*TUBE_IN;
          const vn=b.v[0]*nx+b.v[1]*ny+b.v[2]*nz;
          if(vn>0){
            const f=(1+0.05)*vn;                 /* 近非弹性法向接触 */
            b.v[0]-=f*nx; b.v[1]-=f*ny; b.v[2]-=f*nz;
          }
        }
        /* 滚动接触约束：接触时把速度分解为沿管切向（滚动方向）与环向（绕管打转），
           环向快速衰减（球 rolling 时物理上不存在环向滑动），切向只留滚动阻力 */
        const vd=b.v[0]*ux+b.v[1]*uy+b.v[2]*uz;
        let cx2=b.v[0]-ux*vd, cy2=b.v[1]-uy*vd, cz2=b.v[2]-uz*vd;
        const kC=1-0.25, kR=1-0.4*dt;            /* 环向衰减 / 滚动阻力（决定滚速上限） */
        b.v[0]=ux*vd*kR+cx2*kC; b.v[1]=uy*vd*kR+cy2*kC; b.v[2]=uz*vd*kR+cz2*kC;
      }
      /* 端板：闭端=横跨管膛的实体挡墙（球心停在板前 R_BALL），开敞端=洞（自由穿过）。
         只看球心到端面的有向距离，不看轴向投影（贴底滚动的球投影到不了端点） */
      if(!openA){
        const su=-ux, sv=-uy, sw=-uz;
        const pen=(b.p[0]-ax)*su+(b.p[1]-ay)*sv+(b.p[2]-az)*sw;
        if(pen>-R_BALL&&pen<0){
          const corr=-R_BALL-pen;
          b.p[0]+=su*corr; b.p[1]+=sv*corr; b.p[2]+=sw*corr;
          const vn=b.v[0]*su+b.v[1]*sv+b.v[2]*sw;
          if(vn>0){
            const f=(1+0.15)*vn;
            b.v[0]-=f*su; b.v[1]-=f*sv; b.v[2]-=f*sw;
          }
        }
      }
      if(!openB){
        const su=ux, sv=uy, sw=uz;
        const ex=ax+dx, ey=ay+dy, ez=az+dz;
        const pen=(b.p[0]-ex)*su+(b.p[1]-ey)*sv+(b.p[2]-ez)*sw;
        if(pen>-R_BALL&&pen<0){
          const corr=-R_BALL-pen;
          b.p[0]+=su*corr; b.p[1]+=sv*corr; b.p[2]+=sw*corr;
          const vn=b.v[0]*su+b.v[1]*sv+b.v[2]*sw;
          if(vn>0){
            const f=(1+0.15)*vn;
            b.v[0]-=f*su; b.v[1]-=f*sv; b.v[2]-=f*sw;
          }
        }
      }
    }
  }
}

/* 滑道球：全 3D 弹道 + 管壁/挡块约束。出孔后停顿=落地碰撞自然耗散，无脚本计时；
   入位=球在下轨自行停稳（显示事件，非物理干预） */
function stepRailBall(b,m,dt){
  b.railT+=dt;
  b.v[1]-=G*dt;
  for(let k=0;k<3;k++) b.p[k]+=b.v[k]*dt;
  railWallCollide(b,m,dt);
  if(!b.placed){
    const sp=Math.hypot(b.v[0],b.v[1],b.v[2]);
    const inLow=b.p[1]<LOWER_PTS[0][1]+0.06&&Math.abs(b.p[0]-m.cx)<1.35;
    if(inLow&&sp<0.12) b.settle+=dt; else b.settle=0;
    if(b.settle>0.35) b.placed=true;
  }
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
  let t=0, placedCount=0, stirT=0, holePhase=false, probed=false;
  while(t<150){
    t+=DT;
    if(!m.captured){
      if(!holePhase){ stirT+=DT; if(stirT>3){ m.holeOpen=true; holePhase=true; stirT=0; } }
      else { stirT+=DT; } // 纯物理出球：开阀后拨块持续搅拌，球堆自然流动到孔口即捕获
    } else if(m.captured&&m.captured.placed){
      m.captured=null; placedCount++; holePhase=false; stirT=0;
    }
    for(const b of m.balls){
      if(b.state==='in') stepInBall(b,m,DT);
      else if(b.state==='rail') stepRailBall(b,m,DT);
    }
    collideGroup(m.balls.filter(b=>b.state==='in'&&!b.tube));
    collideTubes(m);
    collideGroup(m.balls.filter(b=>b.state==='rail'));   /* 滑道球 3D 球球碰撞（管壁约束对齐成队） */
    // 旋转拨块：真实物理件，逐块碰撞把球实际拨动（混合的动力来源）
    if(m.agit>0.01){
      m.rotPhase[0]+=m.wInner*m.agit*DT; m.rotPhase[1]+=m.wOuter*m.agit*DT;
      for(const b of m.balls){ if(b.state!=='in'||b.tube)continue;
        if(Math.abs(b.p[1]-m.discY-0.09)>0.14)continue;
        for(const pg of m.pegList){
          for(let k=0;k<pg.n;k++){
            const th=m.rotPhase[pg.rot]+pg.ph+k/pg.n*Math.PI*2;
            const px=m.cx+Math.cos(th)*pg.r, pz=m.cz-Math.sin(th)*pg.r;
            const dx=b.p[0]-px, dz=b.p[2]-pz;
            const dd=Math.hypot(dx,dz), minD=R_BALL+pg.rp;
            if(dd<minD&&dd>1e-6){
              if(m.hitProbe) m.hitProbe[Math.min(5,Math.floor((Math.hypot(b.p[0]-m.cx,b.p[2]-m.cz)-0.08)/0.08))]++;
              const nx=dx/dd,nz=dz/dd;
              b.p[0]=px+nx*minD; b.p[2]=pz+nz*minD;
              const svx=-pg.w*m.agit*pg.r*Math.sin(th);
              const svz=-pg.w*m.agit*pg.r*Math.cos(th);
              const rvx=b.v[0]-svx, rvz=b.v[2]-svz;
              const vn=rvx*nx+rvz*nz;
              if(vn<0){ b.v[0]-=vn*nx*1.05; b.v[2]-=vn*nz*1.05; }
              b.v[0]+=(svx-b.v[0])*0.45; b.v[2]+=(svz-b.v[2])*0.45;
              // 撞击点在球心下方：正面撞击把球向前上方挑起，产生真实翻滚
              if(vn<-0.5) b.v[1]+=Math.min(-vn,2.0)*0.15;
            }
          }
        }
      }
    }
    // 盘面凸圈（真机同款挡圈）：低挡环随外盘刚体转动（全速摩擦，比拖带 0.55 快 →
    // 持续犁过球层），球被拨块推压或堆挤撞圈时被垫起翻越/弹回 —— 打断贴盘公转层
    if(m.agit>0.01){
      const rc=0.035, ringR=m.gapInner+(m.rOuter-m.gapInner)*0.55;
      const topY=m.discY+0.05, sv=m.wOuter*m.agit*ringR;
      for(const b of m.balls){ if(b.state!=='in'||b.tube)continue;
        const bx=b.p[0]-m.cx, bz=b.p[2]-m.cz;
        const br=Math.hypot(bx,bz);
        if(br<1e-4||Math.abs(b.p[1]-topY)>0.4)continue;
        const dr=br-ringR, dy=b.p[1]-topY;
        const dd=Math.hypot(dr,dy), minD=R_BALL+rc;
        if(dd<minD&&dd>1e-6){
          const nr=dr/dd, ny=dy/dd, push=minD-dd;
          const ux=bx/br, uz=bz/br;
          b.p[0]+=ux*push*nr; b.p[2]+=uz*push*nr; b.p[1]+=push*ny;
          const nvx=ux*nr, nvy=ny, nvz=uz*nr;
          const vn=b.v[0]*nvx+b.v[1]*nvy+b.v[2]*nvz;
          if(vn<0){ b.v[0]-=vn*nvx*1.3; b.v[1]-=vn*nvy*1.3; b.v[2]-=vn*nvz*1.3; }
          const tx=-uz, tz=ux;
          const dv=sv-(b.v[0]*tx+b.v[2]*tz);
          b.v[0]+=tx*dv*0.5; b.v[2]+=tz*dv*0.5;
        }
      }
    }
    const fl=m.discY+0.05+R_BALL;
    const mR=Math.min(Math.sqrt(Math.max(0,(m.R-R_BALL)**2-(m.cy-fl)**2)), m.rOuter);
    for(const b of m.balls){ if(b.state!=='in'||b.tube)continue;
      if(b.p[1]<fl){
        const bx=b.p[0]-m.cx,bz=b.p[2]-m.cz,br=Math.hypot(bx,bz);
        if(br>mR){ const k=mR/br; b.p[0]=m.cx+bx*k; b.p[2]=m.cz+bz*k; }
      }
    }
    if(placedCount>=m.draws) break;
    // 搅拌中段径向分布探针：0.08起每0.08一档（中部应满、贴壁带不应独大）
    if(!probed && t>12 && m.agit>0.5 && !m.holeOpen){
      probed=true;
      const rs=m.balls.filter(b=>b.state==='in'&&!b.tube).map(b=>Math.hypot(b.p[0]-m.cx,b.p[2]-m.cz));
      const bands=[0,0,0,0,0,0];
      for(const r of rs) bands[Math.min(5,Math.floor((r-0.08)/0.08))]++;
      log(`${m.key}: t=12s 径向分布[0.08-0.56/0.08档]=${bands.join('/')} 飞行=${m.balls.filter(b=>b.state==='in'&&!b.tube&&b.p[1]>m.discY+0.25).length}`);
    }
    // 拨块命中探针（t=10~16s 窗口）：各径向档命中次数 —— 圈上的球必须被打到
    if(t>10&&t<16&&!m.hitProbe) m.hitProbe=[0,0,0,0,0,0];
    if(m.hitProbe&&t>=16&&!m.hitLogged){
      m.hitLogged=true;
      log(`${m.key}: 拨块命中[0.08-0.56/0.08档,10-16s]=${m.hitProbe.join('/')}`);
    }
  }
  if(placedCount<m.draws){ log(`${m.key}: FAIL 只出球 ${placedCount}/${m.draws} (t=${t.toFixed(1)}s)`); return false; }
  const done=m.balls.filter(b=>b.placed);
  const ss=done.map(b=>+(b.p[0]-m.cx).toFixed(2)).sort((a,b)=>a-b);
  const gaps=[];
  for(let i=1;i<ss.length;i++) gaps.push(+(ss[i]-ss[i-1]).toFixed(3));
  log(`${m.key}: OK ${placedCount}/${m.draws} 出球耗时 ${t.toFixed(1)}s  排队x=[${ss.join(',')}]
     排成一行=${done.every(b=>b.p[1]<LOWER_PTS[0][1]+0.06)}  球间距=[${gaps.join(',')}]（应≈0.178）`);
  return true;
}

console.log('=== 勿忘草真机比例仿真（完整球壳+环形预览架→双转子搅拌→底部小孔→滑道排队）===');
console.log(`滑道（全3D管壁约束）段数=${RAIL_SEGS.length}`);
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
