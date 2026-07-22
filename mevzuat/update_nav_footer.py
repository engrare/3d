import os
import re

base_dir = '.'
root_index_path = '../index.html'

with open(root_index_path, 'r', encoding='utf-8') as f:
    root_html = f.read()

nav_match = re.search(r'(<nav class="navbar">.*?</nav>)', root_html, flags=re.DOTALL)
footer_match = re.search(r'(<footer class="main-footer">.*?</footer>)', root_html, flags=re.DOTALL)

if not nav_match or not footer_match:
    print("Could not find nav or footer in root index.html")
    exit(1)

nav_html = nav_match.group(1)
footer_html = footer_match.group(1)

# Fix paths for mevzuat subdirectories (from ./ to ../../, from mevzuat/ to ../)
nav_html = nav_html.replace('href="./"', 'href="../../"')
nav_html = nav_html.replace('src="./content/', 'src="../../content/')
nav_html = nav_html.replace('data-target="#products-page"', 'href="../../?products"')
nav_html = nav_html.replace('data-target="#checkout-page"', 'href="../../?checkout"')
nav_html = nav_html.replace('data-target="#login-page"', 'href="../../?login"')
nav_html = nav_html.replace('data-target="#dashboard-page"', 'href="../../?dashboard"')
# Make lists clickable as links in nav
nav_html = nav_html.replace('<li data-target="#products-page" class="active">Ürünlerimiz</li>', '<li><a href="../../?products" style="text-decoration: none; color: inherit;">Ürünlerimiz</a></li>')
nav_html = nav_html.replace('<li data-target="#checkout-page"', '<li ')
nav_html = nav_html.replace('<i class="fa-solid fa-cart-shopping" style="font-size: 1.2rem;"></i> Sepet <span id="cart-badge">0</span></li>', '<a href="../../?checkout" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-cart-shopping" style="font-size: 1.2rem;"></i> Sepet <span id="cart-badge">0</span></a></li>')
nav_html = nav_html.replace('<li id="nav-login-btn"', '<li id="nav-login-btn"')
nav_html = nav_html.replace('<i class="fa-regular fa-user" style="font-size: 1.2rem;"></i> Giriş Yap\n                </li>', '<a href="../../?login" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 8px;"><i class="fa-regular fa-user" style="font-size: 1.2rem;"></i> Giriş Yap</a>\n                </li>')
nav_html = nav_html.replace('<i class="fa-solid fa-circle-user" style="font-size: 1.3rem;"></i> Profil\n                </li>', '<a href="../../?dashboard" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 8px;"><i class="fa-solid fa-circle-user" style="font-size: 1.3rem;"></i> Profil</a>\n                </li>')

# Remove class="nav-trigger" as we use standard links
nav_html = nav_html.replace('class="nav-trigger"', '')

footer_html = footer_html.replace('href="mevzuat/', 'href="../')

for d in os.listdir(base_dir):
    dir_path = os.path.join(base_dir, d)
    if os.path.isdir(dir_path):
        file_path = os.path.join(dir_path, 'index.html')
        if os.path.exists(file_path):
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # replace nav
            content = re.sub(r'<nav class="navbar">.*?</nav>', nav_html, content, flags=re.DOTALL)
            
            # replace footer
            content = re.sub(r'<footer class="main-footer">.*?</footer>', footer_html, content, flags=re.DOTALL)
            
            # replace inline script with mevzuat_script.js
            content = re.sub(r'<script>\s*\$\(document\)\.ready\(function\(\) \{.*?\updateCartBadge\(\);\s*\}\);\s*</script>', '<script type="module" src="../mevzuat_script.js"></script>', content, flags=re.DOTALL)
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print(f'Updated {file_path}')
