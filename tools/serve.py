"""Serve a compiled browser package from dist over local HTTP."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from demos import ROOT, DEMOS

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo', choices=DEMOS, default='many-nodes')
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    directory = ROOT / 'dist/experiments' / DEMOS[args.demo]
    if not (directory / 'release.json').is_file():
        parser.error(f'Run python tools/build.py --demo {args.demo} first')
    with ThreadingHTTPServer(('127.0.0.1', args.port), partial(SimpleHTTPRequestHandler, directory=str(directory))) as server:
        print(f'http://127.0.0.1:{args.port}/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
