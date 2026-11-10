/* DEM-aware grid water balance teaching workbench. */
(function(){
  let files={},result=null,grid=[],generation=0;
  const byId=id=>document.getElementById(id);
  const escText=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const source=()=>state.demData?`本地 DEM：${state.demData.fileName}${state.demResult?' · 出口汇水区':' · DEM 有效区域'}`:'合成 4×4 示意网格';
  const fmt=n=>Number.isFinite(n)?n.toFixed(2):'—';
  const names={soil:'土壤参数',vegetation:'植被参数',forcing:'逐网格气象资料'};
  function resetGrid(){grid=GridModel.cells(state.demData,Number(state.area),state.demResult?.mask);result=null}
  function createDownload(name,content){const url=URL.createObjectURL(new Blob(['\ufeff',content],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function dataset(){const d=GridModel.demo(grid);return {
    soil:files.soil?GridModel.soil(files.soil.text,grid):GridModel.soil(d.soil,grid),
    vegetation:files.vegetation?GridModel.vegetation(files.vegetation.text,grid):GridModel.vegetation(d.vegetation,grid),
    forcing:files.forcing?GridModel.forcing(files.forcing.text,grid):GridModel.forcing(d.forcing,grid)
  }}
  function table(){
    if(!result)return '<div class="panel conceptual-empty"><span class="conceptual-empty-icon">▦</span><h2>准备网格计算</h2><p>可以先运行合成演示资料；导入真实资料时，请为每个网格提供土壤、植被和逐日气象数据。</p></div>';
    const rows=result.daily,peak=Math.max(...rows.map(r=>r.discharge)),mean=rows.reduce((s,r)=>s+r.discharge,0)/rows.length,last=rows.at(-1);
    const max=Math.max(1,...rows.map(r=>r.discharge));
    const path=rows.map((r,i)=>`${i?'L':'M'}${(40+i*800/Math.max(1,rows.length-1)).toFixed(1)} ${(230-r.discharge/max*195).toFixed(1)}`).join(' ');
    const cells=last.cells.map(c=>{const position=grid.find(g=>g.id===c.id);return `<div class="grid-cell" title="${c.id} · 产流 ${fmt(c.runoff)} mm/d" style="grid-column:${position.x+1};grid-row:${position.y+1};background:rgba(9,128,169,${(.16+Math.min(1,c.runoff/40)*.72).toFixed(2)})"><b>${c.id}</b><small>${fmt(c.runoff)}</small></div>`}).join('');
    return `<div class="panel"><div class="conceptual-result-head"><div><p class="kicker">网格计算结果 · 教学版</p><h2>${rows.length} 日 · ${grid.length} 个网格</h2><p class="hint">${escText(source())} · 流域面积 ${fmt(Number(state.area))} km²</p></div><button class="secondary" data-grid-action="export">导出逐日及网格结果 CSV ↓</button></div><div class="metrics conceptual-metrics"><div class="metric"><span>最大流量</span><b>${fmt(peak)}</b><small>m³/s</small></div><div class="metric"><span>平均流量</span><b>${fmt(mean)}</b><small>m³/s</small></div><div class="metric"><span>水量平衡最大残差</span><b>${result.maxResidual.toExponential(1)}</b><small>mm/网格/日</small></div></div><div class="conceptual-chart"><svg viewBox="0 0 880 260" role="img" aria-label="逐日网格汇总流量"><rect x="40" y="25" width="800" height="205" fill="#f8fbfc"/><path d="${path}" fill="none" stroke="#087fa8" stroke-width="2.5"/><text x="40" y="250" font-size="12" fill="#77929f">${rows[0].date}</text><text x="840" y="250" text-anchor="end" font-size="12" fill="#77929f">${last.date}</text></svg></div><p class="hint">图示为逐网格水量平衡结果的面积加权汇总，未做河道路由；不能视为正式洪水预报。</p></div><div class="panel"><h3>末日网格产流 · mm/d</h3><div class="grid-map">${cells}</div></div>`;
  }
  function render(){
    const el=byId('gridWorkbench');if(!el)return;
    const fileCard=kind=>`<label class="filebox"><input type="file" accept=".csv,text/csv" data-grid-file="${kind}"><b>${names[kind]} CSV</b><small>${files[kind]?escText(files[kind].name):'使用合成演示资料'}</small></label>`;
    el.innerHTML=`<div class="conceptual-heading"><div><p class="kicker">DISTRIBUTED GRID WATER BALANCE</p><h1>分布式网格水量平衡</h1><p>参考 VIC 的逐网格输入结构，按 DEM 网格分别计算降雨、蒸散、地表产流与基流。</p></div></div><div class="notice">教学简化版：这不是完整 VIC 求解器；尚未实现能量平衡、冻土、积雪、植被分块和河道路由。结果不可用于业务预报。</div><div class="conceptual-layout"><aside class="conceptual-controls"><div class="panel"><h3>空间网格</h3><p class="hint">${escText(source())} · ${grid.length} 个有效网格。导入 DEM 请到“空间建模”；切换项目后会重新建立网格。</p><p class="hint">流域面积 ${fmt(Number(state.area))} km²，均分至有效网格。网格编号按 4×4 行列确定。</p><button class="secondary" data-view="spatial">管理 DEM 与项目 ↗</button></div><div class="panel"><h3>网格输入资料</h3><p class="hint">资料按网格编号关联；气象资料须覆盖每个网格的每一天，日期连续。</p>${fileCard('soil')}${fileCard('vegetation')}${fileCard('forcing')}<div class="conceptual-inline-actions"><button class="secondary" data-grid-action="templates">下载当前网格模板</button><button class="secondary" data-grid-action="demo">重置为演示资料</button></div></div><div class="panel"><h3>开始计算</h3><button class="primary conceptual-run" data-grid-action="run">运行网格水量平衡 →</button></div><p class="conceptual-reference">完整 VIC 所需的参数和过程见 <a href="https://vic.readthedocs.io/en/master/Documentation/Drivers/Classic/Inputs/" target="_blank" rel="noopener noreferrer">VIC 官方输入说明 ↗</a></p></aside><div class="conceptual-results" id="gridResults">${table()}</div></div>`;
  }
  async function restore(){const token=++generation;resetGrid();files={};render();
    try{for(const kind of Object.keys(names)){const file=await HydroProjects.getFile('grid_'+kind);if(token!==generation)return;if(file)files[kind]={name:file.name,text:await file.text()}}if(token===generation)render()}
    catch(e){if(token===generation)toast('网格资料恢复失败：'+e.message)}
  }
  const oldSelect=selectView;
  selectView=function(view){oldSelect(view);if(view==='grid')restore()};
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-open-grid]')){selectView('grid');return}
    const action=e.target.closest('[data-grid-action]')?.dataset.gridAction;if(!action)return;
    try{
      if(action==='run'){const d=dataset();result=GridModel.run(grid,d.soil,d.vegetation,d.forcing);render();toast('网格教学计算完成')}
      if(action==='templates'){const d=GridModel.demo(grid);for(const kind of Object.keys(names))createDownload(`网格_${kind}_模板.csv`,d[kind]);toast('已下载 3 份当前网格模板')}
      if(action==='demo'){Promise.all(Object.keys(names).map(kind=>HydroProjects.removeFile('grid_'+kind))).then(()=>{files={};result=null;render();toast('已恢复合成演示资料')}).catch(err=>toast('重置失败：'+err.message))}
      if(action==='export'&&result){const rows=['date,cell_id,precipitation_mm,actual_evaporation_mm,runoff_mm,soil_storage_mm,baseflow_mm,storage_change_mm'];for(const day of result.daily)for(const cell of day.cells)rows.push([day.date,cell.id,cell.precipitation.toFixed(3),cell.evaporation.toFixed(3),cell.runoff.toFixed(4),cell.soil.toFixed(4),cell.baseflow.toFixed(4),cell.storageChange.toFixed(4)].join(','));createDownload('网格水量平衡_教学结果.csv',rows.join('\n'))}
    }catch(err){toast('网格计算失败：'+err.message)}
  });
  document.addEventListener('change',async e=>{
    const kind=e.target.dataset.gridFile;if(!kind)return;const file=e.target.files?.[0];if(!file)return;
    try{if(file.size>12_000_000)throw Error('文件不能超过 12 MB');const text=await file.text();const d=GridModel.demo(grid);
      if(kind==='soil')GridModel.soil(text,grid);if(kind==='vegetation')GridModel.vegetation(text,grid);if(kind==='forcing')GridModel.forcing(text,grid);
      await HydroProjects.attachFile('grid_'+kind,file);files[kind]={name:file.name,text};result=null;render();toast(`已导入${names[kind]}`)
    }catch(err){toast('导入失败：'+err.message)}
  });
})();

