// Experiment-only data; no annotation CRUD, editing tools or measurement requests.
export type Point={x:number;y:number};
export type Model={schemaVersion:1;line:{from:Point;to:Point};circle:{center:Point;radiusX:number;radiusY:number};point:Point};
export const model:Model={schemaVersion:1,line:{from:{x:0.15,y:0.3},to:{x:0.85,y:0.3}},circle:{center:{x:0.5,y:0.65},radiusX:0.08,radiusY:0.08*640/480},point:{x:0.8,y:0.8}};
export const serialize=(value:Model)=>JSON.stringify(value);
export function restore(input:string):Model {
  const value=JSON.parse(input) as Model;
  if(value.schemaVersion!==1)throw new Error('Unsupported lab schema');
  for(const p of [value.line.from,value.line.to,value.circle.center,value.point]) if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)throw new Error('Invalid normalized point');
  return value;
}
