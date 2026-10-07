// Native source-asset conversion. Geometry layout follows engine/geometry.cpp.
// CMFT is linked into assetc-web; no converter subprocess or engine DLL is used.
#include <cmft/image.h>
#include <cmft/cubemapfilter.h>
#include <cmft/dependency/stb/stb_image.h>
#include <cmath>
#include <cstring>
#include <map>
#include <thread>
#include <regex>
#include <lz4hc.h>

struct AssetOutputs {
  bool compress=true;
  json assets=json::object();
  std::map<std::string,std::string> objects;
  void add(const std::string &id,const std::string &kind,const std::string &bytes,json attributes=json::object()) {
    // Logical paths stay native; compressed storage has an explicit binary
    // extension so FTP clients do not treat extensionless shaders as text.
    const auto hash=sha256(bytes);std::string uri=id;
    attributes["kind"]=kind; attributes["sha256"]=hash;
    attributes["byteLength"]=bytes.size(); if(!attributes.contains("dependencies"))attributes["dependencies"]=json::array();
    // One independent raw LZ4 block per asset. The manifest supplies framing:
    // stored size/hash plus decoded size/hash, without changing logical paths.
    std::string stored=bytes;
    if(compress) {
      check(bytes.size()<=LZ4_MAX_INPUT_SIZE,"Asset exceeds LZ4 input limit: "+id);
      std::string packed(size_t(LZ4_compressBound(int(bytes.size()))),'\0');
      const auto size=LZ4_compress_HC(bytes.data(),packed.data(),int(bytes.size()),int(packed.size()),LZ4HC_CLEVEL_MAX);
      check(size>0,"LZ4 compression failed: "+id);
      if(size_t(size)<bytes.size()) {
        packed.resize(size_t(size));stored=std::move(packed);
        attributes["compression"]="lz4-block";
        uri+=".lz4";
        attributes["storedByteLength"]=stored.size();attributes["storedSha256"]=sha256(stored);
      }
    }
    attributes["uri"]=uri;assets[id]=attributes;objects[uri]=std::move(stored);
  }
};
struct GeometryReader {
  const std::string &bytes; size_t offset=0;
  void need(size_t n) { check(n<=bytes.size()-offset,"Truncated geometry"); }
  uint32_t u32() {need(4);const auto *p=reinterpret_cast<const unsigned char *>(bytes.data()+offset);offset+=4;return uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);}
  float f32() {const auto v=u32();float f;std::memcpy(&f,&v,4);check(std::isfinite(f),"Non-finite geometry attribute");return f;}
  std::vector<float> floats(size_t stride) {const auto count=u32();check(count<=4000000,"Geometry vector limit");need(count*stride*4);std::vector<float> out(count*stride);for(auto &v:out)v=f32();return out;}
  void skip(size_t stride) {const auto count=u32();check(count<=4000000,"Geometry vector limit");need(count*stride);offset+=count*stride;}
};
static json convert_geometry(const std::string &bytes) {
  GeometryReader r{bytes};check(r.u32()==0x46464748,"Invalid geometry magic");r.need(1);check(uint8_t(bytes[r.offset++])==0x20,"Invalid geometry marker");
  const auto version=r.u32();check(version<=2,"Unsupported geometry version");const auto positions=r.floats(3);
  const auto polygons=r.u32();check(polygons>0&&polygons<=1000000,"Invalid polygon count");r.need(polygons*2);
  std::vector<std::pair<unsigned,unsigned>> parts;size_t corners=0;
  for(size_t i=0;i<polygons;++i) {const auto n=uint8_t(bytes[r.offset++]),m=uint8_t(bytes[r.offset++]);check(n>=3,"Invalid polygon");parts.emplace_back(n,m);corners+=n;}
  check(r.u32()==corners&&corners<=4000000,"Invalid geometry bindings");std::vector<uint32_t> bindings(corners);
  for(auto &v:bindings){v=r.u32();check(v<positions.size()/3,"Invalid vertex binding");}
  const auto normals=r.floats(3);check(normals.size()==corners*3,"Source normals required");r.skip(16);
  const auto tangents=r.floats(6);check(tangents.empty()||tangents.size()==corners*6,"Invalid tangent frames");
  const auto uv=r.floats(2);check(uv.empty()||uv.size()==corners*2,"Invalid UV0");for(int i=1;i<8;++i)r.skip(8);
  if(version>0) {check(r.u32()==0&&r.u32()==0,"Skinned geometry unsupported");}
  check(r.offset==bytes.size(),"Unexpected geometry trailing data");
  json vertices=json::array(), indices=json::array(),submeshes=json::array();std::map<unsigned,std::vector<uint32_t>> groups;
  std::vector<float> lo(3,INFINITY),hi(3,-INFINITY);size_t base=0;
  for(const auto &part:parts) {
    for(unsigned i=0;i<part.first;++i) {
      const auto corner=base+i;
      for(int k=0;k<3;++k){const auto p=positions[bindings[corner]*3+k];vertices.push_back(p);lo[k]=std::min(lo[k],p);hi[k]=std::max(hi[k],p);}
      for(int k=0;k<3;++k)vertices.push_back(normals[corner*3+k]);
      vertices.push_back(uv.empty()?0.f:uv[corner*2]);vertices.push_back(uv.empty()?0.f:uv[corner*2+1]);
      if(!tangents.empty())for(int k=0;k<6;++k)vertices.push_back(tangents[corner*6+k]);
    }
    for(unsigned i=1;i+1<part.first;++i){auto &g=groups[part.second];g.push_back(uint32_t(base));g.push_back(uint32_t(base+i+1));g.push_back(uint32_t(base+i));}
    base+=part.first;
  }
  for(const auto &g:groups){submeshes.push_back({{"material",g.first},{"firstIndex",indices.size()},{"indexCount",g.second.size()}});for(auto i:g.second)indices.push_back(i);}
  return {{"schema","harfang-web-geometry/1"},{"stride",tangents.empty()?8:14},{"vertices",vertices},{"indices",indices},{"submeshes",submeshes},{"bounds",{{"min",lo},{"max",hi}}}};
}
struct CompilerImage : cmft::Image {
  CompilerImage()=default;CompilerImage(const CompilerImage &)=delete;
  ~CompilerImage(){if(m_data)cmft::imageUnload(*this);}
};
static void add_image(AssetOutputs &out,const std::string &id,CompilerImage &image,bool floating,bool anisotropic=false) {
  cmft::imageConvert(image,floating?cmft::TextureFormat::RGBA16F:cmft::TextureFormat::RGBA8);
  uint32_t offsets[6][MAX_MIP_NUM];cmft::imageGetMipOffsets(offsets,image);
  json levels=json::array();size_t total=0;
  for(unsigned face=0;face<image.m_numFaces;++face) for(unsigned mip=0;mip<image.m_numMips;++mip) {
    const auto w=std::max(1u,image.m_width>>mip),h=std::max(1u,image.m_height>>mip),size=w*h*(floating?8:4);
    check(offsets[face][mip]+size<=image.m_dataSize,"Invalid converted image range");total+=size;
    levels.push_back({{"face",face},{"mip",mip},{"width",w},{"height",h},{"offset",offsets[face][mip]},{"byteLength",size}});
  }
  check(total==image.m_dataSize,"Unexpected converted image storage");
  out.add(id,"texture",std::string(static_cast<const char *>(image.m_data),image.m_dataSize),
    {{"format",floating?"rgba16f":"rgba8"},{"faces",image.m_numFaces},{"mips",image.m_numMips},{"levels",levels},
      {"sampler",{{"wrap",image.m_numFaces==6?"clamp":"repeat"},{"anisotropic",anisotropic}}}});
}
static json image_meta(const fs::path &source,const std::string &name) {
  const auto path=source/fs::u8path(name+".meta");if(!fs::exists(path))return json::object();
  const auto meta=json::parse(read(path));check(meta.contains("profiles")&&meta["profiles"].contains("default"),"Invalid image metadata");
  return meta["profiles"]["default"];
}
static void compile_image(AssetOutputs &out,const fs::path &source,const std::string &name,const std::string &bytes,unsigned max_texture_size) {
  CompilerImage image;check(bytes.size()<=67108864,"Image input limit");
  const auto extension=fs::u8path(name).extension().string();
  const bool ldr=extension==".png"||extension==".jpg"||extension==".jpeg";
  if(extension==".dds") {
    check(bytes.size()>=128,"Truncated DDS header");
    GeometryReader header{bytes};check(header.u32()==0x20534444&&header.u32()==124,"Invalid DDS header");
    header.offset=12;const auto height=header.u32(),width=header.u32();header.offset=28;const auto mips=header.u32();
    header.offset=84;const auto format=header.u32();header.offset=112;const auto caps2=header.u32();
    check(width>0&&height>0&&width<=4096&&height<=4096&&mips>=1&&mips<=13&&(format==113||format==116),"DDS requires bounded RGBA16F/RGBA32F data");
    size_t expected=0;for(unsigned mip=0;mip<mips;++mip)expected+=size_t(std::max(1u,width>>mip))*std::max(1u,height>>mip)*(format==113?8:16);
    if(caps2&0x200)expected*=6;
    check(expected<=67108864&&bytes.size()>=128+expected,"Truncated/oversized DDS data");
  } else if(extension==".hdr") {
    const auto prefix=bytes.substr(0,4096);std::smatch dimensions;
    check(std::regex_search(prefix,dimensions,std::regex("-Y ([0-9]+) \\+X ([0-9]+)")),"Unsupported HDR orientation/header");
    const auto height=std::stoul(dimensions[1]),width=std::stoul(dimensions[2]);
    check(width>0&&height>0&&width<=4096&&height<=4096&&width*height<=4194304,"HDR dimension limit");
  } else if(extension==".png") {
    check(bytes.size()>=24&&bytes.substr(0,8)==std::string("\x89PNG\r\n\x1a\n",8),"Invalid PNG header");
    const auto be32=[&](size_t i){const auto *p=reinterpret_cast<const unsigned char *>(bytes.data()+i);return (uint32_t(p[0])<<24)|(uint32_t(p[1])<<16)|(uint32_t(p[2])<<8)|p[3];};
    const auto width=be32(16),height=be32(20);check(width>0&&height>0&&width<=4096&&height<=4096&&size_t(width)*height<=4194304,"PNG dimension limit");
  } else if(extension==".jpg"||extension==".jpeg") {
    int width=0,height=0,channels=0;
    check(bytes.size()>=3&&uint8_t(bytes[0])==0xff&&uint8_t(bytes[1])==0xd8&&
      stbi_info_from_memory(reinterpret_cast<const stbi_uc *>(bytes.data()),int(bytes.size()),&width,&height,&channels),"Invalid JPEG header: "+name);
    check(width>0&&height>0&&width<=4096&&height<=4096&&size_t(width)*height<=4194304,"JPEG dimension limit");
  }
  check(ldr?cmft::imageLoadStb(image,bytes.data(),uint32_t(bytes.size()),cmft::TextureFormat::RGBA32F):
    cmft::imageLoad(image,bytes.data(),uint32_t(bytes.size()),cmft::TextureFormat::RGBA32F),"Cannot decode image: "+name);
  check(image.m_width<=4096&&image.m_height<=4096,"Image dimension limit");
  const auto meta=image_meta(source,name);
  if(extension==".hdr") {
    for(const auto &field:meta.items())check(field.key()=="generate-probe"||field.key()=="max-probe-size"||field.key()=="radiance-edge-fixup","Unsupported HDR metadata: "+field.key());
    check(meta.value("generate-probe",false),"HDR requires generate-probe metadata");
    const auto size=meta.value("max-probe-size",256u);check(size>=16&&size<=256&&(size&(size-1))==0,"Probe face limit/power-of-two required");
    check(cmft::imageCubemapFromLatLong(image),"Expected lat-long HDR probe");cmft::imageResize(image,size,size);
    CompilerImage irradiance,radiance;
    check(cmft::imageIrradianceFilterSh(irradiance,size,image),"Irradiance generation failed");
    const auto threads=uint8_t(std::max(1u,std::min(8u,std::thread::hardware_concurrency())));
    check(cmft::imageRadianceFilter(radiance,size,cmft::LightingModel::Phong,false,9,20,0,image,
      meta.value("radiance-edge-fixup",false)?cmft::EdgeFixup::Warp:cmft::EdgeFixup::None,threads,nullptr),"Radiance generation failed");
    add_image(out,name+".irradiance",irradiance,true);add_image(out,name+".radiance",radiance,true);
  } else {
    for(const auto &field:meta.items())check(((field.key()=="min-filter"||field.key()=="mag-filter")&&(field.value()=="Linear"||field.value()=="Anisotropic"))||
      (field.key()=="compression"&&(field.value()=="BC2"||field.value()=="BC3"||field.value()=="BC5"||field.value()=="ETC1"))||
      (ldr&&field.key()=="type"&&(field.value()=="NormalMap"||field.value()=="Standard"))||
      (ldr&&field.key()=="max-size"&&field.value().is_number_integer()&&field.value().get<int>()>0&&field.value().get<int>()<=16384),
      "Unsupported texture metadata: "+field.key());
    if(ldr) {
      const auto limit=std::min(max_texture_size?max_texture_size:16384u,meta.value("max-size",16384u));
      if(std::max(image.m_width,image.m_height)>limit) {
        const float scale=float(limit)/std::max(image.m_width,image.m_height);
        cmft::imageResize(image,std::max(1u,unsigned(image.m_width*scale)),std::max(1u,unsigned(image.m_height*scale)));
      }
      cmft::imageGenerateMipMapChain(image);
    }
    const bool anisotropic=meta.value("min-filter",std::string())=="Anisotropic"||meta.value("mag-filter",std::string())=="Anisotropic";
    add_image(out,name,image,extension==".dds",anisotropic);
    if(meta.contains("type"))out.assets[name]["sourceTextureType"]=meta["type"];
    if(meta.contains("compression")) {
      out.assets[name]["sourceCompression"]=meta["compression"];
      std::cerr<<"assetc-web: warning: "<<name<<": native "<<meta["compression"].get<std::string>()<<" target replaced by portable RGBA8.\n";
    }
  }
}
static std::set<std::string> scene_dependencies(const json &scene,bool animation_stubs) {
  std::set<std::string> deps;
  for(const auto &field:{"scripts","scene_scripts","rigid_bodies","collisions"})
    check(!scene.contains(field)||scene[field].empty(),std::string("Unsupported scene content: ")+field);
  for(const auto &field:{"anims","scene_anims"})if(scene.contains(field)&&!scene[field].empty())
    check(animation_stubs,"Animation playback unsupported; opt in with --animation-stubs to retain tracks without playback");
  if(scene.contains("instances"))for(const auto &instance:scene["instances"]) {
    for(const auto &field:instance.items())check(field.key()=="name"||field.key()=="anim"||field.key()=="loop_mode","Unsupported instance field: "+field.key());
    deps.insert(instance.at("name").get<std::string>());
    if(instance.contains("anim")&&!instance["anim"].get<std::string>().empty())check(animation_stubs,"Instance animation requires --animation-stubs");
  }
  check(scene.contains("nodes")&&scene["nodes"].is_array()&&scene["nodes"].size()<=16384,"Invalid scene nodes");
  if(scene.contains("objects"))for(const auto &object:scene["objects"]) {
    check(!object.contains("bones")||object["bones"].empty(),"Skinned object unsupported");deps.insert(object.at("name").get<std::string>());
    for(const auto &material:object.at("materials")) {
      check(material.at("program")=="core/shader/pbr.hps","Static scene profile requires the reviewed PBR family");
      deps.insert(material.at("program").get<std::string>());
      const auto blend=material.value("blend_mode",std::string("opaque"));
      check(blend=="opaque"||blend=="alpha","Native scene profile supports opaque and alpha materials");
      check(!material.contains("flags")||material["flags"].empty(),"Unsupported material variant flags");
      if(material.contains("textures"))for(const auto &texture:material["textures"]) {
        const auto sampler=texture.at("name").get<std::string>();
        if(sampler=="uSelfMap"&&(!texture.contains("path")||texture["path"].get<std::string>().empty()))continue;
        check(sampler=="uBaseOpacityMap"||sampler=="uNormalMap"||sampler=="uOcclusionRoughnessMetalnessMap","Unsupported PBR material map: "+sampler);
        if(texture.contains("path")&&!texture["path"].get<std::string>().empty())deps.insert(texture["path"].get<std::string>());
      }
    }
  }
  if(scene.contains("environment")){
    const auto &env=scene["environment"];
    if(env.contains("probe")) {
      const auto &probe=env["probe"];check(probe.value("parallax",0.f)==0.f,"Parallax-corrected probes unsupported");
      for(const auto &name:{"irradiance_map","radiance_map"})if(probe.contains(name)&&!probe[name].get<std::string>().empty())deps.insert(probe[name].get<std::string>());
    }
    for(const auto &name:{"brdf_map","irradiance_map","radiance_map"})if(env.contains(name)&&!env[name].get<std::string>().empty())deps.insert(env[name].get<std::string>());
  }
  return deps;
}
