// Synthetic orientation oracle: raw pixels are inverse-mapped by the EXIF definition.
// The independent oracle is corner RGB + upright dimensions, not Sharp's transform output.
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const dir='experiments/konva/public/fixtures';
await mkdir(dir,{recursive:true});
const colors=[[210,35,45],[30,160,65],[35,80,210],[180,190,200]];
const samples=[];
const checks=[];
for (const [width,height] of [[640,480],[480,640]]) for(let orientation=1;orientation<=8;orientation++) {
  const rawWidth=orientation>=5?height:width;
  const rawHeight=orientation>=5?width:height;
  const pixels=Buffer.alloc(rawWidth*rawHeight*3);
  for(let ry=0;ry<rawHeight;ry++) for(let rx=0;rx<rawWidth;rx++) {
    let x,y;
    switch(orientation) {
      case 1: x=rx;y=ry;break;
      case 2: x=rawWidth-1-rx;y=ry;break;
      case 3: x=rawWidth-1-rx;y=rawHeight-1-ry;break;
      case 4: x=rx;y=rawHeight-1-ry;break;
      case 5: x=ry;y=rx;break;
      case 6: x=rawHeight-1-ry;y=rx;break;
      case 7: x=rawHeight-1-ry;y=rawWidth-1-rx;break;
      case 8: x=ry;y=rawWidth-1-rx;break;
    }
    const color=colors[(y>=height/2?2:0)+(x>=width/2?1:0)];
    const at=(ry*rawWidth+rx)*3;
    pixels[at]=color[0];pixels[at+1]=color[1];pixels[at+2]=color[2];
  }
  const raw=await sharp(pixels,{raw:{width:rawWidth,height:rawHeight,channels:3}}).withMetadata({orientation}).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
  const originalMeta=await sharp(raw).metadata();
  assert.equal(originalMeta.orientation,orientation);
  const canonical=await sharp(raw,{limitInputPixels:40000000,failOn:'warning'}).autoOrient().jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
  const meta=await sharp(canonical).metadata();
  assert.equal(meta.width,width);assert.equal(meta.height,height);
  assert.equal(meta.orientation,undefined);assert.equal(meta.exif,undefined);
  const decoded=await sharp(canonical).raw().removeAlpha().toBuffer();
  for(const [i,[u,v]] of [[0,[0.2,0.2]],[1,[0.8,0.2]],[2,[0.2,0.8]],[3,[0.8,0.8]]]) {
    const at=(Math.floor(v*height)*width+Math.floor(u*width))*3;
    for(let channel=0;channel<3;channel++) assert.ok(Math.abs(decoded[at+channel]-colors[i][channel])<=10);
  }
  assert.deepEqual(await sharp(canonical).autoOrient().raw().removeAlpha().toBuffer(),decoded);
  const id=`${width}x${height}-o${orientation}`;
  await writeFile(`${dir}/${id}-source.jpg`,raw);
  await writeFile(`${dir}/${id}-canonical.jpg`,canonical);
  samples.push({id,orientation,width,height,rawWidth,rawHeight,source:`/fixtures/${id}-source.jpg`,canonical:`/fixtures/${id}-canonical.jpg`});
  checks.push({id,orientation,dimensions:[width,height],cornerOracle:'PASS',exifRemoved:true,reorientationStable:true,sourceSha256:createHash('sha256').update(raw).digest('hex'),canonicalSha256:createHash('sha256').update(canonical).digest('hex')});
}
await writeFile(`${dir}/manifest.json`,`${JSON.stringify({samples,colors},null,2)}\n`);
await mkdir('docs/evidence/closeout',{recursive:true});
await writeFile('docs/evidence/closeout/exif.json',`${JSON.stringify({checkedAt:new Date().toISOString(),sharp:sharp.versions.sharp,source:'synthetic inverse-EXIF pixel fixtures; not real phone photos',samples:checks,passed:checks.length},null,2)}\n`);
console.log(`PASS: ${checks.length} synthetic EXIF 1–8 portrait/landscape fixtures; canonical corners, dimensions, metadata removal, repeat-orientation stability.`);
