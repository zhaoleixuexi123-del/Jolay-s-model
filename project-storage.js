/* Multiple local projects: metadata and original files survive a refresh. */
(function(){
  const DB_NAME='lantu-hydro-projects',ACTIVE_KEY='lantu-hydro-active-project',KINDS=['dem','rain','evap','flow','forcing'];
  const initialParams={...state.params};
  let db=null,records=[],currentId=null,ready=false,restoring=false,saveTimer=null,writeChain=Promise.resolve(),initPromise;
  const storedFileObjects=new Map(),pendingFiles=new Set();
  const status=message=>{const el=$('projectSaveStatus');if(el)el.textContent=message};
  const newId=()=>globalThis.crypto?.randomUUID?.()||'project-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  function openDatabase(){return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const database=request.result;
      if(!database.objectStoreNames.contains('projects'))database.createObjectStore('projects',{keyPath:'id'});
      if(!database.objectStoreNames.contains('files'))database.createObjectStore('files',{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('本地数据库无法打开'));
  })}
  function request(store,method,value){return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,method==='get'||method==='getAll'?'readonly':'readwrite');
    const operation=method==='getAll'?tx.objectStore(store).getAll():tx.objectStore(store)[method](value);
    let result;
    operation.onsuccess=()=>{result=operation.result};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error||operation.error||Error('本地存储失败'));
    tx.onabort=()=>reject(tx.error||Error('本地存储中断'));
  })}
  function snapshot(){return{
    id:currentId,name:state.project,area:state.area,model:state.model,resolution:state.resolution,
    demMode:state.demMode,streamPercent:state.streamPercent,demOutlet:state.demOutlet,
    streamGenerated:!!state.demFlow,partitioned:!!state.demResult||!state.demData&&!!state.partitioned,
    spatialStep:state.spatialStep,spatialDone:[...state.spatialDone],view:state.view,
    labStep:state.labStep,calibrated:state.calibrated,simulated:state.simulated,metric:state.metric,
    params:{...state.params},fileStatus:{...state.files},outlet:{...state.outlet},
    conceptualModel:state.conceptualModel||'hbv',conceptualParams:state.conceptualParams||null,
    conceptualFileName:state.conceptualFileName||'',conceptualSimulated:!!state.conceptualSimulated,
    updatedAt:Date.now()
  }}
  function projectPicker(){
    const select=$('projectPick');if(!select)return;
    const current=records.find(r=>r.id===currentId);
    if(current&&!restoring)current.name=state.project;
    select.innerHTML=records.slice().sort((a,b)=>b.updatedAt-a.updatedAt).map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
    select.value=currentId||'';
  }
  function queueSave(){
    if(!ready||restoring||!currentId)return;
    clearTimeout(saveTimer);status('正在自动保存…');
    saveTimer=setTimeout(()=>saveNow().catch(err=>status('保存失败：'+err.message)),350);
  }
  function saveNow(){
    if(!ready||restoring||!currentId)return Promise.resolve();
    clearTimeout(saveTimer);const row=snapshot();
    writeChain=writeChain.catch(()=>{}).then(()=>request('projects','put',row));
    return writeChain.then(()=>{
      const index=records.findIndex(r=>r.id===row.id);
      if(index<0)records.push(row);else if(records[index].updatedAt<=row.updatedAt)records[index]=row;
      localStorage.setItem(ACTIVE_KEY,row.id);projectPicker();
      status('已自动保存在此浏览器 · '+new Date(row.updatedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}));
    });
  }
  async function attachFile(kind,file){
    await initPromise;
    if(!db||!currentId||!KINDS.includes(kind))throw Error('本地项目存储不可用');
    const id=currentId+':'+kind;
    if(storedFileObjects.get(id)===file)return;
    const task=request('files','put',{id,projectId:currentId,kind,file,name:file.name,type:file.type,updatedAt:Date.now()});
    pendingFiles.add(task);
    try{await task;storedFileObjects.set(id,file);queueSave()}
    finally{pendingFiles.delete(task)}
  }
  async function getFile(kind){
    await initPromise;
    if(!db||!currentId||!KINDS.includes(kind))return null;
    return (await request('files','get',currentId+':'+kind))?.file||null;
  }
  async function removeFile(kind){
    await initPromise;
    if(!db||!currentId||!KINDS.includes(kind))throw Error('本地项目存储不可用');
    const id=currentId+':'+kind;
    await request('files','delete',id);storedFileObjects.delete(id);queueSave();
  }
  async function flush(){await saveNow();await Promise.all([...pendingFiles])}
  function normalized(raw,id){
    const allowedResolution=['250 m','500 m','1 km','2 km'];
    const number=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;
    return{
      id,name:String(raw.name||'未命名项目').slice(0,80),area:Math.max(.01,number(raw.area,976.26)),
      model:raw.model==='distributed'?'distributed':'semi',resolution:allowedResolution.includes(raw.resolution)?raw.resolution:'1 km',
      demMode:raw.demMode==='preview'?'preview':'full',streamPercent:Math.max(.2,Math.min(8,number(raw.streamPercent,1.5))),
      demOutlet:raw.demOutlet&&Number.isFinite(raw.demOutlet.x)&&Number.isFinite(raw.demOutlet.y)?{x:raw.demOutlet.x,y:raw.demOutlet.y}:null,
      streamGenerated:!!raw.streamGenerated,partitioned:!!raw.partitioned,
      spatialStep:Math.max(0,Math.min(5,Math.floor(number(raw.spatialStep,0)))),
      spatialDone:Array.from({length:6},(_,i)=>!!raw.spatialDone?.[i]),
      view:['overview','spatial','lab','conceptual'].includes(raw.view)?raw.view:'spatial',
      labStep:Math.max(0,Math.min(3,Math.floor(number(raw.labStep,0)))),
      calibrated:!!raw.calibrated,simulated:!!raw.simulated,metric:String(raw.metric||'NSE'),
      params:Object.fromEntries(Object.keys(initialParams).map(k=>[k,number(raw.params?.[k],initialParams[k])])),
      fileStatus:Object.fromEntries(['dem','rain','evap','flow'].map(k=>[k,String(raw.fileStatus?.[k]||'')])),
      outlet:raw.outlet&&Number.isFinite(raw.outlet.x)&&Number.isFinite(raw.outlet.y)?{x:raw.outlet.x,y:raw.outlet.y}:{x:548,y:475},
      conceptualModel:raw.conceptualModel==='gr4j'?'gr4j':'hbv',
      conceptualParams:Object.fromEntries(['hbv','gr4j'].map(model=>[model,Object.fromEntries(Object.entries(RainfallModels.definitions[model].params).map(([key,defaultValue])=>[key,number(raw.conceptualParams?.[model]?.[key],defaultValue)]))])),
      conceptualFileName:String(raw.conceptualFileName||''),conceptualSimulated:!!raw.conceptualSimulated,
      updatedAt:number(raw.updatedAt,Date.now())
    };
  }
  async function restore(row){
    restoring=true;status('正在恢复项目与 DEM…');
    state.demError=null;
    state.project=row.name;state.area=row.area;state.model=row.model;state.resolution=row.resolution;
    state.demMode=row.demMode;state.streamPercent=row.streamPercent;state.outlet={...row.outlet};
    state.spatialDone=[...row.spatialDone];state.spatialStep=row.spatialStep;
    state.labStep=row.labStep;state.calibrated=row.calibrated;state.simulated=row.simulated;
    state.metric=row.metric;state.params={...row.params};state.files={...row.fileStatus};
    state.conceptualModel=row.conceptualModel;state.conceptualParams=row.conceptualParams;
    state.conceptualFileName=row.conceptualFileName;state.conceptualSimulated=row.conceptualSimulated;
    state.conceptualData=null;state.conceptualResult=null;
    state.demData=null;state.demFile=null;resetDemAnalysis();
    state.spatialDone=[...row.spatialDone];state.partitioned=row.partitioned;
    try{
      const saved=await request('files','get',row.id+':dem');
      if(saved?.file){
        const file=saved.file;storedFileObjects.set(row.id+':dem',file);
        const dem=await DEMTool.readGeoTIFF(file,{fullResolution:row.demMode==='full'});
        state.demData=dem;state.demFile=file;state.files.dem=file.name;
        if(row.streamGenerated){
          status('正在恢复水系与子流域…');await new Promise(resolve=>setTimeout(resolve,0));
          const flow=DEMTool.flowNetwork(dem);
          if(flow.processed<dem.count*.99)throw Error('汇流网络恢复不完整');
          const threshold=Math.max(2,Math.round(dem.count*row.streamPercent/100));
          const mask=new Uint8Array(dem.width*dem.height);let count=0,best=-1;
          for(let i=0;i<mask.length;i++)if(dem.valid[i]){
            if(best<0||flow.acc[i]>flow.acc[best])best=i;
            if(flow.acc[i]>=threshold){mask[i]=1;count++}
          }
          const links=DEMTool.linkStreams(dem,flow,mask);
          state.demFlow=flow;state.demStreamMask=mask;state.demStreamLinks=links;
          state.demStreamCount=count;state.demReachCount=links.reachCount;state.demJunctionCount=links.junctionCount;
          state.streamThresholdCells=threshold;
          const point=row.demOutlet,position=point?Math.floor(point.y)*dem.width+Math.floor(point.x):-1;
          state.demOutlet=position>=0&&position<mask.length&&mask[position]?{x:Math.floor(point.x),y:Math.floor(point.y)}:{x:best%dem.width,y:Math.floor(best/dem.width)};
          if(row.partitioned){
            state.demResult=DEMTool.delineate(dem,flow,state.demOutlet.x,state.demOutlet.y,row.model,row.resolution,row.streamPercent,threshold);
            state.partitioned=true;
          }else state.partitioned=false;
        }else{state.partitioned=false;state.demOutlet=null}
      }
      if(state.demData&&!state.demFlow&&state.spatialStep>1)state.spatialStep=1;
      if(state.demData&&state.demFlow&&!state.demResult&&state.spatialStep>3)state.spatialStep=3;
      if(!state.demData&&row.fileStatus.dem){
        state.demError='原始 DEM 文件未保存在此浏览器，请重新导入或使用项目备份恢复';
        state.files.dem='';state.partitioned=false;state.spatialStep=1;
      }
    }catch(err){
      state.demError='项目恢复失败：'+err.message;
      state.demFlow=null;state.demStreamMask=null;state.demResult=null;state.partitioned=false;
      state.spatialStep=state.demData?1:0;
      status(state.demError);
    }
    document.querySelectorAll('.model-option').forEach(el=>el.classList.toggle('active',el.dataset.selectModel===state.model));
    restoring=false;renderSpatial();renderLab();selectView(row.view);
    projectPicker();
    if(!state.demError)status('已恢复本地项目 · '+new Date(row.updatedAt).toLocaleString('zh-CN'));
  }
  async function switchProject(id){
    if(id===currentId)return;
    await flush();const row=records.find(r=>r.id===id);if(!row)throw Error('项目不存在');
    currentId=id;localStorage.setItem(ACTIVE_KEY,id);await restore(row);
  }
  async function createProject(){
    await flush();
    const id=newId(),row=normalized({name:'新项目 '+(records.length+1),view:'spatial',spatialStep:0},id);
    await request('projects','put',row);records.push(row);currentId=id;
    localStorage.setItem(ACTIVE_KEY,id);await restore(row);selectView('spatial');
  }
  async function exportBackup(){
    await flush();const row=snapshot(),files=[],manifest={format:'lantu-hydro-project',version:1,metadata:row,files:{}};
    for(const kind of KINDS){
      const saved=await request('files','get',currentId+':'+kind);if(!saved?.file)continue;
      manifest.files[kind]={name:saved.name||saved.file.name||kind,type:saved.type||saved.file.type||''};
      files.push({name:'files/'+kind,data:new Uint8Array(await saved.file.arrayBuffer())});
    }
    const entries=[{name:'project.json',data:JSON.stringify(manifest)},...files];
    const bytes=DEMShapefile.zipFiles(entries),safeName=String(row.name).replace(/[\\/:*?"<>|]/g,'_').slice(0,60);
    DEMShapefile.save(safeName+'_水文项目备份.zip',bytes);
    status('项目备份已下载；可在其他浏览器导入');
  }
  async function importBackup(file){
    if(file.size>250_000_000)throw Error('备份文件超过 250 MB');
    const entries=DEMShapefile.unzipStored(new Uint8Array(await file.arrayBuffer()));
    const manifestBytes=entries.get('project.json');if(!manifestBytes)throw Error('备份中缺少 project.json');
    const manifest=JSON.parse(new TextDecoder().decode(manifestBytes));
    if(manifest.format!=='lantu-hydro-project'||manifest.version!==1)throw Error('不是本站支持的项目备份');
    await flush();
    const id=newId(),row=normalized({...manifest.metadata,name:String(manifest.metadata?.name||'导入项目')+'（导入）',updatedAt:Date.now(),view:'spatial'},id);
    await request('projects','put',row);
    for(const kind of KINDS){
      const data=entries.get('files/'+kind);if(!data)continue;
      const meta=manifest.files?.[kind]||{},name=String(meta.name||kind),type=String(meta.type||'');
      const savedFile=new File([data],name,{type});
      await request('files','put',{id:id+':'+kind,projectId:id,kind,file:savedFile,name,type,updatedAt:Date.now()});
    }
    records.push(row);currentId=id;localStorage.setItem(ACTIVE_KEY,id);
    await restore(row);selectView('spatial');status('项目备份已导入并保存在此浏览器');
  }
  async function deleteProject(){
    const row=records.find(r=>r.id===currentId);if(!row)return;
    if(!window.confirm(`确定删除本地项目“${row.name}”吗？此操作不会删除你已下载的备份。`))return;
    clearTimeout(saveTimer);await writeChain.catch(()=>{});await Promise.all([...pendingFiles]);
    await request('projects','delete',currentId);
    for(const kind of KINDS)await request('files','delete',currentId+':'+kind);
    records=records.filter(r=>r.id!==currentId);
    if(records.length){currentId=records[0].id;localStorage.setItem(ACTIVE_KEY,currentId);await restore(records[0])}
    else{currentId=null;await createProject()}
  }
  async function initialize(){
    try{
      db=await openDatabase();records=(await request('projects','getAll')).map(raw=>normalized(raw,raw.id));
      if(!records.length){
        currentId=newId();const row=normalized({...snapshot(),name:state.project,view:'overview',spatialStep:0,streamGenerated:false,partitioned:false},currentId);
        await request('projects','put',row);records=[row];
      }
      const preferred=localStorage.getItem(ACTIVE_KEY),row=records.find(r=>r.id===preferred)||records.slice().sort((a,b)=>b.updatedAt-a.updatedAt)[0];
      currentId=row.id;localStorage.setItem(ACTIVE_KEY,currentId);await restore(row);
      ready=true;projectPicker();
    }catch(err){status('本地存储不可用：'+err.message);console.error('Project storage unavailable',err)}
  }
  const oldRenderSpatial=renderSpatial;renderSpatial=function(){oldRenderSpatial();projectPicker();queueSave()};
  const oldRenderLab=renderLab;renderLab=function(){oldRenderLab();queueSave()};
  const oldPersist=persist;persist=function(){oldPersist();queueSave()};
  const oldSelectView=selectView;selectView=function(view){oldSelectView(view);queueSave()};
  window.HydroProjects={attachFile,getFile,removeFile,saveNow,exportBackup};
  $('projectPick').addEventListener('change',e=>switchProject(e.target.value).catch(err=>status('切换失败：'+err.message)));
  $('projectNew').addEventListener('click',()=>createProject().catch(err=>status('新建失败：'+err.message)));
  $('projectSave').addEventListener('click',()=>flush().then(()=>status('项目与文件已保存在此浏览器')).catch(err=>status('保存失败：'+err.message)));
  $('projectBackup').addEventListener('click',()=>exportBackup().catch(err=>status('备份失败：'+err.message)));
  $('projectDelete').addEventListener('click',()=>deleteProject().catch(err=>status('删除失败：'+err.message)));
  $('projectImport').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)importBackup(file).catch(err=>status('导入失败：'+err.message));e.target.value=''});
  document.addEventListener('change',e=>{const kind=e.target.dataset.file;if(['rain','evap','flow'].includes(kind)&&e.target.files?.[0])attachFile(kind,e.target.files[0]).catch(err=>status('资料保存失败：'+err.message))},true);
  document.addEventListener('change',e=>{if(e.target.id==='streamThreshold')queueSave()},true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&ready)saveNow().catch(()=>{})});
  initPromise=initialize();
})();
