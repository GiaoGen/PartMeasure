import assert from 'node:assert/strict';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import sharp from 'sharp';
import {chromium,expect} from '@playwright/test';
const out='tmp/text-callout-20261101';await mkdir(out,{recursive:true});
const built=await build({entryPoints:['scripts/text-callout/browser-fixture.tsx'],bundle:true,format:'esm',platform:'browser',conditions:['style'],write:false,outfile:`${out}/browser.js`,define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},jsx:'automatic'});
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,css=built.outputFiles.find(f=>f.path.endsWith('.css'))?.text??'';
const pixels=await sharp({create:{width:400,height:400,channels:3,background:'#e7edf3'}}).webp().toBuffer();
const browser=await chromium.launch({channel:'msedge',headless:true}),results=[],errors=[],unexpected=[];
const image={id:'photo',width:400,height:400,imageHash:'a'.repeat(64),normalizationVersion:1};
try{
 for(const input of ['mouse','touch']){
  const context=await browser.newContext({viewport:{width:input==='mouse'?1100:390,height:900},hasTouch:true,isMobile:input==='touch',reducedMotion:'reduce'});
  let saved=[];const writes=[];
  const json=(route,data)=>route.fulfill({contentType:'application/json',body:JSON.stringify({data})});
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),p=url.pathname;
   if(url.origin!=='http://127.0.0.1:39998'){unexpected.push(req.url());return route.abort();}
   if(p==='/fixture')return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n.annotation-viewport{height:400px!important;width:100%;touch-action:none}.annotation-editor{max-width:700px;margin:0 auto}.annotation-properties{max-width:500px}#export-canvas{max-width:100%}</style></head><body><div id="root"></div><script type="module" src="/browser.js"></script></body></html>`});
   if(p==='/browser.js')return route.fulfill({contentType:'text/javascript',body:js});
   if(p==='/api/csrf'&&req.method()==='GET')return json(route,{token:'x'.repeat(43)});
   if(p.endsWith('/preview'))return route.fulfill({contentType:'image/webp',body:pixels});
   if(req.method()==='GET'&&p.endsWith('/annotations'))return json(route,{image,items:saved});
   if(req.method()==='GET'&&p.endsWith('/collaboration'))return json(route,{issues:{items:[],nextCursor:null}});
   if(req.method()==='POST'&&p==='/api/projects/local/annotations'){
    const data=req.postDataJSON();const item={...data,revision:1,deleted:false,schemaVersion:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};saved.push(item);writes.push({method:req.method(),geometry:data.geometry});return json(route,item);
   }
   if(req.method()==='PATCH'&&p.startsWith('/api/projects/local/annotations/')){
    const id=p.split('/').at(-1),data=req.postDataJSON(),old=saved.find(x=>x.id===id);const item={...old,...data,revision:old.revision+1};saved=saved.map(x=>x.id===id?item:x);writes.push({method:req.method(),geometry:data.geometry});return json(route,item);
   }
   if(req.method()==='GET'&&p.endsWith('/issues'))return json(route,{items:[],counts:{},nextCursor:null});
   if(p==='/favicon.ico')return route.fulfill({status:204});
   if(p.startsWith('/fonts/'))return route.fulfill({body:await readFile(`public${p}`)});
   unexpected.push({method:req.method(),path:p});return route.abort();
  });
  try{
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:39998/fixture');
   await expect(page.locator('.annotation-viewport canvas').first()).toBeVisible();await expect(page.locator('.canvas-message')).toHaveCount(0);
   await expect(page.getByRole('button',{name:'点位',exact:true})).toHaveCount(0);
   const choose=page.getByRole('button',{name:'箭头文字',exact:true});await choose.click();
   const viewport=page.locator('.annotation-viewport');await viewport.scrollIntoViewIfNeeded();
   const box=await page.locator('.konvajs-content').boundingBox(),v=await viewport.evaluate(e=>({x:+e.dataset.panX,y:+e.dataset.panY,s:+e.dataset.scale}));
   const at=p=>({x:box.x+v.x+p.x*400*v.s,y:box.y+v.y+p.y*400*v.s});
   const cdp=await context.newCDPSession(page);
   async function drag(a,b){
    if(input==='mouse'){await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:6});await page.mouse.up();}
    else{const pt=({x,y})=>[{id:1,x,y,radiusX:2,radiusY:2,force:1}];await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pt(a)});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pt(b)});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
    await page.waitForTimeout(30);
   }
   await drag(at({x:.3,y:.25}),at({x:.8,y:.7}));
   await expect(choose).toHaveAttribute('aria-pressed','true');
   const field=page.getByLabel('说明文字',{exact:true});await expect(field).toHaveCount(1);await field.fill('请确认倒角\n此处有毛刺');
   await expect(page.locator('.engineering-fields input')).toHaveCount(0);await expect(page.locator('.engineering-fields textarea')).toHaveCount(1);
   await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeDisabled();
   assert.equal(saved.length,1);assert(Math.abs(saved[0].geometry.at.x-.8)<.01);assert(Math.abs(saved[0].geometry.labelAt.x-.3)<.01);
   assert.equal(saved[0].geometry.text,'请确认倒角\n此处有毛刺');
   await viewport.scrollIntoViewIfNeeded();
   const current=await page.locator('.konvajs-content').boundingBox();
   const screen=p=>({x:current.x+v.x+p.x*400*v.s,y:current.y+v.y+p.y*400*v.s});
   await drag(screen(saved[0].geometry.at),screen({x:.85,y:.55}));
   await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeDisabled();
   assert(Math.abs(saved[0].geometry.at.y-.55)<.01);assert(Math.abs(saved[0].geometry.labelAt.y-.25)<.01);
   await viewport.scrollIntoViewIfNeeded();
   const tailBox=await page.locator('.konvajs-content').boundingBox();
   const tailScreen=p=>({x:tailBox.x+v.x+p.x*400*v.s,y:tailBox.y+v.y+p.y*400*v.s});
   await drag(tailScreen(saved[0].geometry.labelAt),tailScreen({x:.35,y:.3}));
   await page.getByRole('button',{name:'保存修改',exact:true}).click();await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeDisabled();
   assert(Math.abs(saved[0].geometry.labelAt.x-.35)<.01);assert(Math.abs(saved[0].geometry.at.y-.55)<.01);
   await viewport.focus();await page.keyboard.press('Control+z');
   await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeEnabled();
   await page.keyboard.press('Control+Shift+z');await expect(page.getByRole('button',{name:'保存修改',exact:true})).toBeDisabled();
   await page.reload();await expect(page.locator('.canvas-message')).toHaveCount(0);
   await page.locator('.annotation-list button').first().click();await expect(field).toHaveValue('请确认倒角\n此处有毛刺');
   await page.evaluate(async snapshot=>window.renderFixtureExport(snapshot),{document:{image,items:saved}});
   await page.locator('#export-canvas').screenshot({path:`${out}/${input}-export.png`});
   await page.locator('.annotation-viewport').screenshot({path:`${out}/${input}-canvas.png`});
   // Full editor should preserve text after a second creation using the same selected tool.
   await choose.click();await viewport.scrollIntoViewIfNeeded();
   const secondBox=await page.locator('.konvajs-content').boundingBox(),v2=await viewport.evaluate(e=>({x:+e.dataset.panX,y:+e.dataset.panY,s:+e.dataset.scale}));
   const second=p=>({x:secondBox.x+v2.x+p.x*400*v2.s,y:secondBox.y+v2.y+p.y*400*v2.s});
   await drag(second({x:.7,y:.15}),second({x:.4,y:.4}));await expect(choose).toHaveAttribute('aria-pressed','true');
   await expect(page.locator('.annotation-list li')).toHaveCount(2);
   results.push({input,status:'PASS',checks:['arrow points to gesture end','single editable field','mock save and reload via actual editor','tip drag keeps tail','tail drag keeps tip','actual editor undo redo','continuous tool','actual export render','new point tool absent'],mockWrites:writes.length});console.log('PASS',input);
  }catch(e){const failedPage=context.pages()[0];if(failedPage)await failedPage.screenshot({path:`${out}/${input}-failure.png`});throw e;}finally{await context.close();}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
}catch(e){console.error(e);process.exitCode=1;}
finally{await writeFile(`${out}/browser-result.json`,JSON.stringify({scope:'Actual AnnotationEditor/Canvas/EngineeringFields/export renderer, synthetic local GET/POST/PATCH intercepted, no cloud/physical phone',results,errors,unexpected},null,2));await browser.close();}
