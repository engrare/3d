const fs = require('fs');
const path = require('path');

const baseDir = '.';
const rootIndexPath = '../index.html';

const rootHtml = fs.readFileSync(rootIndexPath, 'utf-8');

const navMatch = rootHtml.match(/(<nav class="navbar">[\s\S]*?<\/nav>)/);
const footerMatch = rootHtml.match(/(<footer class="main-footer">[\s\S]*?<\/footer>)/);

if (!navMatch || !footerMatch) {
    console.error("Could not find nav or footer in root index.html");
    process.exit(1);
}

let navHtml = navMatch[1];
let footerHtml = footerMatch[1];

// Mobil alt menü + stilleri ve güncel myStyle.css sürümü de ana sayfadan kopyalanır.
// Alt menüdeki tek-sayfa (SPA) hedefleri burada normal sayfa geçişine çevrilir; aktif sekme olmaz.
const bottomNavMatch = rootHtml.match(/<!-- MOBILE BOTTOM NAV -->\s*<div class="bottom-nav-bar"[\s\S]*?\n    <\/div>/);
const bottomStyleMatch = rootHtml.match(/<!-- Sayfaya ozel mobil alt menu stilleri[\s\S]*?<\/style>/);
const cssVersion = (rootHtml.match(/myStyle\.css\?v=(\d+)/) || [])[1];
if (!bottomNavMatch || !bottomStyleMatch || !cssVersion) {
    console.error("Could not find bottom nav, its styles or myStyle.css version in root index.html");
    process.exit(1);
}
const bottomNavHtml = bottomNavMatch[0]
    .replace('class="bottom-nav-item active"', 'class="bottom-nav-item"')
    .replace(/data-target="#(products|checkout|login|dashboard)-page"/g, `onclick="location.href='../../?$1'"`);
const bottomStyleHtml = bottomStyleMatch[0];

navHtml = navHtml.replace(/href="\.\/"/g, 'href="../../"');
navHtml = navHtml.replace(/src="\.\/content\//g, 'src="../../content/');
navHtml = navHtml.replace(/data-target="#products-page"/g, 'href="../../?products"');
navHtml = navHtml.replace(/data-target="#checkout-page"/g, 'href="../../?checkout"');
navHtml = navHtml.replace(/data-target="#login-page"/g, 'href="../../?login"');
navHtml = navHtml.replace(/data-target="#dashboard-page"/g, 'href="../../?dashboard"');
navHtml = navHtml.replace('<li href="../../?products" class="active">Ürünlerimiz</li>', '<li><a href="../../?products" style="text-decoration: none; color: inherit;">Ürünlerimiz</a></li>');
navHtml = navHtml.replace('<li href="../../?checkout"', '<li ');
navHtml = navHtml.replace('<i class="fa-solid fa-cart-shopping" style="font-size: 1.2rem;"></i> Sepet <span id="cart-badge">0</span></li>', '<a href="../../?checkout" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-cart-shopping" style="font-size: 1.2rem;"></i> Sepet <span id="cart-badge">0</span></a></li>');
navHtml = navHtml.replace('<li id="nav-login-btn"', '<li id="nav-login-btn"');
navHtml = navHtml.replace('<i class="fa-regular fa-user" style="font-size: 1.2rem;"></i> Giriş Yap\n                </li>', '<a href="../../?login" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 8px;"><i class="fa-regular fa-user" style="font-size: 1.2rem;"></i> Giriş Yap</a>\n                </li>');
navHtml = navHtml.replace('<i class="fa-solid fa-circle-user" style="font-size: 1.3rem;"></i> Profil\n                </li>', '<a href="../../?dashboard" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 8px;"><i class="fa-solid fa-circle-user" style="font-size: 1.3rem;"></i> Profil</a>\n                </li>');
navHtml = navHtml.replace(/<div class="brand-logo[^>]*>([\s\S]*?)<\/div>/, '<div class="brand-logo" style="cursor: pointer;"><a href="../../?products" style="text-decoration: none; color: inherit;">$1</a></div>');
navHtml = navHtml.replace(/class="nav-trigger"/g, '');

footerHtml = footerHtml.replace(/href="mevzuat\//g, 'href="../');

const dirs = fs.readdirSync(baseDir);

for (const d of dirs) {
    const dirPath = path.join(baseDir, d);
    if (fs.statSync(dirPath).isDirectory()) {
        const filePath = path.join(dirPath, 'index.html');
        if (fs.existsSync(filePath)) {
            let content = fs.readFileSync(filePath, 'utf-8');
            
            content = content.replace(/<nav class="navbar">[\s\S]*?<\/nav>/, navHtml);
            content = content.replace(/<footer class="main-footer">[\s\S]*?<\/footer>/, footerHtml);
            content = content.replace(/myStyle\.css\?v=\d+/, `myStyle.css?v=${cssVersion}`);
            const styleRe = /<!-- Sayfaya ozel mobil alt menu stilleri[\s\S]*?<\/style>/;
            content = styleRe.test(content) ? content.replace(styleRe, () => bottomStyleHtml) : content.replace('</head>', () => `    ${bottomStyleHtml}\n</head>`);
            const navRe = /<!-- MOBILE BOTTOM NAV -->\s*<div class="bottom-nav-bar"[\s\S]*?\n    <\/div>/;
            content = navRe.test(content) ? content.replace(navRe, () => bottomNavHtml) : content.replace('</body>', () => `    ${bottomNavHtml}\n</body>`);
            content = content.replace(/<script>\s*\$\(document\)\.ready\(function\(\) \{[\s\S]*?updateCartBadge\(\);\s*\}\);\s*<\/script>/, '<script type="module" src="../mevzuat_script.js?v=2"></script>');
            content = content.replace(/mevzuat_script\.js(\?v=\d+)?"/, 'mevzuat_script.js?v=2"');
            
            fs.writeFileSync(filePath, content, 'utf-8');
            console.log(`Updated ${filePath}`);
        }
    }
}
