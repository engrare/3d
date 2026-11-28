/* Panelde sepet/sipariş kaleminin müşterinin tasarladığı 2D önizlemesi (yazı, renk, logo, sosyal QR).
   Ana sitedeki sipariş detayı önizlemesinin (myScript.js renderOrderDetailPreview) panel karşılığı:
   aynı motor (preview-engine.js) ve aynı ürün/yerleşim verisi (products.js; panel tasarımı varsa onun yerleşimi). */
import { paintPreview, previewOf, customObjFor, placeSocialOverlays, itemSocialState, logoLayerStyle } from '../preview-engine.js?v=111';
import { products as BASE, cleanDesign, designUsable, designToProduct } from '../products.js?v=24';

const HEX = /^#[0-9a-fA-F]{6}$/;
const color = (v, fb) => (HEX.test(v) ? v : fb);
// CSS url(...) ve src içinde güvenle kullanılabilecek adres; site içi yollar panelden bir üst klasöre göre
function safeUrl(v) {
    if (typeof v !== 'string' || !/^[A-Za-z0-9\-._~:/?#@!$&+,=%;]+$/.test(v)) return '';
    return v.startsWith('./') ? '.' + v : v;
}
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let seq = 0;

/* Ürün tanımı: koddaki ürün; panel tasarımı (override) varsa onun yerleşimi, panel ürünü (kimlik >= 10) tamamen tasarımdan */
function productFor(id, overrides) {
    const base = BASE.find((p) => p.id === id) || null;
    const d = cleanDesign(overrides && overrides[id] && overrides[id].design);
    if (d && d.variants && designUsable(d)) return designToProduct(id, d, base);
    return base;
}

/* Sepet kalemi için önizleme kutusunun HTML'i ve çizim işlevi. Dönen { html, paint }: html sayfaya konur, sonra paint() çağrılır. */
export function itemPreview(item, overrides) {
    const p = productFor(parseInt(item.productId, 10), overrides);
    if (!p) return null;
    const n = 'ip' + (++seq);
    const o = customObjFor(p, item);
    const textArea = (o && o.previewTextArea) || p.previewTextArea || { top: '15%', left: '10%', width: '80%', height: '70%' };
    const logoArea = (o && o.previewLogoArea) || p.previewLogoArea || { top: '15%', left: '10%', width: '80%', height: '70%' };
    const textColor = color(item.textColor, '#FBC02D');
    const objColor = color(item.objColor, textColor);
    const logoUrl = safeUrl(item.logoUrl);
    const hasText = !p.isCustomObject && !p.noText && item.customText;
    const social = (i) => (p.isCustomObject && item['socialPlatform' + i]) ? `
        <div id="${n}-social-qr-area-${i}-0" style="position:absolute;inset:0;z-index:3;display:none;transform-origin:0 0"><img id="${n}-social-qr-img-${i}-0" src="" alt="" style="position:absolute;width:100%;height:100%;object-fit:fill"></div>
        <div id="${n}-social-logo-area-${i}-0" style="position:absolute;inset:0;z-index:3;display:none;transform-origin:0 0"><img id="${n}-social-logo-img-${i}-0" src="" alt="" style="position:absolute;width:100%;height:100%;object-fit:contain" onerror="this.style.visibility='hidden'"></div>` : '';
    const html = `<div class="cart-design" id="${n}-box" style="position:relative;overflow:hidden;background:#fff;border-radius:6px;width:100%;aspect-ratio:16/9">
        <div style="position:absolute;inset:0;background-color:${objColor};z-index:1"></div>
        <img id="${n}-img" src="" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;z-index:2;display:none">
        ${hasText ? `<div id="${n}-text-area" style="position:absolute;top:${textArea.top};left:${textArea.left};width:${textArea.width};height:${textArea.height};z-index:3;display:flex;align-items:center;justify-content:center;overflow:hidden"><span id="${n}-text" style="color:${textColor};font-family:'AGENCYB',sans-serif;font-weight:700;text-align:center;white-space:nowrap;line-height:1;display:inline-block">${esc(item.customText)}</span></div>` : ''}
        ${logoUrl ? `<div style="position:absolute;top:${logoArea.top};left:${logoArea.left};width:${logoArea.width};height:${logoArea.height};z-index:3;display:flex;align-items:center;justify-content:center;overflow:hidden"><div style="${logoLayerStyle(logoUrl, textColor)}"></div></div>` : ''}
        ${social(1)}${social(2)}
    </div>`;
    const paint = () => {
        const box = document.getElementById(n + '-box');
        // Görsel yolları site köküne göre ("./content/..."); panel /admin/ altında olduğu için bir üst klasöre çevrilir
        const pv = previewOf(p, item), up = (x) => (typeof x === 'string' ? x.replace(/^\.\//, '../') : x);
        paintPreview(document.getElementById(n + '-img'), { src: up(pv.src), mask: up(pv.mask) }, textColor, (aspect, status) => {
            if (status === 'error' || !box) return;
            if (aspect) box.style.aspectRatio = String(aspect);
            requestAnimationFrame(() => {
                if (o) placeSocialOverlays(o, n, '-0', itemSocialState(item), { x: 0, y: 0, w: box.clientWidth, h: box.clientHeight });
                // Yazı kutuya sığacak en büyük boyuta ayarlanır (ana sitedeki fitOrderDetailText ile aynı)
                const area = document.getElementById(n + '-text-area'), t = document.getElementById(n + '-text');
                if (area && t && area.clientWidth > 0) {
                    let fs = area.clientHeight * 0.95;
                    t.style.fontSize = fs + 'px';
                    if (t.offsetWidth > area.clientWidth) t.style.fontSize = (fs * area.clientWidth / t.offsetWidth) + 'px';
                }
            });
        });
    };
    return { html, paint };
}
