// One API fixture, executed without edits by native HG JS and HG JS Web.
import * as hg from 'harfang';
import {runWindow} from './js/window.js';

export function main(options={}) {
  globalThis.flightContract={};
  return runWindow('Mouse Flight native/Web contract',()=>{
    const report=globalThis.flightContract,xyz=v=>[v.x,v.y,v.z],rgba=v=>[v.r,v.g,v.b,v.a];
    report.constants=[hg.LSSF_Nodes,hg.LSSF_Scene,hg.LSSF_Anims,hg.LSSF_All,hg.RF_MSAA8X,hg.CF_Depth,hg.BM_Alpha,hg.DT_Less,hg.FC_Disabled];
    report.math=[[0,0,0],[0,0,1],[1,2,3],[0,1,0],[0,-1,0],[-2,.5,-1]].map(v=>{
      const matrix=hg.Mat3LookAt(new hg.Vec3(...v));return [xyz(hg.GetX(matrix)),xyz(hg.GetY(matrix)),xyz(hg.GetZ(matrix)),xyz(hg.ToEuler(matrix))];
    });
    report.clamp=[hg.Clamp(-5,.1,50),hg.Clamp(70,.1,50),hg.Clamp(3,.1,50)];
    report.renderState=hg.ComputeRenderState(hg.BM_Alpha,hg.DT_Less,hg.FC_Disabled) instanceof hg.RenderState;
    const mouse=new hg.Mouse();report.initialMouse=[mouse.X(),mouse.Y(),mouse.DtX(),mouse.DtY(),mouse.Down(0),mouse.Pressed(0),mouse.Released(0),mouse.Wheel(),mouse.HWheel()];
    const scene=new hg.Scene(),resources=new hg.PipelineResources(),pipeline=hg.CreateForwardPipeline(256),info=hg.GetForwardPipelineInfo();
    report.load=hg.LoadSceneFromAssets('playground/playground.scn',scene,resources,info);
    report.loaded=[scene.GetNodeCount(),scene.GetAllNodeCount(),scene.GetNodes().length,scene.GetAllNodes().length];
    report.environmentTexture=[scene.environment.brdf_map instanceof hg.TextureRef,resources.GetTextureName(scene.environment.brdf_map)];
    const environment=rgba(scene.canvas.color);
    const [root,ok]=hg.CreateInstanceFromAssets(scene,hg.TranslationMat4(new hg.Vec3(0,4,0)),'paper_plane/paper_plane.scn',resources,info);
    const view=root.GetInstanceSceneView(),children=view.GetNodes(scene),child=children.get(0);
    report.nodeList=[children instanceof hg.NodeList,Array.isArray(children),typeof children.size(),children.size(),children.length,children.at(0).GetName()];
    report.instance=[ok,root.GetName(),root.GetInstance().GetPath(),scene.GetNodeCount(),scene.GetAllNodeCount(),scene.GetNodes().length,scene.GetAllNodes().length,
      Array.from({length:children.length},(_,i)=>children.get(i).GetName()),child.GetTransform().GetParent().GetName(),child.IsInstantiatedBy().GetName(),view.GetNode(scene,'Shape').IsValid(),view.GetNode(scene,'missing').IsValid(),environment,rgba(scene.canvas.color)];
    root.Disable();report.disabled=[root.IsEnabled(),child.IsEnabled(),child.IsItselfEnabled()];
    child.Disable();root.Enable();report.enabled=[root.IsEnabled(),child.IsEnabled(),child.IsItselfEnabled()];child.Enable();
    const camera=hg.CreateCamera(scene,hg.TranslationMat4(new hg.Vec3(0,4,-5)),.01,1000);scene.SetCurrentCamera(camera);report.cameraName=camera.GetName();
    const transform=root.GetTransform();report.initialWorld=xyz(hg.GetT(transform.GetWorld()));scene.Update(0n);
    transform.SetPos(new hg.Vec3(1,4,2));report.staleWorld=xyz(hg.GetT(transform.GetWorld()));scene.Update(0n);report.updatedWorld=xyz(hg.GetT(transform.GetWorld()));
    const loose=scene.CreateTransform(new hg.Vec3(7,8,9));scene.ReadyWorldMatrices();scene.ComputeWorldMatrices();report.looseWorld=xyz(hg.GetT(loose.GetWorld()));scene.DestroyTransform(loose);
    const ground=scene.GetNode('Plane').GetObject(),material=ground.GetMaterial(0),texture=hg.GetMaterialTexture(material,'uBaseOpacityMap');
    report.texture=[texture instanceof hg.TextureRef,resources.GetTextureName(texture),resources.GetTextureName(resources.HasTexture('missing'))];
    hg.SetMaterialTexture(material,'uBaseOpacityMap',texture,0);hg.SetMaterialBlendMode(material,hg.BM_Opaque);hg.SetMaterialDepthTest(material,hg.DT_Less);hg.SetMaterialFaceCulling(material,hg.FC_Disabled);
    const [missing,missingOK]=hg.CreateInstanceFromAssets(scene,hg.Mat4.Identity,'missing.scn',resources,info);
    report.missing=[missingOK,missing.IsValid(),missing.GetInstance().GetPath(),hg.LoadSceneFromAssets('missing.scn',scene,resources,info)];scene.DestroyNode(missing);
    report.submissions=[];
    return {
      draw(dt,width,height) {
        scene.Update(dt);const result=hg.SubmitSceneToPipeline(7,scene,new hg.IntRect(0,0,width,height),true,pipeline,resources);
        report.submissions.push([result[0],result[1] instanceof hg.SceneForwardPipelinePassViewId,
          ...[hg.SFPP_Opaque,hg.SFPP_Transparent,hg.SFPP_Slot0LinearSplit0].map(pass=>hg.GetSceneForwardPipelinePassViewId(result[1],pass))]);
      },
      dispose() {
        scene.DestroyNode(root);report.destroyRoot=[child.IsValid(),child.IsInstantiatedBy().IsValid(),scene.GetNodeCount(),scene.GetAllNodeCount(),scene.GetNodes().length,scene.GetAllNodes().length];
        scene.Clear();report.cleared=[scene.GetNodeCount(),scene.GetAllNodeCount(),root.IsValid(),child.IsValid(),resources.GetTextureName(texture)];
        resources.DestroyAllTextures();resources.DestroyAllModels();resources.DestroyAllPrograms();hg.DestroyForwardPipeline(pipeline);
        report.destroyedTexture=resources.GetTextureName(texture);
        console.log('FLIGHT_CONTRACT '+JSON.stringify(report,(_,v)=>typeof v==='bigint'?{bigint:String(v)}:v));
      }
    };
  },{...options,frameLimit:2});
}
