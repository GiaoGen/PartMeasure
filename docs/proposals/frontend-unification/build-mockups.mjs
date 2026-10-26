// Proposal-only vector mockups. No app imports, server calls or browser rendering.
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { preservedViews, mobilePreviewHtml } from './preserved-views.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const C = { bg:'#f7f8fa', white:'#ffffff', ink:'#1f2933', muted:'#526171', line:'#dce2e8', blue:'#2459b8', soft:'#edf3fc', red:'#a5222a', yellow:'#885512', green:'#1d6945' };
const esc = v => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const r = (x,y,w,h,fill=C.white,stroke='none',rx=0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" rx="${rx}"/>`;
const t = (x,y,text,size=14,color=C.ink,weight=400) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(text)}</text>`;
const line = (x,y,x2,y2,color=C.line) => `<path d="M${x} ${y}H${x2}" stroke="${color}"/>${y===y2?'':`<path d="M${x2} ${y}V${y2}" stroke="${color}"/>`}`;
const rule = (x,y,w) => r(x,y,w,1,C.line);
const btn = (x,y,w,text,primary=false) => r(x,y,w,36,primary?C.blue:C.white,primary?C.blue:C.line,6)+t(x+12,y+23,text,14,primary?C.white:C.ink,500);
const chip = (x,y,text,color=C.green,bg='#edf7f1') => r(x,y,text.length*13+18,24,bg,'none',4)+t(x+9,y+17,text,12,color,500);
const svg = (w,h,body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>text{font-family:'Segoe UI','Microsoft YaHei','PingFang SC',sans-serif} .num{font-variant-numeric:tabular-nums}</style>${r(0,0,w,h,C.bg)}${body}</svg>`;
const brand = (x,y) => r(x,y-18,24,24,C.blue,'none',5)+`<path d="M${x+6} ${y-1}v-10h6a4 4 0 0 1 0 8h-6" fill="none" stroke="white" stroke-width="2"/>`+t(x+35,y+1,'PartMeasure',20,C.ink,600);
const circle = (x,y,rad,fill,stroke='none',sw=1) => `<circle cx="${x}" cy="${y}" r="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
// Same seven tool glyphs as the existing AnnotationIcon. Proposal-only copies.
const toolGlyphs = [
 ['线段','M4 18 20 6M2 16l4 4M18 4l4 4'],
 ['圆','M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z'],
 ['点','M12 3v5m0 8v5M3 12h5m8 0h5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
 ['文字','M4 6V4h16v2M12 4v16m-4 0h8'],
 ['角度','m4 5 1 14h15M5 13a6 6 0 0 1 6 6'],
 ['圆弧','M4 17a8 8 0 0 1 16 0M3 17h2M11 9h2M19 17h2'],
 ['椭圆','M20 7c2 3-1 8-6 11S4 21 3 17 5 9 10 6s9-2 10 1Z'],
];
function toolbar(){
 return r(232,213,848,47,'#f8fafc',C.line,6)+r(239,220,60,33,C.soft,'none',4)+t(248,242,'选择',13,C.blue,600)
 +toolGlyphs.map(([label,d],i)=>`<g role="img" aria-label="${label}"><title>${label}</title><path transform="translate(${319+i*44} 226) scale(.84)" d="${d}" fill="none" stroke="${C.ink}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></g>`).join('')
 +r(622,223,1,26,C.line)+t(642,242,'↶   ↷',20,C.muted)+t(740,242,'CV 辅助  ▾',13,C.muted)+t(963,242,'适合画布',13,C.muted);
}

function part(x,y,s=1,annotation=true,single=false,mark=C.blue,number=1) {
 return `<g transform="translate(${x} ${y}) scale(${s})">${r(0,0,580,410,'#e9edf0')}
 <ellipse cx="294" cy="323" rx="181" ry="30" fill="#d6dde2"/>
 <path d="M111 214 150 129Q164 100 204 96H377Q410 103 429 132L473 236Q481 267 446 293L339 343Q311 357 282 342L135 277Q104 258 111 214" fill="#a6b2bc" stroke="#738391" stroke-width="2"/>
 <path d="M111 207 151 121Q164 94 204 90H377Q410 96 429 126L473 229Q480 255 445 278L339 329Q311 343 282 328L135 264Q104 246 111 207" fill="#c4ced6" stroke="#81919e" stroke-width="2"/>
 <ellipse cx="292" cy="202" rx="113" ry="77" fill="#dde4e9" stroke="#8595a3" stroke-width="3"/>
 <ellipse cx="292" cy="205" rx="64" ry="43" fill="#5a6c7b" stroke="#687d8d" stroke-width="5"/>
 <path d="M229 201Q291 174 355 201" fill="none" stroke="#304453" stroke-width="8"/>
 ${[[182,159],[391,162],[164,238],[408,241],[296,297]].map(([a,b])=>`<ellipse cx="${a}" cy="${b}" rx="13" ry="9" fill="#536878" stroke="#8394a0" stroke-width="3"/>`).join('')}
 ${annotation?`<ellipse cx="292" cy="205" rx="69" ry="47" fill="none" stroke="${mark}" stroke-width="3"/>
 <path d="M348 177 414 111H503" fill="none" stroke="${mark}" stroke-width="2"/>${circle(503,111,15,mark)}${t(498,116,number,14,C.white,600)}
 ${single?'':`<path d="M151 281 287 343M146 272l-3 17m147 45-3 17" stroke="${C.red}" stroke-width="2"/>${circle(197,319,14,C.red)}${t(192,324,'2',14,C.white,600)}`}`:''}</g>`;
}
function top(title='联轴器支座 · 测绘资料',section='files',actions=true) {
 let b=r(0,0,1440,64,C.white)+rule(0,63,1440)+brand(24,35)+t(262,36,'我的项目',14,C.muted)+t(338,36,'/',14,C.muted)+t(359,36,title,16,C.ink,600);
 if(actions)b+=btn(1172,14,104,'分享项目')+btn(1288,14,128,'项目设置  ···');
 b+=r(0,64,1440,53,C.white)+t(28,96,'资料与补测',14,section==='files'?C.blue:C.muted,section==='files'?600:400)+t(163,96,'交付与版本',14,section==='deliveries'?C.blue:C.muted,section==='deliveries'?600:400)+r(section==='files'?24:160,113,88,3,C.blue)+rule(0,116,1440);
 return b;
}
function field(x,y,w,label,value,unit=''){
 return t(x,y,label,13,C.muted)+r(x,y+11,w,39,C.white,C.line,6)+t(x+12,y+36,value,15)+ (unit?t(x+w-36,y+36,unit,13,C.muted):'');
}
function inboxShortcut(x=24,y=817){
 return circle(x+24,y+24,24,C.white,C.line)+`<path transform="translate(${x+12} ${y+11})" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" fill="none" stroke="${C.muted}" stroke-width="1.8"/>`+circle(x+42,y+3,10,C.red)+t(x+39,y+7,'3',11,C.white,600);
}

function projects() {
 let b=r(0,0,220,900,C.white)+r(219,0,1,900,C.line)+brand(22,39);
 b+=t(24,103,'项目空间',12,C.muted,500)+r(12,122,194,42,C.soft,'none',6)+t(30,149,'▦   全部项目',14,C.blue,600)+t(24,211,'文件夹',12,C.muted,500)+t(183,211,'+',20,C.muted);
 [['客户项目','#7395c6'],['自用零件','#7a9f8c'],['技术展示','#a08cb9']].forEach(([s,c],i)=>{b+=circle(33,248+i*44,4,c)+t(49,253+i*44,s,14);});
 b+=rule(20,812,180)+circle(36,850,14,'#e9edf2')+t(30,855,'工',12,C.muted,600)+t(59,855,'工程师账号',13)+t(176,855,'···',16,C.muted);
 b+=t(264,72,'我的项目',26,C.ink,600)+t(265,101,'整理资料、定位补测，按版本交接成果。',14,C.muted)+btn(1260,47,136,'+  新建项目',true);
 b+=r(264,133,465,40,C.white,C.line,6)+t(280,159,'⌕   搜索项目名称或说明',14,C.muted);
 b+=r(953,133,443,40,C.white,C.line,6)+r(958,138,138,30,C.soft,'none',4)+t(999,159,'进行中',14,C.blue,500)+t(1142,159,'已归档',14,C.muted)+t(1306,159,'全部',14,C.muted);
 b+=t(265,212,'8 个进行中项目',13,C.muted)+t(265,250,'项目名称',12,C.muted)+t(965,250,'文件夹',12,C.muted)+t(1130,250,'创建日期',12,C.muted)+rule(264,265,1132);
 const rows=[['联轴器支座 · 测绘资料','补齐孔径和安装尺寸，交付 STEP 与工程图。','客户项目','2026/10/25'],['泵体端盖','端面与孔位资料整理','客户项目','2026/10/24'],['定位块 · 二次补测','核对斜拍圆孔的人工直径','自用零件','2026/10/23'],['传动轴零件','客户原始资料与交付版本','客户项目','2026/10/22'],['支架复刻','整理照片、测量说明与加工附件','技术展示','2026/10/21']];
 rows.forEach((row,i)=>{const y=266+i*99; b+=r(264,y,1132,98,i===0?'#f0f5fd':C.white)+r(279,y+24,42,42,'#f1f4f7','none',6)+t(290,y+52,'▧',23,C.muted)+t(340,y+38,row[0],16,C.ink,500)+t(340,y+66,row[1],13,C.muted)+circle(972,y+47,4,i===2?'#7a9f8c':'#7395c6')+t(986,y+52,row[2],13,C.muted)+t(1130,y+52,row[3],13,C.muted)+t(1363,y+52,'···',18,C.muted)+rule(264,y+98,1132);});
 b+=btn(760,806,132,'加载更多项目')+t(265,875,'设计提案 · 合成示例数据',11,C.muted);
 return svg(1440,900,b);
}

function workspace(){
 let b=top();
 b+=r(0,117,208,783,C.white)+r(207,117,1,783,C.line)+t(21,150,'‹  返回资料',14,C.blue,500)+rule(16,169,176)+t(20,199,'当前资料',12,C.muted);
 [['支座正面.jpg',true],['支座侧面.jpg',false],['安装位置.jpg',false]].forEach(([name,sel],i)=>{const y=218+i*100;b+=r(10,y,187,88,sel?C.soft:C.white,sel?'#b8ccef':C.line,6)+part(20,y+9,.12,false)+t(99,y+35,name,12,sel?C.blue:C.ink,500)+t(99,y+57,'照片 · 标准图',11,C.muted);});
 b+=r(10,526,187,66,C.white,C.line,6)+t(23,553,'▧  原始模型.step',13)+t(42,576,'STEP · 客户上传',11,C.muted)+t(20,638,'按当前筛选显示',12,C.muted)+btn(18,657,172,'加载更多资料');
 b+=r(208,117,896,783,C.white)+t(232,152,'支座正面.jpg',17,C.ink,600)+chip(419,133,'未保存',C.yellow,'#fff5e7')+t(232,178,'工程师上传 · 2026/10/25',12,C.muted)+btn(862,135,108,'文件操作  ···')+btn(980,135,100,'保存修改',true)+rule(232,196,848);
 b+=toolbar();
 b+=r(232,275,848,482,'#e9edf0',C.line,6)+part(315,295,1.1,true)+r(934,709,128,32,C.white,C.line,6)+t(950,730,'−    100%    +',13,C.muted);
 b+=t(234,789,'1  中心孔',13,C.blue,600)+t(345,789,'2  安装距离 · 待补充',13,C.red)+t(234,822,'拖动画布平移；滚轮缩放。尺寸由人工填写。',13,C.muted)+rule(232,850,848)+t(234,875,'固定位置、来源与历史沿用现有功能',12,C.muted);
 b+=r(1104,117,336,783,C.white)+r(1104,117,1,783,C.line)+t(1128,151,'标注与属性',16,C.ink,600)+rule(1128,172,288)+t(1128,205,'1   中心孔',20,C.ink,600)+chip(1299,186,'已补充')+t(1128,231,'椭圆 · 人工直径 Ø',13,C.muted);
 b+=field(1128,270,288,'名称','中心孔')+field(1128,355,288,'直径 Ø','24.00','mm')+t(1128,424,'孔深、孔类型与其他属性  ›',13,C.muted)+rule(1128,447,288)+t(1128,478,'测量要求',14,C.ink,600)+t(1128,505,'使用内测量爪测量孔径。',14)+t(1128,533,'测量方法与帮助  ›',13,C.blue)+rule(1128,555,288);
 b+=t(1128,586,'客户补充',14,C.green,600)+t(1128,619,'24.00 mm',23,C.ink,600)+t(1128,647,'客户 · 现场人员 · 本次已补充',12,C.muted)+btn(1128,670,130,'要求补测')+rule(1128,731,288)+t(1128,761,'›  回复与修订历史',14,C.muted)+t(1128,800,'已补充不代表工程质量验收。',12,C.muted)+t(1128,876,'设计提案 · 零件示意',11,C.muted);
 b+=inboxShortcut()+t(81,847,'待处理事项',13,C.muted);
 return svg(1440,900,b);
}

function deliveries(){
 let b=top('联轴器支座 · 测绘资料','deliveries');
 b+=t(40,164,'交付与版本',25,C.ink,600)+t(40,194,'每次发布保留独立版本，附件与反馈对应同一版本。',14,C.muted)+btn(1250,149,150,'+  准备新版本',true);
 b+=r(40,225,910,615,C.white,C.line,8)+t(64,263,'V003',25,C.ink,600)+chip(156,242,'最新版本',C.blue,C.soft)+t(64,292,'发布于 2026/10/25 · 工程师',13,C.muted)+rule(64,312,862)+t(64,344,'更新安装孔尺寸，补充支座侧视工程图。',15)+t(64,393,'版本附件',14,C.ink,600)+btn(794,368,132,'ZIP 打包附件');
 const files=[['支座模型.step','STEP · 2.4 MB'],['支座工程图.pdf','PDF · 830 KB'],['测量说明.pdf','PDF · 410 KB']];
 files.forEach((f,i)=>{const y=415+i*81;b+=rule(64,y,862)+t(76,y+34,'▧',21,C.muted)+t(114,y+31,f[0],15,C.ink,500)+t(114,y+54,f[1],12,C.muted)+btn(843,y+21,83,'下载');});
 b+=rule(64,668,862)+t(64,703,'客户反馈与接收',15,C.ink,600)+chip(752,684,'已收到')+t(64,737,'客户 · 现场人员',13,C.green,600)+t(64,767,'文件已收到，正在核对装配位置。',15)+t(64,798,'2026/10/25 · 接收记录不代表工程质量认证',12,C.muted);
 b+=r(978,225,422,285,C.white,C.line,8)+t(1002,264,'私有草稿',18,C.ink,600)+chip(1282,242,'仅工程师',C.muted,'#f1f4f7')+t(1002,304,'准备下一版成果',15)+t(1002,333,'上传附件并填写版本说明，保存后再发布。',13,C.muted)+btn(1002,364,150,'上传成果附件')+rule(1002,428,374)+t(1002,461,'发布前可检查附件与说明。',13,C.muted);
 b+=r(978,534,422,250,C.white,C.line,8)+t(1002,574,'›  历史版本',18,C.ink,600)+t(1002,611,'默认收起，按需浏览每页 10 个版本。',13,C.muted)+rule(1002,638,374)+t(1002,672,'V002',15,C.ink,500)+t(1149,672,'2026/10/24',13,C.muted)+t(1348,672,'›',20,C.muted)+rule(1002,694,374)+t(1002,731,'V001',15,C.ink,500)+t(1149,731,'2026/10/23',13,C.muted)+t(1348,731,'›',20,C.muted);
 b+=t(40,877,'设计提案 · 示例为工程师视角；客户不显示私有草稿与发布入口',12,C.muted);
 return svg(1440,900,b);
}

function guest(){
 return retained.guest;
}

function entry(){
 let b=r(0,0,1440,900,C.white)+brand(56,45)+t(967,46,'工程师整理 · 客户免注册协作',13,C.muted)+btn(1248,24,136,'工程师登录',true)+rule(56,86,1328);
 b+=t(72,170,'工程资料协作',14,C.blue,600)+t(72,240,'把零件资料，',43,C.ink,600)+t(72,304,'交接清楚。',43,C.ink,600)+t(72,359,'照片、标注、补测与成果版本，放在同一个项目里。',17,C.muted)+t(72,391,'工程师指出测哪里，客户打开链接即可上传和回复。',17,C.muted)+btn(72,434,156,'进入工程师工作台',true)+t(72,508,'客户无需注册，请使用工程师分享的项目链接。',13,C.muted);
 b+=r(718,146,666,421,C.bg,C.line,8)+r(718,146,666,43,C.white,C.line,8)+t(739,173,'资料与补测',13,C.blue,600)+t(859,173,'交付与版本',13,C.muted)+part(733,201,.82,true)+r(1215,202,151,346,C.white,C.line,6)+t(1229,233,'1  中心孔',14,C.ink,600)+t(1229,266,'人工直径 Ø',12,C.muted)+t(1229,296,'24.00 mm',18,C.ink,600)+rule(1229,321,122)+t(1229,350,'客户补充',13,C.green,600)+t(1229,380,'来源与历史保留',12,C.muted)+t(1229,424,'›  测量要求',12,C.muted)+t(1229,466,'›  修订历史',12,C.muted);
 b+=rule(72,625,1312)+t(72,672,'一个项目，完成三步交接',23,C.ink,600);
 [['01','整理资料','双方上传照片、CAD 与附件。'],['02','定位补测','标清位置，客户填写或拍照回复。'],['03','交付留档','按版本发布，下载图片、报告与资料包。']].forEach(([n,h,d],i)=>{let x=72+i*445;b+=t(x,728,n,14,C.blue,600)+t(x+40,728,h,18,C.ink,600)+t(x+40,765,d,14,C.muted);});
 b+=rule(72,824,1312)+t(72,860,'PartMeasure · 工程资料协作',12,C.muted)+t(1075,860,'设计提案 · 合成产品示意',12,C.muted);
 return svg(1440,900,b);
}

function login(){
 let b=r(0,0,1440,900,C.bg)+brand(48,44)+t(1290,45,'返回首页',14,C.muted)+r(480,158,480,587,C.white,C.line,8);
 b+=t(520,216,'工程师登录',27,C.ink,600)+t(520,248,'继续整理资料，与客户清楚交接。',14,C.muted)+field(520,295,400,'邮箱','name@example.com')+field(520,386,400,'密码','••••••••••••')+t(861,422,'显示',12,C.blue)+r(520,482,400,44,C.blue,'none',6)+t(701,510,'登录',16,C.white,600)+t(520,563,'还没有账号？',14,C.muted)+t(615,563,'创建工程师账号',14,C.blue)+rule(520,595,400)+t(520,632,'客户无需注册',14,C.ink,500)+t(520,661,'请打开工程师发送的项目链接。',14,C.muted)+t(520,710,'登录异常会就地说明，并保留邮箱输入。',12,C.muted)+t(520,799,'设计提案 · 保留现有密码 / 注册 / OTP 流程',12,C.muted);
 return svg(1440,900,b);
}

function materials(){
 let b=top()+t(40,164,'项目资料',25,C.ink,600)+t(40,193,'照片用于定位与标注，其他附件保留原文件下载。',14,C.muted)+btn(1260,145,140,'+  上传资料',true);
 b+=r(40,219,1360,64,C.white,C.line,8)+t(60,258,'需要补充的事项',15,C.ink,600)+chip(225,239,'待补充',C.red,'#fff0f0')+chip(318,239,'待补测',C.yellow,'#fff5e7')+t(1092,258,'按资料查看当前待办',13,C.muted)+t(1358,258,'›',20,C.blue);
 b+=btn(40,309,139,'所有资料  ▾')+btn(191,309,164,'最新上传在前  ▾')+btn(1118,309,134,'PDF 资料报告')+btn(1264,309,136,'ZIP 资料包');
 const names=['支座正面.jpg','支座侧面.jpg','安装位置.jpg'];
 names.forEach((name,i)=>{const x=40+i*347;b+=r(x,371,321,322,C.white,C.line,8)+part(x+1,372,.55,true)+t(x+17,626,name,16,C.ink,500)+t(x+17,655,'工程师上传 · 2026/10/25',12,C.muted)+t(x+281,626,'···',17,C.muted);});
 b+=r(1081,371,319,322,C.white,C.line,8)+r(1101,391,279,200,'#f1f4f7','none',6)+t(1206,488,'STEP',31,C.muted,600)+t(1169,526,'下载查看原始模型',13,C.muted)+t(1098,626,'原始模型.step',16,C.ink,500)+t(1098,655,'客户上传 · 2.4 MB',12,C.muted);
 b+=r(40,721,1360,83,C.white,C.line,8)+t(63,755,'上传队列',14,C.ink,600)+t(63,781,'本例当前没有进行中的上传；选择资料后在这里显示进度和重试。',13,C.muted)+t(40,876,'设计提案 · 导出选择沿用原位勾选、数量上限、核权与取消规则',12,C.muted);
 b+=inboxShortcut(40,821)+t(97,851,'待处理事项',13,C.muted);
 return svg(1440,900,b);
}
const retained = preservedViews({C,r,t,rule,btn,chip,svg,part,circle});
const screens={projects:projects(),workspace:workspace(),deliveries:deliveries(),guest:guest(),entry:entry(),login:login(),materials:materials(),
 'mobile-materials':retained.mobileMaterials,'owner-mobile':retained.ownerMobile,'mobile-interactions':retained.mobileInteractions,
 inbox:retained.inbox,'inbox-selected':retained.inboxSelected,toolbar:svg(848,60,`<g transform="translate(-232 -207)">${toolbar()}</g>`)};
for(const [name,source] of Object.entries(screens)){
 await writeFile(path.join(dir,`${name}.svg`),source,'utf8');
 await sharp(Buffer.from(source)).png().toFile(path.join(dir,`${name}.png`));
}
let board=r(0,0,1800,2080,C.bg)+t(40,62,'PartMeasure / 全站前端统一提案',33,C.ink,600)+t(40,101,'稳定导航 · 统一排版 · 清晰主动作 · 让照片和工程信息成为主体',17,C.muted)+t(40,132,'静态设计稿，合成数据与零件示意；不是当前运行页面。',13,C.muted);
const positions=[['projects','01  项目空间',40,180],['workspace','02  资料标注工作台 · 七类icon保留',920,180],['deliveries','03  交付与版本',40,810],['guest','04  手机图库原位补齐弹框',920,810],['entry','05  产品入口',40,1440],['login','06  登录与注册体系',920,1440]];
const composites=[];
for(const [name,label,x,y] of positions){
 board+=t(x,y,label,20,C.ink,600)+r(x,y+18,840,525,C.white,C.line,8);
 if(name==='guest'){
   composites.push({input:await sharp(path.join(dir,'guest.png')).resize({height:505}).toBuffer(),left:x+18,top:y+28});
   board+=t(x+294,y+87,'图库直接点标注 → 原位弹框',21,C.ink,600)+t(x+294,y+132,'保留现有客户补齐信息框',16,C.muted)+t(x+294,y+180,'工程师使用对应的属性框',16,C.muted)+t(x+294,y+228,'照片 / 说明 / 其他回复仍可展开',16,C.muted)+t(x+294,y+276,'关闭后保留图库与原滚动位置',16,C.muted)+t(x+294,y+355,'保留原有待办铃铛和横滑卡片',14,C.muted)+t(x+294,y+390,'不强制进入大图、任务页或编辑器',14,C.muted)+t(x+294,y+425,'任何功能删减须单列并先获批准',14,C.muted);
 }else composites.push({input:await sharp(path.join(dir,`${name}.png`)).resize(838,523).toBuffer(),left:x+1,top:y+19});
}
board+=t(40,2046,'方案范围：前端与UI / 后端契约和数据权限保持 / 正式实施待审阅',14,C.muted);
await sharp(Buffer.from(svg(1800,2080,board))).composite(composites).png().toFile(path.join(dir,'overview.png'));

const reviewScreens=[...positions.slice(0,2),['toolbar','七类工具保持icon'],['materials','资料浏览与上传'],['inbox','保留的待处理事项排版'],['inbox-selected','待办同浮窗下方详情'],['mobile-interactions','手机双角色图库快捷弹框'],['mobile-materials','手机图库 · 保留标注热区'],['owner-mobile','工程师原位属性框'],...positions.slice(2)];
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PartMeasure · 前端统一方案</title><style>body{margin:0;background:#f7f8fa;color:#1f2933;font:16px/1.6 'Segoe UI','Microsoft YaHei',sans-serif}header,main{max-width:1480px;margin:auto;padding:24px}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:#2459b8}figure{margin:40px 0}img{display:block;max-width:100%;height:auto;border:1px solid #dce2e8;border-radius:8px}h1{font-size:28px}h2{font-size:22px}small,p{color:#526171}.phone{max-width:430px}figcaption{margin:12px 0}</style><header id="top"><h1>PartMeasure · 全站前端统一方案</h1><p>静态提案，合成示例；不连接真实项目、不模拟已实现功能。本预览仅供设计审阅。</p><nav>${reviewScreens.map(([name,label])=>`<a href="#${name}">${label}</a>`).join('')}<a href="README.md">完整方案</a></nav></header><main>${reviewScreens.map(([name,label])=>`<figure id="${name}"><h2>${label}</h2><img class="${name==='guest'?'phone':''}" src="${name}.png" alt="${label}设计提案"><figcaption><a href="${name}.svg">矢量原稿</a> · <a href="#top">回到顶部</a></figcaption></figure>`).join('')}</main></html>`;
await writeFile(path.join(dir,'index.html'),html.replace('<a href="README.md">完整方案</a>','<a href="mobile-preview.html">点击体验手机弹框（设计示例）</a><a href="README.md">完整方案</a>'),'utf8');
await writeFile(path.join(dir,'mobile-preview.html'),mobilePreviewHtml,'utf8');
process.stdout.write('Updated proposal mockups, retained inbox layout, icon toolbar, and both mobile role panels. No app or browser started.\n');
