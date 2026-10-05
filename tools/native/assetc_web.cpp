// Standalone native program-asset slice. No engine, Python or external encoder at runtime.
#include "json/json.hpp"
#include "sha256.h"
#include "embedded.h"
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <cwchar>

namespace fs = std::filesystem;
using json = nlohmann::json;
static void check(bool ok, const std::string &message) { if(!ok) throw std::runtime_error(message); }
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
static int run(const std::vector<std::string> &args) {
  bool quiet=false,verbose=false,progress=false;
  std::vector<fs::path> paths;
  for(size_t i=0;i<args.size();++i) {
    const auto &arg=args[i];
    if(arg=="--help" || arg=="-h") {
      std::cout<<"assetc-web [options] <input-directory> [output-directory]\n"
        "Program pilot: reviewed default.hps, untextured forward + spotlight shadows.\n"
        "-q/-quiet -v/-verbose -progress -j/-job N -l/-log_errors_to_stderr\n"
        "Fixed WebGL 2 target; unsupported options/content fail. Native scenes/textures/HDR pending.\n"; return 0;
    } else if(arg=="-q" || arg=="-quiet") quiet=true;
    else if(arg=="-v" || arg=="-verbose") verbose=true;
    else if(arg=="-progress") progress=true;
    else if(arg=="-l" || arg=="-log_errors_to_stderr") {}
    else if(arg=="-j" || arg=="-job") {
      check(++i<args.size(),"Missing job count");
      check(!args[i].empty() && args[i].find_first_not_of("0123456789")==std::string::npos,"Invalid job count");
      // A single program compilation task; all requested worker counts have the same result.
    } else { check(arg.empty() || arg[0]!='-',"Unsupported option: "+arg); paths.push_back(fs::u8path(arg)); }
  }
  check(paths.size()==1 || paths.size()==2,"Usage: assetc-web [options] <input-directory> [output-directory]");
  const auto source=fs::weakly_canonical(fs::absolute(paths[0]));
  const auto output=fs::weakly_canonical(fs::absolute(paths.size()==2 ? paths[1] : fs::u8path(paths[0].u8string()+"_compiled")));
  check(fs::is_directory(source),"Input is not a directory");
  check(!contains(source,output) && !contains(output,source),"Source and output must be disjoint");
  const auto approved=json::parse(approved_sources);
  json source_hashes=json::object();
  for(auto it=approved.begin();it!=approved.end();++it) {
    const auto p=source/fs::u8path(it.key());
    check(contains(source,fs::canonical(p)),"Source dependency escapes input: "+it.key());
    auto bytes=read(p);
    check(sha256(lf(bytes))==it.value().get<std::string>(),"Unreviewed shader source: "+it.key()+"; update the Web adapter and its provenance first");
    source_hashes[it.key()]=sha256(bytes);
  }
  for(const auto &entry:fs::recursive_directory_iterator(source)) {
    check(!entry.is_symlink(),"Symbolic links are unsupported in compiler inputs");
    if(entry.is_regular_file()) check(approved.contains(fs::relative(entry.path(),source).generic_u8string()),
      "Unsupported input in program pilot: "+fs::relative(entry.path(),source).generic_u8string());
  }
  json program={{"schema","harfang-web-program/1"},{"adapter","default-spot-instanced/1"},
    {"logicalId","core/shader/default.hps"},{"sourceHashes",source_hashes},
    {"variants",{"untextured-unskinned"}},
    {"requires",{"render.forward","render.spot-shadow","render.draw-instancing"}},
    {"forward",{{"vertex",default_vertex},{"fragment",default_fragment}}},
    {"depth",{{"vertex",depth_vertex},{"fragment",depth_fragment}}}};
  auto bytes=program.dump(2)+"\n", digest=sha256(bytes), uri="objects/"+digest+".program.json";
  json manifest={{"schema","harfang-web-program-assets/1"},{"api","harfang-js/1"},
    {"profile","web-native-forward/1"},{"compiler","assetc-web/program-1"},
    {"buildId",digest},{"maxNodes",16384},
    {"assets",{{"core/shader/default.hps",{{"kind","program"},{"uri",uri},{"sha256",digest},
      {"byteLength",bytes.size()},{"dependencies",json::array()}}}}}};
  // All inputs validated before any output mutation. Immutable content is written
  // first; the manifest is the commit point. Retain old objects for open clients.
  if(fs::exists(output)) check(fs::is_regular_file(output/".assetc-web-program-output"),"Refusing unmarked output: "+output.u8string());
  fs::create_directories(output);
  write(output/".assetc-web-program-output","assetc-web/program-1\n");
  const auto object=output/fs::u8path(uri);
  if(fs::exists(object)) check(read(object)==bytes,"Corrupt existing output object: "+object.u8string());
  else write(object,bytes);
  write(output/"manifest.json.tmp",manifest.dump(2)+"\n");
  // Windows rename cannot replace a destination; restore the previous manifest
  // on publication failure. No recursive deletion or source writes.
  const auto current=output/"manifest.json", backup=output/"manifest.json.previous";
  check(!fs::exists(backup),"Previous interrupted publication needs recovery: "+backup.u8string());
  if(fs::exists(current)) fs::rename(current,backup);
  try { fs::rename(output/"manifest.json.tmp",current); }
  catch(...) { if(fs::exists(backup)) fs::rename(backup,current); throw; }
  if(fs::exists(backup)) fs::remove(backup);
  if(!quiet) std::cout<<"Compiled 1 program, "<<source_hashes.size()<<" reviewed source files -> "<<output.u8string()<<"\n";
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
