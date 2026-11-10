/* SWAT-style stream threshold, reaches, and drainage areas at preview resolution. */
(function(root){
  const original=root.DEMTool.delineate;
  function linkStreams(dem,flow,stream){
    const n=dem.width*dem.height,upstream=new Uint8Array(n),streamCells=[];
    for(let i=0;i<n;i++)if(stream[i])streamCells.push(i);
    for(const i of streamCells){const j=flow.down[i];if(j>=0&&stream[j])upstream[j]++}
    // Accumulation strictly increases downstream, so this is upstream-first.
    streamCells.sort((a,b)=>flow.acc[a]-flow.acc[b]);
    const labels=new Uint32Array(n),reachOutlets=[0],reachHeads=[0];
    let reachCount=0,sourceCount=0,junctionCount=0;
    for(const i of streamCells){
      if(upstream[i]===0)sourceCount++;
      if(upstream[i]>=2)junctionCount++;
      let parent=0;
      if(upstream[i]===1){
        const xx=i%dem.width,yy=(i/dem.width)|0;
        for(let dy=-1;dy<=1&&!parent;dy++)for(let dx=-1;dx<=1;dx++){
          const x2=xx+dx,y2=yy+dy;if(x2<0||y2<0||x2>=dem.width||y2>=dem.height)continue;
          const j=y2*dem.width+x2;if(stream[j]&&flow.down[j]===i){parent=labels[j];break}
        }
      }
      const id=upstream[i]===1&&parent?parent:++reachCount;
      labels[i]=id;if(reachHeads[id]===undefined)reachHeads[id]=i;
      reachOutlets[id]=i;
    }
    return{labels,reachCount,sourceCount,junctionCount,streamCellCount:streamCells.length,reachHeads,reachOutlets};
  }
  function streamReaches(dem,flow,x,y,mode,resolution,streamPercent=1.5,thresholdCells){
    const result=original(dem,flow,x,y,mode==='semi'?'mask':mode,resolution);
    if(mode!=='semi')return result;
    const n=dem.width*dem.height,mask=result.mask,outlet=result.outlet;
    const threshold=Math.max(2,Math.min(result.cellCount,Math.round(thresholdCells??result.cellCount*streamPercent/100)));
    const stream=new Uint8Array(n);
    for(let i=0;i<n;i++)if(mask[i]&&flow.acc[i]>=threshold)stream[i]=1;
    const links=linkStreams(dem,flow,stream),labels=links.labels;
    // Off-channel cells inherit the first stream reach on their D8 flow path.
    const first=new Int32Array(n),sibling=new Int32Array(n);first.fill(-1);sibling.fill(-1);
    for(let i=0;i<n;i++)if(mask[i]){const j=flow.down[i];if(j>=0&&mask[j]){sibling[i]=first[j];first[j]=i}}
    const queue=new Int32Array(result.cellCount);let head=0,tail=0;queue[tail++]=outlet;
    while(head<tail){const i=queue[head++];if(!labels[i])labels[i]=labels[flow.down[i]];for(let j=first[i];j>=0;j=sibling[j])queue[tail++]=j}
    if(tail!==result.cellCount||!labels[outlet])throw Error('河网与汇水区未能完整连接');
    const unitCells=new Int32Array(links.reachCount);
    for(let k=0;k<tail;k++)unitCells[labels[queue[k]]-1]++;
    result.labels=labels;result.unitCount=links.reachCount;result.unitCells=Array.from(unitCells);
    result.streamMask=stream;result.streamThresholdCells=threshold;
    result.streamThresholdKm2=dem.cellAreaKm2?threshold*dem.cellAreaKm2:null;
    result.reachHeads=links.reachHeads;result.reachOutlets=links.reachOutlets;
    result.junctionCount=links.junctionCount;result.method='stream-reach-drainage';
    return result;
  }
  root.DEMTool.linkStreams=linkStreams;
  root.DEMTool.delineate=streamReaches;
  if(typeof module!=='undefined'&&module.exports)module.exports={linkStreams,streamReaches};
})(typeof window!=='undefined'?window:globalThis);
