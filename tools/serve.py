"""Serve source or packaged tutorials over HTTP with explicit module MIME types."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.json': 'application/json'}

    def log_message(self, *_):
        pass


def server(directory=ROOT, port=8000):
    return ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(directory)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--dist', action='store_true')
    args = parser.parse_args()
    directory = ROOT / 'dist/web' if args.dist else ROOT
    if not directory.is_dir():
        parser.error('Run python tools/build.py before serving dist')
    with server(directory, args.port) as httpd:
        print(f'http://127.0.0.1:{args.port}/examples/tutorials/', flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
