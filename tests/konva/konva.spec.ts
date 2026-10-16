import {test,expect} from '@playwright/test';

const colors=[[210,35,45],[30,160,65],[35,80,210],[180,190,200]];
for(const [width,height] of [[640,480],[480,640]]) for(let orientation=1;orientation<=8;orientation++) {
  test(`EXIF ${orientation} ${width}x${height}: browser raw + canonical have same upright corners`,async({page})=>{
    await page.goto('/');
    const results=await page.evaluate(async({width,height,orientation})=>{
      const results=[];
      for(const variant of ['source','canonical']) {
        const blob=await(await fetch(`/fixtures/${width}x${height}-o${orientation}-${variant}.jpg`)).blob();
        const bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
        const ctx=canvas.getContext('2d');if(!ctx)throw new Error('2d context');ctx.drawImage(bitmap,0,0);
        const pixels=[[0.2,0.2],[0.8,0.2],[0.2,0.8],[0.8,0.8]].map(([u,v])=>Array.from(ctx.getImageData(Math.floor((u??0)*bitmap.width),Math.floor((v??0)*bitmap.height),1,1).data).slice(0,3));
        results.push({width:bitmap.width,height:bitmap.height,pixels});bitmap.close();
      }
      return results;
    },{width:width??0,height:height??0,orientation});
    for(const r of results){expect(r.width).toBe(width);expect(r.height).toBe(height);for(let i=0;i<4;i++)for(let channel=0;channel<3;channel++)expect(Math.abs((r.pixels[i]?.[channel]??-999)-(colors[i]?.[channel]??999))).toBeLessThanOrEqual(10);}
  });
}
test('Konva line/circle/point, inverse transform, resize, zoom, pan, rotation and serialization',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect.poll(()=>page.evaluate(()=>window.__partMeasureLab?.ready)).toBe(true);
  const original=await page.evaluate(()=>window.__partMeasureLab?.snapshot());
  expect(original?.line).toEqual([96,144,544,144]);
  expect(original?.circle).toEqual({x:320,y:312,radiusX:51.2,radiusY:51.2});
  expect(original?.point).toEqual({x:512,y:384});
  const changed={...original?.geometry,point:{x:0.64,y:0.72}};
  await page.evaluate(s=>window.__partMeasureLab?.loadFixture(s),JSON.stringify(changed));
  await expect.poll(()=>page.evaluate(()=>window.__partMeasureLab?.snapshot().point.x)).toBe(409.6);
  const initialSerialized=JSON.stringify(changed);
  for(const width of [390,820,1100]) {
    await page.setViewportSize({width,height:900});
    await expect.poll(()=>page.evaluate(()=>window.__partMeasureLab?.snapshot().width)).toBe(Math.min(1000,width-16));
    for(const view of [{zoom:0.5,panX:12,panY:8,rotation:0},{zoom:2.75,panX:-80,panY:40,rotation:0},{zoom:1.25,panX:150,panY:30,rotation:90}]){
      await page.evaluate(v=>window.__partMeasureLab?.view(v),view);
      await expect.poll(()=>page.evaluate(()=>window.__partMeasureLab?.snapshot().view)).toEqual(view);
      const points=await page.evaluate(()=>[ {x:0,y:0},{x:0.15,y:0.3},{x:0.5,y:0.65},{x:0.8,y:0.8},{x:1,y:1} ].map(p=>({p,q:window.__partMeasureLab?.roundTrip(p)})));
      for(const {p,q} of points){expect(Math.abs((q?.x??999)-p.x)*640).toBeLessThanOrEqual(0.5);expect(Math.abs((q?.y??999)-p.y)*480).toBeLessThanOrEqual(0.5);}
    }
    await page.evaluate(()=>window.__partMeasureLab?.reload());
    expect((await page.evaluate(()=>window.__partMeasureLab?.snapshot()))?.serialized).toBe(initialSerialized);
  }
  await page.reload();await expect.poll(()=>page.evaluate(()=>window.__partMeasureLab?.ready)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.__partMeasureLab?.snapshot().serialized)).toBe(initialSerialized);
  expect(errors).toEqual([]);
});
test('actual rendered Canvas pixels place normalized point and line at expected screen positions',async({page})=>{
  await page.goto('/');await expect.poll(()=>page.evaluate(()=>window.__partMeasureLab?.ready)).toBe(true);
  await page.evaluate(()=>window.__partMeasureLab?.view({zoom:1,panX:0,panY:0,rotation:0}));
  const pixels=await page.evaluate(async()=>{
    await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    const lab=window.__partMeasureLab;if(!lab)throw new Error('Missing lab');const state=lab.snapshot();
    const image=new Image();image.src=lab.canvas();await image.decode();
    const canvas=document.createElement('canvas');canvas.width=state.width;canvas.height=state.height;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Missing canvas');ctx.drawImage(image,0,0);
    return [[0.8*state.width,0.8*state.width*0.75],[0.5*state.width,0.3*state.width*0.75],[0.5*state.width,(0.65*480-51.2)*state.fit]].map(([x,y])=>Array.from(ctx.getImageData(Math.round(x??0),Math.round(y??0),1,1).data).slice(0,3));
  });
  for(const rgb of pixels)for(const c of rgb)expect(c).toBeGreaterThan(220);
});
