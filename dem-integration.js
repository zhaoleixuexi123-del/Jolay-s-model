/* Local DEM workflow: import, create streams, select outlet, delineate. */
const originalMap=renderMap,originalStepContent=spContent,originalSelectModel=selectModel;
state.demData=null;state.demFlow=null;state.demStreamMask=null;state.demStreamCount=0;
state.demStreamLinks=null;state.demReachCount=0;state.demJunctionCount=0;
state.demResult=null;state.demOutlet=null;state.streamThresholdCells=null;
state.demMode='full';state.demFile=null;

renderMap=function(){
  originalMap();
  const stage=$('mapStage'),canvas=$('demCanvas'),d=state.demData,has=!!d;
  stage.classList.toggle('has-dem',has);
  document.querySelector('.map-actions').style.display=has?'none':'';
  if(!has){document.querySelector('.map-watermark').textContent='示意流域 · 非真实地理位置';return}
  DEMTool.draw(canvas,d,state.demResult,state.demOutlet);
  $('mapTitle').textContent=d.fileName+' · 本地 DEM';
  $('mapSubtitle').textContent=state.demResult?`${state.demResult.cellCount.toLocaleString()} 个汇水像元 · ${state.demResult.unitCount} 个单元`:state.demFlow?`${state.demReachCount} 个河段 · ${state.demJunctionCount} 个汇流点`:`${d.width} × ${d.height} 分析栅格 · 尚未生成水系`;
  $('unitLegend').innerHTML=`<i class="key unit"></i>${state.demResult?'计算划分':'待划分'}`;
  const badge=document.querySelector('.map-watermark');
  badge.textContent=state.demResult?`${d.approximate?'快速预览':'原始分辨率'}结果：请核对河网和边界`:state.demFlow?'水系已生成：点击蓝线选择出口':'DEM 已导入：请点击生成水系';
  badge.title=state.demResult?d.approximate?'当前按快速预览栅格计算；使用前请与实测河网核对。':'当前按原始 DEM 分辨率计算，地图仅缩小显示；使用前请与实测河网核对。':'本地 DEM 计算状态提示';
};

function demModeControls(){return `<div class="form-section"><h3>DEM 分析分辨率</h3><div class="choice-group"><button type="button" data-dem-resolution="full" class="${state.demMode==='full'?'active':''}">原始分辨率</button><button type="button" data-dem-resolution="preview" class="${state.demMode==='preview'?'active':''}">快速预览 · 最长边 512 像元</button></div><p class="hint">水系、子流域和 SHP 均按所选分辨率计算。原始分辨率保留全部像元；较大 DEM 会占用更多内存、计算更久。地图显示仍会缩小到适合屏幕的尺寸。切换选项后需重新生成水系和子流域。</p></div>`}
spContent=function(){
  const i=state.spatialStep,d=state.demData,r=state.demResult;
  if(i===1)return `<div class="softbox">先选择分析分辨率，再导入 DEM 并手动生成水系。文件只在浏览器中读取，不上传服务器。</div>${demModeControls()}<label class="filebox"><input type="file" accept=".tif,.tiff,image/tiff" data-file="dem"><b>选择本地 DEM GeoTIFF</b><small>单波段高程 · 建议投影坐标系 · 最大 200 MB</small></label><p class="file-status">${esc(d?`${d.fileName} · 原始 ${d.sourceWidth}×${d.sourceHeight} · 分析 ${d.width}×${d.height}`:'尚未选择 DEM')}</p>${d?`<div class="stat-strip"><div class="tiny-stat"><b>${d.min.toFixed(1)}–${d.max.toFixed(1)}</b><small>高程值范围</small></div><div class="tiny-stat"><b>${d.count.toLocaleString()}</b><small>有效像元</small></div></div><p class="hint">${d.approximate?'大栅格已降采样到最长边 512 像元，结果仅用于初步预览。':'使用文件原始栅格计算；地图仅缩小显示。'}${d.cellAreaKm2?'已识别像元面积。':'未能确认坐标单位，暂不计算流域面积。'}</p><button class="primary step-action" data-dem-action="generate-streams">${state.demFlow?'重新生成水系':'生成水系'} →</button>`:''}${d?'':'<button class="secondary step-action" data-action="sp-terrain">没有 DEM，使用示意水系 →</button>'}`;
  if(i===2&&d)return `<div class="softbox">${state.demFlow?'水系已生成。请点击蓝色河道设置出口，再进入子流域划分。':'尚未生成水系。请返回“水系提取”，点击“生成水系”。'}</div><div class="stat-strip"><div class="tiny-stat"><b>${state.demOutlet?`${state.demOutlet.x}, ${state.demOutlet.y}`:'未选择'}</b><small>出口列、行</small></div><div class="tiny-stat"><b>${state.demReachCount}</b><small>河段</small></div></div><div class="stat-strip"><div class="tiny-stat"><b>${state.demJunctionCount}</b><small>汇流点</small></div><div class="tiny-stat"><b>${state.demStreamCount.toLocaleString()}</b><small>河网像元</small></div></div><p class="hint">河网由 D8 汇流量和起始汇水面积阈值生成。出口将吸附到附近河网像元；请核对位置。</p><button class="primary step-action" data-action="sp-outlet" ${state.demFlow&&state.demOutlet?'':'disabled'}>确认出口，继续 →</button><button class="secondary step-action" data-dem-action="export-stream-shp" ${state.demFlow?'':'disabled'}>导出水系 SHP (.zip) ↓</button>`;
  if(i===3&&d)return `<div class="softbox">${state.model==='semi'?'点击下方按钮后，才按已生成的河网划分子流域。':'点击下方按钮后，按出口汇水范围生成网格单元。'}</div>${state.model==='distributed'?`<h3>目标网格分辨率</h3><div class="choice-group">${['250 m','500 m','1 km','2 km'].map(v=>`<button data-resolution="${v}" class="${state.resolution===v?'active':''}">${v}</button>`).join('')}</div>`:'<p class="hint">沿河网在河源、汇流点和出口确定河段；每个河段的汇水范围为一个子流域。数量由 DEM、出口和河网阈值决定。</p>'}<p class="hint">${d.approximate?'当前使用降采样 DEM，':'当前使用原始栅格，'}划分结果需与实测河网核对。</p><button class="primary step-action" data-dem-action="delineate" ${state.demFlow?'':'disabled'}>${state.model==='semi'?'划分子流域':'划分网格单元'} →</button>`;
  if(i===4&&d&&r)return `<div class="softbox">本地 DEM 划分已完成。请核对出口、汇水边界与面积，再继续。</div><div class="stat-strip"><div class="tiny-stat"><b>${r.cellCount.toLocaleString()}</b><small>汇水像元</small></div><div class="tiny-stat"><b>${r.unitCount}</b><small>${state.model==='semi'?'子流域':'网格单元'}</small></div><div class="tiny-stat"><b>${r.areaKm2?r.areaKm2.toFixed(2):'待核实'}</b><small>估算面积 km²</small></div><div class="tiny-stat"><b>${d.width}×${d.height}</b><small>分析栅格</small></div></div><p class="hint">${r.approximate?'结果经过降采样或面积单位未核实。':'使用当前文件栅格计算；仍需核对地形、水系和出口。'}</p><button class="secondary step-action" data-dem-action="export-stream-shp">导出水系 SHP (.zip) ↓</button>${state.model==='semi'?'<button class="secondary step-action" data-dem-action="export-subbasin-shp">导出子流域 SHP (.zip) ↓</button>':''}<button class="secondary step-action" data-dem-action="export">导出划分 CSV ↓</button><button class="primary step-action" data-action="sp-structure">确认划分，继续 →</button>`;
  if(i===4&&d&&!r)return `<div class="softbox">尚未划分。请回到“子流域划分”并点击划分按钮。</div>`;
  return originalStepContent();
};

selectModel=function(m){if(m!==state.model){state.demResult=null;state.partitioned=false}originalSelectModel(m)};
function resetDemAnalysis(){state.demFlow=null;state.demStreamMask=null;state.demStreamLinks=null;state.demStreamCount=0;state.demReachCount=0;state.demJunctionCount=0;state.demResult=null;state.demOutlet=null;state.streamThresholdCells=null;state.partitioned=false;state.spatialDone=[state.spatialDone[0],false,false,false,false,false]}

async function loadLocalDem(f){
  if(f.size>200_000_000){state.demError='DEM 超过 200 MB，请裁剪到目标流域附近后再试';renderSpatial();toast(state.demError);return false}
  try{
    state.demError=null;toast('正在本机读取 DEM…');
    const d=await DEMTool.readGeoTIFF(f,{fullResolution:state.demMode==='full'});
    resetDemAnalysis();state.demData=d;state.demFile=f;state.files.dem=f.name;state.spatialStep=1;
    renderSpatial();
    let stored=true;
    if(window.HydroProjects)try{await window.HydroProjects.attachFile('dem',f)}catch(err){stored=false;toast('DEM 已导入，但本地保存失败：'+err.message)}
    if(stored)toast(`${state.demMode==='full'?'原始分辨率':'快速预览'} DEM 已导入并保存；请点击“生成水系”`);
    return true;
  }catch(err){state.demError='DEM 读取失败：'+err.message;state.spatialStep=1;renderSpatial();toast(state.demError);return false}
}
document.addEventListener('change',async e=>{
  if(e.target.dataset.file!=='dem')return;
  e.stopImmediatePropagation();
  const f=e.target.files?.[0];if(f)await loadLocalDem(f);
},true);
document.addEventListener('click',async e=>{
  const b=e.target.closest('button[data-dem-resolution]');if(!b)return;
  e.stopImmediatePropagation();
  const mode=b.dataset.demResolution;if(mode===state.demMode)return;
  const previous=state.demMode;state.demMode=mode;
  if(state.demFile){if(!await loadLocalDem(state.demFile)){state.demMode=previous;renderSpatial()}}
  else renderSpatial();
},true);

document.addEventListener('click',e=>{
  const b=e.target.closest('button[data-dem-action]');if(!b)return;
  e.stopImmediatePropagation();
  const a=b.dataset.demAction;
  if(a==='generate-streams'){
    if(!state.demData)return;
    b.disabled=true;b.textContent='正在生成水系…';
    setTimeout(()=>{
      try{
        const d=state.demData,flow=DEMTool.flowNetwork(d);
        if(flow.processed<d.count*.99)throw Error('汇流网络未能完整建立');
        const threshold=Math.max(2,Math.round(d.count*state.streamPercent/100));
        const mask=new Uint8Array(d.width*d.height);let streamCount=0,best=-1;
        for(let i=0;i<mask.length;i++)if(d.valid[i]){
          if(best<0||flow.acc[i]>flow.acc[best])best=i;
          if(flow.acc[i]>=threshold){mask[i]=1;streamCount++}
        }
        if(!streamCount)throw Error('当前阈值未生成河网，请调低阈值');
        const links=DEMTool.linkStreams(d,flow,mask);
        state.demFlow=flow;state.demStreamMask=mask;state.demStreamLinks=links;
        state.demStreamCount=streamCount;state.demReachCount=links.reachCount;state.demJunctionCount=links.junctionCount;
        state.streamThresholdCells=threshold;state.demResult=null;state.partitioned=false;
        state.demOutlet={x:best%d.width,y:Math.floor(best/d.width)};
        markSpatial(1);toast('水系已生成。请在地图上核对或重新选择出口');
      }catch(err){b.disabled=false;b.textContent='生成水系 →';toast('生成失败：'+err.message)}
    },20);
  }else if(a==='delineate'){
    if(!state.demData||!state.demFlow||!state.demStreamMask||!state.demOutlet){toast('请先生成水系并选择出口');return}
    b.disabled=true;b.textContent='正在划分…';
    setTimeout(()=>{
      try{
        const r=DEMTool.delineate(state.demData,state.demFlow,state.demOutlet.x,state.demOutlet.y,state.model,state.resolution,state.streamPercent,state.streamThresholdCells);
        if(state.model==='semi'&&r.cellCount<state.streamThresholdCells)throw Error('出口上游面积小于河网阈值，请在蓝色河道下游选择出口');
        state.demResult=r;state.partitioned=true;state.spatialDone[2]=true;
        markSpatial(3);toast(state.model==='semi'?`已按河段汇水范围划分 ${r.unitCount} 个子流域`:'已生成网格单元');
      }catch(err){b.disabled=false;b.textContent=state.model==='semi'?'划分子流域 →':'划分网格单元 →';toast('划分失败：'+err.message)}
    },20);
  }else if(a==='export-stream-shp'){
    if(!state.demData||!state.demFlow||!state.demStreamMask){toast('请先生成水系');return}
    try{
      const mask=state.demResult?.streamMask||state.demStreamMask;
      const links=state.demResult?.streamMask?DEMTool.linkStreams(state.demData,state.demFlow,mask):state.demStreamLinks;
      DEMShapefile.save('水系_SHP.zip',DEMShapefile.streamsZip(state.demData,state.demFlow,mask,links));
      toast(`已导出 ${links.reachCount} 个河段的 SHP 压缩包`);
    }catch(err){toast('水系 SHP 导出失败：'+err.message)}
  }else if(a==='export-subbasin-shp'){
    if(!state.demData||!state.demResult||state.model!=='semi'){toast('请先划分子流域');return}
    try{
      DEMShapefile.save('子流域_SHP.zip',DEMShapefile.subbasinsZip(state.demData,state.demResult));
      toast(`已导出 ${state.demResult.unitCount} 个子流域的 SHP 压缩包`);
    }catch(err){toast('子流域 SHP 导出失败：'+err.message)}
  }else if(a==='export'){
    const d=state.demData,r=state.demResult,f=state.demFlow;if(!d||!r||!f)return;
    const rows=['col,row,elevation,flow_accumulation,unit_id'];
    for(let i=0;i<r.mask.length;i++)if(r.mask[i])rows.push([i%d.width,Math.floor(i/d.width),d.values[i].toFixed(3),f.acc[i],r.labels[i]].join(','));
    download('本地DEM_汇水划分.csv',rows.join('\n'));
  }
},true);

$('demCanvas').addEventListener('click',e=>{
  if(!state.demData||!state.demFlow||state.spatialStep!==2)return;
  const box=e.currentTarget.getBoundingClientRect(),d=state.demData;
  const x=Math.min(d.width-1,Math.max(0,Math.round((e.clientX-box.left)/box.width*(d.width-1))));
  const y=Math.min(d.height-1,Math.max(0,Math.round((e.clientY-box.top)/box.height*(d.height-1))));
  let best=-1,dist=Infinity;
  for(let dy=-12;dy<=12;dy++)for(let dx=-12;dx<=12;dx++){
    const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=d.width||yy>=d.height)continue;
    const i=yy*d.width+xx,dd=dx*dx+dy*dy;
    if(state.demStreamMask[i]&&(dd<dist||dd===dist&&state.demFlow.acc[i]>state.demFlow.acc[best])){best=i;dist=dd}
  }
  if(best<0){toast('附近没有河网像元，请点击蓝色河道');return}
  state.demOutlet={x:best%d.width,y:Math.floor(best/d.width)};
  state.demResult=null;state.partitioned=false;renderSpatial();toast('出口已吸附到河网；点击“确认出口”继续');
});
renderSpatial();
