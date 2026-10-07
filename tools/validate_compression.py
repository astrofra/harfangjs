"""Cross-check the JS decoder with upstream LZ4 and exercise loader boundaries."""
import base64
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import random
import shutil
import struct
import subprocess
import tempfile
import threading
import zlib

import lz4.block
from playwright.sync_api import sync_playwright
from asset_validation import read_asset
from build_compiler import compiler_path
from demos import ROOT
from package_assets import package_assets


def encoded(data):
    return base64.b64encode(data).decode('ascii')


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    # Compile the same real program in both modes, verifying decoded equality
    # independently of our JS implementation and the compiler's checksums.
    source = ROOT / 'build/experiments/native-scene-many-nodes/asset-input'
    with tempfile.TemporaryDirectory(prefix='hg-lz4-') as directory:
        directory = Path(directory)
        manifests = {}
        for mode in ['none', 'lz4']:
            output = directory / mode
            subprocess.run([str(compiler_path()), '-q', '--compression', mode, str(source), str(output)], check=True)
            manifests[mode] = json.loads((output / 'manifest.json').read_bytes())
        entry = next(iter(manifests['lz4']['assets'].values()))
        assert entry['compression'] == 'lz4-block'
        raw_entry = next(iter(manifests['none']['assets'].values()))
        assert entry['uri'] == raw_entry['uri'] + '.lz4'
        raw = read_asset(directory / 'none' / raw_entry['uri'], raw_entry)
        assert read_asset(directory / 'lz4' / entry['uri'], entry) == raw
        for arguments in [['--compression'], ['--compression', 'invalid', str(source), str(directory / 'bad')]]:
            assert subprocess.run([str(compiler_path()), *arguments], capture_output=True).returncode != 0
        package_assets(directory / 'lz4', directory / 'release')
        before = (directory / 'release' / entry['uri']).read_bytes()
        payload = directory / 'lz4' / entry['uri']
        corrupted = bytearray(payload.read_bytes());corrupted[0] ^= 1;payload.write_bytes(corrupted)
        try:
            package_assets(directory / 'lz4', directory / 'release')
        except ValueError:
            pass
        else:
            raise AssertionError('Packaging accepted corrupt compressed bytes')
        assert (directory / 'release' / entry['uri']).read_bytes() == before

        # A 1x1 RGBA texture cannot benefit from LZ4: exercise the native
        # compiler's raw fallback in a bundle that also has packed programs.
        tiny_source = directory / 'tiny-source'
        names = set()
        for filename in ['source-hashes.json', 'scene-source-hashes.json']:
            names.update(json.loads((ROOT / 'tools/native/adapters' / filename).read_bytes()))
        for name in names:
            target = tiny_source / name;target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT.parent / 'harfang3d/tutorials/resources' / name, target)
        def chunk(kind, data):
            return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
        png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)) +
               chunk(b'IDAT', zlib.compress(b'\x00\x17\x63\xaf\xff')) + chunk(b'IEND', b''))
        (tiny_source / 'tiny.png').write_bytes(png)
        tiny_output = directory / 'tiny-output'
        subprocess.run([str(compiler_path()), '-q', str(tiny_source), str(tiny_output)], check=True)
        tiny_assets = json.loads((tiny_output / 'manifest.json').read_bytes())['assets']
        assert 'compression' not in tiny_assets['tiny.png']
        assert read_asset(tiny_output / 'tiny.png', tiny_assets['tiny.png']) == b'\x17\x63\xaf\xff'
        assert tiny_assets['core/shader/pbr.hps']['compression'] == 'lz4-block'
        assert tiny_assets['shaders/pos_rgb']['uri'] == 'shaders/pos_rgb.lz4'
        package_assets(tiny_output, directory / 'tiny-release')

    rng = random.Random(42)
    vectors = []
    for size in [0, 1, 4, 12, 15, 16, 255, 270, 65535, 65536, 131072]:
        for data in [rng.randbytes(size), b'A' * size, (bytes(range(251)) * (size // 251 + 1))[:size]]:
            for mode in ['default', 'high_compression']:
                vectors.append({'packed': encoded(lz4.block.compress(data, mode=mode, store_size=False)),
                                'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    candidates = [Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe',
                  Path(os.environ.get('PROGRAMFILES(X86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe']
    browser_path = next((str(p) for p in candidates if p.is_file()), None)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=browser_path, headless=True)
            page = browser.new_page()
            page.add_init_script('Object.defineProperty(window,"WebAssembly",{get(){throw Error("Wasm forbidden");}});')
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            report = page.evaluate('async data=>(await import("/tools/tests/asset-compression.js")).run(data)',
                                   {'vectors': vectors, 'manifest': manifests['none'], 'raw': encoded(raw), 'packed': encoded(before)})
            report['compiler'] = 'LZ4 HC/raw decoded equality; tiny texture fallback; corrupt package rejected before publication'
            report['browser'] = browser.version
            browser.close()
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
    output = ROOT / 'build/reports/compression.json';output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Compression validation passed: {report}')


if __name__ == '__main__':
    main()
