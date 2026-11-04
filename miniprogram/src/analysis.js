/* 自动生成，请勿手改。真源：_vendor/ + index.html；重新生成：node miniprogram/build.js */
'use strict';
function createAnalysis(input) {
  var D = input.slice().sort(function(a,b){return a[0]-b[0];});
  var N = D.length, LAST = D[N-1];
/* ---------- 统计 ---------- */
var freqR = new Array(34).fill(0), freqB = new Array(17).fill(0);
D.forEach(function(r){ r[1].forEach(function(n){freqR[n]++;}); freqB[r[2]]++; });
var lastSeenR = new Array(34).fill(-1), lastSeenB = new Array(17).fill(-1);
D.forEach(function(r,i){ r[1].forEach(function(n){lastSeenR[n]=i;}); lastSeenB[r[2]]=i; });
var missR = [], missB = [];
for(var i=1;i<=33;i++) missR[i] = N-1-lastSeenR[i];
for(var i=1;i<=16;i++) missB[i] = N-1-lastSeenB[i];

function cnt(arr,len){var c=new Array(len+1).fill(0);arr.forEach(function(v){c[v]++;});return c;}

/* 历史形态分布（用于软评分） */
var dist = {};
function buildDist(){
  dist.sum={}; dist.span={}; dist.odd={}; dist.big={}; dist.z1={};
  dist.rep={}; dist.con={}; dist.tail={};
  D.forEach(function(r){
    var red=r[1], s=0; red.forEach(function(n){s+=n;});
    var sum=Math.floor(s/10)*10;
    dist.sum[sum]=(dist.sum[sum]||0)+1;
    var sp=Math.floor((red[5]-red[0])/3)*3;
    dist.span[sp]=(dist.span[sp]||0)+1;
    var o=red.filter(function(n){return n%2;}).length; dist.odd[o]=(dist.odd[o]||0)+1;
    var b=red.filter(function(n){return n>=17;}).length; dist.big[b]=(dist.big[b]||0)+1;
    var z=red.filter(function(n){return n<=11;}).length; dist.z1[z]=(dist.z1[z]||0)+1;
    var c=consecGroups(red); dist.con[c]=(dist.con[c]||0)+1;
    var t=new Set(red.map(function(n){return n%10;})).size; dist.tail[t]=(dist.tail[t]||0)+1;
  });
  for(var i=1;i<N;i++){
    var a=new Set(D[i-1][1]), n=0;
    D[i][1].forEach(function(x){if(a.has(x))n++;});
    dist.rep[n]=(dist.rep[n]||0)+1;
  }
}
function P(obj,k){ return ((obj[k]||0)+1)/(Object.values(obj).reduce(function(a,b){return a+b;},0)+Object.keys(obj).length+8); }

function consecGroups(red){
  var g=0,c=1;
  for(var i=1;i<red.length;i++){
    if(red[i]===red[i-1]+1) c++; else { if(c>=2)g++; c=1; }
  }
  if(c>=2)g++;
  return g;
}
function acValue(red){
  var s=new Set();
  for(var i=0;i<6;i++)for(var j=i+1;j<6;j++) s.add(red[j]-red[i]);
  return s.size-5;
}

/* ---------- 权重 ---------- */
function buildWeights(alpha, win){
  var half = Math.max(60, Math.round(win/3)), lam = Math.log(2)/half;
  var upto = Math.max(0, N-win), wR=new Array(34).fill(0), wB=new Array(17).fill(0);
  for(var i=upto;i<N;i++){
    var age=N-1-i, wt=Math.exp(-lam*age);
    D[i][1].forEach(function(n){ wR[n]+=wt; });
    wB[D[i][2]]+=wt;
  }
  var tot=0; for(var n=1;n<=33;n++) tot+=wR[n];
  var totB=0; for(var n=1;n<=16;n++) totB+=(wB[n]||0);
  var AM=33/6, sR={}, sB={}, sumR=0, sumB=0;
  for(var n=1;n<=33;n++){
    var ff = (wR[n]+0.5)/((tot/33)+0.5);
    var ratio = Math.min(missR[n]/AM, 2.5);
    var fm = 0.7 + 0.7*ratio/2.5;
    var s = ff*fm; sR[n]=s; sumR+=s;
  }
  for(var n=1;n<=16;n++){
    var ff = ((wB[n]||0)+0.5)/((totB/16)+0.5);
    var ratio = Math.min(missB[n]/(16/1), 2.5);
    var fm = 0.7 + 0.7*ratio/2.5;
    var s = ff*fm; sB[n]=s; sumB+=s;
  }
  var pR={}, pB={};
  for(var n=1;n<=33;n++) pR[n] = (1-alpha)/33 + alpha*(sR[n]/sumR);
  for(var n=1;n<=16;n++) pB[n] = (1-alpha)/16 + alpha*(sB[n]/sumB);
  return {pR:pR,pB:pB};
}

/* ---------- 采样 ---------- */
function sampleRed(pR){
  var arr=[];
  for(var n=1;n<=33;n++){
    var u=Math.random(); if(u<1e-12) u=1e-12;
    arr.push([n, Math.log(u)/pR[n]]);
  }
  arr.sort(function(a,b){return b[1]-a[1];});
  return arr.slice(0,6).map(function(x){return x[0];}).sort(function(a,b){return a-b;});
}
function sampleBlue(pB){
  var r=Math.random(), acc=0;
  var tot=0; for(var n=1;n<=16;n++) tot+=pB[n];
  for(var n=1;n<=16;n++){ acc+=pB[n]/tot; if(r<=acc) return n; }
  return 16;
}

/* ---------- 特征 ---------- */
function feat(red, blue){
  var s=0; red.forEach(function(n){s+=n;});
  var o=0,bg=0,z1=0,tails=new Set(),c=0;
  red.forEach(function(n){ if(n%2)o++; if(n>=17)bg++; if(n<=11)z1++; tails.add(n%10); });
  var prev=new Set(LAST[1]), rep=0;
  red.forEach(function(n){ if(prev.has(n))rep++; });
  return {
    sum:s, span:red[5]-red[0], odd:o, big:bg, z1:z1,
    tail:tails.size, rep:rep, con:consecGroups(red), ac:acValue(red), blue:blue
  };
}

/* ---------- 约束 ---------- */
function cfg(){ return {}; }
function pass(f,c,dan,kill){
  if(dan) for(var i=0;i<dan.length;i++) if(f._red.indexOf(dan[i])<0) return false;
  if(kill) for(var i=0;i<kill.length;i++) if(f._red.indexOf(kill[i])>=0) return false;
  if(c.hSum && (f.sum<c.sumLo||f.sum>c.sumHi)) return false;
  if(c.hOdd && (f.odd<2||f.odd>4)) return false;
  if(c.hBig && (f.big<2||f.big>4)) return false;
  if(c.hZone && (f.z1<1||f.z1>3)) return false;
  if(c.hRep && f.rep>c.repMax) return false;
  if(c.hCon && f.con>c.conMax) return false;
  if(c.hTail && f.tail<c.tailMin) return false;
  if(c.hAc && f.ac<c.acMin) return false;
  if(c.hSpan && (f.span<15||f.span>31)) return false;
  return true;
}
function score(f, W){
  var s=0;
  s+=Math.log(P(dist.sum, Math.floor(f.sum/10)*10));
  s+=Math.log(P(dist.span, Math.floor(f.span/3)*3));
  s+=Math.log(P(dist.odd, f.odd));
  s+=Math.log(P(dist.big, f.big));
  s+=Math.log(P(dist.z1, f.z1));
  s+=Math.log(P(dist.rep, f.rep));
  s+=Math.log(P(dist.con, f.con));
  s+=Math.log(P(dist.tail, f.tail));
  if(W){
    f._red.forEach(function(n){ s+=Math.log(W.pR[n]*33); });
    s+=Math.log(W.pB[f.blue]*16);
  }
  return s;
}

/* ---------- 生成 ---------- */
function generate(opt){
  var c=opt.cfg, W=buildWeights(opt.alpha, opt.win);
  var pool=[], tries=opt.cand, hit=0, sMin=1e9, sMax=-1e9;
  for(var t=0;t<tries;t++){
    var red=sampleRed(W.pR), blue=sampleBlue(W.pB);
    var f=feat(red,blue); f._red=red;
    if(!pass(f,c,opt.dan,opt.kill)) continue;
    var sc=score(f,W);
    if(sc>sMax)sMax=sc; if(sc<sMin)sMin=sc;
    pool.push({red:red,blue:blue,f:f,s:sc});
    hit++;
    if(pool.length>60000) break;
  }
  pool.sort(function(a,b){return b.s-a.s;});
  var out=[], maxOv=opt.maxOv, cap=opt.cap, used={};
  function overlapOk(p){
    for(var j=0;j<out.length;j++){
      var ov=0, s2=new Set(out[j].red);
      p.red.forEach(function(n){ if(s2.has(n))ov++; });
      if(ov>maxOv) return false;
    }
    return true;
  }
  function capOk(p){
    if(cap>=99) return true;
    for(var i=0;i<p.red.length;i++) if((used[p.red[i]]||0)>=cap) return false;
    return true;
  }
  function adopt(p){ p.red.forEach(function(n){ used[n]=(used[n]||0)+1; }); out.push(p); }
  for(var i=0;i<pool.length && out.length<opt.k;i++)
    if(overlapOk(pool[i]) && capOk(pool[i])) adopt(pool[i]);
  if(out.length<opt.k){ cap=99;
    for(var i=0;i<pool.length && out.length<opt.k;i++)
      if(out.indexOf(pool[i])<0 && overlapOk(pool[i])) out.push(pool[i]);
  }
  return {picks:out, tried:tries, passed:hit, sMin:sMin, sMax:sMax};
}


var AWARD={1:5000000,2:150000,3:3000,4:200,5:10,6:5,0:0};
var LVN={1:'一等奖',2:'二等奖',3:'三等奖',4:'四等奖',5:'五等奖',6:'六等奖',0:'未中奖'};
function prizeOf(pick,d){
  var r=0; pick.red.forEach(function(x){ if(d.red.indexOf(x)>=0) r++; });
  var b=pick.blue===d.blue?1:0;
  if(r===6&&b) return 1; if(r===6) return 2; if(r===5&&b) return 3;
  if(r===5||(r===4&&b)) return 4; if(r===4||(r===3&&b)) return 5;
  if(b) return 6; return 0;
}
  buildDist();   /* Web 版在 IIFE 末尾调用，这里打包时补上 */
  return { D:D, N:N, LAST:LAST, freqR:freqR, freqB:freqB, missR:missR, missB:missB,
    dist:dist, buildWeights:buildWeights, sampleRed:sampleRed, sampleBlue:sampleBlue,
    feat:feat, pass:pass, score:score, generate:generate, prizeOf:prizeOf,
    AWARD:AWARD, LVN:LVN, consecGroups:consecGroups, acValue:acValue, P:P };
}
module.exports = { createAnalysis: createAnalysis };
