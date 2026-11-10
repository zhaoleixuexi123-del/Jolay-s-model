/* Export raster-derived streams and subbasins as ESRI Shapefile ZIPs. */
(function(root){
  const encoder=new TextEncoder();
  function spatialReference(dem){
    const b=dem.bbox;
    if(!b||b.length!==4||!b.every(Number.isFinite)||b[2]<=b[0]||b[3]<=b[1])throw Error('DEM 缺少有效地理坐标，无法导出 SHP');
    const code=Number(dem.geoKeys?.ProjectedCSTypeGeoKey||dem.geoKeys?.GeographicTypeGeoKey||dem.geoKeys?.ProjectedCRSGeoKey||dem.geoKeys?.GeodeticCRSGeoKey);
    const geographic='GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
    let prj;
    if(code===4326)prj=geographic;
    else if(code>=32601&&code<=32660||code>=32701&&code<=32760){
      const north=code<32700,zone=code%100,meridian=zone*6-183;
      prj=`PROJCS["WGS_1984_UTM_Zone_${zone}${north?'N':'S'}",${geographic},PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",${north?'0.0':'10000000.0'}],PARAMETER["Central_Meridian",${meridian}.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
    }else if(code===4490)prj='GEOGCS["GCS_China_Geodetic_Coordinate_System_2000",DATUM["D_China_2000",SPHEROID["CGCS2000",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
    else if(code===3857)prj=`PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",${geographic},PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],UNIT["Meter",1.0]]`;
    else throw Error(`当前 DEM 的 EPSG:${code||'未知'} 尚不支持自动生成 .prj；请先转换为 WGS84 UTM、EPSG:4326、4490 或 3857`);
    return{prj,code,point:(col,row)=>[b[0]+col*(b[2]-b[0])/dem.width,b[3]-row*(b[3]-b[1])/dem.height]};
  }
  function segmentKm(a,b,code){
    if(code===4326||code===4490){
      const rad=Math.PI/180,lat1=a[1]*rad,lat2=b[1]*rad,dlat=lat2-lat1,dlon=(b[0]-a[0])*rad;
      const h=Math.sin(dlat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dlon/2)**2;
      return 12742*Math.asin(Math.min(1,Math.sqrt(h)));
    }
    return Math.hypot(b[0]-a[0],b[1]-a[1])/1000;
  }
  function streamFeatures(dem,flow,streamMask,links,ref){
    if(!links?.reachCount)throw Error('尚未生成河段');
    const features=[];
    for(let id=1;id<=links.reachCount;id++){
      let i=links.reachHeads[id];if(i==null)continue;
      const head=i,points=[ref.point(i%dem.width+.5,Math.floor(i/dem.width)+.5)];
      for(let guard=0;guard<streamMask.length;guard++){
        const j=flow.down[i];
        if(j<0||!streamMask[j]||links.labels[j]!==id)break;
        i=j;points.push(ref.point(i%dem.width+.5,Math.floor(i/dem.width)+.5));
      }
      const end=i,next=flow.down[end];
      if(next>=0&&streamMask[next])points.push(ref.point(next%dem.width+.5,Math.floor(next/dem.width)+.5));
      else if(points.length===1)points.push(ref.point(head%dem.width+.75,Math.floor(head/dem.width)+.5));
      const length=points.slice(1).reduce((s,p,k)=>s+segmentKm(points[k],p,ref.code),0);
      features.push({parts:[points],properties:{REACH_ID:id,DS_REACH:next>=0&&streamMask[next]?links.labels[next]:0,UP_CELLS:flow.acc[end],LEN_KM:length}});
    }
    return features;
  }
  function subbasinFeatures(dem,result,ref){
    if(!result?.unitCount||!result.unitCells)throw Error('请先划分子流域');
    const w=dem.width,h=dem.height,groups=Array.from({length:result.unitCount+1},()=>[]),v=(x,y)=>y*(w+1)+x;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,id=result.mask[i]?result.labels[i]:0;if(!id)continue;
      const edges=groups[id];
      if(y===0||!result.mask[i-w]||result.labels[i-w]!==id)edges.push([v(x,y),v(x+1,y),0]);
      if(x===w-1||!result.mask[i+1]||result.labels[i+1]!==id)edges.push([v(x+1,y),v(x+1,y+1),1]);
      if(y===h-1||!result.mask[i+w]||result.labels[i+w]!==id)edges.push([v(x+1,y+1),v(x,y+1),2]);
      if(x===0||!result.mask[i-1]||result.labels[i-1]!==id)edges.push([v(x,y+1),v(x,y),3]);
    }
    const features=[];
    for(let id=1;id<=result.unitCount;id++){
      const edges=groups[id],byStart=new Map(),used=new Uint8Array(edges.length),parts=[];
      for(let k=0;k<edges.length;k++){const a=edges[k][0];if(!byStart.has(a))byStart.set(a,[]);byStart.get(a).push(k)}
      for(let k=0;k<edges.length;k++)if(!used[k]){
        const start=edges[k][0],ring=[start];let current=k;
        for(let guard=0;guard<=edges.length;guard++){
          if(used[current])throw Error(`子流域 ${id} 的边界出现重复边`);
          used[current]=1;const end=edges[current][1];ring.push(end);
          if(end===start)break;
          const options=(byStart.get(end)||[]).filter(j=>!used[j]);
          if(!options.length)throw Error(`子流域 ${id} 的边界未闭合`);
          const rank=turn=>turn===1?0:turn===0?1:turn===3?2:3;
          options.sort((a,b)=>rank((edges[a][2]-edges[current][2]+4)%4)-rank((edges[b][2]-edges[current][2]+4)%4));
          current=options[0];
        }
        if(ring.at(-1)!==start||ring.length<5)throw Error(`子流域 ${id} 的边界无效`);
        parts.push(ring.map(vertex=>ref.point(vertex%(w+1),Math.floor(vertex/(w+1)))));
      }
      if(!parts.length)throw Error(`子流域 ${id} 没有面边界`);
      features.push({parts,properties:{SUB_ID:id,CELLS:result.unitCells[id-1],AREA_KM2:dem.cellAreaKm2?result.unitCells[id-1]*dem.cellAreaKm2:null}});
    }
    return features;
  }
  function bounds(parts){
    const b=[Infinity,Infinity,-Infinity,-Infinity];
    for(const part of parts)for(const p of part){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1])}
    return b;
  }
  function shapeFiles(shapeType,features,fields){
    if(!features.length)throw Error('没有可导出的空间对象');
    const records=[],index=[],globalBounds=[Infinity,Infinity,-Infinity,-Infinity];let offset=50;
    for(let k=0;k<features.length;k++){
      const f=features[k],parts=f.parts,points=parts.flat(),b=bounds(parts);
      for(let j=0;j<4;j++)globalBounds[j]=j<2?Math.min(globalBounds[j],b[j]):Math.max(globalBounds[j],b[j]);
      const size=44+4*parts.length+16*points.length,buf=new Uint8Array(size),view=new DataView(buf.buffer);
      view.setInt32(0,shapeType,true);for(let j=0;j<4;j++)view.setFloat64(4+j*8,b[j],true);
      view.setInt32(36,parts.length,true);view.setInt32(40,points.length,true);
      let pos=44,partStart=0;
      for(const part of parts){view.setInt32(pos,partStart,true);pos+=4;partStart+=part.length}
      for(const p of points){view.setFloat64(pos,p[0],true);view.setFloat64(pos+8,p[1],true);pos+=16}
      records.push(buf);index.push([offset,size/2]);offset+=4+size/2;
    }
    function header(fileWords){const buf=new Uint8Array(100),v=new DataView(buf.buffer);v.setInt32(0,9994,false);v.setInt32(24,fileWords,false);v.setInt32(28,1000,true);v.setInt32(32,shapeType,true);for(let j=0;j<4;j++)v.setFloat64(36+j*8,globalBounds[j],true);return buf}
    const shp=new Uint8Array(offset*2),shx=new Uint8Array(100+8*index.length);shp.set(header(offset));shx.set(header(shx.length/2));
    let pos=100;
    for(let k=0;k<records.length;k++){const v=new DataView(shp.buffer,pos,8);v.setInt32(0,k+1,false);v.setInt32(4,records[k].length/2,false);pos+=8;shp.set(records[k],pos);pos+=records[k].length;const iv=new DataView(shx.buffer,100+k*8,8);iv.setInt32(0,index[k][0],false);iv.setInt32(4,index[k][1],false)}
    const recordLength=1+fields.reduce((n,f)=>n+f.width,0),headerLength=33+32*fields.length;
    const dbf=new Uint8Array(headerLength+features.length*recordLength+1),dv=new DataView(dbf.buffer),now=new Date();
    dbf[0]=3;dbf[1]=now.getFullYear()-1900;dbf[2]=now.getMonth()+1;dbf[3]=now.getDate();
    dv.setUint32(4,features.length,true);dv.setUint16(8,headerLength,true);dv.setUint16(10,recordLength,true);
    for(let k=0;k<fields.length;k++){const f=fields[k],at=32+k*32;dbf.set(encoder.encode(f.name.slice(0,10)),at);dbf[at+11]='N'.charCodeAt(0);dbf[at+16]=f.width;dbf[at+17]=f.decimals||0}
    dbf[headerLength-1]=13;
    for(let k=0;k<features.length;k++){
      let at=headerLength+k*recordLength;dbf[at++]=32;
      for(const f of fields){const val=features[k].properties[f.name];let s=val==null?'':Number(val).toFixed(f.decimals||0);if(s.length>f.width)throw Error(`属性 ${f.name} 超出 DBF 字段宽度`);s=s.padStart(f.width,' ');dbf.set(encoder.encode(s),at);at+=f.width}
    }
    dbf[dbf.length-1]=26;
    return{shp,shx,dbf};
  }
  const crcTable=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0});
  function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0}
  function zip(files){
    const locals=[],central=[];let offset=0;
    for(const file of files){
      const name=encoder.encode(file.name),data=file.data instanceof Uint8Array?file.data:encoder.encode(file.data),crc=crc32(data);
      const local=new Uint8Array(30+name.length+data.length),lv=new DataView(local.buffer);
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,name.length,true);local.set(name,30);local.set(data,30+name.length);locals.push(local);
      const entry=new Uint8Array(46+name.length),ev=new DataView(entry.buffer);
      ev.setUint32(0,0x02014b50,true);ev.setUint16(4,20,true);ev.setUint16(6,20,true);ev.setUint32(16,crc,true);ev.setUint32(20,data.length,true);ev.setUint32(24,data.length,true);ev.setUint16(28,name.length,true);ev.setUint32(42,offset,true);entry.set(name,46);central.push(entry);offset+=local.length;
    }
    const centralLength=central.reduce((n,b)=>n+b.length,0),out=new Uint8Array(offset+centralLength+22);let pos=0;
    for(const b of locals){out.set(b,pos);pos+=b.length}
    for(const b of central){out.set(b,pos);pos+=b.length}
    const end=new DataView(out.buffer,pos,22);end.setUint32(0,0x06054b50,true);end.setUint16(8,files.length,true);end.setUint16(10,files.length,true);end.setUint32(12,centralLength,true);end.setUint32(16,offset,true);
    return out;
  }
  function unzipStored(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files=new Map(),decoder=new TextDecoder();
    let pos=0;
    while(pos+30<=bytes.length){
      const signature=view.getUint32(pos,true);
      if(signature===0x02014b50||signature===0x06054b50)break;
      if(signature!==0x04034b50)throw Error('备份 ZIP 结构无效');
      const flags=view.getUint16(pos+6,true),method=view.getUint16(pos+8,true),crc=view.getUint32(pos+14,true),size=view.getUint32(pos+18,true),nameLength=view.getUint16(pos+26,true),extraLength=view.getUint16(pos+28,true);
      if(flags&8||method!==0)throw Error('备份 ZIP 格式不受支持');
      const start=pos+30+nameLength+extraLength,end=start+size;
      if(end>bytes.length)throw Error('备份 ZIP 文件不完整');
      const name=decoder.decode(bytes.subarray(pos+30,pos+30+nameLength)),data=bytes.slice(start,end);
      if(crc32(data)!==crc)throw Error(`备份文件 ${name} 校验失败`);
      files.set(name,data);pos=end;
    }
    return files;
  }
  function packageLayer(base,type,features,fields,prj){
    const layer=shapeFiles(type,features,fields);
    return zip([{name:base+'.shp',data:layer.shp},{name:base+'.shx',data:layer.shx},{name:base+'.dbf',data:layer.dbf},{name:base+'.prj',data:prj},{name:base+'.cpg',data:'UTF-8'}]);
  }
  function streamsZip(dem,flow,streamMask,links){
    const ref=spatialReference(dem),features=streamFeatures(dem,flow,streamMask,links,ref);
    return packageLayer('hydro_streams',3,features,[{name:'REACH_ID',width:8},{name:'DS_REACH',width:8},{name:'UP_CELLS',width:12},{name:'LEN_KM',width:16,decimals:3}],ref.prj);
  }
  function subbasinsZip(dem,result){
    const ref=spatialReference(dem),features=subbasinFeatures(dem,result,ref);
    return packageLayer('hydro_subbasins',5,features,[{name:'SUB_ID',width:8},{name:'CELLS',width:12},{name:'AREA_KM2',width:16,decimals:3}],ref.prj);
  }
  function save(name,bytes){const url=URL.createObjectURL(new Blob([bytes],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
  root.DEMShapefile={streamsZip,subbasinsZip,save,spatialReference,streamFeatures,subbasinFeatures,zipFiles:zip,unzipStored};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.DEMShapefile;
})(typeof window!=='undefined'?window:globalThis);
