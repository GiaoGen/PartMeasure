import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
import sharp from 'sharp';
import {chromium,expect} from '@playwright/test';
import {emptyMetadata} from '../../src/lib/annotations.ts';
const out='tmp/ui-hit-confirm-20261101';await mkdir(out,{recursive:true});
const shims={
 'next/navigation':`const params=new URLSearchParams(location.search);const router={replace:(href)=>history.replaceState(history.state,'',href),push:(href)=>history.pushState(history.state,'',href),refresh:()=>{}};export const useRouter=()=>router;export const useSearchParams=()=>params;`,
 'next/link':`import React from 'react';export default function Link({prefetch,onNavigate,children,...props}){return React.createElement('a',{...props,onClick:onNavigate},children);}`,
 'next/image':`import React from 'react';export default function Image({fill,unoptimized,priority,quality,sizes,...props}){return React.createElement('img',props);}`,
};
const built=await build({entryPoints:['scripts/ui-hit-confirm/fixture.tsx'],bundle:true,format:'esm',platform:'browser',conditions:['style'],write:false,outfile:`${out}/fixture.js`,define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},jsx:'automatic',plugins:[{name:'next-shell',setup(b){b.onResolve({filter:/^next\/(navigation|link|image)$/},a=>({path:a.path,namespace:'shell'}));b.onLoad({filter:/.*/,namespace:'shell'},a=>({contents:shims[a.path],loader:'js',resolveDir:process.cwd()}));}}]});
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
const pixels=await sharp({create:{width:400,height:400,channels:3,background:'#e7edf3'}}).webp().toBuffer();
const geometries=[{type:'line',from:{x:.3,y:.5},to:{x:.7,y:.5}},{type:'line',from:{x:.87,y:.4},to:{x:.87,y:.6}},{type:'circle',center:{x:.5,y:.5},radiusX:.38,radiusY:.38}];
const items=geometries.map((geometry,i)=>({id:['inner','near','circle'][i],geometry,metadata:emptyMetadata(),revision:1,deleted:false}));
const image={id:'photo',width:400,height:400,imageHash:'fixture',normalizationVersion:1};
const browser=await chromium.launch({channel:'msedge',headless:true});const results=[],errors=[],unexpected=[];
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,reducedMotion:'reduce'});
await context.addInitScript(()=>{
 const vv=Object.assign(new EventTarget(),{width:innerWidth,height:innerHeight,offsetLeft:0,offsetTop:0});
 Object.defineProperty(window,'visualViewport',{get:()=>vv});window.fixtureViewport=vv;
});
const json=(route,data)=>route.fulfill({contentType:'application/json',body:JSON.stringify({data})});
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),p=url.pathname;
 if(url.origin!=='http://127.0.0.1:3198'||req.method()!=='GET'){unexpected.push({path:req.url(),method:req.method()});return route.abort();}
 if(p==='/fixture')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n.annotation-viewport{width:380px!important;height:400px!important}.canvas-column{width:380px}.workspace-asset{position:relative;width:380px;height:400px}.annotated-thumbnail{display:block;position:relative;width:100%;height:100%}.pm-workspace{min-height:1600px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`});
 if(p==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:js});
 if(p==='/pixels.webp'||p.endsWith('/preview'))return route.fulfill({contentType:'image/webp',body:pixels});
 if(p.endsWith('/file-layers'))return json(route,{items:[{image,items}]});
 if(p.endsWith('/annotations'))return json(route,{image,items});
 if(p.endsWith('/inbox'))return json(route,{items:[],files:{},images:{},targets:{},removedIds:[],counts:{},nextCursor:null});
 if(p.endsWith('/issues'))return json(route,{items:[],counts:{},nextCursor:null});
 if(p.startsWith('/fonts/'))return route.fulfill({body:await readFile(`public${p}`)});
 if(p==='/favicon.ico')return route.fulfill({status:204});
 unexpected.push(p);return route.abort();
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
async function check(name,fn){await fn();results.push({name,status:'PASS'});console.log('PASS',name);}
async function viewport(value){await page.evaluate(value=>{Object.assign(window.fixtureViewport,value);window.fixtureViewport.dispatchEvent(new Event('resize'));},value);await page.waitForTimeout(30);}
async function centered(selector,vv,margin=15){const b=await page.locator(selector).boundingBox();assert(b);assert(Math.abs(b.x+b.width/2-(vv.offsetLeft+vv.width/2))<1.5);assert(Math.abs(b.y+b.height/2-(vv.offsetTop+vv.height/2))<1.5);assert(b.y>=vv.offsetTop+margin);assert(b.y+b.height<=vv.offsetTop+vv.height-margin);}
try{
 await page.goto('http://127.0.0.1:3198/fixture');
 await check('shared_confirm_titles_centered_and_cancelled',async()=>{
  for(const title of ['有未完成的修改或操作','归档项目？','发布交付版本？','撤销接收记录？']){
   await page.getByRole('button',{name:title,exact:true}).click();await centered('.pm-confirm',{width:390,height:844,offsetLeft:0,offsetTop:0});
   await page.getByRole('button',{name:'继续编辑',exact:true}).click();await expect(page.locator('.pm-confirm')).toBeHidden();await expect(page.locator('#answer')).toHaveText('false');
  }
 });
 await check('short_visible_viewport_long_content_and_resize',async()=>{
  await page.getByRole('button',{name:'长内容',exact:true}).click();await viewport({width:320,height:340,offsetLeft:20,offsetTop:110});
  await centered('.pm-confirm',{width:320,height:340,offsetLeft:20,offsetTop:110});
  assert(await page.locator('.pm-confirm').evaluate(e=>e.scrollHeight>e.clientHeight));
  await page.getByRole('button',{name:'继续编辑',exact:true}).click();await expect(page.locator('.pm-confirm')).toBeHidden();
  await viewport({width:390,height:844,offsetLeft:0,offsetTop:0});
 });
 await check('centering_survives_motion_and_page_scroll',async()=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>scrollTo(0,400));
  await page.getByRole('button',{name:'有未完成的修改或操作',exact:true}).click();await page.waitForTimeout(180);
  await centered('.pm-confirm',{width:390,height:844,offsetLeft:0,offsetTop:0});
  await page.screenshot({path:`${out}/mobile-confirm.png`});
  await page.keyboard.press('Escape');await expect(page.locator('.pm-confirm')).toBeHidden();
  await page.emulateMedia({reducedMotion:'reduce'});
 });
 await check('nested_context_confirm_closes_first_and_keeps_parent',async()=>{
  await page.getByRole('button',{name:'标注属性',exact:true}).click();await expect(page.locator('.workspace-context-dialog')).toBeVisible();
  await centered('.workspace-context-dialog',{width:390,height:844,offsetLeft:0,offsetTop:0},8);
  await page.getByRole('button',{name:'嵌套确认',exact:true}).click();await centered('.pm-confirm',{width:390,height:844,offsetLeft:0,offsetTop:0});
  await page.keyboard.press('Escape');await expect(page.locator('.pm-confirm')).toBeHidden();await expect(page.locator('.workspace-context-dialog')).toBeVisible();
  await page.getByLabel('关闭标注信息',{exact:true}).click();
 });
 await check('inbox_existing_centering_follows_short_viewport',async()=>{
  await page.locator('.task-inbox-fab').click();
  await viewport({width:390,height:360,offsetLeft:0,offsetTop:100});
  await centered('.task-inbox-dialog',{width:390,height:360,offsetLeft:0,offsetTop:100},8);
  await page.getByLabel('关闭待办',{exact:true}).click();await viewport({width:390,height:844,offsetLeft:0,offsetTop:0});
 });
 await check('confirmation_desktop_dark_landscape_and_acceptance',async()=>{
  await page.setViewportSize({width:1280,height:900});await viewport({width:1280,height:900,offsetLeft:0,offsetTop:0});await page.emulateMedia({colorScheme:'dark'});
  await page.getByRole('button',{name:'有未完成的修改或操作',exact:true}).click();await centered('.pm-confirm',{width:1280,height:900,offsetLeft:0,offsetTop:0});
  await page.screenshot({path:`${out}/desktop-confirm-dark.png`});await page.getByRole('button',{name:'仍要继续',exact:true}).click();await expect(page.locator('#answer')).toHaveText('true');
  await page.setViewportSize({width:844,height:390});await viewport({width:844,height:390,offsetLeft:0,offsetTop:0});
  await page.getByRole('button',{name:'有未完成的修改或操作',exact:true}).click();await centered('.pm-confirm',{width:844,height:390,offsetLeft:0,offsetTop:0});
  await page.keyboard.press('Escape');await expect(page.locator('.pm-confirm')).toBeHidden();await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'light'});
 });
 await page.goto('http://127.0.0.1:3198/fixture?mode=canvas');
 await expect(page.locator('.canvas-message')).toHaveCount(0);await expect(page.locator('.annotation-viewport canvas').first()).toBeVisible();
 const vp=page.locator('.annotation-viewport');await vp.scrollIntoViewIfNeeded();
 async function at(x,y){const b=await page.locator('.konvajs-content').boundingBox(),v=await vp.evaluate(e=>({x:+e.dataset.panX,y:+e.dataset.panY,s:+e.dataset.scale}));return{x:b.x+v.x+x*v.s,y:b.y+v.y+y*v.s};}
 async function tap(x,y,touch=false){const p=await at(x,y);if(touch)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);}
 await check('native_canvas_hollow_interior_and_nearest_stroke',async()=>{
  await tap(150,150);await expect(page.locator('#selected')).toBeEmpty();
  await tap(200,200);await expect(page.locator('#selected')).toHaveText('inner');
  await tap(348,200);await expect(page.locator('#selected')).toHaveText('near');
  await tap(352,200);await expect(page.locator('#selected')).toHaveText('circle');
 });
 await check('native_touch_and_zoom_preserve_screen_tolerance',async()=>{
  await tap(200,200,true);await expect(page.locator('#selected')).toHaveText('inner');
  await page.getByRole('button',{name:'放大',exact:true}).click();await tap(348,200,true);await expect(page.locator('#selected')).toHaveText('near');
  await page.getByRole('button',{name:'适应图片',exact:true}).click();
 });
 await check('overlapping_line_drag_moves_only_selected_line',async()=>{
  await tap(348,200);const a=await at(348,200),b=await at(328,210);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();
  await expect(page.locator('#changed')).toHaveText('1');
  const data=JSON.parse(await page.locator('#items').textContent());assert(data[1].geometry.from.x<.87);assert.equal(data[2].geometry.radiusX,.38);
 });
 await check('touch_drag_escape_permission_drop_and_outside_mouse_release',async()=>{
  await page.getByRole('button',{name:'重置',exact:true}).click();await vp.scrollIntoViewIfNeeded();await tap(348,200,true);
  const cdp=await context.newCDPSession(page),a=await at(348,200),b=await at(328,210),points=p=>[{id:1,...p,radiusX:2,radiusY:2,force:1}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(a)});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(b)});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('#changed')).toHaveText('1');
  for(const cancel of ['escape','permission']){
   await page.getByRole('button',{name:'重置',exact:true}).click();await vp.scrollIntoViewIfNeeded();await tap(200,200);
   const start=await at(200,200),end=await at(210,220);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:3});
   if(cancel==='escape')await page.keyboard.press('Escape');else await page.locator('#lock').evaluate(e=>e.click());
   await page.mouse.up();await expect(page.locator('#changed')).toHaveText('0');
   if(cancel==='permission')await page.locator('#lock').click();
  }
  await page.getByRole('button',{name:'重置',exact:true}).click();await vp.scrollIntoViewIfNeeded();await tap(48,200);
  const start=await at(48,200),box=await vp.boundingBox();await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x,box.y+box.height+60,{steps:8});await page.mouse.up();
  await expect(page.locator('#changed')).toHaveText('1');const data=JSON.parse(await page.locator('#items').textContent());assert(Math.abs(data[2].geometry.center.y-.62)<1e-6);
 });
 await check('native_paths_reject_ellipse_arc_angle_interiors',async()=>{
  const result=await page.evaluate(({metadata})=>{
   const gs=[{type:'ellipse',center:{x:.5,y:.5},axisA:{x:.85,y:.5},axisB:{x:.5,y:.7}},{type:'arc',from:{x:.15,y:.5},via:{x:.5,y:.15},to:{x:.85,y:.5}},{type:'angle',vertex:{x:.5,y:.5},from:{x:.25,y:.5},to:{x:.5,y:.25},reflex:false}];
   const points=[{x:200,y:200},{x:200,y:150},{x:160,y:160}];
   return gs.map((geometry,i)=>window.fixturePick([{id:'shape',geometry,metadata}],points[i],400,400,1,5)?.id??null);
  },{metadata:emptyMetadata()});assert.deepEqual(result,[null,null,null]);
  const tolerance=await page.evaluate(({circle,metadata})=>[.5,1,2].map(scale=>{
   const list=[{id:'circle',geometry:circle,metadata}],point={x:352+7/scale,y:200};
   return [window.fixturePick(list,point,400,400,scale,5)?.id??null,window.fixturePick(list,point,400,400,scale,10)?.id??null];
  }),{circle:geometries[2],metadata:emptyMetadata()});assert.deepEqual(tolerance,[[null,'circle'],[null,'circle'],[null,'circle']]);
 });
 await check('native_three_point_tools_keep_one_count_per_touch',async()=>{
  await page.getByRole('button',{name:'重置',exact:true}).click();
  let count=3;
  for(const name of ['角度','三点圆弧']){
   await page.getByRole('button',{name,exact:true}).click();await vp.scrollIntoViewIfNeeded();
   for(const [index,point] of [[100,300],[200,120],[300,300]].entries()){
    await tap(...point,true);const data=JSON.parse(await page.locator('#items').textContent());assert.equal(data.length,count+(index===2?1:0));
   }
   count++;
  }
 });
 await page.goto('http://127.0.0.1:3198/fixture?mode=gallery');
 await expect(page.locator('.thumbnail-annotations')).toBeVisible();
 await check('gallery_blank_passes_to_photo_and_nested_stroke_selects',async()=>{
  const box=await page.locator('.annotated-thumbnail').boundingBox();const scale=Math.min(box.width/400,box.height/400),x=box.x+(box.width-400*scale)/2,y=box.y+(box.height-400*scale)/2;
  const click=async(px,py)=>page.mouse.click(x+px*scale,y+py*scale);
  await click(150,150);await expect(page.locator('#selected')).toHaveText('browse');
  await click(200,200);await expect(page.locator('#selected')).toHaveText('inner');
  await click(348,200);await expect(page.locator('#selected')).toHaveText('near');
  await click(352,200);await expect(page.locator('#selected')).toHaveText('circle');
  await page.touchscreen.tap(x+200*scale,y+200*scale);await expect(page.locator('#selected')).toHaveText('inner');
  await page.screenshot({path:`${out}/gallery-strokes.png`});
 });
 await check('gallery_keyboard_targets_remain_operable',async()=>{
  const button=page.locator('[data-annotation-id=inner]');await button.focus();await page.keyboard.press('Enter');await expect(page.locator('#selected')).toHaveText('inner');
 });
 await page.goto('http://127.0.0.1:3198/fixture?mode=projects');
 await check('project_and_folder_dialogs_keep_existing_centering',async()=>{
  await page.getByRole('button',{name:'新建项目',exact:true}).first().click();
  await centered('.projects-dialog[open]',{width:390,height:844,offsetLeft:0,offsetTop:0});
  await viewport({width:390,height:400,offsetLeft:0,offsetTop:90});
  await centered('.projects-dialog[open]',{width:390,height:400,offsetLeft:0,offsetTop:90});
  await page.getByRole('button',{name:'取消',exact:true}).click();await viewport({width:390,height:844,offsetLeft:0,offsetTop:0});
  await page.getByRole('button',{name:'文件夹',exact:true}).click();
  await page.locator('.projects-drawer').getByLabel('新建文件夹',{exact:true}).click();
  await centered('.projects-dialog[open]',{width:390,height:844,offsetLeft:0,offsetTop:0});
  await page.getByRole('button',{name:'取消',exact:true}).click();
 });
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
}catch(e){console.error(e);await page.screenshot({path:`${out}/failure.png`});process.exitCode=1;}
finally{await writeFile(`${out}/result.json`,JSON.stringify({scope:'actual components and native browser paths, synthetic intercepted GETs; visible viewport events simulated, not physical phone/keyboard',results,errors,unexpected},null,2));await context.close();await browser.close();}
