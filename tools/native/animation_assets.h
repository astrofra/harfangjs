// Validate the Web rigid-node animation profile before publishing any assets.
static void animation_fields(const json &value,const std::set<std::string> &keys) {
  check(value.is_object(),"Expected animation object");
  for(const auto &field:value.items())check(keys.count(field.key())!=0,"Unsupported animation field: "+field.key());
}
static int64_t animation_time(const json &value) {
  check(value.is_number_integer(),"Animation timestamps must be integer nanoseconds");
  check(value>=-9007199254740991LL&&value<=9007199254740991LL,"Animation timestamp exceeds exact JSON range");
  return value.get<int64_t>();
}
static void animation_range(const json &value) {
  check(animation_time(value.at("t_end"))>=animation_time(value.at("t_start")),"Reversed animation range");
}
static void validate_animations(const json &scene) {
  const auto anims=scene.value("anims",json::array()),clips=scene.value("scene_anims",json::array());
  check((anims.is_null()||anims.is_array())&&(clips.is_null()||clips.is_array()),"Expected animation arrays");
  check(anims.size()<=16384&&clips.size()<=16384,"Animation budget exceeded");
  std::set<uint32_t> ids,nodes;size_t key_count=0;
  for(const auto &node:scene.at("nodes"))nodes.insert(node.at("idx").get<uint32_t>());
  for(const auto &record:anims) {
    animation_fields(record,{"idx","anim"});const auto &idx=record.at("idx");
    check(idx.is_number_integer()&&idx>=0&&idx<4294967295ULL,"Invalid animation index");
    check(ids.insert(idx.get<uint32_t>()).second,"Duplicate animation index");
    const auto &a=record.at("anim");animation_fields(a,{"t_start","t_end","flags","vec3","quat","bool"});animation_range(a);
    if(a.contains("flags")) {
      check(a["flags"].is_array(),"Expected animation flags");
      for(const auto &flag:a["flags"])check(flag=="UseQuaternionForRotation","Unsupported animation flag");
    }
    for(const std::string kind:{"vec3","quat","bool"})if(a.contains(kind)) {
      check(a[kind].is_array(),"Expected animation tracks");std::set<std::string> targets;
      for(const auto &track:a[kind]) {
        animation_fields(track,{"target","keys"});const auto target=track.at("target").get<std::string>();
        check(kind=="vec3"?(target=="Position"||target=="Rotation"||target=="Scale"):kind=="quat"?target=="Rotation":target=="Enable","Unsupported animation target: "+target);
        check(targets.insert(target).second,"Duplicate animation target");
        if(!track.contains("keys"))continue;
        check(track["keys"].is_array(),"Expected animation keys");int64_t previous=-9007199254740992LL;
        for(const auto &key:track["keys"]) {
          animation_fields(key,kind=="vec3"?std::set<std::string>{"t","v","tension","bias"}:std::set<std::string>{"t","v"});
          const auto time=animation_time(key.at("t"));check(time>previous,"Animation key times must increase");previous=time;
          check(++key_count<=1000000,"Animation key budget exceeded");const auto &v=key.at("v");
          if(kind=="bool")check(v.is_boolean(),"Invalid boolean animation key");
          else {
            check(v.is_array()&&v.size()==(kind=="quat"?4:3),"Invalid animation vector");bool nonzero=false;
            for(const auto &component:v){check(component.is_number()&&std::isfinite(component.get<float>()),"Invalid animation component");nonzero|=component.get<float>()!=0;}
            if(kind=="quat")check(nonzero,"Zero animation quaternion");
            else for(const auto &name:{"tension","bias"})check(key.at(name).is_number()&&std::isfinite(key[name].get<float>()),"Invalid Hermite parameter");
          }
        }
      }
    }
  }
  for(const auto &clip:clips) {
    animation_fields(clip,{"name","t_start","t_end","frame_duration","anim","node_anims"});animation_range(clip);
    check(clip.at("name").is_string(),"Invalid animation name");
    if(clip.contains("frame_duration"))check(animation_time(clip["frame_duration"])>=0,"Invalid animation frame duration");
    check(!clip.contains("anim")||clip["anim"].is_null()||clip["anim"]==4294967295ULL,"Scene/environment animation channels unsupported");
    if(clip.contains("node_anims")) {
      check(clip["node_anims"].is_array(),"Expected node animation bindings");
      for(const auto &binding:clip["node_anims"]) {
        animation_fields(binding,{"node","anim"});
        for(const auto &key:{"node","anim"})check(binding.at(key).is_number_integer()&&binding[key]>=0&&binding[key]<4294967295ULL,"Invalid animation binding index");
        check(nodes.count(binding["node"].get<uint32_t>())&&ids.count(binding["anim"].get<uint32_t>()),"Missing animation node or track");
      }
    }
  }
}
