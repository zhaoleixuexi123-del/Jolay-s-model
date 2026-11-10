/* SWAT-3PG workspace: local HRU overlay and optional local compute service. */
(function(){
  const $=id=>document.getElementById(id),e=window.esc||((x)=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
  let landuse=null,soil=null,hru=null,projectZip=null,job=null,pollTimer=null;
  const apiDefault='http://127.0.0.1:8787';
  const api=()=>($('swatEndpoint')?.value||apiDefault).replace(/\/$/,'');
  const status=(message)=>{const target=$('swatStatus');if(target)target.textContent=message};
  function saveFile(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
  function addView(){
    const nav=document.querySelector('.topnav'),button=document.createElement('button');button.dataset.view='swat';button.textContent='SWAT-3PG';nav.append(button);
    const section=document.createElement('section');section.id='swat';section.className='view';section.innerHTML=`<div class="conceptual-wrap swat-wrap"><div class="conceptual-heading"><div><p class="kicker">SWAT-3PG · REV. 664</p><h1>HRU 划分与 SWAT 工程试算</h1><p>土地利用、土壤和坡度叠置生成 HRU；已有 ArcSWAT 工程可交由本地计算服务运行。</p></div></div><div class="notice">HRU 划分在浏览器完成。SWAT-3PG 的 exe 需要独立计算服务；当前仅支持连接你电脑上运行的本地服务。新流域完整 TxtInOut 写入器仍需土地利用、土壤属性、管理措施和气象站等资料核对。</div><div class="swat-layout"><div class="panel"><h2>1 · 划分 HRU</h2><p class="hint">先在“空间建模”完成原始分辨率 DEM、水系和子流域划分。土地利用、土壤须与 DEM 同坐标系、同范围、同行列，栅格像元值为整数分类码。</p><button class="secondary" data-view="spatial">进入空间建模 ↗</button><div class="swat-inputs"><label class="filebox"><input id="swatLanduse" type="file" accept=".tif,.tiff"><b>土地利用 GeoTIFF</b><small id="swatLanduseName">尚未选择</small></label><label class="filebox"><input id="swatSoil" type="file" accept=".tif,.tiff"><b>土壤分类 GeoTIFF</b><small id="swatSoilName">尚未选择</small></label></div><div class="param-grid"><label class="field"><span>坡度等级 1/2 分界（%）</span><input id="swatSlope1" type="number" min="0" step="0.1" value="5"></label><label class="field"><span>坡度等级 2/3 分界（%）</span><input id="swatSlope2" type="number" min="0" step="0.1" value="15"></label></div><div class="action-row"><button class="primary" id="swatBuildHru">划分 HRU →</button><button class="secondary" id="swatExportHru" disabled>导出 HRU 清单 CSV ↓</button></div><div id="swatHruSummary" class="hint">等待子流域、土地利用和土壤数据。</div></div><div class="panel"><h2>2 · 运行已有 SWAT 工程</h2><p class="hint">上传已由 ArcSWAT 等工具生成的完整 TxtInOut ZIP。服务在独立副本中修改试算时段、写入 3-PG 参数并调用 SWAT-3PG Rev.664。请先移除 ZIP 中的大型旧 output 文件。</p><label class="field"><span>计算服务地址</span><input id="swatEndpoint" type="url" value="${e(localStorage.getItem('swat-endpoint')||apiDefault)}"></label><div class="action-row"><button class="secondary" id="swatCheckService">检查服务连接</button><span id="swatServiceState" class="hint">尚未连接</span></div><label class="filebox"><input id="swatProjectZip" type="file" accept=".zip,application/zip"><b>选择 TxtInOut ZIP（最大 100 MB）</b><small id="swatProjectName">尚未选择</small></label><label class="field"><span>试算天数（从 file.cio 起始年份第 1 天起）</span><input id="swatDays" type="number" min="1" max="365" step="1" value="10"></label><div class="action-row"><button class="primary" id="swatRun">提交 SWAT 试算 →</button><button class="secondary" id="swatResult" disabled>下载结果 TxtInOut ZIP ↓</button></div><p id="swatStatus" class="hint" role="status">等待上传工程。</p></div></div><div class="panel swat-map-panel"><div class="conceptual-result-head"><div><h2>HRU 空间结果</h2><p class="hint">每个 HRU 由子流域编号、土地利用码、土壤码和坡度等级唯一确定。颜色仅用于区分。</p></div></div><canvas id="swatHruCanvas" aria-label="HRU 划分地图"></canvas><div id="swatHruTable" class="swat-table-wrap"><p class="hint">划分完成后显示 HRU 面积与分类。</p></div></div></div>`;
    document.querySelector('main').append(section);
  }
  async function readRaster(file,kind){
    if(file.size>200_000_000)throw Error('栅格文件超过 200 MB');
    if(!state.demData)throw Error('请先在空间建模中导入 DEM');
    const result=await HRUTool.categoryRaster(file,state.demData);
    if(kind==='landuse')landuse=result;else soil=result;
    hru=null;$('swatExportHru').disabled=true;
    $(kind==='landuse'?'swatLanduseName':'swatSoilName').textContent=`${file.name} · ${result.count.toLocaleString()} 像元`;
    status(`${kind==='landuse'?'土地利用':'土壤'}栅格已读取`);
  }
  function buildHru(){
    if(!state.demData||!state.demResult||state.model!=='semi')throw Error('请先完成半分布式方案的真实 DEM 子流域划分');
    if(state.demData.approximate)throw Error('请在空间建模选择“原始分辨率”重新划分');
    hru=HRUTool.delineate(state.demData,state.demResult,landuse,soil,[Number($('swatSlope1').value),Number($('swatSlope2').value)]);
    HRUTool.draw($('swatHruCanvas'),state.demData,hru);
    const all=hru.hrus,rows=all.slice(0,120).map(v=>`<tr><td>${v.id}</td><td>${v.subbasinId}</td><td>${v.landuseCode}</td><td>${v.soilCode}</td><td>${v.slopeClass}</td><td>${v.areaKm2.toFixed(4)}</td></tr>`).join('');
    $('swatHruSummary').textContent=`已划分 ${all.length} 个 HRU · ${hru.cellCount.toLocaleString()} 个像元 · ${hru.areaKm2.toFixed(3)} km²。当前输出为 HRU 清单，尚未生成新的 SWAT TxtInOut。`;
    $('swatHruTable').innerHTML=`<table class="swat-table"><thead><tr><th>HRU</th><th>子流域</th><th>土地利用</th><th>土壤</th><th>坡度级</th><th>面积 km²</th></tr></thead><tbody>${rows}</tbody></table>${all.length>120?'<p class="hint">表格仅显示前 120 条；CSV 包含全部 HRU。</p>':''}`;
    $('swatExportHru').disabled=false;
    status(`HRU 划分完成：${all.length} 个`);
  }
  async function checkService(){
    localStorage.setItem('swat-endpoint',api());
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000);
    try{
      const response=await fetch(api()+'/api/swat/health',{signal:controller.signal});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(data.status!=='ready')throw Error('服务尚未准备好');
      $('swatServiceState').textContent=`已连接 ${data.model}`;
      return true;
    }catch(err){$('swatServiceState').textContent='未连接：'+err.message;return false}
    finally{clearTimeout(timeout)}
  }
  async function run(){
    if(!projectZip)throw Error('请先选择 TxtInOut ZIP');
    if(projectZip.size>100_000_000)throw Error('ZIP 超过 100 MB，请移除旧 output 文件后重试');
    const days=Number($('swatDays').value);if(!Number.isInteger(days)||days<1||days>365)throw Error('试算天数须为 1–365');
    if(!await checkService())throw Error('计算服务未连接；请先在本机启动 SWAT 服务');
    const button=$('swatRun');button.disabled=true;$('swatResult').disabled=true;
    try{
      status('正在上传 SWAT 工程…');
      const response=await fetch(api()+'/api/swat/jobs',{method:'POST',headers:{'Content-Type':'application/zip','X-SWAT-Days':String(days)},body:projectZip});
      const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);
      job=data.id;status('工程已提交，等待计算…');
      for(let i=0;i<130;i++){
        await new Promise(resolve=>{pollTimer=setTimeout(resolve,1000)});
        const check=await fetch(api()+'/api/swat/jobs/'+job);if(!check.ok)throw Error('任务状态读取失败');
        const state=await check.json();
        if(state.status==='complete'){status(`运行完成，已处理 ${state.input_files} 个输入文件，结果 ${Math.round(state.result_bytes/1024/1024)} MB`);$('swatResult').disabled=false;return}
        if(state.status==='failed')throw Error(state.error||'SWAT 运行失败');
        status(state.status==='running'?'SWAT 正在计算…':'任务排队中…');
      }
      throw Error('等待超过 130 秒，请稍后重新查看任务状态');
    }finally{button.disabled=false}
  }
  async function downloadResult(){
    if(!job)return;
    const response=await fetch(api()+'/api/swat/jobs/'+job+'/result');if(!response.ok)throw Error('结果下载失败');
    saveFile('SWAT3PG_TxtInOut_结果.zip',await response.blob());
  }
  addView();
  $('swatLanduse').addEventListener('change',async ev=>{try{const file=ev.target.files?.[0];if(file)await readRaster(file,'landuse')}catch(err){status('土地利用读取失败：'+err.message)}});
  $('swatSoil').addEventListener('change',async ev=>{try{const file=ev.target.files?.[0];if(file)await readRaster(file,'soil')}catch(err){status('土壤读取失败：'+err.message)}});
  $('swatBuildHru').onclick=()=>{try{buildHru()}catch(err){status('HRU 划分失败：'+err.message)}};
  $('swatExportHru').onclick=()=>{if(hru)saveFile('SWAT_HRU_清单.csv',new Blob(['\ufeff',HRUTool.csv(hru)],{type:'text/csv;charset=utf-8'}))};
  $('swatCheckService').onclick=checkService;
  $('swatProjectZip').onchange=ev=>{projectZip=ev.target.files?.[0]||null;$('swatProjectName').textContent=projectZip?`${projectZip.name} · ${(projectZip.size/1024/1024).toFixed(1)} MB`:'尚未选择'};
  $('swatRun').onclick=()=>run().catch(err=>status('运行失败：'+err.message));
  $('swatResult').onclick=()=>downloadResult().catch(err=>status(err.message));
})();

