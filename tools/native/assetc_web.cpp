// Standalone native program-asset slice. No engine, Python or external encoder at runtime.
#include "json/json.hpp"
#include "sha256.h"
#include "embedded.h"
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <cwchar>
#include <cmft/print.h>

namespace fs = std::filesystem;
using json = nlohmann::json;
static void check(bool ok, const std::string &message) { if(!ok) throw std::runtime_error(message); }
static int quiet_print(const char *,...) {return 0;}
static std::string read(const fs::path &p) {
  std::ifstream in(p,std::ios::binary); check(bool(in),"Missing source dependency: "+p.u8string());
  return {std::istreambuf_iterator<char>(in),std::istreambuf_iterator<char>()};
}
static void write(const fs::path &p,const std::string &data) {
  fs::create_directories(p.parent_path()); std::ofstream out(p,std::ios::binary);
  out.write(data.data(),data.size()); check(bool(out),"Cannot write: "+p.u8string());
}
static std::string lf(std::string s) { for(size_t i=0;(i=s.find("\r\n",i))!=std::string::npos;) s.erase(i,1); return s; }
static bool contains(const fs::path &parent,const fs::path &child) {
  auto a=parent.begin(), b=child.begin();
  for(;a!=parent.end();++a,++b) {
    if(b==child.end()) return false;
#ifdef _WIN32
    if(_wcsicmp(a->c_str(),b->c_str())!=0) return false;
#else
    if(*a!=*b) return false;
#endif
  }
  return true;
}
#include "scene_assets.h"
static void publish(const fs::path &output,const AssetOutputs &compiled,const json &manifest) {
  const auto parent=output.parent_path();
  const auto staging=parent/fs::u8path(output.filename().u8string()+".building");
  const auto backup=parent/fs::u8path(output.filename().u8string()+".previous");
  const auto marker=fs::path(".assetc-web-program-output");
  // These directories are compiler-owned. Verify exact resolved sibling paths
  // and reject links before renaming or recursively removing an output tree.
  const auto owned=[&](const fs::path &path) {
    check((path==output||path==staging||path==backup)&&fs::weakly_canonical(path)==path&&path.parent_path()==parent,"Unsafe compiler output path");
    check(fs::is_regular_file(path/marker),"Refusing unmarked output: "+path.u8string());
    for(const auto &entry:fs::recursive_directory_iterator(path))check(!entry.is_symlink(),"Links are unsupported in compiler outputs");
  };
  if(fs::exists(output))owned(output);
  check(!fs::exists(staging)&&!fs::exists(backup),"Interrupted publication needs recovery: "+staging.u8string()+" or "+backup.u8string());
  bool saved=false;
  try {
    fs::create_directories(staging);write(staging/marker,"assetc-web/program-1\n");
    for(const auto &payload:compiled.objects)write(staging/fs::u8path(payload.first),payload.second);
    write(staging/"manifest.json",manifest.dump(2)+"\n");
    owned(staging);
    if(fs::exists(output)){owned(output);fs::rename(output,backup);saved=true;}
    try {fs::rename(staging,output);}
    catch(...){if(saved){owned(backup);fs::rename(backup,output);}throw;}
  } catch(...) {
    if(fs::exists(staging)&&fs::is_regular_file(staging/marker)){owned(staging);fs::remove_all(staging);}
    throw;
  }
  if(saved){owned(backup);fs::remove_all(backup);}
}
static int run(const std::vector<std::string> &args) {
  bool quiet=false,verbose=false,progress=false,animation_stubs=false,compress=true;
  unsigned max_texture_size=0;
  std::vector<fs::path> paths;
  for(size_t i=0;i<args.size();++i) {
    const auto &arg=args[i];
    if(arg=="--help" || arg=="-h") {
      std::cout<<"assetc-web [options] <input-directory> [output-directory]\n"
        "Reviewed default/PBR/line programs, static scenes/geometry, PNG/JPEG/DDS and HDR probes.\n"
        "-q/-quiet -v/-verbose -progress -j/-job N -l/-log_errors_to_stderr\n"
        "--animation-stubs: legacy opt-out from rigid node animation playback\n"
        "--max-texture-size N: resize PNG/JPEG before mip generation (default: original size)\n"
        "--compression lz4|none: lossless asset transport (default: LZ4 HC level 12)\n"
        "Fixed WebGL 2 target; unsupported options/content fail.\n"; return 0;
    } else if(arg=="-q" || arg=="-quiet") quiet=true;
    else if(arg=="-v" || arg=="-verbose") verbose=true;
    else if(arg=="-progress") progress=true;
    else if(arg=="-l" || arg=="-log_errors_to_stderr") {}
    else if(arg=="--animation-stubs")animation_stubs=true;
    else if(arg=="--compression") {
      check(++i<args.size()&&(args[i]=="lz4"||args[i]=="none"),"Expected compression lz4 or none");
      compress=args[i]=="lz4";
    }
    else if(arg=="--max-texture-size") {
      check(++i<args.size()&&!args[i].empty()&&args[i].find_first_not_of("0123456789")==std::string::npos,"Expected texture size");
      max_texture_size=unsigned(std::stoul(args[i]));
      check(max_texture_size>=16&&max_texture_size<=4096&&(max_texture_size&(max_texture_size-1))==0,"Texture size must be a power of two from 16 to 4096");
    }
    else if(arg=="-j" || arg=="-job") {
      check(++i<args.size(),"Missing job count");
      check(!args[i].empty() && args[i].find_first_not_of("0123456789")==std::string::npos,"Invalid job count");
      // A single program compilation task; all requested worker counts have the same result.
    } else { check(arg.empty() || arg[0]!='-',"Unsupported option: "+arg); paths.push_back(fs::u8path(arg)); }
  }
  check(paths.size()==1 || paths.size()==2,"Usage: assetc-web [options] <input-directory> [output-directory]");
  if(quiet)cmft::setInfoPrintf(quiet_print);
  const auto source=fs::weakly_canonical(fs::absolute(paths[0]));
  const auto output=fs::weakly_canonical(fs::absolute(paths.size()==2 ? paths[1] : fs::u8path(paths[0].u8string()+"_compiled")));
  check(fs::is_directory(source),"Input is not a directory");
  check(!contains(source,output) && !contains(output,source),"Source and output must be disjoint");
  for(const auto &suffix:{".building",".previous"}) {
    const auto sibling=fs::weakly_canonical(fs::u8path(output.u8string()+suffix));
    check(!contains(source,sibling)&&!contains(sibling,source),"Publication directories must be disjoint from source");
  }
  auto approved=json::parse(approved_sources);
  const bool scene_profile=fs::exists(source/"core/shader/pbr.hps");
  if(scene_profile) {const auto extra=json::parse(scene_approved_sources);for(auto it=extra.begin();it!=extra.end();++it)approved[it.key()]=it.value();}
  json source_hashes=json::object();
  for(auto it=approved.begin();it!=approved.end();++it) {
    const auto p=source/fs::u8path(it.key());
    check(contains(source,fs::canonical(p)),"Source dependency escapes input: "+it.key());
    auto bytes=read(p);
    check(sha256(lf(bytes))==it.value().get<std::string>(),"Unreviewed shader source: "+it.key()+"; update the Web adapter and its provenance first");
    source_hashes[it.key()]=sha256(bytes);
  }
  AssetOutputs compiled;compiled.compress=compress;std::vector<std::pair<std::string,std::string>> inputs;
  for(const auto &entry:fs::recursive_directory_iterator(source)) {
    check(!entry.is_symlink(),"Symbolic links are unsupported in compiler inputs");
    if(!entry.is_regular_file())continue;
    const auto name=fs::relative(entry.path(),source).generic_u8string();
    check(contains(source,fs::canonical(entry.path())),"Input escapes source directory");
    if(approved.contains(name))continue;
    const auto extension=entry.path().extension().string();
    check(scene_profile&&(extension==".scn"||extension==".geo"||extension==".png"||extension==".jpg"||extension==".jpeg"||extension==".dds"||extension==".hdr"||extension==".meta"),"Unsupported input: "+name);
    auto data=read(entry.path());source_hashes[name]=sha256(data);inputs.emplace_back(name,std::move(data));
  }
  json program={{"schema","harfang-web-program/1"},{"adapter","default-spot-instanced/1"},
    {"logicalId","core/shader/default.hps"},{"sourceHashes",source_hashes},
    {"variants",{"untextured-unskinned"}},
    {"requires",{"render.forward","render.spot-shadow","render.draw-instancing"}},
    {"forward",{{"vertex",default_vertex},{"fragment",default_fragment}}},
    {"depth",{{"vertex",depth_vertex},{"fragment",depth_fragment}}}};
  auto bytes=program.dump(2)+"\n", digest=sha256(bytes);
  compiled.add("core/shader/default.hps","program",bytes);
  if(scene_profile) {
    json pbr={{"schema","harfang-web-program/1"},{"adapter","pbr-scene-instanced/3"},{"logicalId","core/shader/pbr.hps"},{"sourceHashes",source_hashes},
      {"variants",{"pbr-maps-unskinned"}},{"requires",{"render.forward","render.directional-shadow","render.spot-shadow","render.environment","render.textures","render.alpha-blend"}},
      {"forward",{{"vertex",pbr_vertex},{"fragment",pbr_fragment}}},{"depth",{{"vertex",depth_vertex},{"fragment",depth_fragment}}}};
    compiled.add("core/shader/pbr.hps","program",pbr.dump(2)+"\n");
    json line={{"schema","harfang-web-program/1"},{"adapter","pos-rgb/1"},{"logicalId","shaders/pos_rgb"},{"sourceHashes",source_hashes},
      {"variants",{"color"}},{"requires",{"render.lines"}},{"forward",{{"vertex",line_vertex},{"fragment",line_fragment}}}};
    compiled.add("shaders/pos_rgb","program",line.dump(2)+"\n");
    for(const auto &input:inputs) {
      const auto extension=fs::u8path(input.first).extension().string();
      if(extension==".geo")compiled.add(input.first,"geometry",convert_geometry(input.second).dump()+"\n");
      else if(extension==".scn") {
        const auto scene=json::parse(input.second);const auto deps=scene_dependencies(scene,animation_stubs);
        compiled.add(input.first,"scene",scene.dump()+"\n",{{"dependencies",deps}});
      } else if(extension!=".meta")compile_image(compiled,source,input.first,input.second,max_texture_size);
    }
    for(const auto &entry:compiled.assets.items())for(const auto &dep:entry.value()["dependencies"])
      check(compiled.assets.contains(dep.get<std::string>()),"Missing compiled dependency: "+dep.get<std::string>());
  }
  json manifest={{"schema","harfang-web-program-assets/1"},{"api","harfang-js/1"},
    {"profile","web-native-forward/1"},{"compiler","assetc-web/program-1"},
    {"buildId",digest},{"maxNodes",16384}};
  manifest["assets"]=compiled.assets;manifest["sourceHashes"]=source_hashes;
  if(animation_stubs){manifest["animationPlayback"]="stub";std::cerr<<"assetc-web: warning: animation playback is stubbed; tracks are preserved but will not play.\n";}
  manifest["maxTextureSize"]=max_texture_size;
  if(scene_profile){manifest["profile"]="web-native-scene/1";manifest["compiler"]="assetc-web/scene-1";manifest["buildId"]=sha256(compiled.assets.dump());
    if(!animation_stubs)manifest["animationPlayback"]="scene-trs/1";}
  // Validate/compile everything first, then replace the complete owned output.
  // Stable filenames can change bytes, and obsolete hashed files disappear.
  publish(output,compiled,manifest);
  if(!quiet) std::cout<<"Compiled "<<compiled.assets.size()<<" assets, "<<source_hashes.size()<<" source files -> "<<output.u8string()<<"\n";
  if(verbose && !quiet) std::cout<<"SHA256 "<<digest<<"\n";
  if(progress && !quiet) std::cout<<"100%\n";
  return 0;
}
#ifdef _WIN32
int wmain(int argc,wchar_t **argv) {
  std::vector<std::string> args;
  for(int i=1;i<argc;++i) args.push_back(fs::path(argv[i]).u8string());
#else
int main(int argc,char **argv) {
  std::vector<std::string> args(argv+1,argv+argc);
#endif
  try { return run(args); }
  catch(const std::exception &e) { std::cerr<<"assetc-web: "<<e.what()<<"\n"; return 1; }
}
