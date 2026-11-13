import { enableBottleViews } from './bottle-views.js?v=2';

const canvas=document.querySelector('#film');
const poster=document.querySelector('#poster');
const title=document.querySelector('.brand');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const mobile=matchMedia('(max-width: 700px)').matches;
const variant=mobile?'mobile':'desktop';
const ENTRY_AT=3.3, FPS=25, TURN=20, RESUME_DELAY=2000;
const media=mobile?[720,960]:[1200,1400];
const turnCrop=mobile?[128,90,512,756]:[262,132,744,1100];
let gl,program,texture,uniforms,frame=0,previous=null,elapsed=0;
let phase='LOADING',activeVideo=null,videoDirty=false,hasVideo=false;
let entryStarted=false,loopStarted=false,failed=false,initialized=false;
let entry,loop,decodedFrames=0,requests=0,draws=0,timelineTicks=0,seeks=0;
let viewport=[0,0],origin=[0,0],titleOpacity=-1,entryDuration=null;
let pointer=null,desiredTime=null,seekFrame=0,resumeTimer=0,holding=false;
let fallbackTimer=0, playbackTimer=0, lastFogDraw=-Infinity, lastSeek=-Infinity;
const callbacks=new Map();
const wrap=t=>((t%TURN)+TURN)%TURN;
function setPhase(next){phase=next;canvas.dataset.phase=next;}
function fitTitle(){
 title.style.fontSize='';
 const width=title.getBoundingClientRect().width;
 if(width)title.style.fontSize=`${parseFloat(getComputedStyle(title).fontSize)*innerWidth*.92/width}px`;
}
function revealTitle(progress=1){
 const p=Math.max(0,Math.min(1,progress));
 if(p===titleOpacity)return;
 titleOpacity=p;title.style.opacity=String(p);
 title.style.setProperty('--title-blur',p===1?'0px':`${(1-p)*9}px`);
}
function stopTimers(){
 cancelAnimationFrame(frame);frame=0;previous=null;
 clearTimeout(resumeTimer);clearTimeout(fallbackTimer);fallbackTimer=0;
 cancelAnimationFrame(seekFrame);seekFrame=0;
}
function releaseVideo(video){
 if(!video)return;video.pause();
 if(callbacks.has(video))video.cancelVideoFrameCallback?.(callbacks.get(video));
 callbacks.delete(video);video.removeAttribute('src');video.load();video.remove();
}
function staticFallback(){
 if(failed)return;
 failed=true;
 setPhase('STATIC');
 stopTimers();
 clearTimeout(playbackTimer);
 pointer=null;
 canvas.removeAttribute('data-interactive');
 canvas.tabIndex=-1;
 releaseVideo(entry);
 releaseVideo(loop);
 activeVideo=null;
 canvas.hidden=true;
 poster.hidden=false;
 revealTitle();
 if(!reduced.matches)enableBottleViews(poster, mobile);
}
function watchPlayback(video){
 clearTimeout(playbackTimer);
 playbackTimer=setTimeout(()=>{
  if(document.hidden||failed)return;
  if(video===entry&&!entryStarted)return;
  if(video===loop&&holding)return;
  staticFallback();
 }, 4500);
}
function playVideo(video){
 watchPlayback(video);
 return video.play().catch(()=>{
  if(!document.hidden)staticFallback();
 });
}
function shader(type,source){
 const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);
 if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh));return sh;
}
function prepareGL(){
 gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
 if(!gl)throw new Error('WebGL unavailable');
 const vertex=shader(gl.VERTEX_SHADER,`attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`);
 const fragment=shader(gl.FRAGMENT_SHADER,`
 precision highp float;
 uniform vec2 resolution,mediaSize,origin;
 uniform vec4 sourceCrop;
 uniform float time,videoOn;
 uniform sampler2D film;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
 float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=noise(p)*a;p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(3.1,7.4);a*=.5;}return v;}
 void main(){
  vec2 uv=(gl_FragCoord.xy+origin)/resolution;
  float fog=0.;
  if(time<3.05){
   float t=clamp((time-.4)/2.6,0.,1.);
   vec2 p=(uv-.5)*vec2(resolution.x/resolution.y,1.)*3.;
   vec2 flow=vec2(fbm(p+vec2(time*.05,0.)),fbm(p-vec2(0.,time*.07)));
   float field=fbm(p+1.5*flow+vec2(time*.075,-time*.045));
   fog=smoothstep(t*1.3-.16,t*1.3+.16,field);
   fog=max(fog,1.-smoothstep(.35,.7,time));
  }
  vec3 color=vec3(0.);float a=0.;
  if(videoOn>.5){
   float fit=min(resolution.x/mediaSize.x,resolution.y/mediaSize.y);
   vec2 filmUV=(gl_FragCoord.xy+origin-resolution*.5)/(mediaSize*fit)+.5;
   filmUV=(filmUV*mediaSize-sourceCrop.xy)/sourceCrop.zw;
   if(all(greaterThanEqual(filmUV,vec2(0.)))&&all(lessThanEqual(filmUV,vec2(1.)))){
    color=texture2D(film,vec2(filmUV.x*.5,filmUV.y)).rgb;
    a=texture2D(film,vec2(.5+filmUV.x*.5,filmUV.y)).r;
    if(a<.004)a=0.;
   }
  }
  gl_FragColor=vec4(color*a,a+fog*(1.-a));
 }`);
 program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
 gl.useProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
 const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
 const loc=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
 texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));
 uniforms=Object.fromEntries(['resolution','mediaSize','origin','sourceCrop','time','videoOn','film'].map(n=>[n,gl.getUniformLocation(program,n)]));gl.uniform1i(uniforms.film,0);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
 resize();
}
function resize(){
 fitTitle();if(!gl||failed)return;
 const dpr=entryStarted?Math.min(devicePixelRatio,1.5):.75;
 viewport=[Math.round(innerWidth*dpr),Math.round(innerHeight*dpr)];
 let left=0,top=0,right=innerWidth,bottom=innerHeight;
 if(loopStarted){
  // All 500 source silhouettes fit these bounds, including a generous safety margin.
  const bounds=mobile?[128,115,638,870]:[262,169,1004,1268];
  const fit=Math.min(innerWidth/media[0],innerHeight/media[1]);
  const x=(innerWidth-media[0]*fit)/2,y=(innerHeight-media[1]*fit)/2;
  left=Math.max(0,Math.floor(x+bounds[0]*fit));top=Math.max(0,Math.floor(y+bounds[1]*fit));
  right=Math.min(innerWidth,Math.ceil(x+bounds[2]*fit));bottom=Math.min(innerHeight,Math.ceil(y+bounds[3]*fit));
 }
 Object.assign(canvas.style,{inset:'auto',left:`${left}px`,top:`${top}px`,width:`${right-left}px`,height:`${bottom-top}px`});
 canvas.width=Math.round((right-left)*dpr);canvas.height=Math.round((bottom-top)*dpr);
 origin=[Math.round(left*dpr),Math.round((innerHeight-bottom)*dpr)];
 gl.viewport(0,0,canvas.width,canvas.height);draw();
}
function updateAngle(){
 if(!loopStarted)return;
 const angle=Math.round(wrap((loop?.currentTime||0)+2.4)/TURN*360)%360;
 canvas.setAttribute('aria-valuenow',String(angle));canvas.setAttribute('aria-valuetext',`${angle}°`);
}
function draw(){
 if(!gl||failed||document.hidden)return;
 try{
  if(activeVideo&&activeVideo.readyState>=2&&videoDirty){
   gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,activeVideo);
   if(!hasVideo&&gl.getError()!==gl.NO_ERROR){staticFallback();return;}
   videoDirty=false;hasVideo=true;decodedFrames++;
  }
  gl.uniform2f(uniforms.resolution,...viewport);gl.uniform2f(uniforms.origin,...origin);
  gl.uniform2f(uniforms.mediaSize,...media);
  gl.uniform4f(uniforms.sourceCrop,...(activeVideo===loop?turnCrop:[0,0,...media]));
  gl.uniform1f(uniforms.time,elapsed);gl.uniform1f(uniforms.videoOn,hasVideo?1:0);gl.drawArrays(gl.TRIANGLES,0,3);draws++;
 }catch{staticFallback();}
}
function watchVideo(video){
 if(video.requestVideoFrameCallback){
  const callback=()=>{
   if(video===activeVideo&&!document.hidden&&!failed){videoDirty=true;draw();}
   if(!failed&&video.src)callbacks.set(video,video.requestVideoFrameCallback(callback));
  };
  callbacks.set(video,video.requestVideoFrameCallback(callback));
 }
 video.addEventListener('seeked',()=>{
  if(video===activeVideo&&!document.hidden&&!failed){videoDirty=true;draw();updateAngle();}
  if(video===loop)queueSeek();
 });
}
function fallbackFrames(){
 clearTimeout(fallbackTimer);fallbackTimer=0;
 if(!activeVideo||activeVideo.requestVideoFrameCallback||activeVideo.paused||document.hidden||failed)return;
 videoDirty=true;draw();fallbackTimer=setTimeout(fallbackFrames,1000/FPS);
}
function makeVideo(name,isLoop){
 const video=document.createElement('video');video.className='media-source';video.setAttribute('aria-hidden','true');video.tabIndex=-1;video.muted=true;video.defaultMuted=true;video.volume=0;video.playsInline=true;video.setAttribute('webkit-playsinline','');video.preload='auto';video.loop=isLoop;
 video.src=`assets/${name}-${variant}.mp4`;document.body.append(video);requests++;
 video.addEventListener('timeupdate',()=>{
  if(!document.hidden&&!video.paused&&!video.seeking&&video===activeVideo)watchPlayback(video);
 });
 video.addEventListener('error',()=>{if(!failed&&video.hasAttribute('src'))staticFallback();});
 video.addEventListener('playing',()=>{
  if(failed||document.hidden)return;
  watchPlayback(video);
  activeVideo=video;videoDirty=true;setPhase(isLoop?'LOOP':'ENTRY');draw();fallbackFrames();
  if(failed)return;
  if(!isLoop&&!loop)loop=makeVideo('turn',true);
  if(isLoop){
   canvas.dataset.interactive='true';
   canvas.tabIndex=0;
   canvas.setAttribute('aria-disabled','false');
   updateAngle();
   if(entry){entryDuration=entry.duration;const finished=entry;entry=null;releaseVideo(finished);}
  }
 });
 watchVideo(video);return video;
}
async function beginEntry(){
 if(entryStarted||failed||document.hidden||elapsed<ENTRY_AT)return;
 entryStarted=true;setPhase('ENTRY_PENDING');
 resize();
 await playVideo(entry);
}
async function beginLoop(){
 if(loopStarted||failed)return;
 loopStarted=true;
 setPhase('LOOP_PENDING');
 resize();
 if(!loop)loop=makeVideo('turn',true);
 if(!document.hidden)await playVideo(loop);
}
function tick(now){
 frame=0;if(failed||document.hidden||reduced.matches){previous=null;return;}
 timelineTicks++;
 if(previous!==null)elapsed+=(now-previous)/1000;previous=now;
 const progress=Math.max(0,Math.min(1,(elapsed-.4)/2.6));revealTitle(progress*progress*(3-2*progress));
 if(elapsed>=ENTRY_AT){
  elapsed=ENTRY_AT;revealTitle();setPhase('WAITING');draw();beginEntry();previous=null;return;
 }
 if(now-lastFogDraw>=31&&elapsed<=3.1){draw();lastFogDraw=now;}
 frame=requestAnimationFrame(tick);
}
function queueSeek(){
 if(seekFrame||failed||document.hidden)return;
 seekFrame=requestAnimationFrame(now=>{
  seekFrame=0;if(!loop||loop.seeking||desiredTime===null)return;
  if(now-lastSeek<48){queueSeek();return;}
  const target=Math.floor(wrap(desiredTime)*FPS)/FPS;
  if(Math.abs(loop.currentTime-target)<.018){desiredTime=null;return;}
  desiredTime=null;lastSeek=now;seeks++;loop.currentTime=target;
 });
}
function resumeAuto(){
 clearTimeout(resumeTimer);
 if(failed||document.hidden||pointer)return;
 holding=false;desiredTime=null;playVideo(loop);
}
function hold(){
 clearTimeout(resumeTimer);holding=true;loop.pause();clearTimeout(fallbackTimer);clearTimeout(playbackTimer);
}
function scheduleResume(){
 clearTimeout(resumeTimer);resumeTimer=setTimeout(resumeAuto,RESUME_DELAY);
}
canvas.addEventListener('pointerdown',event=>{
 if(phase!=='LOOP'||failed||event.isPrimary===false||event.button!==0||pointer)return;
 hold();pointer={id:event.pointerId,x:event.clientX,time:loop.currentTime};desiredTime=null;
 canvas.setPointerCapture(event.pointerId);canvas.dataset.dragging='true';
});
canvas.addEventListener('pointermove',event=>{
 if(!pointer||event.pointerId!==pointer.id)return;
 // One turn per viewport width, in either direction; only the latest requested frame is decoded.
 desiredTime=pointer.time+(event.clientX-pointer.x)/Math.max(320,innerWidth)*TURN;
 queueSeek();
});
function endDrag(event){
 if(!pointer||event.pointerId!==pointer.id)return;
 pointer=null;delete canvas.dataset.dragging;updateAngle();scheduleResume();
}
canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('lostpointercapture',endDrag);
canvas.addEventListener('keydown',event=>{
 if(phase!=='LOOP'||failed)return;
 let target=desiredTime??loop.currentTime;
 if(event.key==='ArrowLeft')target-=TURN/72;
 else if(event.key==='ArrowRight')target+=TURN/72;
 else if(event.key==='Home')target=TURN-2.4;
 else if(event.key==='End')target=TURN-2.4-1/FPS;
 else return;
 event.preventDefault();hold();desiredTime=target;queueSeek();scheduleResume();
});
async function initialize(){
 fitTitle();
 document.fonts?.ready.then(fitTitle);
 if(reduced.matches){staticFallback();return;}
 if(mobile){
  const hero=poster.closest('main');
  hero.dataset.phoneIntro='';
  setPhase('IMAGES');
  const rise = poster.getAnimations?.().find(animation => animation.animationName === 'phone-rise');
  enableBottleViews(poster, true, rise?.finished);
  return;
 }
 try{
  prepareGL();
  revealTitle(0);poster.hidden=true;canvas.hidden=false;
  entry=makeVideo('entry',false);
  entry.addEventListener('ended',beginLoop);
  initialized=true;setPhase('TITLE');canvas.dataset.ready='true';frame=requestAnimationFrame(tick);
 }catch{canvas.dataset.ready='failed';staticFallback();}
}
addEventListener('resize',resize);
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();staticFallback();});
document.addEventListener('visibilitychange',()=>{
 stopTimers();
 clearTimeout(playbackTimer);
 if(document.hidden){
  if(pointer){const id=pointer.id;pointer=null;delete canvas.dataset.dragging;try{canvas.releasePointerCapture(id)}catch{}}
  entry?.pause();loop?.pause();
 }else if(initialized&&!failed&&!reduced.matches){
  if(loopStarted){if(holding)scheduleResume();else playVideo(loop);}
  else if(entryStarted&&!entry?.ended)playVideo(entry);
  else if(entryStarted&&entry?.ended)beginLoop();
  else if(elapsed>=ENTRY_AT)beginEntry();
  else frame=requestAnimationFrame(tick);
  draw();
 }
});
reduced.addEventListener?.('change',()=>{if(reduced.matches)staticFallback();});
export function inspectExperience(){return {initialized,failed,phase,elapsed,titleOpacity,variant,hasVideo,decodedFrames,requests,activeTime:activeVideo?.currentTime??null,entryDuration:entry?.duration??entryDuration,loopDuration:loop?.duration??null,entryPaused:entry?.paused??true,loopPaused:loop?.paused??true,canvas:[canvas.width,canvas.height],draws,timelineTicks,seeks,holding,dragging:!!pointer,pendingSeek:desiredTime,videoElements:document.querySelectorAll('video').length,framePending:!!frame,canvasOrigin:origin};}
export const experienceReady=initialize();
