/* Standalone daily HBV and GR4J workbench. */
(function(){
  const defaults=RainfallModels.definitions;
  state.conceptualModel=state.conceptualModel||'hbv';
  state.conceptualParams=state.conceptualParams||Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,{...value.params}]));
  state.conceptualFileName=state.conceptualFileName||'';
  state.conceptualData=null;state.conceptualResult=null;state.conceptualSimulated=!!state.conceptualSimulated;
  let demo=RainfallModels.demo(state.area),loadGeneration=0;
  const modelName=()=>defaults[state.conceptualModel].name;
  const days=()=>state.conceptualData||demo;
  const sourceName=()=>state.conceptualData?state.conceptualFileName:'合成演示数据';
  const parameterLabels={FC:'土壤最大蓄水量 FC · mm',BETA:'入渗指数 BETA',LP:'蒸散发阈值 LP',K0:'快流系数 K0 · d⁻¹',K1:'上层出流系数 K1 · d⁻¹',K2:'下层出流系数 K2 · d⁻¹',UZL:'快流阈值 UZL · mm',PERC:'下渗量 PERC · mm/d',X1:'产流水库容量 X1 · mm',X2:'地下水交换 X2 · mm/d',X3:'汇流水库容量 X3 · mm',X4:'单位线时长 X4 · d'};
  function run(){
    const model=state.conceptualModel,input=days(),area=Number(state.area);
    if(!Number.isFinite(area)||area<=0)throw Error('请填写有效的流域面积');
    const qmm=RainfallModels.run(model,input,state.conceptualParams[model]);
    const qcms=qmm.map(v=>v*area/86.4);
    const metrics=RainfallModels.scores(qcms,input.map(d=>d.q));
    state.conceptualResult={model,qmm,qcms,metrics,source:sourceName()};
    state.conceptualSimulated=true;persist();render();
  }
  function renderControls(){
    const model=state.conceptualModel,def=defaults[model],input=days();
    document.querySelectorAll('[data-conceptual-model]').forEach(button=>button.classList.toggle('active',button.dataset.conceptualModel===model));
    const params=Object.entries(def.params).map(([key])=>{
      const value=state.conceptualParams[model][key],range=def.ranges[key];
      return `<label class="field"><span>${parameterLabels[key]}</span><input data-conceptual-param="${key}" type="number" min="${range[0]}" max="${range[1]}" step="any" value="${esc(value)}"></label>`;
    }).join('');
    $('conceptualControls').innerHTML=`<div class="panel"><p class="kicker">当前模型</p><h2>${esc(modelName())}</h2><p class="hint">${model==='hbv'?'逐日土壤水量和上下层水库计算；不模拟积雪、融雪与河道滞时。':'逐日产流水库、双单位线和汇流水库计算。参数 X1–X4 可调整。'}</p><div class="conceptual-project"><span>项目：${esc(state.project)}</span><button type="button" data-view="spatial">管理项目 ↗</button></div><label class="field"><span>流域面积（km²）</span><input id="conceptualArea" type="number" min="0.01" step="0.01" value="${esc(state.area)}"></label><p class="hint">流量换算：1 mm/d × 1 km² = 1/86.4 m³/s。</p></div>
    <div class="panel"><h3>逐日资料</h3><p class="hint">当前：${esc(sourceName())} · ${input.length} 日。CSV 字段：date, precipitation_mm, evaporation_mm；可选 discharge_m3s 用于计算评价指标。</p><label class="filebox"><input type="file" id="conceptualFile" accept=".csv,text/csv"><b>导入逐日 CSV</b><small>流域平均降雨和潜在蒸发 · 最多 3650 日</small></label><div class="conceptual-inline-actions"><button type="button" class="secondary" data-conceptual-action="template">下载模板</button><button type="button" class="secondary" data-conceptual-action="demo">使用演示资料</button></div></div>
    <div class="panel"><h3>模型参数</h3><div class="conceptual-param-grid">${params}</div><button type="button" class="primary conceptual-run" data-conceptual-action="run">运行${esc(modelName())} →</button></div>
    <p class="conceptual-reference">${model==='hbv'?'HBV 当前为简化无雪版，未加入温度驱动的积雪过程和三角河道路由。':'GR4J 采用逐日四参数产汇流结构。'}<a href="${model==='hbv'?'https://www.geo.uzh.ch/en/units/h2k/Services/HBV-Model.html':'https://crealp.github.io/rsminerve-releases/tech_hydrological_models.html#gr4j-model-description'}" target="_blank" rel="noopener noreferrer">模型资料 ↗</a></p>`;
  }
  function chart(result,input){
    const start=Math.max(0,input.length-120),view=input.slice(start),sim=result.qcms.slice(start),obs=view.map(d=>d.q),hasObs=obs.some(Number.isFinite);
    const W=900,H=320,L=55,R=18,T=24,B=37,plotW=W-L-R,plotH=H-T-B;
    const top=Math.max(1,...sim,...obs.filter(Number.isFinite))*1.12;
    const x=i=>L+i*plotW/Math.max(1,view.length-1),y=v=>T+(1-v/top)*plotH;
    const line=(arr)=>arr.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const rainTop=Math.max(1,...view.map(d=>d.p)),barWidth=Math.max(1,Math.min(7,plotW/view.length*.7));
    const obsPaths=[];let segment=[];
    obs.forEach((v,i)=>{if(Number.isFinite(v))segment.push([i,v]);else if(segment.length){obsPaths.push(segment);segment=[]}});
    if(segment.length)obsPaths.push(segment);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="逐日降雨与模拟流量过程线"><rect x="${L}" y="${T}" width="${plotW}" height="${plotH}" fill="#f8fbfc"/>${[0,.25,.5,.75,1].map(t=>`<line x1="${L}" y1="${y(t*top)}" x2="${W-R}" y2="${y(t*top)}" stroke="#dfecef"/><text x="6" y="${y(t*top)+4}" font-size="11" fill="#77929f">${(t*top).toFixed(0)}</text>`).join('')}${view.map((d,i)=>`<rect x="${x(i)-barWidth/2}" y="${T}" width="${barWidth}" height="${Math.max(1,d.p/rainTop*65)}" fill="#91d8e8" opacity=".7"/>`).join('')}<path d="${line(sim)}" fill="none" stroke="#087fa8" stroke-width="2.6"/>${hasObs?obsPaths.map(points=>`<path d="${points.map(([i,v],j)=>`${j?'L':'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="#e3a259" stroke-width="2"/>`).join(''):''}<text x="${L}" y="${H-9}" font-size="11" fill="#7893a0">${esc(view[0].date)}</text><text x="${W-R}" y="${H-9}" text-anchor="end" font-size="11" fill="#7893a0">${esc(view[view.length-1].date)}</text></svg>`;
  }
  const fmt=(n,d=2)=>n==null||!Number.isFinite(n)?'—':n.toFixed(d);
  function renderResults(){
    const result=state.conceptualResult,input=days();
    if(!result||result.model!==state.conceptualModel){
      $('conceptualResults').innerHTML=`<div class="panel conceptual-empty"><span class="conceptual-empty-icon">≈</span><h2>准备运行 ${esc(modelName())}</h2><p>左侧设置流域面积、资料和模型参数，点击“运行”后生成逐日流量过程线。当前资料：${esc(sourceName())}。</p><p class="hint">演示数据是合成数据。导入真实资料前，请核对时间步长、单位和流域平均处理方法。</p></div>`;return;
    }
    const metrics=result.metrics,peak=Math.max(...result.qcms),mean=result.qcms.reduce((a,b)=>a+b,0)/result.qcms.length;
    const card=(label,value,unit='')=>`<div class="metric"><span>${label}</span><b>${value}</b><small>${unit}</small></div>`;
    $('conceptualResults').innerHTML=`<div class="panel"><div class="conceptual-result-head"><div><p class="kicker">计算结果</p><h2>${esc(modelName())} · ${input.length} 日</h2><p class="hint">${esc(result.source)} · 流域面积 ${fmt(Number(state.area))} km²</p></div><button type="button" class="secondary" data-conceptual-action="export">导出逐日结果 CSV ↓</button></div><div class="metrics conceptual-metrics">${card('模拟最大流量',fmt(peak),'m³/s')}${card('模拟平均流量',fmt(mean),'m³/s')}${card('NSE',metrics?fmt(metrics.nse,3):'—',metrics?'与资料中流量比较':'未提供实测流量')}${card('KGE',metrics?fmt(metrics.kge,3):'—',metrics?'与资料中流量比较':'未提供实测流量')}</div><div class="legend"><span><i style="background:#91d8e8;height:8px"></i>降雨</span><span><i style="background:#087fa8"></i>模拟流量</span>${metrics?'<span><i style="background:#e3a259"></i>输入流量</span>':''}</div><div class="conceptual-chart">${chart(result,input)}</div><p class="hint">图中显示最近 ${Math.min(120,input.length)} 日。${metrics?`评价采用 ${metrics.n} 个有流量的日值；RMSE ${fmt(metrics.rmse)} m³/s，偏差 ${fmt(metrics.pbias)}%。`:'未提供流量时仅计算模拟过程，不生成评价指标。'}</p></div><div class="notice">${state.conceptualData?'结果来自导入资料和当前参数，尚未进行参数率定；使用前需检查资料质量和初始状态。':'全部输入与参考流量均为合成演示数据，评价指标不能代表实际预报能力。'}</div>`;
  }
  function render(){if(!$('conceptualControls'))return;renderControls();renderResults()}
  async function restoreInput(){
    const token=++loadGeneration;
    try{
      const file=await window.HydroProjects.getFile('forcing');if(token!==loadGeneration)return;
      state.conceptualData=file?RainfallModels.parseCsv(await file.text()):null;
      if(token!==loadGeneration)return;
      state.conceptualFileName=file?file.name:'';
      if(state.conceptualSimulated)run();else render();
    }catch(err){if(token===loadGeneration){state.conceptualData=null;state.conceptualFileName='';state.conceptualSimulated=false;render();toast('逐日资料恢复失败：'+err.message)}}
  }
  const priorSelectView=selectView;
  selectView=function(view){++loadGeneration;priorSelectView(view);if(view==='conceptual'){demo=RainfallModels.demo(state.area);render();restoreInput()}};
  document.addEventListener('click',e=>{
    const modelButton=e.target.closest('[data-conceptual-model]');
    if(modelButton){const model=modelButton.dataset.conceptualModel;
      if(state.conceptualModel!==model){state.conceptualModel=model;state.conceptualResult=null;state.conceptualSimulated=false}
      selectView('conceptual');persist();return;
    }
    const button=e.target.closest('[data-conceptual-action]');if(!button)return;
    const action=button.dataset.conceptualAction;
    if(action==='run')try{run();toast(modelName()+' 计算完成')}catch(err){toast('计算失败：'+err.message)}
    if(action==='template')download('逐日降雨径流资料模板.csv','date,precipitation_mm,evaporation_mm,discharge_m3s\n2026-01-01,12.4,2.1,45.6\n2026-01-02,8.2,2.0,51.3');
    if(action==='demo'){state.conceptualData=null;state.conceptualFileName='';state.conceptualResult=null;state.conceptualSimulated=false;window.HydroProjects.removeFile('forcing').then(()=>{persist();render();toast('已切换到合成演示资料')}).catch(err=>toast('切换失败：'+err.message))}
    if(action==='export'&&state.conceptualResult){const input=days(),q=state.conceptualResult.qcms,mm=state.conceptualResult.qmm;
      download(`${state.conceptualModel.toUpperCase()}_逐日计算结果.csv`,'date,precipitation_mm,evaporation_mm,observed_m3s,simulated_mm,simulated_m3s\n'+input.map((d,i)=>[d.date,d.p.toFixed(3),d.e.toFixed(3),d.q==null?'':d.q.toFixed(3),mm[i].toFixed(4),q[i].toFixed(3)].join(',')).join('\n'))}
  });
  document.addEventListener('change',async e=>{
    if(e.target.id==='conceptualArea'){
      const value=Number(e.target.value);if(!Number.isFinite(value)||value<=0){toast('请输入有效流域面积');render();return}
      state.area=value;demo=RainfallModels.demo(value);state.conceptualResult=null;state.conceptualSimulated=false;persist();render();return;
    }
    if(e.target.dataset.conceptualParam){
      const key=e.target.dataset.conceptualParam,value=Number(e.target.value),range=defaults[state.conceptualModel].ranges[key];
      if(!Number.isFinite(value)||value<range[0]||value>range[1]){toast(`${key} 应在 ${range[0]} 至 ${range[1]} 之间`);render();return}
      state.conceptualParams[state.conceptualModel][key]=value;state.conceptualResult=null;state.conceptualSimulated=false;persist();render();return;
    }
    if(e.target.id==='conceptualFile'){
      const file=e.target.files?.[0];if(!file)return;
      try{
        if(file.size>12_000_000)throw Error('CSV 超过 12 MB');
        const parsed=RainfallModels.parseCsv(await file.text());
        if(parsed.length>3650)throw Error('最多支持 3650 日资料');
        await window.HydroProjects.attachFile('forcing',file);
        state.conceptualData=parsed;state.conceptualFileName=file.name;
        state.conceptualResult=null;state.conceptualSimulated=false;persist();render();toast(`已导入 ${parsed.length} 日逐日资料`);
      }catch(err){toast('导入失败：'+err.message)}
    }
  });
})();
