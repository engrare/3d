/* Sipariş sonrası çapraz satış: satın alınmayan diğer ürünleri gösterir (ödeme sayfasındaki "Siparişiniz Alındı" ve
   iyzico dönüş sayfası ortak kullanır). Ürün bilgisi products.js'ten (fiyat.js/önbellek üzerine yazılmış hâliyle) gelir. */
import { products, overridesReady } from './products.js?v=24';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = (t) => String(t).toLowerCase().trim().replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/â/g, 'a').replace(/î/g, 'i').replace(/û/g, 'u')
    .replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-');
const asset = (p) => (p || '').replace(/^\.\//, '/');
const fmtTL = (n) => '₺' + Number(n).toLocaleString('tr-TR', { maximumFractionDigits: 2 });

const CSS = `.cs-box{margin:26px 0 0;text-align:left}.cs-box h3{font-size:1.05rem;margin:0 0 4px;color:var(--primary,#1d1d1f)}
.cs-box p{margin:0 0 12px;font-size:.85rem;color:var(--text-muted,#6b7280)}
.cs-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.cs-card{display:block;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;background:#fff;text-decoration:none;color:inherit;transition:box-shadow .15s,transform .15s}
.cs-card:hover{box-shadow:0 6px 18px rgba(0,0,0,.08);transform:translateY(-1px)}
.cs-card img{display:block;width:100%;aspect-ratio:400/250;object-fit:cover;background:#f3f4f6}
.cs-info{padding:9px 11px 11px}.cs-name{font-size:.88rem;font-weight:700;line-height:1.25}
.cs-price{margin-top:4px;font-size:.85rem;color:var(--text-muted,#6b7280)}.cs-price s{margin-left:6px;opacity:.7}.cs-go{display:block;margin-top:6px;font-size:.8rem;font-weight:700;color:var(--accent,#2a78d6)}`;

/* container: sarmalayıcı eleman; boughtIds: bu siparişte alınan ürün kimlikleri (gösterilmez) */
export function crossSell(container, boughtIds) {
    if (!container) return;
    const bought = (boughtIds || []).map(Number);
    const others = products.filter((p) => !bought.includes(Number(p.id)) && p.name && p.price > 0).slice(0, 4);
    if (!others.length) return;
    if (!document.getElementById('cs-style')) {
        const st = document.createElement('style');
        st.id = 'cs-style';
        st.textContent = CSS;
        document.head.appendChild(st);
    }
    const cards = others.map((p) => {
        const img = p.card || (p.images && p.images[0] && p.images[0].src) || '/content/images/engrare_logo_elegant.png';
        const price = overridesReady ? `<div class="cs-price">${fmtTL(p.price)}${p.oldPrice > p.price ? `<s>${fmtTL(p.oldPrice)}</s>` : ''}</div>` : '';
        return `<a class="cs-card" id="cs-${esc(p.id)}" href="/?detail=${esc(slugify(p.name))}"><img src="${esc(asset(img))}" alt="${esc(p.name)}" width="400" height="250" loading="lazy">`
            + `<div class="cs-info"><div class="cs-name">${esc(p.name)}</div>${price}<span class="cs-go">İncele →</span></div></a>`;
    }).join('');
    container.innerHTML = `<div class="cs-box"><h3>Bunlara da göz atın</h3><p>Aynı özenle, kişiye özel üretilir. Ücretsiz kargo.</p><div class="cs-grid">${cards}</div></div>`;
}
