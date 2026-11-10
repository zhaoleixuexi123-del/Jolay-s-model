/* HRU overlay: subbasin × land use × soil × slope class on aligned rasters. */
(function(root){
  function code(keys){return Number(keys?.ProjectedCSTypeGeoKey||keys?.GeographicTypeGeoKey||keys?.ProjectedCRSGeoKey||keys?.GeodeticCRSGeoKey||0)}
  async function categoryRaster(file,dem){
    if(!root.GeoTIFF)throw Error('GeoTIFF 读取组件未加载');
    if(!dem?.bbox||!dem?.geoKeys)throw Error('DEM 缺少投影与边界信息');
    const tiff=await root.GeoTIFF.fromArrayBuffer(await file.arrayBuffer()),image=await tiff.getImage();
    const bbox=image.getBoundingBox(),demBox=dem.bbox,crs=code(image.getGeoKeys?.());
    if(!crs||crs!==code(dem.geoKeys))throw Error(`${file.name} 与 DEM 的坐标系不一致`);
    const tol=Math.max((demBox[2]-demBox[0])/dem.sourceWidth,(demBox[3]-demBox[1])/dem.sourceHeight)*.05;
    if(bbox.some((v,i)=>Math.abs(v-demBox[i])>tol))throw Error(`${file.name} 与 DEM 范围或像元对齐不一致；请先重采样到 DEM 网格`);
    if(image.getWidth()!==dem.sourceWidth||image.getHeight()!==dem.sourceHeight)throw Error(`${file.name} 与 DEM 原始行列数不同；请先重采样到 DEM 网格`);
    const raw=await image.readRasters({samples:[0],interleave:true,width:dem.width,height:dem.height,resampleMethod:'nearest'});
    if(raw.length!==dem.width*dem.height)throw Error(`${file.name} 栅格长度不完整`);
    const nodataRaw=image.getGDALNoData?.(),nodata=nodataRaw==null?NaN:Number(nodataRaw),values=new Int32Array(raw.length),valid=new Uint8Array(raw.length);
    let count=0;
    for(let i=0;i<raw.length;i++){
      const v=Number(raw[i]);
      if(Number.isFinite(v)&&(!Number.isFinite(nodata)||v!==nodata)){
        if(!Number.isSafeInteger(v)||v<0)throw Error(`${file.name} 含非整数或负数分类值`);
        values[i]=v;valid[i]=1;count++;
      }
    }
    if(!count)throw Error(`${file.name} 没有有效分类像元`);
    return{fileName:file.name,values,valid,count};
  }
  function pixelMetres(dem){
    if(!dem.bbox||!dem.cellAreaKm2)throw Error('DEM 缺少可用的面积和坐标信息');
    const codeValue=code(dem.geoKeys),lat=(dem.bbox[1]+dem.bbox[3])/2;
    let mx=1,my=1;
    if(codeValue===4326||codeValue===4490){mx=111320*Math.cos(lat*Math.PI/180);my=110574}
    else{const unit=Number(dem.geoKeys.ProjLinearUnitsGeoKey||dem.geoKeys.ProjLinearUnits);mx=my=unit===9001?1:unit===9002?.3048:unit===9003?1200/3937:NaN}
    const dx=(dem.bbox[2]-dem.bbox[0])/dem.width*mx,dy=(dem.bbox[3]-dem.bbox[1])/dem.height*my;
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||dx<=0||dy<=0)throw Error('DEM 投影单位不支持坡度计算');
    return{dx,dy};
  }
  function slopePercent(dem){
    const{width:w,height:h,values:z,valid}=dem,{dx,dy}=pixelMetres(dem),slope=new Float32Array(w*h);
    function v(x,y,c){if(x<0||y<0||x>=w||y>=h)return c;const i=y*w+x;return valid[i]?z[i]:c}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x;if(!valid[i])continue;const c=z[i];
      const a=v(x-1,y-1,c),b=v(x,y-1,c),d=v(x+1,y-1,c),e=v(x-1,y,c),f=v(x+1,y,c),g=v(x-1,y+1,c),j=v(x,y+1,c),k=v(x+1,y+1,c);
      const gx=((d+2*f+k)-(a+2*e+g))/(8*dx),gy=((g+2*j+k)-(a+2*b+d))/(8*dy);
      slope[i]=100*Math.hypot(gx,gy);
    }
    return slope;
  }
  function delineate(dem,subbasins,landuse,soil,thresholds=[5,15]){
    if(!subbasins?.mask||!subbasins?.labels)throw Error('请先按河网划分子流域');
    if(!landuse||!soil)throw Error('请导入土地利用和土壤分类栅格');
    if(thresholds.length!==2||!thresholds.every(Number.isFinite)||thresholds[0]<0||thresholds[1]<=thresholds[0])throw Error('坡度分级阈值无效');
    const slope=slopePercent(dem),groups=new Map(),missing=[];
    for(let i=0;i<subbasins.mask.length;i++)if(subbasins.mask[i]){
      if(!landuse.valid[i]||!soil.valid[i]){if(missing.length<5)missing.push([i%dem.width,Math.floor(i/dem.width)]);continue}
      const sub=subbasins.labels[i],land=landuse.values[i],soilId=soil.values[i],s=slope[i],slopeClass=s<thresholds[0]?1:s<thresholds[1]?2:3;
      if(!sub)throw Error('子流域编号缺失');
      const key=[sub,land,soilId,slopeClass].join(':');
      let group=groups.get(key);
      if(!group){group={subbasinId:sub,landuseCode:land,soilCode:soilId,slopeClass,cells:0,slopeSum:0};groups.set(key,group)}
      group.cells++;group.slopeSum+=s;
    }
    if(missing.length)throw Error(`土地利用或土壤栅格有缺失像元，首个位置：${missing[0].join(', ')}`);
    const hrus=[...groups.values()].sort((a,b)=>a.subbasinId-b.subbasinId||a.landuseCode-b.landuseCode||a.soilCode-b.soilCode||a.slopeClass-b.slopeClass);
    const labels=new Uint32Array(subbasins.mask.length);
    hrus.forEach((h,index)=>{h.id=index+1;h.areaKm2=h.cells*dem.cellAreaKm2;h.meanSlopePercent=h.slopeSum/h.cells;delete h.slopeSum});
    for(let i=0;i<subbasins.mask.length;i++)if(subbasins.mask[i]){
      const s=slope[i],slopeClass=s<thresholds[0]?1:s<thresholds[1]?2:3;
      labels[i]=groups.get([subbasins.labels[i],landuse.values[i],soil.values[i],slopeClass].join(':')).id;
    }
    return{hrus,labels,cellCount:subbasins.cellCount,thresholds:[...thresholds],areaKm2:hrus.reduce((n,h)=>n+h.areaKm2,0)};
  }
  function csv(result){return ['hru_id,subbasin_id,landuse_code,soil_code,slope_class,mean_slope_percent,cells,area_km2',...result.hrus.map(h=>[h.id,h.subbasinId,h.landuseCode,h.soilCode,h.slopeClass,h.meanSlopePercent.toFixed(3),h.cells,h.areaKm2.toFixed(6)].join(','))].join('\n')}
  function draw(canvas,dem,result){
    const w=Math.min(1000,dem.width),h=Math.max(1,Math.round(w*dem.height/dem.width));canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d'),image=ctx.createImageData(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const ix=Math.min(dem.width-1,Math.floor((x+.5)*dem.width/w)),iy=Math.min(dem.height-1,Math.floor((y+.5)*dem.height/h));
      const id=result.labels[iy*dem.width+ix],p=(y*w+x)*4;
      if(id){image.data[p]=75+(id*53)%150;image.data[p+1]=100+(id*97)%130;image.data[p+2]=120+(id*29)%115;image.data[p+3]=255}
      else{image.data[p]=229;image.data[p+1]=238;image.data[p+2]=240;image.data[p+3]=255}
    }
    ctx.putImageData(image,0,0);
  }
  root.HRUTool={categoryRaster,slopePercent,delineate,csv,draw};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.HRUTool;
})(typeof window!=='undefined'?window:globalThis);

