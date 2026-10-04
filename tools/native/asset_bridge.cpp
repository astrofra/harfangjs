// Offline-only adapter over HARFANG's native readers. Never shipped to browsers.
#include "engine/geometry.h"
#include "engine/scene.h"
#include "engine/forward_pipeline.h"
#include "engine/scene_forward_pipeline.h"
#include "engine/assets.h"
#include "engine/picture.h"
#include "platform/window_system.h"
#include "foundation/matrix4.h"
#include <json/json.hpp>
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <map>
#include <stdexcept>

using nlohmann::json;
static void check(bool ok, const std::string &message) { if (!ok) throw std::runtime_error(message); }
static json read_json(const char *path) { std::ifstream stream(path); check(bool(stream), "Cannot open input"); json j; stream >> j; return j; }
static void write_json(const char *path, const json &j) { std::ofstream stream(path); stream << j.dump(2) << '\n'; check(bool(stream), "Cannot write output"); }

static json geometry(const char *path) {
  auto geo = hg::LoadGeometryFromFile(path);
  check(!geo.vtx.empty() && !geo.pol.empty(), "Empty or invalid native source geometry (compiled bgfx models are not accepted)");
  check(geo.skin.empty() && geo.bind_pose.empty(), "Required skinning is outside W1");
  const size_t count = hg::ComputeBindingCount(geo);
  check(count == geo.binding.size() && count < 4000000, "Invalid or oversized polygon binding table");
  check(geo.normal.empty() || geo.normal.size() == count, "Invalid normal count");
  check(geo.uv[0].empty() || geo.uv[0].size() == count, "Invalid UV0 count");
  for (auto index : geo.binding) check(index < geo.vtx.size(), "Invalid geometry vertex reference");
  const auto flat_normals = hg::ComputePolygonNormal(geo);
  std::vector<float> vertices;
  std::map<unsigned, std::vector<uint32_t>> groups;
  float lo[3] = {INFINITY, INFINITY, INFINITY}, hi[3] = {-INFINITY, -INFINITY, -INFINITY};
  size_t base = 0;
  for (size_t p = 0; p < geo.pol.size(); ++p) {
    const auto &pol = geo.pol[p];
    check(pol.vtx_count >= 3, "Non-triangle polygon primitive is outside W1");
    for (size_t i = 0; i < pol.vtx_count; ++i) {
      const auto position = geo.vtx[geo.binding[base + i]];
      const auto normal = geo.normal.empty() ? flat_normals[p] : geo.normal[base + i];
      const auto uv = geo.uv[0].empty() ? hg::Vec2(0, 0) : geo.uv[0][base + i];
      const float values[] = {position.x, position.y, position.z, normal.x, normal.y, normal.z, uv.x, uv.y};
      for (float value : values) { check(std::isfinite(value), "Non-finite geometry attribute"); vertices.push_back(value); }
      for (int k = 0; k < 3; ++k) { lo[k] = std::min(lo[k], values[k]); hi[k] = std::max(hi[k], values[k]); }
    }
    // Match GeometryToModel's fan and winding, retaining per-corner UV seams.
    for (size_t i = 1; i + 1 < pol.vtx_count; ++i) {
      auto &indices = groups[pol.material];
      indices.push_back(uint32_t(base)); indices.push_back(uint32_t(base + i + 1)); indices.push_back(uint32_t(base + i));
    }
    base += pol.vtx_count;
  }
  json submeshes = json::array(); std::vector<uint32_t> indices;
  for (const auto &group : groups) {
    submeshes.push_back({{"material", group.first}, {"firstIndex", indices.size()}, {"indexCount", group.second.size()}});
    indices.insert(indices.end(), group.second.begin(), group.second.end());
  }
  return {{"vertices", vertices}, {"indices", indices}, {"submeshes", submeshes},
    {"bounds", {{"min", {lo[0], lo[1], lo[2]}}, {"max", {hi[0], hi[1], hi[2]}}}},
    {"sourceVertexCount", geo.vtx.size()}, {"vertexCount", count}};
}

static void create_geometry(const char *input, const char *output) {
  const auto source = read_json(input); hg::Geometry geo;
  for (const auto &v : source.at("positions")) geo.vtx.push_back({v.at(0), v.at(1), v.at(2)});
  for (const auto &p : source.at("polygons")) {
    const auto &indices = p.at("indices");
    check(indices.size() >= 3 && indices.size() <= 255, "Invalid generated polygon size");
    hg::Geometry::Polygon pol; pol.vtx_count = uint8_t(indices.size()); pol.material = p.value("material", 0);
    geo.pol.push_back(pol);
    for (size_t i = 0; i < indices.size(); ++i) {
      check(indices[i].is_number_unsigned() && indices[i].get<size_t>() < geo.vtx.size(), "Invalid generated vertex reference");
      geo.binding.push_back(indices[i]);
      geo.uv[0].push_back({p.at("uv").at(i).at(0), p.at("uv").at(i).at(1)});
    }
  }
  auto normals = hg::ComputePolygonNormal(geo);
  for (size_t i = 0; i < geo.pol.size(); ++i) for (size_t j = 0; j < geo.pol[i].vtx_count; ++j) geo.normal.push_back(normals[i]);
  check(hg::SaveGeometryToFile(output, geo), "Native geometry save failed");
}

static void scene_command(const std::string &mode, const char *input, const char *output) {
  hg::Scene scene; hg::PipelineResources resources; hg::LoadSceneContext ctx;
  check(hg::LoadSceneFromFile(input, scene, resources, hg::GetForwardPipelineInfo(), ctx, hg::LSSF_All | hg::LSSF_DoNotLoadResources), "Native scene reader failed");
  if (mode == "scene-json") check(hg::SaveSceneJsonToFile(output, scene, resources), "Native JSON writer failed");
  else if (mode == "scene-binary") check(hg::SaveSceneBinaryToFile(output, scene, resources), "Native binary writer failed");
  else {
    scene.ComputeWorldMatrices(); json nodes = json::array();
    for (const auto &node : scene.GetNodes()) {
      json world = nullptr;
      if (node.GetTransform().IsValid()) {
        const auto m = node.GetTransform().GetWorld(); world = json::array();
        for (int c = 0; c < 4; ++c) for (int r = 0; r < 3; ++r) world.push_back(m.m[r][c]);
      }
      json item = {{"name", node.GetName()}, {"enabled", node.IsEnabled()}, {"world", world}};
      if (node.GetTransform().IsValid()) {
        const auto parent = node.GetTransform().GetParentNode();
        item["parent"] = parent.IsValid() ? parent.GetName() : "";
      }
      const auto camera = node.GetCamera();
      if (camera.IsValid()) item["camera"] = {{"ortho", camera.GetIsOrthographic()}, {"near", camera.GetZNear()},
        {"far", camera.GetZFar()}, {"fov", camera.GetFov()}, {"size", camera.GetSize()}};
      const auto object = node.GetObject();
      if (object.IsValid()) {
        item["model"] = resources.models.GetName(object.GetModelRef());
        item["materials"] = json::array(); item["materialNames"] = json::array();
        for (size_t i = 0; i < object.GetMaterialCount(); ++i) {
          json mat; hg::SaveMaterial(object.GetMaterial(i), mat, resources);
          item["materials"].push_back(mat); item["materialNames"].push_back(object.GetMaterialName(i));
        }
      }
      nodes.push_back(item);
    }
    const auto camera = scene.GetCurrentCamera();
    write_json(output, {{"nodes", nodes}, {"currentCamera", camera.IsValid() ? camera.GetName() : ""}});
  }
}

static void capture_room(const char *assets, const char *output) {
  hg::WindowSystemInit();
  auto *window = hg::NewWindow(256, 256, 32, hg::WV_Hidden);
  check(window && hg::RenderInit(window, bgfx::RendererType::OpenGL), "Native OpenGL initialization failed");
  hg::AddAssetsFolder(assets);
  {
    hg::Scene scene; hg::PipelineResources resources; hg::LoadSceneContext ctx;
    check(hg::LoadSceneFromAssets("scenes/room.scn", scene, resources, hg::GetForwardPipelineInfo(), ctx), "Compiled room load failed");
    auto pipeline = hg::CreateForwardPipeline();
    for (const auto *name : {"Perspective", "Orthographic"}) {
      scene.SetCurrentCamera(scene.GetNode(name)); scene.Update(0);
      for (int frame = 0; frame < 6; ++frame) {
        bgfx::ViewId view = 0; hg::SceneForwardPipelinePassViewId views;
        hg::SubmitSceneToPipeline(view, scene, {0,0,256,256}, true, pipeline, resources, views);
        if (frame == 3) bgfx::requestScreenShot(BGFX_INVALID_HANDLE, (std::string(output) + "-" + name).c_str());
        bgfx::frame();
      }
    }
    hg::DestroyForwardPipeline(pipeline);
  }
  hg::RenderShutdown(); hg::DestroyWindow(window); hg::WindowSystemShutdown();
  for (const auto *name : {"Perspective", "Orthographic"}) {
    const auto prefix = std::string(output) + "-" + name; hg::Picture picture;
    check(hg::LoadPicture(picture, (prefix + ".tga").c_str()), "Native screenshot missing");
    check(hg::SavePNG(picture, (prefix + ".png").c_str()), "Native PNG save failed");
  }
}

int main(int argc, char **argv) {
  try {
    check(argc == 4, "Usage: harfang_web_asset_bridge geometry|create-geometry|scene-json|scene-binary|scene-state|capture-room INPUT OUTPUT");
    const std::string command = argv[1];
    if (command == "geometry") write_json(argv[3], geometry(argv[2]));
    else if (command == "create-geometry") create_geometry(argv[2], argv[3]);
    else if (command == "scene-json" || command == "scene-binary" || command == "scene-state") scene_command(command, argv[2], argv[3]);
    else if (command == "capture-room") capture_room(argv[2], argv[3]);
    else throw std::runtime_error("Unknown command");
    return 0;
  } catch (const std::exception &error) { std::cerr << (argc > 2 ? argv[2] : "asset bridge") << ": " << error.what() << '\n'; return 1; }
}
