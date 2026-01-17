from http.server import HTTPServer, SimpleHTTPRequestHandler
import sys

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Tüm kökenlerden gelen isteklere izin ver (*)
        self.send_header('Access-Control-Allow-Origin', '*')
        # İzin verilen metodlar
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        # İzin verilen başlıklar
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-type')
        super().end_headers()

if __name__ == '__main__':
    # Varsayılan port 8000, istersen değiştirebilirsin
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server_address = ('', port)
    httpd = HTTPServer(server_address, CORSRequestHandler)
    
    print(f"Sunucu çalışıyor: http://localhost:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nSunucu durduruldu.")