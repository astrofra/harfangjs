"""Build the offline reader adapter using an existing native HARFANG MSVC build.

Reads the assetc project's Release includes/defines/link closure. Does not modify
or reconfigure the HARFANG build. Other platforms can add tools/native to their
HARFANG CMake build and link the existing engine target directly.
"""
import argparse
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def build(native_build):
    project = native_build.resolve() / 'tools/assetc/assetc.vcxproj'
    tree = ET.parse(project)
    ns = {'m': 'http://schemas.microsoft.com/developer/msbuild/2003'}
    group = next(g for g in tree.findall('m:ItemDefinitionGroup', ns) if "'Release|x64'" in g.attrib.get('Condition', ''))
    def values(path):
        return [v for v in group.find(path, ns).text.split(';') if not v.startswith('%(')]
    includes = values('m:ClCompile/m:AdditionalIncludeDirectories')
    definitions = [d for d in values('m:ClCompile/m:PreprocessorDefinitions') if not d.startswith('CMAKE_INTDIR=')]
    libraries = values('m:Link/m:AdditionalDependencies')
    libraries = [str((project.parent / p).resolve()) if '\\' in p or '/' in p else p for p in libraries]
    target = ROOT / 'build/native'
    target.mkdir(parents=True, exist_ok=True)
    config = target / 'harfang-link.cmake'
    def cmake_list(name, items):
        return 'set(' + name + '\n' + '\n'.join('  [==[' + v.replace('\\', '/') + ']==]' for v in items) + '\n)\n'
    config.write_text(cmake_list('HG_BRIDGE_INCLUDES', includes) + cmake_list('HG_BRIDGE_DEFINITIONS', definitions) + cmake_list('HG_BRIDGE_LIBRARIES', libraries), encoding='utf-8')
    subprocess.run(['cmake', '-S', str(ROOT / 'tools/native'), '-B', str(target), '-A', 'x64', f'-DHARFANG_LINK_CONFIG={config}'], check=True)
    subprocess.run(['cmake', '--build', str(target), '--config', 'Release'], check=True)
    for folder, name in [('extern/lua/Release', 'lua54.dll'), ('extern/glfw/src/Release', 'glfw3.dll')]:
        shutil.copy2(native_build / folder / name, target / 'Release' / name)
    executable = target / 'Release/harfang_web_asset_bridge.exe'
    print(executable)
    return executable


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harfang-build', type=Path, default=ROOT.parent / 'build/python-cmake')
    args = parser.parse_args()
    build(args.harfang_build)
