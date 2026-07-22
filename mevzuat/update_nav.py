import os
import re

nav_html = '''            <ul class="nav-menu">
                <li class="active"><a href="../../" style="text-decoration: none; color: inherit;">Ürünlerimiz</a></li>
                <li title="Sepet">
                    <a href="../../?checkout" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 6px;">
                        <i class="fa-solid fa-cart-shopping" style="font-size: 1.2rem;"></i> Sepet
                        <span id="cart-badge">0</span>
                    </a>
                </li>
                
                <li id="nav-login-btn" style="margin-left: auto; display: flex; align-items: center;">
                    <a href="../../?login" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 8px; font-weight: 600; padding: 10px 0;">
                        <i class="fa-regular fa-user" style="font-size: 1.2rem;"></i> Giriş Yap
                    </a>
                </li>
            </ul>'''

base_dir = '.'
for d in os.listdir(base_dir):
    dir_path = os.path.join(base_dir, d)
    if os.path.isdir(dir_path):
        file_path = os.path.join(dir_path, 'index.html')
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # replace the nav-menu block
            content = re.sub(r'            <ul class="nav-menu">.*?            </ul>', nav_html, content, flags=re.DOTALL)
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f'Updated {file_path}')
