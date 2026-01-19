from http.server import HTTPServer, SimpleHTTPRequestHandler
import sys
import socket

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 1. CORS Headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'X-Requested-With, Content-Type')
        
        # 2. CACHE Headers (Force reload every time)
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "OK")
        self.end_headers()

def get_local_ip():
    """Yerel IP adresini bul"""
    try:
        # Yerel ağ IP'sini almak için bir socket oluştur
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "127.0.0.1"

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    
    # Tüm ağ arayüzlerini dinle (0.0.0.0)
    server_address = ('0.0.0.0', port)
    
    # Allow address reuse
    HTTPServer.allow_reuse_address = True
    
    httpd = HTTPServer(server_address, CORSRequestHandler)
    
    # Yerel IP'yi al
    local_ip = get_local_ip()
    
    print(f"Sunucu çalışıyor (No-Cache Modu):")
    print(f"- Yerel adres: http://localhost:{port}")
    print(f"- Ağ adresi:   http://{local_ip}:{port}")
    print(f"- Telefondan erişmek için: http://{local_ip}:{port}/Desktop/3d-main/")
    print(f"\nSunucuyu durdurmak için: Ctrl+C")
    
    try: 
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nSunucu durduruldu.")