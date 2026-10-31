/* Sosyal Medya & Reklam sekmesi: Instagram rakamları, Reels performans analizi, AI öğrenimleri, reklam.
   Veri edit.engrare.com sunucusunda durur (AI Stüdyo da oradan öğrenir). Panel iki fonksiyonla okur:
   socialStats (kayıtlı veri, Meta'ya gidilmez) ve socialRefresh (Yenile: Meta'dan yeniden çeker).
   Sunucu ayrıca her gece 00:00'da yeniler. Panel kendiliğinden yenilemez; yalnız arka planda video incelemesi
   ya da AI yorumu sürerken kayıtlı veriyi 20 sn'de bir okur (en çok 15 dk, sekme açıkken).
   Grafikler satır içi SVG: tek eksen, ölçeği farklı ölçümler ayrı küçük grafiklerde, dokunulan noktada açıklama,
   her grafiğin tablo görünümü var. Renkler: mavi #2a78d6 + turuncu #eb6834 (beyaz zeminde renk körlüğü
   kontrolünden geçti); yazılar her zaman metin rengi. */

const CACHE = 'engrare_social_cache';
const POLL_MS = 20000, POLL_MAX_MS = 15 * 60 * 1000;
const COL = {
    s1: '#2a78d6', s2: '#eb6834', grid: '#E2E8F0', base: '#CBD5E1', ink: '#0F172A', muted: '#64748B',
    track: '#cde2fb', scene: ['#cde2fb', '#b7d3f6'], voice: '#3987e5'
};
const PARTS = [
    ['hook', 'Açılış', "İlk 3 sn'de geçmeyenlerin oranı"],
    ['hold', 'İzlenme', 'Ortalama izleme süresi / video süresi'],
    ['value', 'Değer', 'Kaydet + paylaş / erişim (%2 = 100)'],
    ['engage', 'Etkileşim', 'Etkileşim / erişim (%8 = 100)'],
    ['reach', 'Dağıtım', 'Erişim / hesabın ortalaması (2 katı = 100)']
];
const VERDICT = {
    'iyi': ['badge-success', 'fa-circle-check', 'İyi'],
    'orta': ['badge-warning', 'fa-circle-minus', 'Orta'],
    'zayıf': ['badge-danger', 'fa-circle-xmark', 'Zayıf']
};
const DIAG_ICON = { good: 'fa-circle-check so-good', bad: 'fa-triangle-exclamation so-bad', info: 'fa-circle-info so-info' };

let ctx = null;          // { call(name, payload), orders(), toast(msg, type) }
const adsModule = import('./ads.js?v=10');   // reklam yönetimi (Reels'ten Meta reklamı)
let data = null;         // son sunucu cevabı
let loading = false, refreshing = false, bound = false;
let pollTimer = null, pollStart = 0;
const openRows = new Set(), tableViews = new Set();

// ---------------------------------------------------------------- dışa açık

export function show(c) {
    ctx = c;
    bind();
    if (data) { render(); return; }
    const cached = readCache();
    if (cached) { data = cached; render(); note('Son bilinen veri gösteriliyor; sunucudan güncel kayıt alınıyor…', 'info'); }
    load();
}

export function reset() {
    data = null;
    openRows.clear();
    adsModule.then((m) => m.reset()).catch(() => {});
    stopPoll();
    hideTip();
    try { localStorage.removeItem(CACHE); } catch (e) { /* yok sayılır */ }
    const r = root();
    if (r) r.innerHTML = '<div class="so-empty">Giriş yapınca yüklenecek.</div>';
    const u = document.getElementById('so-updated');
    if (u) u.textContent = '';
}

// ---------------------------------------------------------------- yükleme

const root = () => document.getElementById('so-root');
const visible = () => { const s = document.getElementById('social-section'); return !!s && s.classList.contains('active'); };

function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) { return null; }
}
function writeCache() {
    try { localStorage.setItem(CACHE, JSON.stringify(data)); } catch (e) { /* kota: önbelleksiz devam */ }
}
const errText = (e) => (e && e.message) || 'Sunucuya ulaşılamadı.';

async function load(quiet = false) {
    if (loading || !ctx) return;
    loading = true;
    try {
        data = await ctx.call('socialStats');
        writeCache();
        render();
        schedulePoll();
    } catch (e) {
        console.error('socialStats:', e);
        if (!quiet) {
            if (!data) root().innerHTML = `<div class="so-empty so-error"><i class="fa-solid fa-plug-circle-xmark"></i> ${esc(errText(e))}</div>`;
            else note(`${errText(e)} Son bilinen veri gösteriliyor.`, 'error');
        }
    } finally {
        loading = false;
    }
}

async function refresh() {
    if (refreshing || !ctx) return;
    refreshing = true;
    const btn = document.getElementById('so-refresh');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Yenileniyor'; }
    root().classList.add('so-dim');
    try {
        data = await ctx.call('socialRefresh');
        writeCache();
        render();
        ctx.toast(data.note || 'İstatistikler Instagram\'dan yenilendi.', data.note ? 'info' : 'success');
        schedulePoll();
    } catch (e) {
        console.error('socialRefresh:', e);
        ctx.toast(errText(e), 'error');
    } finally {
        refreshing = false;
        root().classList.remove('so-dim');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Yenile'; }
    }
}

// Excel: ekrandaki tüm veri (Instagram günlük, Reels, AI öğrenimleri, reklam, site davranışı) etiketli sayfalarda
async function exportExcel() {
    if (!data || !ctx) { ctx && ctx.toast('Önce veri yüklenmeli.', 'error'); return; }
    const btn = document.getElementById('so-export');
    if (btn) btn.disabled = true;
    try {
        const [{ buildXlsx }, { sheets }, ads] = await Promise.all([import('./xlsx-lite.js?v=1'), import('./social-xlsx.js?v=2'), adsModule]);
        let ov = ads.overview();
        if (!ov) { try { ov = await ads.fetchOverview(); } catch (e) { /* kampanya sayfası boş kalır */ } }
        const list = sheets(data, ov, ctx.orders(), { istDay, sitePageName, siteClickName, siteErrName, siteEv: SITE_EV, siteSrc: SITE_SRC });
        const blob = await buildXlsx(list);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `engrare-sosyal-medya-${new Date().toLocaleDateString('sv-SE')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        if (ctx.audit) ctx.audit('export', 'Excel', `Sosyal medya & reklam: ${list.length} sayfa, ${(data.reels || []).length} Reels`);
        ctx.toast(`Excel hazır (${list.length} sayfa).${ov ? '' : ' Reklam kampanyaları alınamadı, o sayfa yok.'}`, ov ? 'success' : 'info');
    } catch (e) {
        console.error('Sosyal Excel:', e);
        ctx.toast('Excel oluşturulamadı: ' + errText(e), 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

const busy = () => !!(data && data.busy && (data.busy.bg || data.busy.process || data.busy.analysis));

function schedulePoll() {
    if (!busy()) { stopPoll(); return; }
    if (!pollStart) pollStart = Date.now();
    if (Date.now() - pollStart > POLL_MAX_MS) { stopPoll(); return; }
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
        pollTimer = null;
        if (visible() && document.visibilityState === 'visible') load(true);
        else schedulePoll();
    }, POLL_MS);
}
function stopPoll() { clearTimeout(pollTimer); pollTimer = null; pollStart = 0; }

function bind() {
    if (bound) return;
    bound = true;
    const btn = document.getElementById('so-refresh');
    if (btn) btn.addEventListener('click', refresh);
    const xl = document.getElementById('so-export');
    if (xl) xl.addEventListener('click', exportExcel);
    let t = null;
    window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => { if (data && visible()) render(); }, 200);
    });
    document.addEventListener('scroll', hideTip, true);
}

// ---------------------------------------------------------------- biçim

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n) => (Number(n) || 0).toLocaleString('tr-TR');
const dec = (n, d = 1) => (Number(n) || 0).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 1) => '%' + dec(n, d);
const money = (n) => '₺' + (Number(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 0 });
const istDay = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
const dayLabel = (d) => `${d.slice(8)}.${d.slice(5, 7)}`;
const longDay = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'short' });
const when = (sec) => new Date(sec * 1000).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const sec = (s) => `${dec(s)} sn`;

function lastDays(n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(istDay(Date.now() - i * 864e5));
    return out;
}

function note(text, type = 'info') {
    const el = document.getElementById('so-note');
    if (!el) return;
    el.className = `so-note so-note-${type}`;
    el.textContent = text;
    el.hidden = !text;
}

// ---------------------------------------------------------------- açıklama kutusu (tooltip)

let tipEl = null;
function tip() {
    if (!tipEl) {
        tipEl = document.createElement('div');
        tipEl.className = 'so-tip';
        tipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(tipEl);
    }
    return tipEl;
}
/* rows: [{ value, label, color }] — değer önde ve kalın, ad arkada; renk yalnızca kısa çizgi anahtarında */
function showTip(x, y, title, rows) {
    const t = tip();
    t.replaceChildren();
    const h = document.createElement('div');
    h.className = 'so-tip-title';
    h.textContent = title;
    t.appendChild(h);
    for (const r of rows) {
        const row = document.createElement('div');
        row.className = 'so-tip-row';
        if (r.color) { const k = document.createElement('i'); k.className = 'so-key'; k.style.background = r.color; row.appendChild(k); }
        if (r.value !== undefined && r.value !== '') { const b = document.createElement('b'); b.textContent = r.value; row.appendChild(b); }
        if (r.label) { const s = document.createElement('span'); s.textContent = r.label; row.appendChild(s); }
        t.appendChild(row);
    }
    t.style.display = 'block';
    const pad = 14, w = t.offsetWidth, hh = t.offsetHeight;
    let left = x + pad, top = y + pad;
    if (left + w > innerWidth - 8) left = x - w - pad;
    if (top + hh > innerHeight - 8) top = y - hh - pad;
    t.style.left = `${Math.max(8, left)}px`;
    t.style.top = `${Math.max(8, top)}px`;
}
function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

// ---------------------------------------------------------------- SVG yardımcıları

const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, text) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    return el;
}
/* Okunaklı eksen adımları: tam sayı ölçümlerde ondalık adım yok */
function ticks(max, count = 4) {
    if (!(max > 0)) return [0, 1];
    const raw = max / count;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    let step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
    if (step < 1) step = 1;
    if (step % 1) step = Math.ceil(step);
    const out = [];
    for (let v = 0; v <= Math.ceil(max / step) * step + 1e-9; v += step) out.push(v);
    return out;
}
/* Üstü 4 px yuvarlak, tabanı kare sütun */
function barPath(x, y, w, h, r = 4) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/* Çizgi grafik (tek eksen, aynı birim): artı imleci en yakın güne oturur, açıklamada tüm seriler */
function lineChart(host, keys, series, rowOf) {
    host.replaceChildren();
    const W = Math.max(260, host.clientWidth), H = 210, L = 40, R = 14, T = 12, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const vals = series.map((s) => keys.map((k) => { const r = rowOf(k); return r ? Number(r[s.key]) || 0 : null; }));
    const tk = ticks(Math.max(1, ...vals.flat().filter((v) => v !== null)));
    const top = tk[tk.length - 1];
    const x = (i) => L + (keys.length === 1 ? pw / 2 : (i / (keys.length - 1)) * pw);
    const y = (v) => T + ph - (v / top) * ph;
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'so-svg', role: 'img',
        'aria-label': series.map((s) => s.label).join(' ve ') + ', son 30 gün' });
    for (const v of tk) {
        svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: v ? COL.grid : COL.base, 'stroke-width': 1 }));
        svg.appendChild(svgEl('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'so-ax' }, fmt(v)));
    }
    keys.forEach((k, i) => {
        if ((keys.length - 1 - i) % 7 === 0) svg.appendChild(svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'so-ax' }, dayLabel(k)));
    });
    series.forEach((s, si) => {
        let d = '', pen = false;
        vals[si].forEach((v, i) => {
            if (v === null) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
            pen = true;
        });
        svg.appendChild(svgEl('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        const li = vals[si].map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
        if (li !== undefined) {
            const partial = !!(rowOf(keys[li]) || {}).partial;
            svg.appendChild(svgEl('circle', { cx: x(li), cy: y(vals[si][li]), r: 4, fill: partial ? '#fff' : s.color, stroke: partial ? s.color : '#fff', 'stroke-width': 2 }));
        }
    });
    const cross = svgEl('line', { y1: T, y2: T + ph, stroke: COL.muted, 'stroke-width': 1, visibility: 'hidden' });
    svg.appendChild(cross);
    const dots = series.map((s) => { const c = svgEl('circle', { r: 4, fill: s.color, stroke: '#fff', 'stroke-width': 2, visibility: 'hidden' }); svg.appendChild(c); return c; });
    const hit = svgEl('rect', { x: L, y: T, width: pw, height: ph, fill: 'transparent', tabindex: 0, class: 'so-hit' });
    svg.appendChild(hit);
    let idx = keys.length - 1;
    const at = (i, cx, cy) => {
        idx = Math.max(0, Math.min(keys.length - 1, i));
        cross.setAttribute('x1', x(idx)); cross.setAttribute('x2', x(idx)); cross.setAttribute('visibility', 'visible');
        series.forEach((s, si) => {
            const v = vals[si][idx];
            dots[si].setAttribute('visibility', v === null ? 'hidden' : 'visible');
            if (v !== null) { dots[si].setAttribute('cx', x(idx)); dots[si].setAttribute('cy', y(v)); }
        });
        const row = rowOf(keys[idx]) || {};
        showTip(cx, cy, longDay(keys[idx]) + (row.partial ? ' · bugün, sürüyor' : ''),
            series.map((s, si) => ({ value: vals[si][idx] === null ? 'veri yok' : fmt(vals[si][idx]), label: s.label, color: s.color })));
    };
    const fromEvent = (e) => Math.round(((e.clientX - svg.getBoundingClientRect().left - L) / pw) * (keys.length - 1));
    hit.addEventListener('pointermove', (e) => at(fromEvent(e), e.clientX, e.clientY));
    hit.addEventListener('pointerdown', (e) => at(fromEvent(e), e.clientX, e.clientY));
    const leave = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); hideTip(); };
    hit.addEventListener('pointerleave', leave);
    hit.addEventListener('blur', leave);
    const keyAt = () => { const b = svg.getBoundingClientRect(); return [b.left + x(idx), b.top + T + 10]; };
    hit.addEventListener('focus', () => at(idx, ...keyAt()));
    hit.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        idx += e.key === 'ArrowRight' ? 1 : -1;
        at(idx, ...keyAt());
    });
    host.appendChild(svg);
}

/* Sütun grafik (tek seri): her sütun kendi açıklamasını taşır; yalnız en yüksek değer sütunun üstünde yazılı */
function colChart(host, keys, values, label, unit = '') {
    host.replaceChildren();
    const W = Math.max(200, host.clientWidth), H = 132, L = 28, R = 6, T = 16, B = 22;
    const pw = W - L - R, ph = H - T - B, band = pw / keys.length, bw = Math.max(2, Math.min(24, band - 2));
    const max = Math.max(0, ...values.filter((v) => v !== null));
    const tk = ticks(Math.max(1, max), 2);
    const top = tk[tk.length - 1];
    const y = (v) => T + ph - (v / top) * ph;
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'so-svg', role: 'img', 'aria-label': `${label}, günlük` });
    for (const v of tk) {
        svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: v ? COL.grid : COL.base, 'stroke-width': 1 }));
        svg.appendChild(svgEl('text', { x: L - 5, y: y(v) + 3.5, 'text-anchor': 'end', class: 'so-ax' }, fmt(v)));
    }
    const maxI = max > 0 ? values.lastIndexOf(max) : -1;
    keys.forEach((k, i) => {
        const v = values[i];
        const bx = L + i * band + (band - bw) / 2;
        if (v) {
            const p = svgEl('path', { d: barPath(bx, y(v), bw, T + ph - y(v)), fill: COL.s1, class: 'so-bar' });
            svg.appendChild(p);
        }
        if (i === maxI) svg.appendChild(svgEl('text', { x: bx + bw / 2, y: y(v) - 4, 'text-anchor': 'middle', class: 'so-val' }, fmt(v)));
        if ((keys.length - 1 - i) % 7 === 0) svg.appendChild(svgEl('text', { x: bx + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'so-ax' }, dayLabel(k)));
        const hit = svgEl('rect', { x: L + i * band, y: T, width: band, height: ph, fill: 'transparent', tabindex: -1, class: 'so-hit' });
        const showIt = (cx, cy) => showTip(cx, cy, longDay(k), [{ value: v === null ? 'veri yok' : fmt(v) + unit, label }]);
        hit.addEventListener('pointermove', (e) => showIt(e.clientX, e.clientY));
        hit.addEventListener('pointerdown', (e) => showIt(e.clientX, e.clientY));
        hit.addEventListener('pointerleave', hideTip);
        svg.appendChild(hit);
    });
    host.appendChild(svg);
}

// ---------------------------------------------------------------- hesaplar

function dayIndex() {
    return Object.fromEntries(((data && data.days) || []).map((r) => [r.d, r]));
}
function ordersByDay() {
    const out = {};
    for (const o of (ctx && ctx.orders ? ctx.orders() : [])) {
        const d = istDay(o.t);
        out[d] = out[d] || { n: 0, total: 0 };
        out[d].n += 1;
        out[d].total += Number(o.total) || 0;
    }
    return out;
}
const sum = (keys, f) => keys.reduce((a, k) => a + (f(k) || 0), 0);

// ---------------------------------------------------------------- çizim

function render() {
    const r = root();
    if (!r || !data) return;
    hideTip();
    const upd = document.getElementById('so-updated');
    if (upd) {
        upd.textContent = data.updated
            ? `Son güncelleme ${when(data.updated)} (${data.updated_by === 'midnight' ? 'gece otomatik' : 'Yenile ile'}) · sonraki otomatik 00:00`
            : 'Henüz hiç yenilenmedi';
    }
    if (!data.updated && !(data.reels || []).length) {
        r.innerHTML = '<div class="so-empty">Henüz veri yok. <b>Yenile</b>\'ye basınca Instagram\'dan çekilir (ilk sefer 30 günü getirir, yarım dakika kadar sürer).</div>';
        return;
    }
    const byDay = dayIndex();
    const ord = ordersByDay();
    const d30 = lastDays(30), d7 = d30.slice(-7), p7 = d30.slice(-14, -7);
    const acc = data.account || {};
    const kv = (keys, key) => sum(keys, (k) => (byDay[k] || {})[key]);

    r.innerHTML = `
        <div id="so-note" class="so-note" hidden></div>
        <div class="so-kpis">${kpis(acc, kv, ord, d7, p7)}</div>
        <div class="so-grid">
            <div class="card so-card">
                <div class="card-header"><h4>Günlük erişim ve görüntüleme <small>son 30 gün</small></h4>${tableToggle('reach')}</div>
                <div class="so-legend"><span><i class="so-line" style="background:${COL.s1}"></i>Erişim (tekil hesap)</span><span><i class="so-line" style="background:${COL.s2}"></i>Görüntüleme</span></div>
                <div class="so-chart" id="so-ch-reach"></div>
                <div class="so-table-view" id="so-tb-reach" hidden></div>
            </div>
            <div class="card so-card">
                <div class="card-header"><h4>Huni <small>son 30 gün</small></h4></div>
                ${funnel(kv, ord, d30)}
            </div>
        </div>
        <div class="card so-card">
            <div class="card-header"><h4>Profil, site ve sipariş <small>günlük, son 30 gün</small></h4>${tableToggle('daily')}</div>
            <div class="so-multi">
                <div><div class="so-mt">Profil ziyareti <b>${fmt(kv(d30, 'profile_views'))}</b></div><div class="so-chart" id="so-ch-profile"></div></div>
                <div><div class="so-mt">Site tıklaması <b>${fmt(kv(d30, 'website_clicks'))}</b></div><div class="so-chart" id="so-ch-clicks"></div></div>
                <div><div class="so-mt">Sipariş <b>${fmt(sum(d30, (k) => (ord[k] || {}).n))}</b></div><div class="so-chart" id="so-ch-orders"></div></div>
            </div>
            <div class="so-table-view" id="so-tb-daily" hidden></div>
            <p class="so-fine">Site tıklaması: Instagram profilindeki bağlantıya dokunma. Sipariş: sitedeki tüm siparişler (iptal ve ödeme bekleyenler hariç); kaynağı ayrılmıyor.</p>
        </div>
        ${siteCard()}
        ${reelsCard()}
        ${learningsCard()}
        ${adsCard()}
        <div id="so-ads-manage"></div>`;

    const status = [];
    if (data.busy && data.busy.process) status.push('yeni videolar inceleniyor');
    if (data.busy && data.busy.analysis) status.push('AI yorumu hazırlanıyor');
    if (status.length) note(`Arka planda ${status.join(', ')}; bitince burada görünür.`, 'info');

    lineChart(document.getElementById('so-ch-reach'), d30,
        [{ key: 'reach', label: 'Erişim', color: COL.s1 }, { key: 'views', label: 'Görüntüleme', color: COL.s2 }], (k) => byDay[k]);
    const col = (id, f, label) => colChart(document.getElementById(id), d30, d30.map(f), label);
    col('so-ch-profile', (k) => (byDay[k] ? byDay[k].profile_views || 0 : null), 'profil ziyareti');
    col('so-ch-clicks', (k) => (byDay[k] ? byDay[k].website_clicks || 0 : null), 'site tıklaması');
    col('so-ch-orders', (k) => (ord[k] || {}).n || 0, 'sipariş');
    fillTables(byDay, ord, d30);
    const vh = document.getElementById('so-ch-visits');
    if (vh) colChart(vh, data.site.days.map((x) => x.d), data.site.days.map((x) => x.loads), 'ziyaret');
    const ih = document.getElementById('so-ch-items');
    if (ih) {
        const sd = Object.fromEntries(data.site.days.map((x) => [x.d, { view: (x.ev || {}).view_item || 0, cart: (x.ev || {}).add_to_cart || 0 }]));
        lineChart(ih, data.site.days.map((x) => x.d),
            [{ key: 'view', label: 'Ürüne bakma', color: COL.s1 }, { key: 'cart', label: 'Sepete ekleme', color: COL.s2 }], (k) => sd[k]);
    }
    bindReels();
    for (const id of openRows) openDetail(id, true);
    adsModule.then((m) => m.mount(ctx, document.getElementById('so-ads-manage'), data.reels || []))
        .catch((e) => console.error('ads.js:', e));
}

function delta(now, prev, unit = '') {
    const d = now - prev;
    if (!prev && !now) return '<span class="so-delta">önceki 7 gün de 0</span>';
    if (d === 0) return '<span class="so-delta"><i class="fa-solid fa-equals"></i> önceki 7 günle aynı</span>';
    const up = d > 0;
    return `<span class="so-delta ${up ? 'so-up' : 'so-down'}"><i class="fa-solid ${up ? 'fa-arrow-up' : 'fa-arrow-down'}"></i> ${up ? '+' : ''}${fmt(d)}${unit} önceki 7 güne göre</span>`;
}

function kpis(acc, kv, ord, d7, p7) {
    // takipçi geçmişi sunucunun günlük kaydından (Meta 100 takipçiden önce vermiyor): 7 günlük pencereden önceki son kayıt
    const folNow = acc.followers_count;
    const base = (data.followers || []).filter((x) => x.d < d7[0]).pop();
    const folSub = base
        ? delta(folNow, base.n)
        : `<span class="so-delta">takip ettiği ${fmt(acc.follows_count)} · değişim bir hafta sonra görünür</span>`;
    const o7 = sum(d7, (k) => (ord[k] || {}).n), op7 = sum(p7, (k) => (ord[k] || {}).n);
    const tile = (label, value, sub) => `<div class="so-kpi"><span class="so-kpi-l">${label}</span><span class="so-kpi-v">${value}</span>${sub}</div>`;
    return [
        tile('Takipçi', fmt(folNow), folSub),
        tile('Erişim · 7 gün', fmt(kv(d7, 'reach')), delta(kv(d7, 'reach'), kv(p7, 'reach'))),
        tile('Profil ziyareti · 7 gün', fmt(kv(d7, 'profile_views')), delta(kv(d7, 'profile_views'), kv(p7, 'profile_views'))),
        tile('Site tıklaması · 7 gün', fmt(kv(d7, 'website_clicks')), delta(kv(d7, 'website_clicks'), kv(p7, 'website_clicks'))),
        tile('Sipariş · 7 gün', fmt(o7), delta(o7, op7))
    ].join('');
}

function funnel(kv, ord, d30) {
    const reach = kv(d30, 'reach'), prof = kv(d30, 'profile_views'), click = kv(d30, 'website_clicks');
    const orders = sum(d30, (k) => (ord[k] || {}).n), rev = sum(d30, (k) => (ord[k] || {}).total);
    const rate = (a, b) => (b ? pct((a / b) * 100) : '—');
    const step = (label, v, sub) => `<li class="so-fs"><b class="so-fs-v">${fmt(v)}</b><span class="so-fs-l">${label}${sub ? ` <small>${sub}</small>` : ''}</span></li>`;
    const arrow = (r, what) => `<li class="so-fa"><i class="fa-solid fa-arrow-down"></i><b>${r}</b><span>${what}</span></li>`;
    return `<ol class="so-funnel">
        ${step('Erişim', reach, 'günlük toplamlar')}${arrow(rate(prof, reach), 'profile girdi')}
        ${step('Profil ziyareti', prof)}${arrow(rate(click, prof), 'siteye tıkladı')}
        ${step('Site tıklaması', click)}${arrow(rate(orders, click), 'sipariş verdi')}
        ${step('Sipariş', orders, money(rev))}
    </ol>
    <p class="so-fine">Oranlar bir önceki adıma göredir. Erişim günlük toplamdır (aynı kişi birden çok gün sayılabilir). Siparişin Instagram'dan gelip gelmediği henüz ayrılmıyor.</p>`;
}

function tableToggle(id) {
    const on = tableViews.has(id);
    return `<button type="button" class="btn-sm so-tt" data-tt="${id}" aria-pressed="${on}"><i class="fa-solid ${on ? 'fa-chart-line' : 'fa-table'}"></i> ${on ? 'Grafik' : 'Tablo'}</button>`;
}

function fillTables(byDay, ord, d30) {
    const rows = [...d30].reverse();
    const reach = document.getElementById('so-tb-reach');
    reach.innerHTML = `<table class="so-tbl"><thead><tr><th>Gün</th><th>Erişim</th><th>Görüntüleme</th><th>Takipçi olmayan erişim</th></tr></thead><tbody>${
        rows.map((k) => { const r = byDay[k]; return `<tr><td>${esc(longDay(k))}${r && r.partial ? ' (sürüyor)' : ''}</td><td>${r ? fmt(r.reach) : '—'}</td><td>${r ? fmt(r.views) : '—'}</td><td>${r && r.reach_nf !== undefined ? fmt(r.reach_nf) : '—'}</td></tr>`; }).join('')}</tbody></table>`;
    const daily = document.getElementById('so-tb-daily');
    daily.innerHTML = `<table class="so-tbl"><thead><tr><th>Gün</th><th>Profil ziyareti</th><th>Site tıklaması</th><th>Sipariş</th><th>Ciro</th></tr></thead><tbody>${
        rows.map((k) => { const r = byDay[k], o = ord[k] || { n: 0, total: 0 }; return `<tr><td>${esc(longDay(k))}</td><td>${r ? fmt(r.profile_views) : '—'}</td><td>${r ? fmt(r.website_clicks) : '—'}</td><td>${fmt(o.n)}</td><td>${money(o.total)}</td></tr>`; }).join('')}</tbody></table>`;
    for (const id of ['reach', 'daily']) applyTableView(id);
    root().querySelectorAll('.so-tt').forEach((b) => b.addEventListener('click', () => {
        const id = b.dataset.tt;
        if (tableViews.has(id)) tableViews.delete(id); else tableViews.add(id);
        const on = tableViews.has(id);
        b.setAttribute('aria-pressed', on);
        b.innerHTML = `<i class="fa-solid ${on ? 'fa-chart-line' : 'fa-table'}"></i> ${on ? 'Grafik' : 'Tablo'}`;
        applyTableView(id);
    }));
}
function applyTableView(id) {
    const on = tableViews.has(id);
    const tb = document.getElementById(`so-tb-${id}`);
    if (tb) tb.hidden = !on;
    const card = tb && tb.closest('.so-card');
    if (card) card.querySelectorAll('.so-chart, .so-legend, .so-multi').forEach((el) => { el.hidden = on; });
}

// ---------------------------------------------------------------- Site davranışı (kimliksiz sayaç: frontend/olcum.js -> edit sunucusu)

const SITE_PAGES = { urunler: 'Ürün listesi', sepet: 'Sepet', giris: 'Giriş / kayıt', hesabim: 'Hesabım', odeme: 'Ödeme', sonuc: 'Ödeme sonucu' };
const SITE_SRC = { instagram: 'Instagram', facebook: 'Facebook', google: 'Google', direkt: 'Doğrudan', diger: 'Diğer site' };
const SITE_EV = { view_item: 'Ürüne bakma', add_to_cart: 'Sepete ekleme', begin_checkout: 'Ödemeye geçme', odeme_baslat: 'Kart ödemesine geçme', purchase: 'Satın alma' };

function sitePageName(p) {
    if (SITE_PAGES[p]) return SITE_PAGES[p];
    if (p.startsWith('urun/')) return `Ürün: ${p.slice(5)}`;
    if (p.startsWith('mevzuat/')) return `Yasal: ${p.slice(8)}`;
    return p;
}
// Sayfa adı "-de/-da" biçiminde: "Kullanıcı ürün listesinde ..." cümlesi için
const SITE_WHERE = { urunler: 'ürün listesinde', urun: 'ürün sayfasında', sepet: 'sepette', giris: 'giriş sayfasında', hesabim: 'hesabında',
    odeme: 'ödeme sayfasında', sonuc: 'ödeme sonucu sayfasında', mevzuat: 'yasal sayfada' };
// Ölçülen öğe (id/sınıf) -> ne yaptığı. Bilinmeyenler olduğu gibi (okunur biçimde) gösterilir.
const SITE_CLICK = {
    'cookie-accept': 'çerezleri kabul etti', 'cookie-reject': 'çerezleri reddetti',
    'model-card': 'bir ürüne bastı', 'carousel-next': 'ürün görselinde sonrakine geçti', 'carousel-prev': 'ürün görselinde öncekine döndü',
    'detail-thumbnails': 'ürün küçük resimlerine baktı', 'detail-wa': 'WhatsApp ile soru sormak için bastı', 'detail-rating': 'müşteri yorumlarına baktı',
    'reviews-more': 'daha fazla yorum gösterdi', 'design-hint-text': 'canlı önizleme ipucuna bastı',
    'custom-object-tab': 'stand modelini (bölme sayısını) değiştirdi', 'color-combinations-container': 'renk seçti',
    'logo-bubble': 'hazır bir logo seçti', 'upload-logo-trigger': 'kendi logosunu yüklemek için bastı', 'custom-logo-input': 'logo dosyası seçti',
    'custom-text-input': 'yazı alanına bastı', 'custom-text-color': 'yazı rengini değiştirdi', 'custom-obj-color': 'ürün rengini değiştirdi',
    'custom-social-link-n': 'QR bilgisi alanına bastı', 'custom-social-platform-n': 'QR platformunu değiştirdi', 'social-icon-btn': 'QR için sosyal medya seçti',
    'advanced-nd-preview-container': 'canlı önizlemeye bastı', 'preview-dynamic-logo': 'önizlemedeki logoya bastı',
    'quantity-input': 'adet alanına bastı', 'detail-qty-plus': 'adedi artırdı', 'detail-qty-minus': 'adedi azalttı',
    'add-to-cart': 'Sepete Ekle düğmesine bastı', 'btn-checkout-start': 'Ödemeye Geç düğmesine bastı',
    'nav-lookup-pill': 'üstteki sipariş/sepet düğmesine bastı', 'mobile-bottom-nav': 'alt menüye bastı', 'bottom-nav-item': 'alt menüde bir sekmeye bastı',
    'footer-social': 'altbilgideki sosyal medya bağlantısına bastı', 'footer-phone': 'altbilgideki telefona bastı', 'footer-logo': 'altbilgideki logoya bastı',
    'btn-signin': 'giriş yap düğmesine bastı', 'btn-signup': 'kayıt ol düğmesine bastı', 'btn-order-lookup': 'sipariş sorgula düğmesine bastı',
    'btn-forgot-password': 'şifre sıfırlama düğmesine bastı', 'btn-complete-order': 'siparişi tamamla düğmesine bastı',
    'btn-apply-discount': 'indirim kodunu uyguladı', 'discount-code-input': 'indirim kodu alanına bastı', 'preinfo-check': 'ön bilgilendirmeyi onayladı',
    'contact-email': 'e-posta alanına bastı', 'contact-phone': 'telefon alanına bastı', 'ship-name': 'ad alanına bastı', 'ship-surname': 'soyad alanına bastı',
    'ship-address': 'adres alanına bastı', 'ship-city': 'şehir alanına bastı', 'ship-district': 'ilçe alanına bastı',
    'nav-trigger': 'üst menüde bir sekmeye bastı', 'nav-menu': 'üst menüye bastı', 'a': 'bir bağlantıya bastı',
};
const SITE_TYPED = {
    'custom-text-input': 'yazı alanına yazdı', 'custom-social-link-n': 'QR bilgisi alanına yazdı', 'quantity-input': 'adet alanına yazdı',
    'contact-email': 'e-posta alanına yazdı', 'contact-phone': 'telefon alanına yazdı', 'ship-name': 'ad alanına yazdı', 'ship-surname': 'soyad alanına yazdı',
    'ship-address': 'adres alanına yazdı', 'ship-district': 'ilçe alanına yazdı', 'discount-code-input': 'indirim kodu alanına yazdı',
    'signin-email': 'giriş e-postasını yazdı', 'signin-password': 'giriş şifresini yazdı', 'lookup-order-id': 'sipariş numarasını yazdı', 'lookup-email': 'sipariş sorgusu e-postasını yazdı',
};
function siteHuman(id) { return id.replace(/[_\-]+/g, ' ').replace(/\bn\b/g, '').trim(); }
function siteClickName(k) {
    const [pg, rest] = k.split(/:(.*)/s);
    if (rest === undefined) return k;
    const typed = pg.startsWith('yaz_'), page = typed ? pg.slice(4) : pg;
    const where = SITE_WHERE[page] || page;
    const what = (typed ? SITE_TYPED : SITE_CLICK)[rest] || `“${siteHuman(rest)}” ${typed ? 'alanına yazdı' : 'öğesine bastı'}`;
    return `Kullanıcı ${where} ${what}.`;
}

// Hata olayları: sepete eklerken (sepet_hata_*) ve ödeme formunda (hata_<alan>)
const SITE_ERR = {
    sepet_hata_telefon_bos: 'Kullanıcı sepete eklerken telefon numarasını boş bıraktı',
    sepet_hata_telefon_gecersiz: 'Kullanıcı sepete eklerken geçersiz telefon numarası girdi',
    sepet_hata_metin_bos: 'Kullanıcı sepete eklerken ürün yazısını boş bıraktı',
    sepet_hata_qr_bos: 'Kullanıcı sepete eklerken QR bilgilerini girmedi',
    sepet_hata_whatsapp_gecersiz: 'Kullanıcı sepete eklerken geçersiz WhatsApp numarası girdi',
    sepet_hata_logo_yukleme: 'Kullanıcı sepete eklerken logosu yüklenemedi',
};
const SITE_FIELD = { 'contact-email': 'e-posta', 'contact-phone': 'telefon', 'ship-name': 'ad', 'ship-surname': 'soyad', 'ship-address': 'açık adres',
    'ship-city': 'şehir', 'ship-district': 'ilçe', alan: 'bilinmeyen' };
function siteErrName(k) {
    if (SITE_ERR[k]) return SITE_ERR[k];
    if (k.startsWith('sepet_hata_')) return `Kullanıcı sepete eklerken hata aldı (${siteHuman(k.slice(11))})`;
    const f = k.slice(5);
    return `Kullanıcı ödeme formunda ${SITE_FIELD[f] || siteHuman(f)} alanında hata aldı`;
}

function siteCard() {
    const st = data.site;
    if (!st || !st.total) return '';
    const t = st.total;
    const views = Object.values(t.pages).reduce((a, r) => a + r.v, 0);
    const secs = Object.values(t.pages).reduce((a, r) => a + r.sec, 0), nSec = Object.values(t.pages).reduce((a, r) => a + r.n, 0);
    if (!t.loads && !views) {
        return `<div class="card so-card"><div class="card-header"><h4>Site davranışı <small>son 30 gün</small></h4></div>
            <div class="so-empty">Ölçüm yeni başladı; ziyaretçiler geldikçe burada birikir. Çerez onayı beklemez, kimliksiz sayaçtır.</div></div>`;
    }
    const ev = (n) => t.events[n] || 0;
    const rate = (a, b) => (b ? pct((a / b) * 100) : '—');
    const tile = (label, value, sub = '') => `<div class="so-kpi"><span class="so-kpi-l">${label}</span><span class="so-kpi-v">${value}</span>${sub ? `<span class="so-delta">${sub}</span>` : ''}</div>`;
    const step = (label, v) => `<li class="so-fs"><b class="so-fs-v">${fmt(v)}</b><span class="so-fs-l">${label}</span></li>`;
    const arrow = (r, what) => `<li class="so-fa"><i class="fa-solid fa-arrow-down"></i><b>${r}</b><span>${what}</span></li>`;
    const today = st.days[st.days.length - 1] || {};
    const pages = Object.entries(t.pages).sort((a, b) => b[1].v - a[1].v).slice(0, 12);
    const srcTot = Object.values(t.src).reduce((a, n) => a + n, 0);
    const list = (obj, name, cap = 8) => Object.entries(obj).slice(0, cap).map(([k, n]) => `<tr><td>${esc(name(k))}</td><td>${fmt(n)}</td></tr>`).join('');
    const srcRows = Object.entries(t.src).sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `<tr><td>${esc(SITE_SRC[k] || k)}</td><td>${fmt(n)}</td><td>${rate(n, srcTot)}</td></tr>`).join('');
    const clicks = Object.entries(t.clicks).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const aband = Object.entries(t.abandon).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const errs = Object.entries(t.events).filter(([k]) => k.startsWith('sepet_hata_') || k.startsWith('hata_')).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const camps = Object.entries(t.camp).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return `<div class="card so-card">
        <div class="card-header"><h4>Site davranışı <small>son 30 gün · kimliksiz sayaç</small></h4></div>
        <div class="so-kpis so-kpis-sm">
            ${tile('Ziyaret', fmt(t.loads), `bugün ${fmt(today.loads || 0)}`)}
            ${tile('Sayfa görüntüleme', fmt(views), `bugün ${fmt(today.views || 0)}`)}
            ${tile('Sayfada kalma', nSec ? sec(secs / nSec) : '—', 'görüntüleme başına')}
            ${tile('Telefondan', rate(t.mobile, t.loads), `${fmt(t.mobile)} ziyaret`)}
        </div>
        <div class="so-grid">
            <div>
                <div class="so-mt">Günlük ziyaret</div>
                <div class="so-chart" id="so-ch-visits"></div>
            </div>
            <div>
                <div class="so-mt">Site hunisi</div>
                <ol class="so-funnel">
                    ${step('Ziyaret', t.loads)}${arrow(rate(ev('view_item'), t.loads), 'ürüne baktı (olay sayısı)')}
                    ${step('Ürüne bakma', ev('view_item'))}${arrow(rate(ev('add_to_cart'), ev('view_item')), 'sepete ekledi')}
                    ${step('Sepete ekleme', ev('add_to_cart'))}${arrow(rate(ev('begin_checkout'), ev('add_to_cart')), 'ödemeye geçti')}
                    ${step('Ödemeye geçme', ev('begin_checkout'))}${arrow(rate(ev('purchase'), ev('begin_checkout')), 'satın aldı')}
                    ${step('Satın alma', ev('purchase'))}
                </ol>
            </div>
        </div>
        <div class="so-mt" style="margin-top:16px">Günlük ürüne bakma ve sepete ekleme</div>
        <div class="so-legend"><span><i class="so-line" style="background:${COL.s1}"></i>Ürüne bakma</span><span><i class="so-line" style="background:${COL.s2}"></i>Sepete ekleme</span></div>
        <div class="so-chart" id="so-ch-items"></div>
        <div class="so-mt" style="margin-top:16px">Sayfalar</div>
        <div class="so-table-view"><table class="so-tbl"><thead><tr><th>Sayfa</th><th>Görüntüleme</th><th>Ort. süre</th><th>Aşağıya kadar</th></tr></thead><tbody>${
            pages.map(([p, r]) => `<tr><td>${esc(sitePageName(p))}</td><td>${fmt(r.v)}</td><td>${r.n ? sec(r.sec / r.n) : '—'}</td><td>${r.n ? rate(r.scroll[2], r.n) : '—'}</td></tr>`).join('')}</tbody></table></div>
        <div class="so-grid" style="margin-top:16px">
            <div>
                <div class="so-mt">En çok basılan / yazılan yerler</div>
                <div class="so-table-view"><table class="so-tbl"><tbody>${clicks.map(([k, n]) => `<tr><td>${esc(siteClickName(k))}</td><td>${fmt(n)}</td></tr>`).join('') || '<tr><td>Henüz yok</td><td></td></tr>'}</tbody></table></div>
            </div>
            <div>
                ${errs.length ? `<div class="so-mt">Kullanıcının hata aldığı yerler</div>
                <div class="so-table-view"><table class="so-tbl"><tbody>${errs.map(([k, n]) => `<tr><td>${esc(siteErrName(k))}</td><td>${fmt(n)}</td></tr>`).join('')}</tbody></table></div>
                <div class="so-mt" style="margin-top:12px">Nereden geldiler</div>` : '<div class="so-mt">Nereden geldiler</div>'}
                <table class="so-tbl"><tbody>${srcRows || '<tr><td>Henüz yok</td><td></td><td></td></tr>'}</tbody></table>
                ${camps.length ? `<div class="so-mt" style="margin-top:12px">Reklam kampanyaları</div><table class="so-tbl"><tbody>${list(Object.fromEntries(camps), (k) => k)}</tbody></table>` : ''}
                ${aband.length ? `<div class="so-mt" style="margin-top:12px">Ödemeden ayrılırken son alan</div><table class="so-tbl"><tbody>${list(Object.fromEntries(aband), (k) => k)}</tbody></table>` : ''}
            </div>
        </div>
        <p class="so-fine">Çerez onayı beklemeyen, kimliksiz sayaçtır: kişi, IP ya da cihaz kaydedilmez; "ziyaret" sayfa açılışıdır (aynı kişi tekrar gelirse yine sayılır). Olay oranları olay sayısına göredir, kişiye değil. Ödeme sayfası site içi geçiş olduğu için ziyaret sayılmaz. ${Object.entries(SITE_EV).filter(([k]) => ev(k)).map(([k, l]) => `${l}: ${fmt(ev(k))}`).join(' · ')}</p>
    </div>`;
}

// ---------------------------------------------------------------- Reels

function verdictBadge(sc) {
    if (!sc || sc.total === null || sc.total === undefined) return '<span class="badge badge-muted">Veri yok</span>';
    const [cls, icon, label] = VERDICT[sc.verdict] || ['badge-muted', 'fa-circle', '—'];
    return `<span class="so-score"><span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${label}</span><b>${sc.total}</b></span>`;
}

function reelsCard() {
    const reels = data.reels || [];
    const s = data.summary || {};
    if (!reels.length) return '<div class="card so-card"><div class="card-header"><h4>Reels performansı</h4></div><div class="so-empty">Henüz Reels yok.</div></div>';
    const med = [s.med_skip !== null && s.med_skip !== undefined ? `geçme ${pct(s.med_skip)}` : '',
        s.med_hold ? `izlenme ${pct(s.med_hold, 0)}` : '', s.med_reach ? `erişim ${fmt(Math.round(s.med_reach))}` : ''].filter(Boolean).join(' · ');
    const rows = reels.map((r) => {
        const m = r.m || {};
        const hold = r.dur && m.avg_ms ? ` <small>(${pct((m.avg_ms / 10) / r.dur, 0)})</small>` : '';
        return `<tr class="so-row" data-id="${esc(r.id)}" tabindex="0" aria-expanded="${openRows.has(r.id)}">
            <td class="so-vid">
                ${r.thumb ? `<img src="${esc(r.thumb)}" alt="" loading="lazy">` : '<span class="so-noimg"><i class="fa-solid fa-film"></i></span>'}
                <span class="so-vt"><span><b>#${r.n}</b> · ${esc(when(r.t))}${r.dur ? ` · ${dec(r.dur)} sn` : ''}</span><small>${esc((r.caption || '').split('\n')[0].slice(0, 90))}</small></span>
            </td>
            <td data-l="Puan">${verdictBadge(r.score)}</td>
            <td data-l="Erişim">${m.reach !== undefined ? fmt(m.reach) : '—'}</td>
            <td data-l="Görüntüleme">${m.views !== undefined ? fmt(m.views) : '—'}</td>
            <td data-l="İlk 3 sn'de geçen">${m.skip !== null && m.skip !== undefined ? pct(m.skip) : '—'}</td>
            <td data-l="Ort. izleme">${m.avg_ms ? sec(m.avg_ms / 1000) + hold : '—'}</td>
            <td data-l="Kaydet · Paylaş">${m.reach !== undefined ? `${fmt(m.saved)} · ${fmt((m.shares || 0) + (m.reposts || 0))}` : '—'}</td>
            <td data-l="Etkileşim">${m.inter !== undefined ? fmt(m.inter) : '—'}</td>
            <td class="so-chev"><i class="fa-solid fa-chevron-down"></i></td>
        </tr>
        <tr class="so-detail" data-for="${esc(r.id)}" hidden><td colspan="9"><div class="so-det"></div></td></tr>`;
    }).join('');
    return `<div class="card so-card so-reels-card">
        <div class="card-header"><h4>Reels performansı <small>${reels.length} video${med ? ` · hesap ortalaması: ${med}` : ''}</small></h4></div>
        <p class="so-fine so-fine-top">Puan 0–100: açılış %35, izlenme %25, değer %15, dağıtım %15, etkileşim %10. Ayrıntı ve “neden” için satıra dokun.</p>
        <div class="so-tablewrap"><table class="so-reels">
            <thead><tr><th>Video</th><th>Puan</th><th>Erişim</th><th>Görüntüleme</th><th>İlk 3 sn'de geçen</th><th>Ort. izleme</th><th>Kaydet · Paylaş</th><th>Etkileşim</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>
    </div>`;
}

function bindReels() {
    root().querySelectorAll('.so-row').forEach((tr) => {
        const toggle = () => openDetail(tr.dataset.id, !openRows.has(tr.dataset.id));
        tr.addEventListener('click', (e) => { if (!e.target.closest('a')) toggle(); });
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
}

function openDetail(id, on) {
    const tr = root().querySelector(`.so-row[data-id="${CSS.escape(id)}"]`);
    const det = root().querySelector(`.so-detail[data-for="${CSS.escape(id)}"]`);
    if (!tr || !det) { openRows.delete(id); return; }
    if (on) openRows.add(id); else openRows.delete(id);
    tr.setAttribute('aria-expanded', on);
    tr.classList.toggle('so-open', on);
    det.hidden = !on;
    if (!on) return;
    const r = (data.reels || []).find((x) => x.id === id);
    const box = det.querySelector('.so-det');
    box.innerHTML = detailHtml(r);
    const tl = box.querySelector('.so-tl');
    if (tl) timeline(tl, r);
}

function detailHtml(r) {
    const sc = r.score || { parts: {} };
    const meters = PARTS.filter(([k]) => sc.parts && sc.parts[k] !== undefined).map(([k, label, hint]) =>
        `<div class="so-meter"><span class="so-ml">${label}</span><span class="so-mt-track"><i style="width:${sc.parts[k]}%"></i></span><b>${sc.parts[k]}</b><small>${hint}</small></div>`).join('');
    const diag = (r.diag || []).map((d) => `<li><i class="fa-solid ${DIAG_ICON[d.t] || DIAG_ICON.info}"></i><span>${esc(d.text)}</span></li>`).join('');
    const ai = r.ai;
    const list = (title, xs, icon) => (xs && xs.length ? `<div class="so-ai-l"><h6><i class="fa-solid ${icon}"></i> ${title}</h6><ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
    const aiHtml = ai
        ? `${ai.verdict && VERDICT[ai.verdict] ? `<span class="badge ${VERDICT[ai.verdict][0]}"><i class="fa-solid ${VERDICT[ai.verdict][1]}"></i> AI: ${VERDICT[ai.verdict][2]}</span>` : ''}
           ${list('Neden', ai.why, 'fa-magnifying-glass')}${list('Korunacak', ai.keep, 'fa-thumbs-up')}${list('Düzeltilecek', ai.fix, 'fa-wrench')}
           <p class="so-fine">AI yorumu: ${esc(when(ai.at))}</p>`
        : `<p class="so-fine">${r.inspected ? 'AI yorumu bu video için henüz yapılmadı (yayından en az 1 saat sonra, gece 00:00\'da ya da yeni Reels gelince yapılır).' : 'Video henüz incelenmedi.'}</p>`;
    const tl = r.timeline;
    const ev = tl && tl.events && tl.events.length
        ? `<p class="so-evs">${tl.events.slice().sort((a, b) => a.t - b.t).map((e) => `<span><b>${esc(e.label)}</b> ${dec(e.t)} sn</span>`).join('')}</p>` : '';
    const voice = tl && tl.voice && tl.voice.length
        ? `<details class="so-more"><summary>Konuşma metni (${tl.voice.length} satır)</summary><ol>${tl.voice.map((v) => `<li><span>${dec(v.s)}–${dec(v.e)} sn</span> ${esc(v.text)}</li>`).join('')}</ol></details>` : '';
    const job = r.job ? `<span><i class="fa-solid fa-wand-magic-sparkles"></i> AI Stüdyo: ${esc(r.job.title)} v${esc(r.job.version)}</span>` : '<span><i class="fa-solid fa-video"></i> AI Stüdyo dışında hazırlanmış</span>';
    return `<div class="so-det-grid">
        <div>
            <h5>Puan dağılımı</h5>${meters || '<p class="so-fine">Puan için veri yok.</p>'}
            <h5>Rakamların söylediği</h5><ul class="so-diag">${diag || '<li><span>—</span></li>'}</ul>
        </div>
        <div><h5>AI yorumu</h5>${aiHtml}</div>
    </div>
    <h5>Zaman çizelgesi</h5>
    ${tl ? `<div class="so-tl-legend"><span><i class="so-sw" style="background:${COL.scene[0]}"></i>sahne / plan</span><span><i class="so-sw" style="background:${COL.voice}"></i>konuşma</span><span><i class="so-mk"></i>ilk 3 sn sınırı</span><span><i class="so-mk so-mk-avg"></i>ortalama izleyicinin ayrıldığı an</span><span><i class="so-sw so-sw-dim"></i>ortalama izleyicinin görmediği kısım</span></div><div class="so-tl"></div>${ev}${voice}` : '<p class="so-fine">Video henüz incelenmedi.</p>'}
    <div class="so-det-foot">${job}${r.permalink ? `<a href="${esc(r.permalink)}" target="_blank" rel="noopener"><i class="fa-brands fa-instagram"></i> Instagram'da aç</a>` : ''}</div>
    ${r.caption ? `<details class="so-more"><summary>Açıklama</summary><p class="so-cap">${esc(r.caption)}</p></details>` : ''}`;
}

/* Video zaman çizelgesi: sahneler (plan yoksa kesmeler), konuşma, 3 sn sınırı, ortalama izleme anı, olaylar */
function timeline(host, r) {
    host.replaceChildren();
    const tl = r.timeline, dur = tl.dur, m = r.m || {};
    const W = Math.max(260, host.clientWidth), H = 96, L = 6, R = 6;
    const x = (t) => L + (Math.max(0, Math.min(dur, t)) / dur) * (W - L - R);
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'so-svg', role: 'img', 'aria-label': `Video zaman çizelgesi, ${dec(dur)} saniye` });
    const tipOn = (el, title, rows) => {
        const f = (e) => showTip(e.clientX, e.clientY, title, rows);
        el.addEventListener('pointermove', f); el.addEventListener('pointerdown', f); el.addEventListener('pointerleave', hideTip);
    };
    const segs = tl.scenes && tl.scenes.length
        ? tl.scenes.map((s) => ({ s: s.s, e: s.e, label: s.label, head: s.head }))
        : [0, ...(tl.cuts || []), dur].slice(0, -1).map((t, i, a) => ({ s: t, e: i + 1 < a.length ? a[i + 1] : dur, label: '', head: '' }));
    const sy = 22, sh = 28;
    segs.forEach((s, i) => {
        const x0 = x(s.s) + (i ? 1 : 0), x1 = x(s.e) - (i < segs.length - 1 ? 1 : 0);
        if (x1 - x0 < 1) return;
        const rect = svgEl('rect', { x: x0, y: sy, width: x1 - x0, height: sh, rx: 4, fill: COL.scene[i % 2] });
        svg.appendChild(rect);
        if (s.label && x1 - x0 > 26) svg.appendChild(svgEl('text', { x: x0 + 6, y: sy + 18, class: 'so-seg' }, s.label));
        tipOn(rect, `${s.label ? s.label + ' · ' : ''}${dec(s.s)}–${dec(s.e)} sn`, s.head ? [{ label: s.head }] : []);
    });
    (tl.voice || []).forEach((v) => {
        const vb = svgEl('rect', { x: x(v.s), y: sy + sh + 6, width: Math.max(2, x(v.e) - x(v.s)), height: 6, rx: 3, fill: COL.voice });
        svg.appendChild(vb);
        const hit = svgEl('rect', { x: x(v.s), y: sy + sh + 2, width: Math.max(8, x(v.e) - x(v.s)), height: 14, fill: 'transparent' });
        svg.appendChild(hit);
        tipOn(hit, `${dec(v.s)}–${dec(v.e)} sn`, [{ label: v.text }]);
    });
    const avg = (m.avg_ms || 0) / 1000;
    if (avg > 0 && avg < dur) {
        const dim = svgEl('rect', { x: x(avg), y: sy - 2, width: x(dur) - x(avg), height: sh + 20, fill: '#ffffff', opacity: 0.62 });
        dim.style.pointerEvents = 'none';
        svg.appendChild(dim);
    }
    if (dur > 3) {
        svg.appendChild(svgEl('line', { x1: x(3), x2: x(3), y1: sy - 4, y2: sy + sh + 16, stroke: COL.muted, 'stroke-width': 1 }));
    }
    if (avg > 0) {
        svg.appendChild(svgEl('line', { x1: x(avg), x2: x(avg), y1: sy - 4, y2: sy + sh + 16, stroke: COL.ink, 'stroke-width': 2 }));
    }
    // olaylar: üstte işaret + ad; yakın olaylar tek etikette, sığmayan etiket açıklamaya kalır
    const evs = (tl.events || []).slice().sort((a, b) => a.t - b.t);
    const groups = [];
    for (const e of evs) {
        const g = groups[groups.length - 1];
        if (g && e.t - g.t < 0.6) g.labels.push(e.label); else groups.push({ t: e.t, labels: [e.label] });
    }
    let lastEnd = -Infinity;
    for (const g of groups) {
        const gx = x(g.t), text = g.labels.join(' + ');
        svg.appendChild(svgEl('path', { d: `M${gx - 4},${sy - 9}L${gx + 4},${sy - 9}L${gx},${sy - 3}Z`, fill: COL.ink }));
        const w = text.length * 5.6;
        const tx = Math.max(L, Math.min(W - R - w, gx - w / 2));
        if (tx > lastEnd + 6) { svg.appendChild(svgEl('text', { x: tx, y: sy - 12, class: 'so-ev' }, text)); lastEnd = tx + w; }
        const hit = svgEl('rect', { x: gx - 8, y: 0, width: 16, height: sy, fill: 'transparent' });
        svg.appendChild(hit);
        tipOn(hit, `${dec(g.t)} sn`, g.labels.map((l) => ({ label: l })));
    }
    // eksen: 0, 5, 10... ve süre; 3 sn ve ortalama izleme etiketi
    const ay = H - 6;
    const marks = [];
    for (let t = 0; t < dur - 1.5; t += 5) marks.push([t, `${t}`]);
    marks.push([dur, `${dec(dur)} sn`]);
    for (const [t, label] of marks) svg.appendChild(svgEl('text', { x: x(t), y: ay, 'text-anchor': t === 0 ? 'start' : t >= dur ? 'end' : 'middle', class: 'so-ax' }, label));
    // işaret etiketleri: önce ortalama izleme; "3 sn" ona çarpıyorsa yazılmaz (lejant açıklıyor)
    const placed = [];
    const put = (t, label, cls) => {
        const w = label.length * 5.4, tx = Math.max(L, Math.min(W - R - w, x(t) - w / 2));
        if (placed.some(([a, b]) => tx < b + 6 && tx + w > a - 6)) return;
        placed.push([tx, tx + w]);
        svg.appendChild(svgEl('text', { x: tx, y: ay - 13, class: cls }, label));
    };
    if (avg > 0) put(avg, `ort. izleme ${dec(avg)} sn`, 'so-ax so-ax-strong');
    if (dur > 3) put(3, '3 sn', 'so-ax');
    host.appendChild(svg);
}

// ---------------------------------------------------------------- öğrenimler

function learningsCard() {
    const an = data.analysis || {};
    const lr = an.learnings || {};
    const col = (title, icon, xs) => `<div class="so-lc"><h5><i class="fa-solid ${icon}"></i> ${title}</h5>${
        xs && xs.length ? `<ul>${xs.map((x) => `<li><span>${esc(x.text)}</span>${x.confidence || x.evidence
            ? `<small>${x.confidence ? `güven: ${esc(x.confidence)}` : ''}${x.confidence && x.evidence ? ' · ' : ''}${x.evidence ? esc(x.evidence) : ''}</small>` : ''}</li>`).join('')}</ul>`
            : '<p class="so-fine">—</p>'}</div>`;
    const prompt = (data.prompt || []).filter((l) => l.trim());
    const head = an.at
        ? `<small>son AI yorumu ${esc(when(an.at))} · ${an.n} Reels</small>`
        : '<small>henüz yok</small>';
    const body = an.at
        ? `${an.summary ? `<p class="so-sum">${esc(an.summary)}</p>` : ''}
           <div class="so-learn">${col('Korunacak', 'fa-thumbs-up', lr.keep)}${col('Bırakılacak', 'fa-ban', lr.avoid)}${col('Denenecek', 'fa-flask', lr.try)}</div>`
        : '<p class="so-fine">En az 2 Reels incelenince AI yorumu kendiliğinden yapılır.</p>';
    return `<div class="card so-card">
        <div class="card-header"><h4>Öğrenimler <small>AI Stüdyo bunlara göre video üretir</small></h4>${head}</div>
        ${an.error ? `<div class="so-note so-note-error">${esc(an.error)}</div>` : ''}
        ${body}
        <p class="so-fine">Güven düşükse kural değil yön göstergesidir: örneklem küçük. AI yorumu gece 00:00'da (günde bir) ve yeni Reels gelince yenilenir.</p>
        ${prompt.length ? `<details class="so-more"><summary>AI Stüdyo'ya giden metin</summary><pre class="so-pre">${esc(prompt.join('\n'))}</pre></details>` : ''}
    </div>`;
}

// ---------------------------------------------------------------- reklam

function adsCard() {
    const ads = data.ads || {};
    const reels = (data.reels || []).filter((r) => r.score && r.score.total !== null && r.score.total !== undefined);
    const now = Date.now() / 1000;
    // en az 1 günlük, 100 kişiye ulaşmış ve puanı 55+ olanlardan en yükseği (zayıf videoya reklam önerilmez)
    const best = reels.filter((r) => now - r.t >= 24 * 3600 && (r.m || {}).reach >= 100 && r.score.total >= 55)
        .sort((a, b) => b.score.total - a.score.total)[0];
    const row = (label, badge, text) => `<div class="so-ad"><div class="so-ad-h"><b>${label}</b>${badge}</div><p>${text}</p></div>`;
    let account;
    if (ads.connected) {
        account = row('Meta reklam hesabı', '<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Bağlı</span>',
            ads.accounts && ads.accounts.length ? 'Son 30 günün özeti aşağıda.' : 'İzin var ama bağlı reklam hesabı bulunamadı.');
    } else if (ads.missing === 'ads_read') {
        account = row('Meta reklam hesabı', '<span class="badge badge-muted"><i class="fa-solid fa-circle-minus"></i> Bağlı değil</span>',
            'Reklam başlatınca Facebook uygulamasına <code>ads_read</code> izni ekleyip Instagram bağlantısını yenile (edit.engrare.com › AI Stüdyo › Marka). Harcama, tıklama ve tıklama başı maliyet burada görünür.');
    } else {
        account = row('Meta reklam hesabı', '<span class="badge badge-muted"><i class="fa-solid fa-circle-minus"></i> Bilinmiyor</span>',
            ads.error ? esc(ads.error) : 'Bağlantı Facebook token\'ı ile yapılınca kontrol edilir.');
    }
    const pixel = ads.pixel === true
        ? row('Meta Pixel (engrare.com)', '<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Kurulu</span>', 'Reklamdan gelen ziyaret ve satışlar ölçülebilir.')
        : ads.pixel === false
            ? row('Meta Pixel (engrare.com)', '<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Kurulu değil</span>', 'Reklamın satışa dönüşüp dönüşmediğini ölçmek için gerekir; reklam başlamadan eklenmeli.')
            : row('Meta Pixel (engrare.com)', '<span class="badge badge-muted">Kontrol edilemedi</span>', 'Site okunamadı; bir sonraki yenilemede yeniden bakılır.');
    const goods = best ? (best.diag || []).filter((d) => d.t === 'good').slice(0, 2).map((d) => esc(d.text)).join(' ') : '';
    const cand = best
        ? row('Öne çıkarmaya en uygun video', verdictBadge(best.score),
            `<span class="so-cand">${best.thumb ? `<img src="${esc(best.thumb)}" alt="">` : ''}<span><b>#${best.n}</b> · ${esc(when(best.t))}${goods ? `<br>${goods}` : ''}</span></span>`)
        : row('Öne çıkarmaya en uygun video', '', 'Henüz yok: en az 1 günlük, 100 kişiye ulaşmış ve puanı 55 ya da üstü bir video olunca burada önerilir.');
    let detail = '';
    for (const a of (ads.connected && ads.accounts) || []) {
        const t = a.total || {};
        const cur = a.currency === 'TRY' ? '₺' : `${a.currency || ''} `;
        detail += `<h5>${esc(a.name)} <small>son 30 gün</small></h5>
            <div class="so-kpis so-kpis-sm">
                <div class="so-kpi"><span class="so-kpi-l">Harcama</span><span class="so-kpi-v">${cur}${dec(t.spend, 2)}</span></div>
                <div class="so-kpi"><span class="so-kpi-l">Gösterim</span><span class="so-kpi-v">${fmt(t.impressions)}</span></div>
                <div class="so-kpi"><span class="so-kpi-l">Erişim</span><span class="so-kpi-v">${fmt(t.reach)}</span></div>
                <div class="so-kpi"><span class="so-kpi-l">Bağlantı tıklaması</span><span class="so-kpi-v">${fmt(t.inline_link_clicks)}</span></div>
                <div class="so-kpi"><span class="so-kpi-l">Tıklama oranı</span><span class="so-kpi-v">${pct(t.ctr, 2)}</span></div>
                <div class="so-kpi"><span class="so-kpi-l">Tıklama başı</span><span class="so-kpi-v">${cur}${dec(t.cpc, 2)}</span></div>
            </div>
            ${(a.campaigns || []).length ? `<div class="so-tablewrap"><table class="so-tbl"><thead><tr><th>Kampanya</th><th>Harcama</th><th>Gösterim</th><th>Tıklama</th><th>Tıklama oranı</th><th>Tıklama başı</th></tr></thead><tbody>${
                a.campaigns.map((c) => `<tr><td>${esc(c.name)}</td><td>${cur}${dec(c.spend, 2)}</td><td>${fmt(c.impressions)}</td><td>${fmt(c.clicks)}</td><td>${pct(c.ctr, 2)}</td><td>${cur}${dec(c.cpc, 2)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="so-fine">Son 30 günde kampanya yok.</p>'}`;
    }
    return `<div class="card so-card">
        <div class="card-header"><h4>Reklam</h4>${ads.at ? `<small>kontrol ${esc(when(ads.at))}</small>` : ''}</div>
        <div class="so-ads">${account}${pixel}${cand}</div>
        ${detail}
    </div>`;
}
