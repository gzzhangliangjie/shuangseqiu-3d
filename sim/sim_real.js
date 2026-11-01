/* 镜像 myosotis-real.html 的物理逻辑，验证：预览架落球 → 搅拌 → 出球 → 轨道 → 排队入位 */
const R_BALL = 0.30, G = 22, REST_BALL = 0.55, REST_WALL = 0.62, DT = 1 / 120;

const CFG = [
  { key:'red', cx:-4.4, cz:0, count:33, R:1.55, cy:4.15, discDX:0.72, discR:0.8, discY:3.15,
    inletHalf:32*Math.PI/180, exitHalf:20*Math.PI/180, exitDir:[0,-Math.SQRT1_2,Math.SQRT1_2],
    chuteZ0:0.95, chuteTopY:2.45, chuteSlope:0.60, chuteZ1:3.3,
    chanZ:3.9, chanBaseY:1.05, rollDir:-1, stopX:-6.95, entryX:-4.4, draws:6 },
  { key:'blue', cx:4.4, cz:0, count:16, R:1.25, cy:4.0, discDX:0.6, discR:0.65, discY:3.0,
    inletHalf:32*Math.PI/180, exitHalf:22*Math.PI/180, exitDir:[0,-Math.SQRT1_2,Math.SQRT1_2],
    chuteZ0:0.95, chuteTopY:2.5, chuteSlope:0.64, chuteZ1:3.3,
    chanZ:3.9, chanBaseY:1.0, rollDir:1, stopX:6.95, entryX:4.4, draws:1 },
];

function chuteFloorY(m,z){ return m.chuteTopY - m.chuteSlope*(z-m.chuteZ0); }
function chanFloorY(m,x){ return m.chanBaseY + 0.045*(m.stopX-x)*-m.rollDir; }

function makeMachine(cfg){
  const balls=[];
  for(let i=1;i<=cfg.count;i++){
    // 预览架初始位（随便放高处即可，模拟从架上落球）
    balls.push({num:i,p:[cfg.cx+(Math.random()-0.5)*2,cfg.cy+cfg.R+1.5+Math.random()*0.5,(Math.random()-0.5)*1.6],v:[0,0,0],state:'in',placed:false});
  }
  return {...cfg, balls, agit:0, loadOpen:true, holeOpen:false, captured:null,
    cosInlet:Math.cos(cfg.inletHalf), cosExit:Math.cos(cfg.exitHalf),
    exitW:[cfg.cx+cfg.exitDir[0]*cfg.R, cfg.cy+cfg.exitDir[1]*cfg.R, cfg.cz+cfg.exitDir[2]*cfg.R]};
}

function stepInBall(b,m,dt){
  const v=b.v,p=b.p;
  v[1]-=G*dt;
  if(m.agit>0.01){
    for(const side of [-1,1]){
      const dx=p[0]-(m.cx+side*m.discDX), dz=p[2]-m.cz, rr=Math.hypot(dx,dz);
      if(rr<m.discR+R_BALL*1.6 && Math.abs(p[1]-m.discY)<0.9){
        const w=side*12, sp=w*m.agit*Math.min(rr,m.discR)*1.25;
        v[0]+=-dz/(rr+1e-4)*sp*dt; v[2]+=dx/(rr+1e-4)*sp*dt;
        if(p[1]<m.discY+0.5&&p[1]>m.discY-0.25&&Math.random()<0.22) v[1]+=8.5*m.agit*dt*(0.5+Math.random());
      }
    }
  }
  if(m.holeOpen){
    const dx=m.exitW[0]-p[0],dy=m.exitW[1]-p[1],dz=m.exitW[2]-p[2];
    const dd=Math.hypot(dx,dy,dz);
    if(dd<m.R*1.8){ const s=130*(1-dd/(m.R*1.8))/dd*dt; v[0]+=dx*s; v[1]+=dy*s; v[2]+=dz*s; }
  }
  const damp=m.agit>0.01?0.4:0.15;
  v[0]*=Math.max(0,1-damp*dt); v[1]*=Math.max(0,1-damp*dt); v[2]*=Math.max(0,1-damp*dt);
  p[0]+=v[0]*dt; p[1]+=v[1]*dt; p[2]+=v[2]*dt;

  if(m.loadOpen && p[1]>m.cy+0.4 && p[1]<m.cy+m.R+2.2){
    const rho=Math.hypot(p[0]-m.cx,p[2]-m.cz);
    if(rho>0.42){ const s=0.42/rho; p[0]=m.cx+(p[0]-m.cx)*s; p[2]=m.cz+(p[2]-m.cz)*s; v[0]*=0.6; v[2]*=0.6; }
  }

  const rx=p[0]-m.cx, ry=p[1]-m.cy, rz=p[2]-m.cz;
  const d=Math.hypot(rx,ry,rz);
  if(d>m.R-R_BALL){
    const nx=rx/d,ny=ry/d,nz=rz/d;
    const inInlet=m.loadOpen&&ny>m.cosInlet;
    const inExit=m.holeOpen&&(nx*m.exitDir[0]+ny*m.exitDir[1]+nz*m.exitDir[2])>m.cosExit;
    if(inExit&&d>m.R+R_BALL*0.7&&!m.captured){ b.state='rail'; b.placed=false; m.captured=b; m.holeOpen=false; return; }
    if(!inInlet&&!inExit){
      const push=m.R-R_BALL;
      p[0]=m.cx+nx*push; p[1]=m.cy+ny*push; p[2]=m.cz+nz*push;
      const vn=v[0]*nx+v[1]*ny+v[2]*nz;
      if(vn>0){ const f=(1+REST_WALL)*vn; v[0]-=f*nx; v[1]-=f*ny; v[2]-=f*nz; v[0]*=0.985; v[1]*=0.985; v[2]*=0.985; }
    }
  }
}

function stepRailBall(b,m,dt){
  const v=b.v,p=b.p;
  v[1]-=G*dt; p[0]+=v[0]*dt; p[1]+=v[1]*dt; p[2]+=v[2]*dt;
  if(p[2]<m.chuteZ1){
    p[0]=m.cx+Math.max(-0.2,Math.min(0.2,p[0]-m.cx)); v[0]*=(1-4*dt);
    const fY=chuteFloorY(m,p[2]);
    if(p[1]<fY){ p[1]=fY; if(v[1]<-2.5)v[1]*=-0.25; else v[1]=0; v[2]+=G*m.chuteSlope*dt; }
    v[2]*=(1-0.08*dt);
  } else {
    b.railT=(b.railT||0)+dt;
    const fY=chanFloorY(m,p[0]);
    if(p[1]<fY){ p[1]=fY; if(v[1]<-2.5)v[1]*=-0.25; else v[1]=0; v[0]+=m.rollDir*G*0.045*dt; }
    v[0]*=(1-0.5*dt);
    if(Math.abs(p[2]-m.chanZ)>0.18){ p[2]=m.chanZ+Math.sign(p[2]-m.chanZ)*0.18; v[2]*=-0.2; }
    if(m.rollDir<0){ if(p[0]<m.stopX+R_BALL){ p[0]=m.stopX+R_BALL; v[0]*=-0.25; } }
    else { if(p[0]>m.stopX-R_BALL){ p[0]=m.stopX-R_BALL; v[0]*=-0.25; } }
    if(!b.placed&&b.railT>1.2&&Math.abs(v[0])<0.25&&Math.abs(v[2])<0.2&&p[2]>m.chuteZ1-0.05){ b.placed=true; }
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
        a.v[0]-=nx*imp; a.v[1]-=ny*imp; a.v[2]-=nz*imp;
        b.v[0]+=nx*imp; b.v[1]+=ny*imp; b.v[2]+=nz*imp; }
    }
  }
}

function runMachine(m, log){
  let t=0, placedCount=0, stirPhase=true, stirT=0, idle=0;
  m.agit=1;
  while(placedCount<m.draws && t<80){
    t+=DT;
    if(m.captured&&m.captured.placed){
      m.captured=null; placedCount++;
      if(placedCount<m.draws){ stirT=0; }
      continue;
    }
    if(!m.captured){
      if(stirPhase){ stirT+=DT; if(stirT>3){ m.holeOpen=true; stirPhase=false; } }
      else if(!m.holeOpen){ stirPhase=true; }
    }
    const inB=[],railB=[];
    for(const b of m.balls){
      if(b.state==='in'){ stepInBall(b,m,DT); inB.push(b);  }
      else if(b.state==='rail'){ stepRailBall(b,m,DT); railB.push(b); }
    }
    collideGroup(inB); collideGroup(railB);
  }
  if(placedCount<m.draws){ log(`${m.key}: FAIL 只出球 ${placedCount}/${m.draws} (t=${t.toFixed(1)}s)`); return false; }
  // 检查入位 x 范围
  const done=m.balls.filter(b=>b.placed);
  const xs=done.map(b=>+b.p[0].toFixed(2));
  const inChan=done.every(b=>Math.abs(b.p[2]-m.chanZ)<0.5&&b.p[0]>Math.min(m.chanX1??-99,m.stopX-1)&&b.p[0]<Math.max(m.chanX2??99,m.stopX+1));
  log(`${m.key}: OK ${placedCount}/${m.draws} 出球耗时 ${t.toFixed(1)}s  入位x=[${xs.join(',')}]\n     通道内=${inChan}`);
  return true;
}

console.log('=== 真机结构仿真（落球→搅拌→出球→轨道→排队）===');
let allOK=true;
for(const cfg of CFG){
  // 跑 3 轮取平均
  for(let round=1;round<=3;round++){
    const m=makeMachine(cfg);
    const lines=[];
    const ok=runMachine(m,l=>lines.push(l));
    if(round===1||!ok) console.log(lines.join('\n'));
    if(!ok) allOK=false;
  }
}
console.log(allOK?'\n全部通过 ✓':'\n存在失败 ✗');
