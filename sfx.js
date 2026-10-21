/* MADA exclusive emoji sounds — synthesized (no audio files), lazy-loaded on first tap */
(function(){"use strict";
let AC,MG,NB;
const VW={a:[800,1250],e:[530,1850],i:[300,2300],o:[500,950],u:[330,800]},R=(a,b)=>a+Math.random()*(b-a);
const env=(g,t,d,v,a=.01)=>{g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(v,t+a);g.gain.exponentialRampToValueAtTime(.0001,t+d)};
function tn(ty,a,b,d,t,v,lp){const o=AC.createOscillator(),g=AC.createGain();o.type=ty;o.frequency.setValueAtTime(a,t);o.frequency.exponentialRampToValueAtTime(b,t+d);env(g,t,d,v);let n=o;if(lp){n=AC.createBiquadFilter();n.type='lowpass';n.frequency.value=lp;o.connect(n)}n.connect(g);g.connect(MG);o.start(t);o.stop(t+d+.05)}
function nz(d,t,v,ty,a,b,q=1){const s=AC.createBufferSource(),g=AC.createGain(),f=AC.createBiquadFilter();s.buffer=NB;s.loop=true;f.type=ty;f.Q.value=q;f.frequency.setValueAtTime(a,t);f.frequency.exponentialRampToValueAtTime(b,t+d);env(g,t,d,v,Math.min(.03,d/3));s.connect(f);f.connect(g);g.connect(MG);s.start(t,Math.random());s.stop(t+d+.05)}
function vo(w,a,b,d,t,v,vib=0){const o=AC.createOscillator(),g=AC.createGain();o.type='sawtooth';o.frequency.setValueAtTime(a,t);o.frequency.linearRampToValueAtTime(b,t+d);
  if(vib){const l=AC.createOscillator(),lg=AC.createGain();l.frequency.value=vib;lg.gain.value=a*.04;l.connect(lg);lg.connect(o.frequency);l.start(t);l.stop(t+d+.05)}
  env(g,t,d,v,Math.min(.04,d/3));VW[w].forEach((f,i)=>{const q=AC.createBiquadFilter(),gg=AC.createGain();q.type='bandpass';q.frequency.value=f;q.Q.value=7;gg.gain.value=i?.5:1.4;o.connect(q);q.connect(gg);gg.connect(g)});g.connect(MG);o.start(t);o.stop(t+d+.05)}
const bl=(f,d,t,v)=>[[1,1],[2.76,.5],[5.4,.3],[8.9,.15]].forEach(([m,a])=>tn('sine',f*m,f*m,d/m**.3,t,v*a));
const cheer=(t,n)=>{for(let i=0;i<n;i++)nz(.05,t+R(0,1.2),.3,'bandpass',R(1500,2800),1500)};
const fan=(fs,t,v=.18)=>fs.forEach((f,i)=>tn('sawtooth',f,f,i==fs.length-1?.8:.14,t+i*.14,v,2500));
const SF={
laugh:t=>{for(let i=0;i<5;i++){nz(.05,t+i*.17,.15,'highpass',3000,3000);vo('a',300-i*14,250-i*14,.12,t+i*.17+.02,.4-i*.04)}},
love:t=>{vo('a',330,420,.25,t,.3,5);vo('o',420,350,.5,t+.25,.3,5);nz(.06,t+.85,.25,'bandpass',2500,4000);tn('sine',900,1500,.1,t+.85,.15)},
sad:t=>{[0,.7].forEach(d=>{vo('u',450,300,.55,t+d,.35,6);nz(.4,t+d,.05,'bandpass',900,500)})},
angry:t=>{vo('a',95,70,.9,t,.45,28);nz(.9,t,.15,'lowpass',500,200)},
shock:t=>{nz(.25,t,.3,'bandpass',600,3500,2);vo('a',500,420,.35,t+.22,.4);tn('sine',200,100,.15,t+.2,.2)},
shy:t=>[0,.14,.28].forEach(d=>vo('i',620+d*300,760+d*300,.11,t+d,.3,10)),
sleep:t=>[0,1.2].forEach(d=>{nz(.5,t+d,.3,'bandpass',300,900,.8);nz(.6,t+d+.55,.35,'lowpass',900,200);vo('o',70,55,.45,t+d+.55,.25)}),
think:t=>{vo('u',200,230,.35,t,.35,4);vo('u',230,190,.45,t+.35,.35,4)},
pop:t=>{tn('sine',300,1300,.09,t,.5);nz(.03,t,.3,'highpass',3000,3000)},
clap:t=>{for(let i=0;i<26;i++)nz(.05,t+R(0,1.3),.35,'bandpass',R(1200,2800),R(900,2000),.8);[0,.35].forEach(d=>nz(.06,t+d,.6,'bandpass',1800,1500,.6))},
fire:t=>{nz(2.2,t,.35,'lowpass',700,350,.7);nz(1.8,t+.05,.12,'bandpass',200,150,.6);nz(.4,t,.3,'bandpass',300,1800,.8);for(let i=0;i<40;i++)nz(.025,t+R(0,2),R(.15,.5),'highpass',R(2500,6000),R(2500,6000))},
heart:t=>[0,.55].forEach(d=>{tn('sine',70,38,.14,t+d,.7);tn('sine',60,35,.12,t+d+.17,.5)}),
thanks:t=>{bl(1319,.6,t,.2)},
hello:t=>{vo('e',380,450,.12,t,.3);vo('i',450,560,.28,t+.12,.3)},
bravo:t=>{vo('a',280,520,.35,t,.4,8);nz(1,t+.2,.2,'bandpass',800,1800,.6);cheer(t+.4,10)},
chime:t=>{bl(1047,1.2,t,.2);bl(1568,1.4,t+.15,.15)},
morning:t=>{for(let i=0;i<7;i++){const f=R(2500,3800);tn('sine',f,f*R(.8,1.3),.08,t+i*.13+(i>3?.2:0),.18)}},
party:t=>{tn('sawtooth',380,380,.5,t,.15,1200);nz(.3,t+.55,.5,'highpass',2000,6000);cheer(t+.6,8)},
wink:t=>{tn('sine',1200,2200,.12,t,.3);bl(2093,.4,t+.1,.12)},
win:t=>{fan([523,659,784,1047],t);cheer(t+.4,18)},
lose:t=>[[392,.3,0],[370,.3,.32],[350,.3,.64],[330,.9,.96]].forEach(([f,d,s],i)=>tn('sawtooth',f,i==3?f*.6:f,d,t+s,.25,900)),
rage:t=>{vo('a',260,420,.7,t,.45,14);nz(.7,t,.25,'bandpass',500,2500,.7);tn('sine',120,50,.3,t,.5)},
beat:t=>[0,.3,.6,.9].forEach((d,i)=>{tn('sine',160,45,.18,t+d,.8);if(i%2)nz(.12,t+d,.35,'highpass',2500,2500);nz(.04,t+d+.15,.2,'highpass',7000,7000)}),
game:t=>{tn('square',988,988,.08,t,.15);tn('square',1319,1319,.4,t+.08,.15)},
cool:t=>{tn('sine',120,50,.4,t,.7);nz(.04,t+.25,.5,'bandpass',3500,3500,2);bl(784,.8,t+.4,.2)},
trophy:t=>{fan([523,784,1047],t);cheer(t+.4,30)},
crown:t=>fan([392,523,659,784],t,.2),
star:t=>{for(let i=0;i<9;i++)tn('sine',1800+i*300,1800+i*300,.25,t+i*.06,.15)},
gem:t=>{bl(2093,1,t,.18);bl(2637,1,t+.12,.12)},
rocket:t=>{nz(2,t,.5,'lowpass',500,2500,.6);nz(2,t,.3,'bandpass',200,3000,.5);tn('sawtooth',60,40,2,t,.25,200)},
gold:t=>{for(let i=0;i<6;i++){const f=2400+R(0,800);tn('sine',f,f,.15,t+i*.09,.2);tn('sine',3500,3500,.12,t+i*.09,.1)}},
bell:t=>{bl(523,2,t,.3);bl(392,2.2,t+.35,.25)},
ram:t=>{bl(659,1.6,t,.25);bl(880,1.8,t+.3,.2)},
cup:t=>{nz(2,t,.5,'bandpass',300,1200,.5);tn('sawtooth',233,233,1.5,t,.15,800);cheer(t,30)},
snow:t=>{for(let i=0;i<10;i++){const f=3000+R(0,1500);tn('sine',f,f,.3,t+i*.1,.12);nz(.1,t+i*.1,.1,'highpass',6000,6000)}},
logo:t=>{bl(784,.8,t,.2);bl(1175,1.2,t+.15,.2);tn('sine',1568,2093,.3,t+.35,.1)},
ny:t=>{for(let i=0;i<5;i++){const s=t+i*.4;nz(.6,s,.5,'lowpass',400,120);tn('sine',90,35,.5,s,.6);for(let j=0;j<10;j++)nz(.03,s+.1+R(0,.5),.25,'highpass',R(3000,6000),4000)}cheer(t+1.5,20)},
zap:t=>{nz(.15,t,.7,'highpass',2000,8000);tn('sawtooth',2200,90,.25,t,.3,3000);nz(.5,t+.1,.3,'lowpass',900,150)},
idea:t=>{tn('sine',600,1400,.15,t,.3);bl(1568,.9,t+.15,.22)},
cd:t=>{[0,.4,.8].forEach(d=>tn('sine',880,880,.2,t+d,.3));tn('sine',1760,1760,.6,t+1.2,.3);nz(.3,t+1.2,.5,'highpass',2000,6000);cheer(t+1.3,14)}
};
const dr=(t,v=.9)=>{tn('sine',110,45,.32,t,v);nz(.1,t,.35,'lowpass',500,200)},sis=(t,n=14)=>{for(let i=0;i<n;i++)nz(.03,t+i*.035,.22,'highpass',5000,7000)},chant=(t,d=1.6,f=118)=>{vo('o',f,f*.97,d,t,.38,5);vo('a',f*.75,f*.73,d,t+.05,.3,5)},horn=(t,f=130,d=1)=>tn('sawtooth',f,f,d,t,.2,700);
Object.assign(SF,{
ph_tut:t=>{dr(t);dr(t+.5);horn(t+.6,130,1.2);chant(t+.3,1.8)},
ph_pyr:t=>{[0,.45,.9,1.35].forEach(d=>dr(t+d));chant(t,2,100);nz(2,t,.12,'bandpass',300,700,.5)},
ph_ankh:t=>{sis(t);bl(880,1.6,t+.3,.22);chant(t+.2,1.8,130)},
ph_eye:t=>{chant(t,1.8,110);nz(1.2,t+.2,.2,'bandpass',300,3000,2);bl(1319,1.4,t+1,.2)},
ph_scar:t=>{nz(.9,t,.3,'bandpass',900,1400,6);dr(t+.9);dr(t+1.2);sis(t+.5,18)},
ph_obel:t=>{[130,165,196].forEach((f,i)=>horn(t+i*.25,f,i==2?1.4:.35));dr(t);dr(t+.5)},
ph_cart:t=>{sis(t,20);horn(t+.4,147,1);chant(t+.3,1.6,125);dr(t+1)},
ph_sun:t=>{[130,165,196].forEach(f=>chant(t,2.2,f));bl(1047,2,t+.5,.2);dr(t)}
});

function play(k){
  if(!AC){AC=new(window.AudioContext||window.webkitAudioContext)();MG=AC.createGain();MG.connect(AC.destination);NB=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate);const x=NB.getChannelData(0);for(let i=0;i<x.length;i++)x[i]=Math.random()*2-1}
  MG.gain.value=.7;AC.resume();(SF[k]||SF.pop)(AC.currentTime+.02);
}
window.MadaEmojiSfx={play:play};
})();
