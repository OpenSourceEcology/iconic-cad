#!/usr/bin/env python3
"""No-cache dev server for the web UI.

`python -m http.server` lets the browser cache ES modules aggressively, so
edits to web/js/*.js don't show up even after Ctrl+Shift+R. This server sends
Cache-Control: no-store on every response, so a plain reload always fetches the
latest code and assets.

Usage (from repo root):
    python scripts/serve.py            # serves web/ at http://127.0.0.1:8080/
    python scripts/serve.py 9000       # custom port

Then open http://127.0.0.1:8080/ and just reload after each edit.
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class Server(socketserver.TCPServer):
    allow_reuse_address = True


with Server(("", PORT), NoCacheHandler) as httpd:
    print("Serving %s at http://127.0.0.1:%d/  (no-cache)" % (WEB_DIR, PORT))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
