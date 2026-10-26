// Proposal-only views of existing entry points. No application modules or APIs.
export function preservedViews({ C, r, t, rule, btn, chip, svg, part, circle }) {
 const tones={redo:[C.yellow,'#fbefcb'],missing:[C.red,'#fce7e9'],done:[C.green,'#e0f2e8']};
 function bell(x,y){return `<g transform="translate(${x} ${y})" fill="none" stroke="${C.muted}" stroke-width="1.8" stroke-linejoin="round"><path d="M7 17H2c3-3 2-4 3-9a7 7 0 0 1 14 0c1 5 0 6 3 9H7m2 3h6"/></g>`;}
 function background(role='guest'){
  let b=r(0,0,430,900,C.bg)+r(0,0,430,112,C.white)+t(18,33,'PartMeasure',15,C.ink,600)+t(18,69,'联轴器支座',21,C.ink,600)+t(18,96,role==='guest'?'客户协作 · 仅此项目':'工程师 · 项目工作台',12,C.muted)+rule(0,111,430);
  b+=r(0,112,430,51,C.white)+t(20,144,'资料与补测',14,C.blue,600)+t(174,144,'交付与版本',14,C.muted)+r(18,160,91,3,C.blue)+rule(0,163,430);
  b+=t(20,203,'项目资料',21,C.ink,600)+btn(280,177,130,'上传资料')+t(20,239,'类型  所有资料  ▾',13,C.muted)+t(220,239,'排序  最新上传  ▾',13,C.muted);
  b+=r(20,257,390,328,C.white,C.line,8)+part(21,258,.669,true,false,C.red)+t(36,558,'支座正面.jpg',15,C.ink,500)+t(36,579,'工程师上传 · 2026/10/25',12,C.muted);
  b+=r(20,605,390,290,C.white,C.line,8)+part(21,606,.669,true)+t(36,879,'支座侧面.jpg',15,C.ink,500);
  b+=circle(44,841,25,C.white,C.line)+bell(32,829)+circle(62,821,10,C.red)+t(59,825,'3',11,C.white,600)+r(289,812,121,52,C.blue,'none',8)+t(311,845,'↑  上传',16,C.white,600);
  return b;
 }
 function guestDialog(){
  let b=r(8,280,414,365,C.white,C.line,12)+circle(34,314,4,C.red)+t(48,322,'椭圆',21,C.ink,600)+r(362,294,44,44,'#f4f6f9','none',8)+t(377,323,'×',24,C.ink);
  b+=t(30,369,'孔径',13,C.muted)+t(347,369,'待补充',13,C.red)+t(30,410,'填写孔径',14,C.ink,500)+r(30,426,272,53,C.white,'#a5bce0',6)+t(43,459,'输入实测值',18,C.muted)+r(312,426,88,53,'#f5f7fa',C.line,6)+t(333,459,'mm  ▾',16);
  b+=rule(30,499,370)+t(30,532,'照片、说明或其他回复方式  ▾',14,C.muted)+r(30,568,370,48,C.blue,'none',6)+t(181,598,'提交尺寸',16,C.white,600);
  return b;
 }
 function ownerDialog(){
  let b=r(8,174,414,611,C.white,C.line,12)+t(30,213,'标注与属性',18,C.ink,600)+r(362,187,44,44,'#f4f6f9','none',8)+t(377,216,'×',24,C.ink)+rule(30,240,370);
  b+=circle(34,267,4,C.red)+t(48,274,'1  椭圆',20,C.ink,600)+chip(323,253,'待补充',C.red,'#fff0f0')+t(30,308,'名称',13,C.muted)+r(108,288,292,39,C.white,C.line,6)+t(120,313,'中心孔',15);
  b+=t(30,361,'直径 Ø',13,C.muted)+r(108,339,208,42,C.white,C.line,6)+t(121,365,'输入人工值',16,C.muted)+t(345,365,'mm',14,C.muted)+t(30,408,'›  孔深、孔类型与其他属性',14,C.muted)+rule(30,428,370);
  b+=t(30,459,'测量要求与备注',14,C.ink,600)+t(30,488,'内测量爪 · 测量孔径，避开倒角',14)+t(30,518,'›  测量方式与帮助',13,C.blue)+rule(30,538,370)+t(30,568,'客户补充',14,C.green,600)+t(30,596,'待客户填写孔径',14,C.muted)+t(30,632,'›  客户补充与补测记录',14,C.muted)+rule(30,652,370)+t(30,682,'›  回复与修订历史',14,C.muted)+r(30,713,370,46,C.blue,'none',6)+t(180,742,'保存修改',16,C.white,600);
  return b;
 }
 function mobile(role='guest',popup=true){
  let b=background(role);
  if(popup)b+=r(0,0,430,900,'#182431').replace('fill="#182431"','fill="#182431" fill-opacity="0.48"')+(role==='guest'?guestDialog():ownerDialog());
  return svg(430,900,b);
 }
 function inbox(selected=false){
  const h=selected?1280:760;
  let b=r(0,0,840,h,'#f7f9fc','none',16)+t(32,70,'待处理事项',27,C.ink,600)+r(750,29,54,54,C.white,C.line,10)+t(769,64,'×',23);
  [['待补测','redo'],['待补充','missing'],['已补充','done']].forEach(([s,tone],i)=>{b+=circle(37+i*100,121,4,tones[tone][0])+t(49+i*100,127,s,15,C.muted);});
  b+=t(32,177,'正在准备其余待办…',17,C.muted);
  const groups=[['支座正面.jpg',[['8 · 角度','missing'],['7 · 椭圆','missing'],['6 · 椭圆','missing'],['5 · 椭圆','missing'],['4 · 椭圆','missing'],['3 · 线段','missing'],['2 · 线段','missing']]],['支座侧面.jpg',[['5 · 圆弧','redo'],['7 · 20','missing'],['2 · 15','missing'],['4 · 椭圆','missing'],['3 · 角度','done'],['6 · 圆弧','done']]],['安装位置.jpg',[['6 · 椭圆','missing'],['11 · 线段','missing'],['10 · 线段','missing'],['9 · 线段','missing'],['8 · 角度','missing'],['7 · 线段','missing']]]];
  groups.forEach(([name,cards],index)=>{
   const y=222+index*173;
   b+=t(32,y,'▧',19,C.muted)+t(64,y,name,16,C.muted)+t(706,y,'‹',22,C.muted)+t(754,y,'›',22,C.muted);
   b+=`<defs><clipPath id="lane-${index}-${selected}">${r(32,y+18,776,84,C.white)}</clipPath></defs><g clip-path="url(#lane-${index}-${selected})">`;
   cards.forEach(([label,tone],i)=>{const x=32+i*120,sel=selected&&index===0&&i===1;b+=r(x,y+31,109,63,tones[tone][1],sel?tones[tone][0]:'none',10)+t(x+17,y+70,label,17,tones[tone][0],500);});
   b+='</g>'+r(32,y+107,776,10,C.white,'none',5)+r(43,y+110,index===1?300:510,5,'#949ba3','none',3);
  });
  if(selected){
   b+=rule(32,751,776)+t(32,791,'7 · 椭圆',21,C.ink,600)+t(714,790,'收起  ∧',14,C.blue)+part(32,819,.63,true,true,C.red,7)+t(429,848,'孔径 · 待补充',15,C.red,600)+t(429,880,'使用内测量爪测量孔径。',14)+r(429,903,260,45,C.white,C.line,6)+t(440,931,'输入实测值',16,C.muted)+r(699,903,109,45,C.white,C.line,6)+t(718,931,'mm  ▾',14);
   b+=t(429,986,'照片、说明或其他回复方式  ▾',14,C.muted)+r(429,1011,379,46,C.blue,'none',6)+t(567,1040,'提交尺寸',16,C.white,600)+rule(32,1110,776)+t(32,1148,'›  回复与补测历史',15,C.muted)+t(32,1216,'设计提案 · 列表保留，详情仍在同一浮窗下方切换',13,C.muted);
  }
  return svg(840,h,b);
 }
 // An overview of the existing direct-click path and the two existing role panels.
 const nested=(source,x,y,w,h)=>source.replace(/^<svg[^>]+>/,`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 430 900">`);
 let flow=t(32,47,'手机图库：直接点标注 → 当前页弹框',26,C.ink,600)+t(32,78,'保留现有快捷入口；Guest 与 Owner 按角色显示已有能力。',15,C.muted);
 flow+=t(32,119,'① 资料图库',17,C.ink,600)+t(491,119,'② 客户：补齐信息',17,C.ink,600)+t(932,119,'② 工程师：标注与属性',17,C.ink,600);
 flow+=nested(mobile('guest',false),32,143,370,774)+nested(mobile('guest',true),491,143,370,774)+nested(mobile('owner',true),932,143,370,774);
 flow+=t(421,492,'→',32,C.blue,600)+t(876,492,'/',27,C.muted)+t(32,954,'点标注：打开对应信息框；点图片空白：继续原图片详情路径。关闭弹框：返回原图库位置。',15,C.muted)+t(32,986,'静态设计示例 · 字段按所选标注及现有权限显示，折叠内容不表示功能删除',13,C.muted);
 return {guest:mobile('guest',true),ownerMobile:mobile('owner',true),mobileMaterials:mobile('guest',false),inbox:inbox(),inboxSelected:inbox(true),mobileInteractions:svg(1334,1010,flow)};
}

export const mobilePreviewHtml=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>手机点标注 · 原位弹框设计示例</title><style>body{background:#f7f8fa;color:#1f2933;font:15px/1.6 'Segoe UI','Microsoft YaHei',sans-serif;margin:0;padding:24px}main{max-width:1000px;margin:auto}a{color:#2459b8}.role{display:inline-block;padding:10px 20px;margin:8px;border:1px solid #dce2e8;border-radius:6px;cursor:pointer}#guest:checked~label[for=guest],#owner:checked~label[for=owner]{background:#edf3fc;color:#2459b8}input{accent-color:#2459b8}.phone{position:relative;width:min(430px,100%);aspect-ratio:430/900;background:white;border:1px solid #dce2e8;margin-top:16px}.phone>img,.modal>img{width:100%;height:100%;display:block}.hotspot{position:absolute;left:39%;top:39%;width:26%;height:10%;border:2px dashed #2459b8;border-radius:50%;box-sizing:border-box}.number{left:78%;top:35%;width:9%;height:5%;border-radius:50%}.hint{position:absolute;top:47%;left:9%;padding:4px 8px;background:#fff;font-size:12px;color:#2459b8;pointer-events:none}#guest:checked~.phone .owner-link,#owner:checked~.phone .guest-link{display:none}.modal{display:none;position:absolute;inset:0;z-index:2}.modal:target{display:block}.close{position:absolute;left:84%;top:32.7%;width:11%;height:5%;border-radius:8px}.close-owner{top:20.8%}a:focus-visible{outline:3px solid #2459b8;outline-offset:3px}</style><main><h1>手机图库直接点标注</h1><p>先选角色，再点击照片孔位或编号的虚线热区。展示原位弹框；关闭回到图库。输入与提交仅为静态示意，不连接后端、不保存数据。</p><input type=radio id=guest name=role checked><label class=role for=guest>客户端</label><input type=radio id=owner name=role><label class=role for=owner>工程师端</label><div class=phone id=phone><img src="mobile-materials.png" alt="手机资料图库"><a class="hotspot guest-link" href="#guest-modal" aria-label="点椭圆标注打开客户补齐框"></a><a class="hotspot number guest-link" href="#guest-modal" aria-label="点编号打开客户补齐框"></a><a class="hotspot owner-link" href="#owner-modal" aria-label="点椭圆标注打开工程师属性框"></a><a class="hotspot number owner-link" href="#owner-modal" aria-label="点编号打开工程师属性框"></a><span class=hint>点击孔位或编号 → 原位弹框</span><section class=modal id=guest-modal aria-label="客户补齐弹框设计稿"><img src="guest.png" alt="现有客户补齐框的统一样式方案"><a class=close href="#phone" aria-label="关闭客户补齐框回到图库"></a></section><section class=modal id=owner-modal aria-label="工程师属性弹框设计稿"><img src="owner-mobile.png" alt="保留现有工程师属性能力的弹框方案"><a class="close close-owner" href="#phone" aria-label="关闭工程师属性框回到图库"></a></section></div><p><a href="inbox.png">查看保留的待处理事项排版</a> · <a href="inbox-selected.png">查看同浮窗下方详情</a> · <a href="index.html">全部设计稿</a> · <a href="README.md">方案与功能保留清单</a></p></main></html>`;
