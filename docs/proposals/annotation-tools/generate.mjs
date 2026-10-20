// Proposal assets only. No product imports, network requests, or persistent application state.
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
const base = new URL("./", import.meta.url);
const blue = "#2564a8", muted = "#647487";
const defs = `<defs><marker id="arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M0 0L8 4L0 8" fill="none" stroke="${blue}" stroke-width="1.5"/></marker></defs>`;
const line = (x1, y1, x2, y2, extra = "") => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${blue}" stroke-width="2" ${extra}/>`;
function dimension(x1, y1, x2, y2) {
	const dx = x2-x1, dy = y2-y1, length = Math.hypot(dx,dy), nx = -dy/length*7, ny = dx/length*7;
	return line(x1,y1,x2,y2,'marker-start="url(#arrow)" marker-end="url(#arrow)"') + line(x1-nx,y1-ny,x1+nx,y1+ny) + line(x2-nx,y2-ny,x2+nx,y2+ny);
}
const text = (x,y,value,size=20,color=blue,anchor="middle") => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" paint-order="stroke" stroke="#fff" stroke-width="7" stroke-linejoin="round">${value}</text>`;
const handle = (x,y) => `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="${blue}" stroke-width="2"/>`;
const samples = {
	line: {
		title: "线段", hint: "两点定位。端标随线垂直，不画长引出线。", fields: ["长度"], unit: "mm", values: ["120"],
		shape: `<path d="M70 220V162H150V142H440V162H510V220" fill="#e7ebef" stroke="#b4bec9" stroke-width="2"/>${dimension(100,100,480,100)}`,
		labels: [{x:290,y:81,key:0,prefix:"",pending:"长度待补"}],
	},
	angle: {
		title: "角度", hint: "顶点 → 第一条边 → 第二条边；真实角度由人填写。", fields: ["角度"], unit: "°", values: ["45"],
		shape: `<path d="M145 215L145 192L335 12L350 30L175 205H490V225H145Z" fill="#e7ebef" stroke="#b4bec9" stroke-width="2"/>${line(160,200,455,200)}${line(160,200,310,50)}<path d="M240 200A80 80 0 0 0 216.569 143.431" fill="none" stroke="${blue}" stroke-width="2"/>${handle(160,200)}${handle(310,50)}${handle(455,200)}`,
		labels: [{x:300,y:155,key:0,prefix:"α ",pending:"角度待补"}],
	},
	arc: {
		title: "圆弧", hint: "起点 → 弧上中间点 → 终点；默认只要求补半径。", fields: ["半径"], unit: "mm", values: ["20"],
		shape: `<path d="M135 205A155 155 0 0 1 445 205" fill="none" stroke="#c1cad4" stroke-width="16"/><path d="M150 205A140 140 0 0 1 430 205" fill="none" stroke="${blue}" stroke-width="2.5"/>${line(290,205,389,106,'marker-end="url(#arrow)"')}${line(143,205,157,205)}${line(423,205,437,205)}${handle(150,205)}${handle(290,65)}${handle(430,205)}<circle cx="290" cy="205" r="2.5" fill="${muted}"/>`,
		labels: [{x:384,y:145,key:0,prefix:"R",pending:"半径待补"}],
	},
	ellipse: {
		title: "椭圆", hint: "贴合斜拍圆孔；默认人工孔径 Ø，可选长半轴 a。", fields: ["圆孔直径 Ø"], unit: "mm", values: ["40"],
		shape: `<ellipse cx="290" cy="145" rx="184" ry="78" transform="rotate(-20 290 145)" fill="#e7ebef" stroke="#bbc5cf" stroke-width="2"/><ellipse cx="290" cy="145" rx="176" ry="70" transform="rotate(-20 290 145)" fill="none" stroke="${blue}" stroke-width="2"/>`,
		labels: [{x:290,y:145,key:0,prefix:"Ø",pending:"孔径待补"}],
	},
};
function label(sample, point, values) {
	const raw = values[point.key];
	const value = raw ? `${point.prefix}${raw}${sample.unit === "°" ? "°" : " mm"}` : point.pending;
	return text(point.x,point.y,value);
}
let cards = "";
let index = 0;
for (const [key,sample] of Object.entries(samples)) {
	const x = index%2 ? 660:40, y = index<2 ? 124:490;
	// Ellipse describes the photographed contour; the physical diameter is human-entered.
	const values = sample.values;
	cards += `<g transform="translate(${x} ${y})"><rect width="580" height="338" rx="12" fill="#fff" stroke="#d9e0e7"/><text x="24" y="38" font-size="22" font-weight="600" fill="#23364b">0${index+1} / ${sample.title}</text><g transform="translate(0 42)">${sample.shape}${sample.labels.map(p=>label(sample,p,values)).join("")}</g><text x="24" y="312" font-size="15" fill="${muted}">${sample.hint}</text></g>`;
	index++;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="900" viewBox="0 0 1280 900"><style>text{font-family:'Microsoft YaHei','Noto Sans CJK SC',sans-serif}</style>${defs}<rect width="1280" height="900" fill="#f3f6f9"/><text x="40" y="53" font-size="30" font-weight="600" fill="#23364b">照片标注 / 显示与操作提案</text><text x="40" y="88" font-size="17" fill="${muted}">短端标 + 小箭头；新增角度、圆弧、椭圆。蓝色尺寸均为人工填写的示例。</text>${cards}<text x="40" y="870" font-size="16" fill="${muted}">仅独立示意 · 未接入正式编辑器 · 几何用于定位，不从照片推算零件真实尺寸或角度</text></svg>`;
await writeFile(new URL("annotation-tools.svg",base),svg);
await sharp(Buffer.from(svg)).png().toFile(new URL("annotation-tools.png",base).pathname.replace(/^\/(\w:)/,"$1"));
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PartMeasure 标注工具提案</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f6f9;color:#23364b;font:16px/1.65 system-ui,'Microsoft YaHei',sans-serif}main{max-width:1100px;margin:auto;padding:32px 20px}h1{font-size:28px;margin:0 0 8px}p{color:#607286}nav{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}button{font:inherit;border:1px solid #c9d4df;background:#fff;color:#23364b;padding:9px 18px;border-radius:7px;cursor:pointer}button[aria-pressed=true]{background:#2564a8;color:white;border-color:#2564a8}button:focus-visible,input:focus-visible{outline:3px solid #8aadd6;outline-offset:3px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:28px}figure{margin:0;min-width:0}svg{display:block;width:100%;background:white;border:1px solid #d9e0e7;border-radius:10px}figcaption{margin-top:16px;color:#607286}aside{border-left:1px solid #d9e0e7;padding-left:24px}h2{font-size:20px;margin-top:0}label{display:block;margin-bottom:18px}input{display:block;width:100%;font:inherit;padding:10px;margin-top:6px;border:1px solid #bdcbd8;border-radius:6px}small{display:block;color:#607286}footer{border-top:1px solid #d9e0e7;margin-top:32px;padding-top:18px;color:#607286}#status{color:#2564a8;min-height:28px}@media(max-width:700px){main{padding:20px 16px}.layout{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid #d9e0e7;padding:18px 0 0}nav button{flex:1;padding:9px 12px}}
</style><main><h1>照片标注：先看显示效果</h1><p>独立提案。选择图形，填写或清空人工值；不会创建或提交真实标注。</p><nav aria-label="图形示例">${Object.entries(samples).map(([key,s])=>`<button type="button" data-tool="${key}" aria-pressed="false">${s.title}</button>`).join("")}</nav><div class="layout"><figure><svg viewBox="0 0 580 295" role="img" aria-label="所选图形的尺寸标注示例">${defs}<g id="shape" transform="translate(0 28)"></g><g id="labels" transform="translate(0 28)"></g></svg><figcaption id="hint"></figcaption></figure><aside><h2>标注与属性</h2><div id="fields"></div><p id="status" role="status"></p><button id="fill" type="button">填入示例人工值</button> <button id="clear" type="button">全部留空</button><small>这里的输入只改变示意图。实际产品的客户提交、工程师确认和历史记录尚未接入本示例。</small></aside></div><footer>OpenCV 目前未实现。此提案不增加识别管线、后端服务或网络请求。<br>照片中的夹角/像素长度不代表实物尺寸；椭圆也不能自动还原斜拍圆孔的孔径。<br><a href="annotation-tools.png">查看四种示例总图</a> · <a href="README.md">完整方案</a></footer></main><script>
const samples=${JSON.stringify(samples)};
let current='line',values=[];
const ns='http://www.w3.org/2000/svg',fields=document.getElementById('fields');
function redraw(){const s=samples[current];const labels=document.getElementById('labels');labels.replaceChildren();s.labels.forEach(p=>{const t=document.createElementNS(ns,'text');t.setAttribute('x',p.x);t.setAttribute('y',p.y);t.setAttribute('font-size','20');t.setAttribute('text-anchor','middle');t.setAttribute('fill','#2564a8');t.setAttribute('stroke','white');t.setAttribute('stroke-width','7');t.setAttribute('paint-order','stroke');t.textContent=values[p.key]?p.prefix+values[p.key]+(s.unit==='°'?'°':' mm'):p.pending;labels.append(t)});const missing=values.filter(v=>!v).length;document.getElementById('status').textContent=missing?'示意：还有 '+missing+' 个字段待补':'示意：已填写，真实产品仍按来源确认';}
function select(key){current=key;const s=samples[key];values=s.fields.map(()=> '');document.getElementById('shape').innerHTML=s.shape;document.getElementById('hint').textContent=s.hint;fields.replaceChildren();s.fields.forEach((name,i)=>{const l=document.createElement('label');l.textContent=name+'（'+s.unit+'）';const input=document.createElement('input');input.inputMode='decimal';input.placeholder='留空表示待补';input.maxLength=24;input.addEventListener('input',()=>{values[i]=input.value.trim();redraw()});l.append(input);fields.append(l)});document.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===key)));redraw()}
document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.tool)));
document.getElementById('fill').addEventListener('click',()=>{values=[...samples[current].values];fields.querySelectorAll('input').forEach((e,i)=>e.value=values[i]);redraw()});
document.getElementById('clear').addEventListener('click',()=>{values=values.map(()=> '');fields.querySelectorAll('input').forEach(e=>e.value='');redraw()});select('line');
</script></html>`;
await writeFile(new URL("preview.html",base),html);
console.log("Created proposal SVG, PNG and offline HTML. Product files and services unchanged.");
