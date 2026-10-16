'use client';
import {useEffect,useRef,useState} from 'react';
import dynamic from 'next/dynamic';
import type Konva from 'konva';
import {model,restore,serialize,type Model,type Point} from '../geometry';

type View={zoom:number;panX:number;panY:number;rotation:number};
type Snapshot={width:number;height:number;fit:number;view:View;geometry:Model;line:number[];circle:{x:number;y:number;radiusX:number;radiusY:number};point:Point;serialized:string};
declare global {interface Window {__partMeasureLab?: {view:(v:View)=>void;loadFixture:(s:string)=>void;snapshot:()=>Snapshot;roundTrip:(p:Point)=>Point;reload:()=>void;canvas:()=>string;ready:boolean}}}

const Scene=dynamic(()=>import('./scene'),{ssr:false});
export default function Lab(){
  const host=useRef<HTMLDivElement>(null);
  const group=useRef<Konva.Group>(null);
  const stage=useRef<Konva.Stage>(null);
  const [width,setWidth]=useState(640);
  const [view,setView]=useState<View>({zoom:1,panX:0,panY:0,rotation:0});
  const [geometry,setGeometry]=useState<Model>(model);
  const [image,setImage]=useState<HTMLImageElement|null>(null);
  useEffect(()=>{
    const saved=sessionStorage.getItem('p0-0-konva-fixture');
    if(saved)setGeometry(restore(saved));
  },[]);
  useEffect(()=>{
    const img=new window.Image();img.onload=()=>setImage(img);img.src='/fixtures/640x480-o6-canonical.jpg';
    return()=>{img.onload=null;};
  },[]);
  useEffect(()=>{
    if(!host.current)return;
    const observer=new ResizeObserver(([entry])=>{if(entry)setWidth(Math.min(1000,Math.floor(entry.contentRect.width)));});
    observer.observe(host.current);return()=>observer.disconnect();
  },[]);
  const height=Math.round(width*0.75);
  const fit=width/640;
  useEffect(()=>{
    if(!image)return;
    window.__partMeasureLab={
      get ready(){return !!group.current;},
      view:setView,
      loadFixture:(s)=>setGeometry(restore(s)),
      snapshot:()=>{
        const line=group.current?.findOne<Konva.Line>('Line');
        const circle=group.current?.findOne<Konva.Ellipse>('Ellipse');
        const point=group.current?.findOne<Konva.Circle>('Circle');
        if(!line||!circle||!point)throw new Error('Shapes not mounted');
        return{width,height,fit,view,geometry,line:line.points(),circle:{x:circle.x(),y:circle.y(),radiusX:circle.radiusX(),radiusY:circle.radiusY()},point:{x:point.x(),y:point.y()},serialized:serialize(geometry)};
      },
      roundTrip:(p)=>{
        if(!group.current)throw new Error('Canvas not mounted');
        const t=group.current.getAbsoluteTransform();const screen=t.point({x:p.x*640,y:p.y*480});const restored=t.copy().invert().point(screen);
        return{x:restored.x/640,y:restored.y/480};
      },
      reload:()=>{const saved=serialize(geometry);sessionStorage.setItem('p0-0-konva-fixture',saved);setGeometry(restore(saved));},
      canvas:()=>{if(!stage.current)throw new Error('Canvas not mounted');return stage.current.toDataURL({pixelRatio:1});},
    };
    return()=>{delete window.__partMeasureLab;};
  },[image,width,height,fit,view,geometry]);
  return <div ref={host}><output data-testid="state">{JSON.stringify({width,height,fit,view,loaded:!!image})}</output><Scene stageRef={stage} groupRef={group} image={image} width={width} height={height} scale={fit*view.zoom} view={view} geometry={geometry}/></div>;
}
