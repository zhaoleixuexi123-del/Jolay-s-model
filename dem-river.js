/* Show a candidate stream network from locally computed flow accumulation. */
state.streamPercent=1.5;
const previousDemDraw=DEMTool.draw;
DEMTool.draw=function(canvas,dem,result,outlet){
  previousDemDraw(canvas,dem,result,null);
  const flow=state.demFlow;if(!flow)return;
  const streamMask=result?.streamMask||state.demStreamMask;
  const w=dem.width,h=dem.height,cw=canvas.width,ch=canvas.height;
  const columns=Int32Array.from({length:cw},(_,x)=>Math.min(w-1,Math.floor((x+.5)*w/cw)));
  const rows=Int32Array.from({length:ch},(_,y)=>Math.min(h-1,Math.floor((y+.5)*h/ch)));
  const source=(x,y)=>rows[y]*w+columns[x];
  const ctx=canvas.getContext('2d'),img=ctx.getImageData(0,0,cw,ch);
  if(result&&state.model==='semi'){
    const palette=[[88,176,202],[230,170,111],[133,190,144],[175,154,211],[215,204,116],[116,167,213],[198,147,159],[125,202,191]];
    for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
      const i=source(x,y);if(!result.mask[i])continue;
      const c=palette[(result.labels[i]-1)%palette.length],j=(y*cw+x)*4;
      for(let k=0;k<3;k++)img.data[j+k]=Math.round(img.data[j+k]*.18+c[k]*.82);
    }
  }
  if(streamMask)for(let i=0;i<streamMask.length;i++)if(streamMask[i]){
    const x=Math.min(cw-1,Math.floor((i%w+.5)*cw/w)),y=Math.min(ch-1,Math.floor((Math.floor(i/w)+.5)*ch/h)),j=(y*cw+x)*4;
    img.data[j]=13;img.data[j+1]=103;img.data[j+2]=166;img.data[j+3]=255;
  }
  if(result){
    const mask=result.mask,labels=result.labels;
    for(let y=1;y<ch-1;y++)for(let x=1;x<cw-1;x++){
      const i=source(x,y);if(!mask[i])continue;
      const left=source(x-1,y),right=source(x+1,y),top=source(x,y-1),bottom=source(x,y+1);
      const edge=!mask[left]||!mask[right]||!mask[top]||!mask[bottom];
      const divide=mask[left]&&labels[left]!==labels[i]||mask[right]&&labels[right]!==labels[i]||mask[top]&&labels[top]!==labels[i]||mask[bottom]&&labels[bottom]!==labels[i];
      if(edge||divide){const j=(y*cw+x)*4;img.data[j]=edge?245:255;img.data[j+1]=edge?249:255;img.data[j+2]=edge?252:255;img.data[j+3]=255}
    }
  }
  ctx.putImageData(img,0,0);
};
function renderDemLabels(){
  const layer=$('demLabels'),stage=$('mapStage'),dem=state.demData,result=state.demResult;
  layer.replaceChildren();
  if(!dem)return;
  const width=stage.clientWidth,height=stage.clientHeight;
  if(width<100||height<100)return;
  const occupied=[];
  const outlet=result?{x:result.outlet%dem.width,y:Math.floor(result.outlet/dem.width)}:state.demOutlet;
  if(outlet){
    const x=(outlet.x+.5)*width/dem.width,y=(outlet.y+.5)*height/dem.height;
    const marker=document.createElement('span');marker.className='dem-outlet-marker';
    marker.style.left=x+'px';marker.style.top=y+'px';marker.title='流域出口';layer.appendChild(marker);
    occupied.push([x-14,y-14,x+14,y+14]);
  }
  if(!result||state.model!=='semi')return;
  const sourceW=dem.width,sourceH=dem.height,w=dem.displayWidth||sourceW,h=dem.displayHeight||sourceH,n=w*h;
  const labels=new Uint32Array(n),mask=new Uint8Array(n);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sx=Math.min(sourceW-1,Math.floor((x+.5)*sourceW/w)),sy=Math.min(sourceH-1,Math.floor((y+.5)*sourceH/h));
    const from=sy*sourceW+sx,to=y*w+x;
    if(result.mask[from]){mask[to]=1;labels[to]=result.labels[from]}
  }
  const sums=Array.from({length:result.unitCount+1},()=>({x:0,y:0,count:0}));
  const distance=new Uint16Array(n),groups=Array.from({length:result.unitCount+1},()=>[]);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!mask[i])continue;
    const id=labels[i],s=sums[id];s.x+=x+.5;s.y+=y+.5;s.count++;
    distance[i]=x===0||y===0||x===w-1||y===h-1||labels[i-1]!==id||labels[i+1]!==id||labels[i-w]!==id||labels[i+w]!==id?0:65535;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(!mask[i]||!distance[i])continue;
    if(x&&labels[i-1]===labels[i])distance[i]=Math.min(distance[i],distance[i-1]+1);
    if(y&&labels[i-w]===labels[i])distance[i]=Math.min(distance[i],distance[i-w]+1);
  }
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
    const i=y*w+x;if(!mask[i]||!distance[i])continue;
    if(x<w-1&&labels[i+1]===labels[i])distance[i]=Math.min(distance[i],distance[i+1]+1);
    if(y<h-1&&labels[i+w]===labels[i])distance[i]=Math.min(distance[i],distance[i+w]+1);
  }
  for(const s of sums)if(s.count){s.x/=s.count;s.y/=s.count}
  for(let i=0;i<n;i++)if(mask[i]){
    const id=labels[i],x=i%w+.5,y=Math.floor(i/w)+.5,s=sums[id];
    groups[id].push([i,distance[i]*12-Math.hypot(x-s.x,y-s.y)*.07]);
  }
  for(let id=1;id<=result.unitCount;id++)if(!groups[id].length&&result.reachHeads?.[id]!=null){
    const cell=result.reachHeads[id],x=Math.min(w-1,Math.floor((cell%sourceW+.5)*w/sourceW)),y=Math.min(h-1,Math.floor((Math.floor(cell/sourceW)+.5)*h/sourceH));
    groups[id].push([y*w+x,0]);
  }
  const boxes=document.querySelectorAll('.map-stage .map-watermark,.map-stage .map-scale');
  const stageBox=stage.getBoundingClientRect();
  for(const element of boxes){const b=element.getBoundingClientRect();if(b.width&&b.height)occupied.push([b.left-stageBox.left-4,b.top-stageBox.top-4,b.right-stageBox.left+4,b.bottom-stageBox.top+4])}
  const ids=Array.from({length:result.unitCount},(_,i)=>i+1).sort((a,b)=>(result.unitCells?.[a-1]||sums[a].count)-(result.unitCells?.[b-1]||sums[b].count));
  for(const id of ids){
    const candidates=groups[id].sort((a,b)=>b[1]-a[1]),halfWidth=38,halfHeight=12;
    let chosen=null,callout=null;
    const available=(x,y)=>x>=halfWidth+5&&x<=width-halfWidth-5&&y>=halfHeight+5&&y<=height-halfHeight-5&&!occupied.some(b=>x+halfWidth+4>b[0]&&x-halfWidth-4<b[2]&&y+halfHeight+3>b[1]&&y-halfHeight-3<b[3]);
    for(const [cell] of candidates){
      const x=(cell%w+.5)*width/w,y=(Math.floor(cell/w)+.5)*height/h;
      if(!available(x,y))continue;
      chosen=[x,y];break;
    }
    if(!chosen&&candidates.length){
      const cell=candidates[0][0],ax=(cell%w+.5)*width/w,ay=(Math.floor(cell/w)+.5)*height/h;
      for(const radius of [30,50,75,105,140]){
        for(let angle=0;angle<16;angle++){
          const theta=angle*Math.PI/8,x=ax+radius*Math.cos(theta),y=ay+radius*Math.sin(theta);
          if(available(x,y)){chosen=[x,y];callout=[ax,ay];break}
        }
        if(chosen)break;
      }
    }
    if(!chosen)continue;
    const [x,y]=chosen,tag=document.createElement('span');tag.className='dem-label';
    if(callout){
      const [ax,ay]=callout,line=document.createElement('span');line.className='dem-label-leader';
      line.style.left=ax+'px';line.style.top=ay+'px';line.style.width=Math.hypot(x-ax,y-ay)+'px';
      line.style.transform=`rotate(${Math.atan2(y-ay,x-ax)}rad)`;layer.appendChild(line);
    }
    tag.textContent='SUB-'+String(id).padStart(3,'0');
    tag.style.left=x+'px';tag.style.top=y+'px';
    tag.title=`子流域 ${id} · ${(result.unitCells?.[id-1]||sums[id].count).toLocaleString()} 个分析像元`;
    layer.appendChild(tag);occupied.push([x-halfWidth,y-halfHeight,x+halfWidth,y+halfHeight]);
  }
}
const mapWithDemRaster=renderMap;
renderMap=function(){mapWithDemRaster();renderDemLabels()};
if('ResizeObserver' in window)new ResizeObserver(()=>{if(state.demData)renderDemLabels()}).observe($('mapStage'));
const previousSpContent=spContent;
function streamThresholdText(){
  const cells=Math.max(2,Math.round((state.demData?.count||0)*state.streamPercent/100));
  return state.demData?.cellAreaKm2?`${(cells*state.demData.cellAreaKm2).toFixed(0)} km²（${cells.toLocaleString()} 像元）`:`${cells.toLocaleString()} 像元`;
}
spContent=function(){
  let html=previousSpContent();
  if(state.spatialStep===1&&state.demError)html='<div class="notice">'+esc(state.demError)+'</div>'+html;
  if(state.demData&&state.spatialStep===1){
    const status=state.demFlow?'<div class="softbox">水系已生成。可调整阈值后重新生成。</div>':'<div class="softbox">导入完成，尚未生成水系。请设置起始汇水面积并点击“生成水系”。</div>';
    html=status+html;
    html=html.replace('<button class="primary step-action" data-dem-action="generate-streams">',`<label class="field"><span>河网起始汇水面积：<b id="thresholdValue">${streamThresholdText()}</b></span><input id="streamThreshold" type="range" min="0.2" max="8" step="0.1" value="${state.streamPercent}"></label><p class="hint">按 D8 汇流量达到该阈值的位置生成河网。降低阈值通常会得到更多支流；修改后需重新点击“生成水系”。</p><button class="primary step-action" data-dem-action="generate-streams">`);
  }
  if(state.demData&&state.demFlow&&state.spatialStep===2){
    html='<div class="softbox">已生成水系。蓝线是河道，尚未划分子流域。</div>'+html;
  }
  if(state.demData&&state.spatialStep===4&&state.model==='semi'&&state.demResult?.unitCells){
    const r=state.demResult,d=state.demData;
    const rows=r.unitCells.map((n,i)=>`<div class="file-row"><b>SUB-${String(i+1).padStart(3,'0')}</b><span>${d.cellAreaKm2?(n*d.cellAreaKm2).toFixed(1)+' km²':n.toLocaleString()+' 像元'}</span></div>`).join('');
    html=html.replace('<button class="secondary step-action" data-dem-action="export">',`<div class="form-section"><h3>各子流域估算面积</h3>${rows}</div><button class="secondary step-action" data-dem-action="export">`);
  }
  return html;
};
document.addEventListener('input',e=>{if(e.target.id!=='streamThreshold')return;state.streamPercent=Number(e.target.value);$('thresholdValue').textContent=streamThresholdText()});
document.addEventListener('change',e=>{
  if(e.target.id!=='streamThreshold'||!state.demData)return;
  const next=Math.max(2,Math.round(state.demData.count*state.streamPercent/100));
  if(state.demFlow&&next!==state.streamThresholdCells){
    resetDemAnalysis();state.spatialStep=1;renderSpatial();toast('阈值已修改，请重新点击“生成水系”');
  }
});
renderSpatial();
