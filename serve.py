#!/usr/bin/env python3
"""Local preview with byte ranges for responsive video seeking; standard library only."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).resolve().parent), **kwargs)

    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def send_head(self):
        self.remaining = None
        path = Path(self.translate_path(self.path))
        header = self.headers.get('Range')
        if not header or not path.is_file():
            return super().send_head()
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', header.strip())
        size = path.stat().st_size
        if not match or not size:
            self.send_error(416, 'Unsupported range')
            return None
        first, last = match.groups()
        if first:
            start, end = int(first), min(int(last) if last else size-1, size-1)
        elif last:
            start, end = max(0, size-int(last)), size-1
        else:
            start, end = size, size-1
        if start >= size or start > end:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        try:
            source = path.open('rb')
        except OSError:
            self.send_error(404)
            return None
        source.seek(start)
        self.remaining = end-start+1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Length', str(self.remaining))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Last-Modified', self.date_time_string(path.stat().st_mtime))
        self.end_headers()
        return source

    def copyfile(self, source, outputfile):
        try:
            if self.remaining is None:
                return super().copyfile(source, outputfile)
            while self.remaining > 0:
                data = source.read(min(self.remaining, 65536))
                if not data:
                    break
                outputfile.write(data)
                self.remaining -= len(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A new drag position can cancel a previous range request.

if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8767), Handler)
    print('Al Bakhur: http://127.0.0.1:8767/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
