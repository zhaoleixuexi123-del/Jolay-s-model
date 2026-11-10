/* Educational distributed grid water balance. This is not the VIC solver. */
(function(root){
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function csv(text,required){
    const lines=String(text).replace(/^\uFEFF/,'').trim().split(/\r?\n/);
    const head=lines.shift().split(',').map(x=>x.trim().toLowerCase());
    for(const key of required)if(!head.includes(key))throw Error('缺少字段 '+key);
    return lines.filter(Boolean).map((line,i)=>{const values=line.split(',').map(x=>x.trim()),row={};head.forEach((h,j)=>row[h]=values[j]??'');row._line=i+2;return row});
  }
  function cells(dem,area,mask){
    const out=[],n=4;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      let total=0,count=0;
      if(dem){
        const x0=Math.floor(x*dem.width/n),x1=Math.floor((x+1)*dem.width/n);
        const y0=Math.floor(y*dem.height/n),y1=Math.floor((y+1)*dem.height/n);
        const step=Math.max(1,Math.floor(Math.max(x1-x0,y1-y0)/30));
        for(let yy=y0;yy<y1;yy+=step)for(let xx=x0;xx<x1;xx+=step){const k=yy*dem.width+xx;if(dem.valid[k]&&(!mask||mask[k])){total+=dem.values[k];count++}}
        if(!count)continue;
      }
      out.push({id:`G${String(y*n+x+1).padStart(2,'0')}`,x,y,elevation:count?total/count:1200+120*y-45*x});
    }
    if(!out.length)throw Error('DEM 中没有可用网格');
    return out.map(c=>({...c,area:area/out.length}));
  }
  function soil(text,grid){
    const rows=csv(text,['cell_id','capacity_mm','ksat_mm_day','infiltration_shape','baseflow_k']);
    const found=new Map();
    for(const r of rows){
      const id=r.cell_id;
      if(found.has(id))throw Error('土壤资料网格重复：'+id);
      const capacity=Number(r.capacity_mm),ksat=Number(r.ksat_mm_day),shape=Number(r.infiltration_shape),baseflow=Number(r.baseflow_k);
      if(!Number.isFinite(capacity)||capacity<=0||!Number.isFinite(ksat)||ksat<0||!Number.isFinite(shape)||shape<0||!Number.isFinite(baseflow)||baseflow<0||baseflow>1)throw Error(`土壤资料第 ${r._line} 行数值无效`);
      found.set(id,{capacity,ksat,shape,baseflow});
    }
    for(const c of grid)if(!found.has(c.id))throw Error('土壤资料缺少网格 '+c.id);
    return found;
  }
  function vegetation(text,grid){
    const rows=csv(text,['cell_id','canopy_mm','et_factor']);const found=new Map();
    for(const r of rows){
      if(found.has(r.cell_id))throw Error('植被资料网格重复：'+r.cell_id);
      const canopy=Number(r.canopy_mm),et=Number(r.et_factor);
      if(!Number.isFinite(canopy)||canopy<0||!Number.isFinite(et)||et<0||et>2)throw Error(`植被资料第 ${r._line} 行数值无效`);
      found.set(r.cell_id,{canopy,et});
    }
    for(const c of grid)if(!found.has(c.id))throw Error('植被资料缺少网格 '+c.id);
    return found;
  }
  function forcing(text,grid){
    const rows=csv(text,['date','cell_id','precipitation_mm','evaporation_mm']);const ids=new Set(grid.map(c=>c.id)),byDate=new Map();
    for(const r of rows){
      const date=r.date,p=Number(r.precipitation_mm),e=Number(r.evaporation_mm),time=Date.parse(date+'T00:00:00Z');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==date||r.precipitation_mm===''||r.evaporation_mm===''||!Number.isFinite(p)||p<0||!Number.isFinite(e)||e<0||!ids.has(r.cell_id))throw Error(`气象资料第 ${r._line} 行无效`);
      if(!byDate.has(date))byDate.set(date,new Map());const day=byDate.get(date);
      if(day.has(r.cell_id))throw Error(`气象资料重复：${date} / ${r.cell_id}`);
      day.set(r.cell_id,{p,e});
    }
    const dates=[...byDate.keys()].sort();if(!dates.length||dates.length>3650)throw Error('气象资料需包含 1 至 3650 日');
    for(let i=0;i<dates.length;i++){
      if(byDate.get(dates[i]).size!==grid.length)throw Error(`${dates[i]} 缺少网格气象资料`);
      if(i&&Date.parse(dates[i]+'T00:00:00Z')-Date.parse(dates[i-1]+'T00:00:00Z')!==86400000)throw Error('逐日日期必须连续');
    }
    return dates.map(date=>({date,cells:byDate.get(date)}));
  }
  function demo(grid){
    const soilRows=['cell_id,capacity_mm,ksat_mm_day,infiltration_shape,baseflow_k'];
    const vegRows=['cell_id,canopy_mm,et_factor'];
    const forceRows=['date,cell_id,precipitation_mm,evaporation_mm'];
    grid.forEach((c,i)=>{soilRows.push(`${c.id},${190+i*9},${12+i%4*3},1.4,0.045`);vegRows.push(`${c.id},${1+i%3*.3},${(.75+i%4*.08).toFixed(2)}`)});
    for(let d=0;d<90;d++){
      const date=new Date(Date.UTC(2026,0,d+1)).toISOString().slice(0,10);
      const storm=(center,span,height)=>height*Math.exp(-(((d-center)/span)**2));
      grid.forEach((c,i)=>forceRows.push(`${date},${c.id},${(1+storm(16,3,34)+storm(43,4,49)+storm(70,3,38))*(.72+(i%4)*.12)},${(2+.6*Math.sin(d/12))*(.85+Math.floor(i/4)*.06)}`));
    }
    return {soil:soilRows.join('\n'),vegetation:vegRows.join('\n'),forcing:forceRows.join('\n')};
  }
  function run(grid,soils,vegetation,days){
    const states=new Map(grid.map(c=>[c.id,{soil:soils.get(c.id).capacity*.5,ground:soils.get(c.id).capacity*.15,canopy:0}]));
    const totalArea=grid.reduce((s,c)=>s+c.area,0),daily=[];let maxResidual=0;
    for(const day of days){let runoffVolume=0,pVolume=0,etVolume=0,storageDelta=0;const cellValues=[];
      for(const c of grid){
        const s=states.get(c.id),a=soils.get(c.id),v=vegetation.get(c.id),f=day.cells.get(c.id);
        const old=s.soil+s.ground+s.canopy;
        const caught=Math.min(f.p,Math.max(0,v.canopy-s.canopy));s.canopy+=caught;
        let water=f.p-caught,pet=f.e,et=Math.min(s.canopy,pet);s.canopy-=et;pet-=et;
        const soilEt=Math.min(s.soil,pet*v.et*clamp(s.soil/a.capacity,0,1));s.soil-=soilEt;et+=soilEt;
        const infiltration=Math.min(water,a.ksat*Math.pow(Math.max(0,1-s.soil/a.capacity),a.shape));
        let surface=water-infiltration;s.soil+=infiltration;
        if(s.soil>a.capacity){surface+=s.soil-a.capacity;s.soil=a.capacity}
        const perc=Math.min(s.soil,a.ksat*.08*Math.pow(s.soil/a.capacity,2));s.soil-=perc;s.ground+=perc;
        const base=s.ground*a.baseflow;s.ground-=base;
        const q=surface+base,residual=f.p-et-q-(s.soil+s.ground+s.canopy-old);
        maxResidual=Math.max(maxResidual,Math.abs(residual));
        runoffVolume+=q*c.area;pVolume+=f.p*c.area;etVolume+=et*c.area;storageDelta+=(s.soil+s.ground+s.canopy-old)*c.area;
        cellValues.push({id:c.id,precipitation:f.p,evaporation:et,runoff:q,soil:s.soil,baseflow:base,storageChange:s.soil+s.ground+s.canopy-old});
      }
      const qmm=runoffVolume/totalArea;
      daily.push({date:day.date,precipitation:pVolume/totalArea,evaporation:etVolume/totalArea,runoffMm:qmm,discharge:qmm*totalArea/86.4,storageChange:storageDelta/totalArea,cells:cellValues});
    }
    return {daily,maxResidual};
  }
  root.GridModel={cells,soil,vegetation,forcing,demo,run};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.GridModel;
})(typeof window!=='undefined'?window:globalThis);

