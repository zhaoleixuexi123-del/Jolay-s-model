/* Daily lumped rainfall-runoff engines. Inputs and outputs are mm/day. */
(function(root){
  const definitions={
    hbv:{name:'HBV · 简化无雪版',params:{FC:250,BETA:1.5,LP:.7,K0:.15,K1:.08,K2:.015,UZL:20,PERC:2},ranges:{FC:[20,1000],BETA:[.1,6],LP:[.05,1],K0:[0,.99],K1:[0,.99],K2:[0,.5],UZL:[0,200],PERC:[0,20]}},
    gr4j:{name:'GR4J',params:{X1:350,X2:0,X3:90,X4:2.2},ranges:{X1:[10,1500],X2:[-10,10],X3:[1,500],X4:[.5,15]}}
  };
  function validate(model,params){
    const def=definitions[model];if(!def)throw Error('不支持的模型');
    for(const [key,[min,max]] of Object.entries(def.ranges)){
      const value=Number(params[key]);
      if(!Number.isFinite(value)||value<min||value>max)throw Error(`${key} 应在 ${min} 至 ${max} 之间`);
    }
  }
  function hbv(days,p){
    let soil=p.FC*.5,upper=0,lower=20;
    return days.map(day=>{
      const rain=day.p,pet=day.e;
      const aet=Math.min(soil,pet*Math.min(1,soil/(p.LP*p.FC)));
      soil-=aet;
      let recharge=rain*Math.pow(Math.min(1,soil/p.FC),p.BETA);
      soil+=rain-recharge;
      if(soil>p.FC){recharge+=soil-p.FC;soil=p.FC}
      upper+=recharge;
      const perc=Math.min(p.PERC,upper);upper-=perc;lower+=perc;
      const q0=Math.min(upper,p.K0*Math.max(0,upper-p.UZL));upper-=q0;
      const q1=Math.min(upper,p.K1*upper);upper-=q1;
      const q2=Math.min(lower,p.K2*lower);lower-=q2;
      return q0+q1+q2;
    });
  }
  function gr4j(days,p){
    let soil=.6*p.X1,routing=.7*p.X3;
    const sh1=t=>t<=0?0:t>=p.X4?1:Math.pow(t/p.X4,2.5);
    const sh2=t=>t<=0?0:t>=2*p.X4?1:t<=p.X4?.5*Math.pow(t/p.X4,2.5):1-.5*Math.pow(2-t/p.X4,2.5);
    const ordinates=(n,sh)=>Array.from({length:n},(_,i)=>sh(i+1)-sh(i));
    const weight1=ordinates(Math.ceil(p.X4),sh1),weight2=ordinates(Math.ceil(2*p.X4),sh2);
    const queue1=weight1.map(()=>0),queue2=weight2.map(()=>0);
    return days.map(day=>{
      const pn=Math.max(0,day.p-day.e),en=Math.max(0,day.e-day.p);
      let pr=0;
      if(pn){const tanh=Math.tanh(pn/p.X1),ratio=soil/p.X1;
        const ps=p.X1*(1-ratio*ratio)*tanh/(1+ratio*tanh);
        soil+=ps;pr=pn-ps;
      }else if(en){const tanh=Math.tanh(en/p.X1),ratio=soil/p.X1;
        const es=soil*(2-ratio)*tanh/(1+(1-ratio)*tanh);soil-=es;
      }
      const perc=soil*(1-Math.pow(1+Math.pow(4*soil/(9*p.X1),4),-.25));
      soil-=perc;pr+=perc;
      for(let i=0;i<queue1.length;i++)queue1[i]+=.9*pr*weight1[i];
      for(let i=0;i<queue2.length;i++)queue2[i]+=.1*pr*weight2[i];
      const q9=queue1.shift();queue1.push(0);
      const q1=queue2.shift();queue2.push(0);
      const exchange=p.X2*Math.pow(Math.max(0,routing/p.X3),3.5);
      routing=Math.max(0,routing+q9+exchange);
      const qr=routing*(1-Math.pow(1+Math.pow(routing/p.X3,4),-.25));routing-=qr;
      const qd=Math.max(0,q1+exchange);
      return Math.max(0,qr+qd);
    });
  }
  function run(model,days,params){
    validate(model,params);
    if(!Array.isArray(days)||!days.length)throw Error('没有可计算的逐日资料');
    for(const [i,d] of days.entries())if(!Number.isFinite(d.p)||d.p<0||!Number.isFinite(d.e)||d.e<0)throw Error(`第 ${i+1} 日降雨或潜在蒸发无效`);
    return model==='hbv'?hbv(days,params):gr4j(days,params);
  }
  function scores(sim,obs){
    const pairs=sim.map((v,i)=>[v,obs[i]]).filter(([,o])=>Number.isFinite(o));
    if(pairs.length<2)return null;
    const n=pairs.length,meanO=pairs.reduce((s,[,o])=>s+o,0)/n,meanS=pairs.reduce((s,[v])=>s+v,0)/n;
    const varO=pairs.reduce((s,[,o])=>s+(o-meanO)**2,0),varS=pairs.reduce((s,[v])=>s+(v-meanS)**2,0);
    const mse=pairs.reduce((s,[v,o])=>s+(v-o)**2,0)/n;
    const covariance=pairs.reduce((s,[v,o])=>s+(v-meanS)*(o-meanO),0);
    const nse=varO>0?1-n*mse/varO:null;
    const r=varO>0&&varS>0?covariance/Math.sqrt(varS*varO):null;
    const alpha=varO>0?Math.sqrt(varS/varO):null,beta=meanO!==0?meanS/meanO:null;
    const kge=r!=null&&alpha!=null&&beta!=null?1-Math.sqrt((r-1)**2+(alpha-1)**2+(beta-1)**2):null;
    return {n,nse,kge,rmse:Math.sqrt(mse),pbias:meanO!==0?100*(meanS-meanO)/meanO:null};
  }
  function parseCsv(text){
    const rows=String(text).replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(line=>line.split(',').map(x=>x.trim().replace(/^"|"$/g,'')));
    if(rows.length<3)throw Error('至少需要 2 日有效数据');
    const columns=rows.shift().map(x=>x.toLowerCase()),get=(row,name)=>row[columns.indexOf(name)];
    for(const name of ['date','precipitation_mm','evaporation_mm'])if(!columns.includes(name))throw Error('缺少字段 '+name);
    const hasQ=columns.includes('discharge_m3s');
    const days=rows.map((row,i)=>{
      const date=get(row,'date'),rawP=get(row,'precipitation_mm'),rawE=get(row,'evaporation_mm'),p=Number(rawP),e=Number(rawE);
      const qRaw=hasQ?get(row,'discharge_m3s'):'';
      const q=qRaw===''?null:Number(qRaw);
      const timestamp=Date.parse(date+'T00:00:00Z');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==date||rawP===''||rawE===''||!Number.isFinite(p)||p<0||!Number.isFinite(e)||e<0||q!=null&&(!Number.isFinite(q)||q<0))throw Error(`第 ${i+2} 行日期或数值无效`);
      return{date,p,e,q};
    });
    for(let i=1;i<days.length;i++)if(Date.parse(days[i].date+'T00:00:00Z')-Date.parse(days[i-1].date+'T00:00:00Z')!==86400000)throw Error('逐日日期必须连续、递增且不能重复');
    return days;
  }
  function demo(areaKm2=976.26){
    const days=[];
    for(let i=0;i<120;i++){
      const pulse=(center,width,height)=>height*Math.exp(-Math.pow((i-center)/width,2));
      const p=1.3+1.8*Math.sin(i*.32)**2+pulse(15,2.5,44)+pulse(37,3,28)+pulse(61,3,52)+pulse(86,2,35)+pulse(104,4,41);
      const e=2.2+.7*Math.sin(i*.045+.4);
      const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);
      days.push({date,p,e,q:null});
    }
    const reference=run('gr4j',days,{...definitions.gr4j.params,X1:320,X3:80});
    return days.map((d,i)=>({...d,q:reference[i]*areaKm2/86.4*(.97+.06*Math.sin(i*.47))}));
  }
  root.RainfallModels={definitions,run,scores,parseCsv,demo};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.RainfallModels;
})(typeof window!=='undefined'?window:globalThis);
