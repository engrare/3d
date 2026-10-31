/* Reklam yönetimi (Sosyal Medya & Reklam sekmesinin altında): Reels'ten Meta reklamı oluştur, başlat, duraklat.
   Mantığın tamamı edit.engrare.com sunucusunda (social_ads.py); panel `socialApi` fonksiyonuyla (yönetici + 2FA) konuşur.
   Her reklam DURAKLATILMIŞ oluşur; "Başlat" denmeden harcama olmaz. Bütçe/süre sınırları sunucuda da zorlanır. */

const SITE = 'https://engrare.com/';
const LINKS = [
    ['Araba içi numaratör', SITE + 'urun/araba-ici-numarator/'],
    ['Ad plakası', SITE + 'urun/duvara-yapismali-ozel-ad-plakasi/'],
    ['Kartvizit standı', SITE + 'urun/sosyal-medya-kartvizit-standi/'],
    ['Ana sayfa', SITE]
];
const STATUS = {
    ACTIVE: ['badge-success', 'Yayında'], PAUSED: ['badge-muted', 'Duraklatıldı'], IN_PROCESS: ['badge-warning', 'İşleniyor'],
    WITH_ISSUES: ['badge-danger', 'Sorunlu'], PENDING_REVIEW: ['badge-warning', 'İncelemede'], DISAPPROVED: ['badge-danger', 'Reddedildi'],
    CAMPAIGN_PAUSED: ['badge-muted', 'Duraklatıldı'], ADSET_PAUSED: ['badge-muted', 'Duraklatıldı']
};
const MISSING = {
    ads_management: 'Facebook token\'ında <code>ads_management</code> izni yok. Graph API Explorer\'da izinlere <code>ads_management</code>, <code>ads_read</code>, <code>pages_show_list</code>, <code>business_management</code>, <code>instagram_basic</code> ekleyip yeni token üret, sonra edit.engrare.com › AI Stüdyo › Marka\'dan Instagram bağlantısını yenile.',
    pages_show_list: 'Token\'da <code>pages_show_list</code> izni yok (Facebook sayfası bulunamıyor).',
    ad_account: 'Bu token\'a bağlı reklam hesabı bulunamadı.',
    page: 'Instagram hesabına bağlı Facebook sayfası bulunamadı.',
    instagram: 'Instagram hesabı okunamadı.'
};

let ctx = null, host = null, ov = null, err = '';
let loading = false, working = false, reels = [];
const form = { media: '', objective: 'traffic', daily: 100, days: 7, ageMin: 20, ageMax: 55, gender: 'all', link: LINKS[0][1], name: '', regions: [], interests: [] };
const MAX_PICK = 10;
// siteye giden hedefler: gidilecek sayfa seçilir (utm + Pixel izleme sunucuda eklenir)
const LINKED = ['traffic', 'sales'];
// hazir kitleler: Meta ilgi alani aramasinda bu kelimelerin ilk sonucu eklenir
const PRESETS = [
    ['Araç meraklıları', ['Cars', 'Car tuning']],
    ['Hediye & kişiye özel', ['Gift', 'Personalization']],
    ['3D baskı & teknoloji', ['3D printing', 'Gadget']],
    ['Küçük işletme sahipleri', ['Small business', 'Entrepreneurship']]
];
const GENDER = { all: 'Hepsi', male: 'Erkek', female: 'Kadın' };
let timers = {};
// duzenleme: editing = duzenlenen kampanya kimligi; snap = Duzenle'ye basilmadan onceki form (iptal/guncelle sonrasi geri gelir)
let editing = null, snap = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const tl = (n) => '₺' + (Number(n) || 0).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const num = (n) => (Number(n) || 0).toLocaleString('tr-TR');
const when = (sec) => new Date(sec * 1000).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short' });
const api = (method, path, body) => ctx.call('socialApi', { method, path, body }).then((r) => r);

export function mount(c, el, reelList) {
    ctx = c; host = el; reels = reelList || [];
    if (!form.media) {
        const best = reels.filter((r) => r.score && r.score.total != null).sort((a, b) => b.score.total - a.score.total)[0] || reels[0];
        if (best) form.media = best.id;
    }
    draw();
    if (!ov && !loading) load();
}

// Excel dışa aktarımı için: yüklü reklam özeti (yoksa sunucudan alınır, ekranı değiştirmez)
export const overview = () => ov;
export function fetchOverview() { return api('GET', '/api/social/ads/overview'); }

export function reset() { ov = null; err = ''; host = null; editing = null; snap = null; }

async function load(fresh = false) {
    if (loading || !ctx) return;
    loading = true; err = '';
    draw();
    try {
        ov = await api('GET', '/api/social/ads/overview' + (fresh ? '?fresh=1' : ''));
    } catch (e) {
        console.error('socialApi overview:', e);
        err = (e && e.message) || 'Sunucuya ulaşılamadı.';
    } finally {
        loading = false;
        draw();
    }
}

function draw() {
    if (!host || !host.isConnected) return;
    host.innerHTML = `<div class="card so-card">
        <div class="card-header"><h4>Reklam yönetimi ${ov ? `<small>${esc(ov.setup.account ? ov.setup.account.name : '')} · ${num(ov.live)}/${num(ov.limits.max_live)} yayında</small>` : ''}</h4>
            <button type="button" class="btn-sm" id="ad-reload" ${loading ? 'disabled' : ''}><i class="fa-solid fa-rotate ${loading ? 'fa-spin' : ''}"></i> Yenile</button></div>
        ${err ? `<div class="so-note so-note-error">${esc(err)}</div>` : ''}
        ${ov ? body() : (loading ? '<div class="so-empty">Yükleniyor…</div>' : '')}
    </div>`;
    bind();
}

function body() {
    const s = ov.setup, miss = s.missing || [];
    const notes = miss.map((m) => `<div class="so-note so-note-error">${MISSING[m] || esc(m)}</div>`).join('');
    const acc = s.account;
    const pay = acc && !acc.has_payment
        ? '<div class="so-note so-note-info">Reklam hesabında ödeme yöntemi görünmüyor. Yayın başlamadan önce business.facebook.com › Faturalama\'dan kart ekle (kartı Meta\'ya sen girersin, panel kart bilgisi görmez).</div>' : '';
    const stat = acc && acc.status !== 1 ? '<div class="so-note so-note-error">Reklam hesabı aktif değil (Meta tarafında kısıtlı olabilir).</div>' : '';
    return `${notes}${stat}${pay}${ov.can_create ? formHtml() : ''}${list()}
        <p class="so-fine">Panelden açılan reklamlar duraklatılmış başlar. Sınırlar: günlük ${tl(ov.limits.min_daily)}–${tl(ov.limits.max_daily)}, en çok ${ov.limits.max_days} gün, aynı anda ${ov.limits.max_live} kampanya (sunucuda zorlanır). KDV ve dijital hizmet vergisi Meta faturasında ayrıca eklenir.</p>`;
}

function formHtml() {
    const ed = editing ? (ov.campaigns || []).find((x) => x.id === editing) : null;
    const known = reels.some((r) => r.id === form.media);
    const opts = (known || !form.media ? '' : `<option value="${esc(form.media)}" selected>Mevcut video</option>`) + reels.map((r) => `<option value="${esc(r.id)}" ${r.id === form.media ? 'selected' : ''}>#${r.n} · ${esc(when(r.t))}${r.score && r.score.total != null ? ` · puan ${Math.round(r.score.total)}` : ''}</option>`).join('');
    const links = (LINKS.some(([, u]) => u === form.link) ? '' : `<option value="${esc(form.link)}" selected>${esc(form.link)}</option>`) + LINKS.map(([l, u]) => `<option value="${esc(u)}" ${u === form.link ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const total = (Number(form.daily) || 0) * (Number(form.days) || 0);
    return `<form class="so-adform ${ed ? 'ad-editing' : ''}" id="ad-form" autocomplete="off">
        ${ed ? `<div class="so-note so-note-info ad-edit-note"><i class="fa-solid fa-pen"></i> Düzenleniyor: <b>${esc(ed.name.replace(/^Panel · /, ''))}</b>${ed.effective === 'ACTIVE' ? ' · yayında, değişiklikler hemen uygulanır' : ''}. Hedef (trafik/satış/erişim) kampanya açıldıktan sonra değiştirilemez.</div>` : ''}
        <label>Video<select name="media">${opts}</select></label>
        <label>Hedef<select name="objective" ${ed ? 'disabled' : ''}>
            <option value="traffic" ${form.objective === 'traffic' ? 'selected' : ''}>Siteye trafik (ziyaretçi çek)</option>
            <option value="sales" ${form.objective === 'sales' ? 'selected' : ''}>Alışveriş yapma (satın alma, Pixel ile)</option>
            <option value="reach" ${form.objective === 'reach' ? 'selected' : ''}>Erişim (daha çok kişiye göster)</option></select></label>
        <label class="ad-link" ${LINKED.includes(form.objective) ? '' : 'hidden'}>Gidilecek sayfa<select name="link">${links}</select></label>
        <label>Günlük bütçe (₺)<input name="daily" type="number" min="${ov.limits.min_daily}" max="${ov.limits.max_daily}" step="10" value="${esc(form.daily)}"></label>
        <label>Süre (gün)<input name="days" type="number" min="1" max="${ov.limits.max_days}" step="1" value="${esc(form.days)}"></label>
        <label>Yaş<span class="ad-age"><input name="ageMin" type="number" min="18" max="65" value="${esc(form.ageMin)}"> – <input name="ageMax" type="number" min="18" max="65" value="${esc(form.ageMax)}"></span></label>
        <label>Cinsiyet<select name="gender">
            <option value="all" ${form.gender === 'all' ? 'selected' : ''}>Hepsi</option>
            <option value="male" ${form.gender === 'male' ? 'selected' : ''}>Erkek</option>
            <option value="female" ${form.gender === 'female' ? 'selected' : ''}>Kadın</option></select></label>
        ${audienceHtml()}
        <label class="ad-name">Kampanya adı (isteğe bağlı)<input name="name" type="text" maxlength="60" value="${esc(form.name)}" placeholder="örn. Numaratör Reel"></label>
        <div class="ad-go"><span class="so-fine" id="ad-total">Toplam en çok ${tl(total)} (${placesText()}, Instagram akışı + Reels)</span>
            <span class="ad-btns">${ed ? `<button type="button" class="btn" id="ad-cancel" ${working ? 'disabled' : ''}>İptal</button>
            <button type="submit" class="btn primary" ${working ? 'disabled' : ''}><i class="fa-solid fa-check"></i> Güncelle</button>`
                 : `<button type="submit" class="btn primary" ${working ? 'disabled' : ''}><i class="fa-solid fa-plus"></i> Duraklatılmış oluştur</button>`}</span></div>
    </form>`;
}

const placesText = () => form.regions.length ? form.regions.map((r) => r.name).join(', ') : 'Türkiye';

function chips(kind) {
    const arr = form[kind];
    return arr.map((x, i) => `<span class="ad-chip">${esc(x.name)}<button type="button" data-rm="${kind}:${i}" aria-label="Kaldır">&times;</button></span>`).join('');
}

function audienceHtml() {
    const presets = PRESETS.map(([l], i) => `<button type="button" class="btn-sm" data-preset="${i}">${esc(l)}</button>`).join('');
    return `<div class="ad-aud">
        <div class="ad-aud-h">Hedef kitle <small>(yaş ve cinsiyet yukarıda)</small></div>
        <div class="ad-aud-row"><span>Konum</span>
            <div class="ad-picks" id="ad-regions">${chips('regions') || '<span class="so-fine">Tüm Türkiye</span>'}</div>
            <div class="ad-search"><input type="search" data-search="region" placeholder="İl ekle (örn. İstanbul)" autocomplete="off"><div class="ad-results" data-for="region" hidden></div></div></div>
        <div class="ad-aud-row"><span>İlgi alanları</span>
            <div class="ad-picks" id="ad-interests">${chips('interests') || '<span class="so-fine">Sınırsız (Meta herkese gösterir)</span>'}</div>
            <div class="ad-search"><input type="search" data-search="interest" placeholder="İlgi alanı ara (örn. Cars, Gift)" autocomplete="off"><div class="ad-results" data-for="interest" hidden></div></div></div>
        <div class="ad-aud-row"><span>Hazır kitle</span><div class="ad-presets">${presets}</div></div>
    </div>`;
}

function redrawPicks() {
    for (const kind of ['regions', 'interests']) {
        const el = host.querySelector('#ad-' + kind);
        if (el) el.innerHTML = chips(kind) || `<span class="so-fine">${kind === 'regions' ? 'Tüm Türkiye' : 'Sınırsız (Meta herkese gösterir)'}</span>`;
    }
    const t = host.querySelector('#ad-total');
    if (t) t.textContent = `Toplam en çok ${tl((Number(form.daily) || 0) * (Number(form.days) || 0))} (${placesText()}, Instagram akışı + Reels)`;
}

function addPick(kind, item) {
    const arr = form[kind];
    if (arr.some((x) => x.id === item.id)) return true;
    if (arr.length >= MAX_PICK) { ctx.toast(`En çok ${MAX_PICK} seçilebilir.`, 'error'); return false; }
    arr.push({ id: item.id, name: item.name });
    return true;
}

async function search(kind, q) {
    const r = await api('POST', '/api/social/ads/search', { kind, q });
    return r.items || [];
}

async function runSearch(input) {
    const kind = input.dataset.search, box = host.querySelector(`.ad-results[data-for="${kind}"]`);
    const q = input.value.trim();
    if (q.length < 2) { box.hidden = true; return; }
    try {
        const items = await search(kind, q);
        if (input.value.trim() !== q || !box.isConnected) return;
        box.innerHTML = items.length
            ? items.map((x) => `<button type="button" data-id="${esc(x.id)}" data-name="${esc(x.name)}">${esc(x.name)}${x.size ? ` <small>~${num(x.size)} kişi</small>` : ''}</button>`).join('')
            : '<span class="so-fine">Sonuç yok</span>';
        box.hidden = false;
    } catch (e) {
        box.innerHTML = `<span class="so-bad">${esc((e && e.message) || 'Arama yapılamadı.')}</span>`;
        box.hidden = false;
    }
}

async function applyPreset(i) {
    const [, words] = PRESETS[i];
    try {
        const found = await Promise.all(words.map((w) => search('interest', w)));
        found.forEach((items) => { if (items[0]) addPick('interests', items[0]); });
        redrawPicks();
    } catch (e) {
        ctx.toast((e && e.message) || 'Hazır kitle eklenemedi.', 'error');
    }
}

function audienceLine(c) {
    const a = c.audience;
    if (!a) return '';
    const parts = [(a.places || []).join(', ') || 'Türkiye', a.age && a.age[0] ? `${a.age[0]}–${a.age[1]} yaş` : '', GENDER[a.gender] || '',
        (a.interests || []).length ? 'İlgi: ' + a.interests.join(', ') : ''].filter(Boolean);
    return `<small>${esc(parts.join(' · '))}</small>`;
}

function list() {
    const cs = ov.campaigns || [];
    if (!cs.length) return '<p class="so-fine">Henüz kampanya yok.</p>';
    // tıklama -> sayfa açılışı oranı: %60 altı (en az 10 tıklamada) bot/yanlış tıklama şüphesi
    const lpvCell = (m) => {
        if (!m.clicks) return '—';
        const r = Math.round(100 * (m.lpv || 0) / m.clicks);
        const bad = m.clicks >= 10 && r < 60;
        return `${num(m.lpv || 0)} <small${bad ? ' class="so-bad"' : ''}>(%${r})</small>`;
    };
    const rows = cs.map((c) => {
        const st = STATUS[c.ad_effective === 'ACTIVE' || c.ad_effective === 'PAUSED' ? c.effective : c.ad_effective] || STATUS[c.effective] || ['badge-muted', c.effective || '—'];
        const m = c.m;
        const on = c.effective === 'ACTIVE';
        return `<tr data-id="${esc(c.id)}">
            <td class="so-vid">${c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy">` : '<span class="so-noimg"><i class="fa-solid fa-film"></i></span>'}
                <span class="so-vt"><span><b>${esc(c.name.replace(/^Panel · /, ''))}</b>${c.own ? '' : ' <small>(Meta\'dan açıldı)</small>'}</span>
                <small>${c.objective === 'OUTCOME_TRAFFIC' ? 'Trafik' : c.objective === 'OUTCOME_SALES' ? `Satış · ${num(m.purchases)} satın alma` : c.objective === 'OUTCOME_AWARENESS' ? 'Erişim' : esc(c.objective)} · günlük ${tl(c.daily)}${c.end ? ` · bitiş ${esc(new Date(c.end).toLocaleDateString('tr-TR'))}` : ''}</small>
                ${audienceLine(c)}
                ${c.issues.length ? `<small class="so-bad">${esc(c.issues.join(' · '))}</small>` : ''}</span></td>
            <td data-l="Durum"><span class="badge ${st[0]}">${esc(st[1])}</span></td>
            <td data-l="Harcama">${tl(m.spend)}</td><td data-l="Erişim">${num(m.reach)}</td><td data-l="Tıklama">${num(m.clicks)}</td>
            <td data-l="Sayfa açılışı">${lpvCell(m)}</td>
            <td data-l="Tıklama başı">${m.cpc ? tl(m.cpc) : '—'}</td>
            <td class="ad-acts">
                <button type="button" class="btn-sm ${on ? '' : 'primary'}" data-act="${on ? 'pause' : 'start'}">${on ? 'Duraklat' : 'Başlat'}</button>
                ${c.edit ? `<button type="button" class="btn-sm ${editing === c.id ? 'primary' : ''}" data-act="edit" title="Tüm ayarları düzenle"><i class="fa-solid fa-pen"></i> Düzenle</button>`
                         : '<button type="button" class="btn-sm" data-act="budget" title="Günlük bütçeyi değiştir"><i class="fa-solid fa-turkish-lira-sign"></i></button>'}
                <button type="button" class="btn-sm" data-act="delete" title="Sil"><i class="fa-solid fa-trash"></i></button></td>
        </tr>`;
    }).join('');
    return `<div class="so-tablewrap"><table class="so-reels so-adtbl"><thead><tr><th>Kampanya</th><th>Durum</th><th>Harcama</th><th>Erişim</th><th>Tıklama</th><th title="Tıklayıp siteyi gerçekten açanlar (Açılış Sayfası Görüntüleme). Oran düşükse tıklamaların bir kısmı bot ya da yanlışlıkla olabilir.">Sayfa açılışı</th><th>Tıklama başı</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function bind() {
    const q = (s) => host.querySelector(s);
    const rl = q('#ad-reload');
    if (rl) rl.addEventListener('click', () => load(true));
    const f = q('#ad-form');
    if (f) {
        f.addEventListener('input', (e) => {
            if (e.target.dataset.search) {
                clearTimeout(timers[e.target.dataset.search]);
                timers[e.target.dataset.search] = setTimeout(() => runSearch(e.target), 350);
                return;
            }
            const d = new FormData(f);
            for (const k of Object.keys(form)) if (d.has(k)) form[k] = d.get(k);
            const t = q('#ad-total');
            if (t) t.textContent = `Toplam en çok ${tl((Number(form.daily) || 0) * (Number(form.days) || 0))} (${placesText()}, Instagram akışı + Reels)`;
        });
        f.addEventListener('change', (e) => {
            if (e.target.name === 'objective') { form.objective = e.target.value; draw(); }
        });
        f.addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b) return;
            if (b.dataset.rm) { const [k, i] = b.dataset.rm.split(':'); form[k].splice(Number(i), 1); redrawPicks(); }
            else if (b.dataset.preset) applyPreset(Number(b.dataset.preset));
            else if (b.closest('.ad-results') && b.dataset.id) {
                const box = b.closest('.ad-results'), kind = box.dataset.for;
                if (addPick(kind === 'region' ? 'regions' : 'interests', { id: b.dataset.id, name: b.dataset.name })) {
                    box.hidden = true; box.previousElementSibling.value = ''; redrawPicks();
                }
            }
        });
        f.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.search) e.preventDefault(); });
        f.addEventListener('submit', (e) => { e.preventDefault(); if (editing) update(); else create(); });
        const cn = q('#ad-cancel');
        if (cn) cn.addEventListener('click', () => endEdit());
    }
    host.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.closest('tr').dataset.id, b.dataset.act)));
}

async function run(label, fn) {
    if (working) return;
    working = true; draw();
    try {
        await fn();
        await load(true);
    } catch (e) {
        console.error(label, e);
        ctx.toast((e && e.message) || 'İşlem yapılamadı.', 'error');
    } finally {
        working = false; draw();
    }
}

function create() {
    if (!form.media) { ctx.toast('Bir video seç.', 'error'); return; }
    if (!(Number(form.daily) >= ov.limits.min_daily)) { ctx.toast(`Günlük bütçe en az ${tl(ov.limits.min_daily)} olmalı.`, 'error'); return; }
    run('create', async () => {
        const r = await api('POST', '/api/social/ads/create', {
            media_id: form.media, objective: form.objective, daily: Number(form.daily), days: Number(form.days),
            age_min: Number(form.ageMin), age_max: Number(form.ageMax), gender: form.gender,
            regions: form.regions, interests: form.interests,
            link: LINKED.includes(form.objective) ? form.link : '', name: form.name.trim()
        });
        ctx.toast(r.note || 'Reklam oluşturuldu (duraklatılmış).', 'success');
    });
}

function endEdit() {
    if (snap) Object.assign(form, snap);
    editing = null; snap = null;
    draw();
}

function startEdit(c) {
    const e = c.edit;
    if (!e) return;
    // zaten duzenleniyorsa asil formu (snap) koru; ikinci Duzenle'de uzerine yazma
    if (!editing) snap = JSON.parse(JSON.stringify(form));
    editing = c.id;
    Object.assign(form, {
        media: e.media || form.media, objective: e.objective, daily: c.daily, days: e.days || form.days,
        ageMin: e.age[0] || 20, ageMax: e.age[1] || 55, gender: e.gender,
        // 3d.engrare.com'dan açılmış eski kampanya: yeni adres seçili gelir (Güncelle yeni bağlantılı kreatif açar)
        link: (e.link || '').replace('https://3d.engrare.com/', SITE) || (LINKED.includes(e.objective) ? LINKS[0][1] : form.link), name: e.name,
        regions: e.regions.map((x) => ({ ...x })), interests: e.interests.map((x) => ({ ...x }))
    });
    draw();
    const f = host.querySelector('#ad-form');
    if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function update() {
    const c = (ov.campaigns || []).find((x) => x.id === editing);
    if (!c) { endEdit(); return; }
    if (!(Number(form.daily) >= ov.limits.min_daily)) { ctx.toast(`Günlük bütçe en az ${tl(ov.limits.min_daily)} olmalı.`, 'error'); return; }
    if (c.effective === 'ACTIVE' && !confirm('Reklam yayında; değişiklikler hemen uygulanır (video/sayfa değişirse Meta yeniden inceleyebilir). Güncellensin mi?')) return;
    run('update', async () => {
        const r = await api('POST', `/api/social/ads/${c.id}/update`, {
            media_id: form.media, daily: Number(form.daily), days: Number(form.days),
            age_min: Number(form.ageMin), age_max: Number(form.ageMax), gender: form.gender,
            regions: form.regions, interests: form.interests,
            link: LINKED.includes(form.objective) ? form.link : '', name: form.name.trim()
        });
        ctx.toast(r.note || 'Güncellendi.', 'success');
        // basarili: form Duzenle'den onceki haline doner (hata olursa duzenleme acik kalir)
        if (snap) Object.assign(form, snap);
        editing = null; snap = null;
    });
}

function act(id, what) {
    const c = (ov.campaigns || []).find((x) => x.id === id);
    if (!c) return;
    if (what === 'edit') {
        startEdit(c);
    } else if (what === 'start') {
        if (!confirm(`"${c.name.replace(/^Panel · /, '')}" yayına alınsın mı?\nGünlük ${tl(c.daily)} harcanabilir. Reklam Meta incelemesinden geçince yayınlanır.`)) return;
        run('start', async () => { await api('POST', `/api/social/ads/${id}/status`, { status: 'ACTIVE' }); ctx.toast('Yayına alındı (Meta incelemesi sürebilir).', 'success'); });
    } else if (what === 'pause') {
        run('pause', async () => { await api('POST', `/api/social/ads/${id}/status`, { status: 'PAUSED' }); ctx.toast('Duraklatıldı.', 'success'); });
    } else if (what === 'delete') {
        if (!confirm('Bu kampanya silinsin mi? Geri alınamaz.')) return;
        run('delete', async () => { await api('POST', `/api/social/ads/${id}/status`, { status: 'DELETED' }); ctx.toast('Silindi.', 'success'); });
    } else if (what === 'budget') {
        const v = prompt(`Yeni günlük bütçe (₺, ${ov.limits.min_daily}–${ov.limits.max_daily}):`, c.daily);
        if (v === null) return;
        const n = Number(String(v).replace(',', '.'));
        if (!(n > 0)) { ctx.toast('Geçerli bir tutar yaz.', 'error'); return; }
        run('budget', async () => { await api('POST', `/api/social/ads/${id}/budget`, { daily: n }); ctx.toast('Bütçe güncellendi.', 'success'); });
    }
}
