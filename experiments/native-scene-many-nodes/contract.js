// Executed unchanged by native HG JS and the Web facade. No Web-only hg calls.
import * as hg from 'harfang';
import {runWindow} from './js/window.js';

export function main(options={}) {
  return runWindow('Native/Web API contract',()=>{
    const pipeline=hg.CreateForwardPipeline(256), resources=new hg.PipelineResources(), scene=new hg.Scene();
    const xyz=v=>[v.x,v.y,v.z], color=v=>[v.r,v.g,v.b,v.a];
    const report={constants:[hg.LT_Point,hg.LT_Spot,hg.LT_Linear,hg.LST_None,hg.LST_Map,hg.RF_VSync,hg.RF_MSAA4X]};
    const rect=new hg.IntRect(2,3,4,5); report.rect=[rect.sx,rect.sy,rect.ex,rect.ey];
    const v4=new hg.Vec4(1,0.8,0);report.vec4=[v4.x,v4.y,v4.z,v4.w];
    const camera=hg.CreateCamera(scene,hg.TransformationMat4(new hg.Vec3(0,1,-5),new hg.Vec3()),0.01,100);
    scene.SetCurrentCamera(camera);
    report.camera=[camera.GetCamera().GetZNear(),camera.GetCamera().GetZFar(),camera.GetCamera().GetFov()];
    const lightNode=hg.CreateSpotLight(scene,hg.TransformationMat4(new hg.Vec3(0,5,-5),hg.Deg3(45,0,0)),0,hg.Deg(5),hg.Deg(30),hg.Color.White,hg.Color.White,0,hg.LST_Map,0.000005);
    const light=lightNode.GetLight();
    report.light=[light.GetType(),light.GetRadius(),light.GetInnerAngle(),light.GetOuterAngle(),light.GetShadowType(),light.GetShadowNear(),light.GetShadowFar(),light.GetDiffuseIntensity(),light.GetSpecularIntensity()];
    const model=hg.CreateSphereModel(hg.VertexLayoutPosFloatNormUInt8(),0.1,8,16), ref=resources.AddModel('sphere',model);
    const program=hg.LoadPipelineProgramRefFromAssets('core/shader/default.hps',resources,hg.GetForwardPipelineInfo());
    const material=hg.CreateMaterial(program,'uDiffuseColor',new hg.Vec4(1,0,0),'uSpecularColor',new hg.Vec4(1,0.8,0));
    const node=hg.CreateObject(scene,hg.TranslationMat4(new hg.Vec3(1,2,3)),ref,[material]), transform=node.GetTransform();
    report.resources=[ref instanceof hg.ModelRef,program instanceof hg.PipelineProgramRef,
      resources.GetModelName(node.GetObject().GetModelRef()),resources.GetModelName(resources.HasModel('sphere')),
      resources.GetModelName(resources.AddModel('sphere',model)),resources.GetModelName(resources.HasModel('missing')),
      resources.GetProgramName(program),node.GetObject().GetMaterialCount()];
    const component=scene.CreateObject(ref,[material]);
    report.resources.push(resources.GetModelName(component.GetModelRef()));scene.DestroyObject(component);
    const copy=transform.GetPos();copy.x=99;report.getterCopy=xyz(transform.GetPos());
    const position=new hg.Vec3(4,5,6);transform.SetPos(position);position.y=99;
    scene.Update(16666667n);report.setterCopy=xyz(transform.GetPos());report.world=xyz(hg.GetT(transform.GetWorld()));
    const parent=scene.CreateNode();parent.SetTransform(scene.CreateTransform(new hg.Vec3(1,2,3)));
    transform.SetParent(parent);scene.Update(16666667n);report.parentWorld=xyz(hg.GetT(transform.GetWorld()));
    parent.GetTransform().SetPos(new hg.Vec3(4,3,2));scene.Update(16666667n);
    report.movedParentWorld=xyz(hg.GetT(transform.GetWorld()));transform.ClearParent();
    report.submissions=[];
    return {
      draw(dt,width,height) {
        report.time=[typeof dt,String(dt),hg.time_to_sec_f(dt)];scene.Update(dt);
        const result=hg.SubmitSceneToPipeline(7,scene,new hg.IntRect(0,0,width,height),true,pipeline,resources);
        report.submissions.push([result[0],result[1] instanceof hg.SceneForwardPipelinePassViewId,
          ...[hg.SFPP_Opaque,hg.SFPP_Transparent,hg.SFPP_Slot1Spot,hg.SFPP_DepthPrepass].map(pass=>hg.GetSceneForwardPipelinePassViewId(result[1],pass))]);
        if(report.submissions.length===1) light.SetShadowType(hg.LST_None);
        if(report.submissions.length===2) scene.DestroyLight(light);
      },
      dispose() {
        scene.canvas.color=new hg.Color(0.2,0.3,0.4,1);scene.Clear();
        report.clear=[scene.GetNodeCount(),node.IsValid(),transform.IsValid(),scene.GetCurrentCamera().IsValid(),color(scene.canvas.color)];
        scene.CreateNode('reused');report.reusedCount=scene.GetNodeCount();scene.Clear();
        resources.DestroyAllTextures();resources.DestroyAllModels();resources.DestroyAllPrograms();hg.DestroyForwardPipeline(pipeline);
        report.destroyedName=resources.GetModelName(ref);
        globalThis.manyNodesContract=report;console.log('MANY_NODES_CONTRACT '+JSON.stringify(report,(_,value)=>typeof value==='bigint'?{bigint:String(value)}:value));
      }
    };
  },{...options,frameLimit:3});
}
