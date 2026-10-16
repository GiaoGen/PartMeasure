'use client';
import type {RefObject} from 'react';
import type Konva from 'konva';
import {Stage,Layer,Group,Image,Line,Ellipse,Circle} from 'react-konva';
import type {Model} from '../geometry';

export default function Scene({stageRef,groupRef,image,width,height,scale,view,geometry}: {
  stageRef:RefObject<Konva.Stage|null>;groupRef:RefObject<Konva.Group|null>;image:HTMLImageElement|null;
  width:number;height:number;scale:number;view:{panX:number;panY:number;rotation:number};geometry:Model;
}) {
  return <Stage ref={stageRef} width={width} height={height}><Layer><Group ref={groupRef} x={view.panX} y={view.panY} rotation={view.rotation} scaleX={scale} scaleY={scale}>
    {image?<Image image={image} width={640} height={480}/>:null}
    <Line points={[geometry.line.from.x*640,geometry.line.from.y*480,geometry.line.to.x*640,geometry.line.to.y*480]} stroke="#fff" strokeWidth={3}/>
    <Ellipse x={geometry.circle.center.x*640} y={geometry.circle.center.y*480} radiusX={geometry.circle.radiusX*640} radiusY={geometry.circle.radiusY*480} stroke="#fff" strokeWidth={3}/>
    <Circle x={geometry.point.x*640} y={geometry.point.y*480} radius={5} fill="#fff"/>
  </Group></Layer></Stage>;
}
