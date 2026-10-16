"""Local dev server: the plain http.server, but a missing page gets the
site's own 404.html (with a 404 status), the way Netlify, Vercel, GitHub
Pages or the .htaccess rule serve it in production.

usage: python tools/serve.py [port]   (from the project root; default 5173)
"""
import gzip
import io
import sys
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    # text is sent gzipped when the browser accepts it, as the hosting does
    TEXT = (".html", ".css", ".js", ".svg", ".json", ".xml", ".txt", ".webmanifest")

    def send_head(self):
        path = self.translate_path(self.path)
        if (path.endswith(self.TEXT) or Path(path).is_dir()) and "gzip" in self.headers.get("Accept-Encoding", ""):
            p = Path(path) / "index.html" if Path(path).is_dir() else Path(path)
            if p.is_file():
                body = gzip.compress(p.read_bytes(), 6)
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", self.guess_type(str(p)))
                self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                return io.BytesIO(body)
        return super().send_head()

    def send_error(self, code, message=None, explain=None):
        page = ROOT / "404.html"
        if code == HTTPStatus.NOT_FOUND and page.exists():
            body = page.read_bytes()
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    print(f"serving {ROOT} on http://127.0.0.1:{port}")
    server.serve_forever()
