"""Serve the self-contained PBR Scene release on localhost."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from build import DIST

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8004)
    args = parser.parse_args()
    if not (DIST / 'index.html').exists():
        parser.error('Run build.py first')
    print(f'PBR Scene: http://localhost:{args.port}/', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), partial(SimpleHTTPRequestHandler, directory=str(DIST))).serve_forever()
