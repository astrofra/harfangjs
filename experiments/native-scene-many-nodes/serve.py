"""Serve the isolated Many Nodes package; build it first with build.py."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / 'dist/experiments/native-scene-many-nodes'

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8001)
    args = parser.parse_args()
    if not (DIST / 'release.json').is_file():
        parser.error('Run experiments/native-scene-many-nodes/build.py first')
    with ThreadingHTTPServer(('127.0.0.1', args.port), partial(SimpleHTTPRequestHandler, directory=str(DIST))) as server:
        print(f'http://127.0.0.1:{args.port}/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
