/* Ürün görselleri penceresi (yalnız "Görseller" düğmesine basılınca import() ile yüklenir).
   Görseller tarayıcıda WebP'ye çevrilir ve GitHub API ile doğrudan herkese açık `engrare/3d`
   reposuna (content/panel/<ürünNo>/) yazılır; araya sunucu/Cloud Function girmez. Anahtar RTDB
   config/github_upload/token'da durur (yalnız yönetici+2FA okur). Liste RTDB config/products/<id>/images
   ve card alanlarına yazılır, site bunları applyProductOverrides ile okur.
   Dosya adı her yüklemede yenidir (önbellek sorunu olmaz). Sıra: yükle > sitede yayınlanmasını bekle
   (GitHub Pages ~1-2 dk) > RTDB'ye yaz > kullanılmayan eski panel dosyalarını sil.
   deploy.sh yayından önce content/panel'i GitHub'dan yerele çeker: yoksa force-push görselleri silerdi. */

const REPO = 'engrare/3d';
const BRANCH = 'main';
const SITE = 'https://engrare.com';
const MAX_IMAGES = 8;
const PANEL_DIR = 'content/panel/';

const $ = (sel) => document.querySelector(sel);

async function gh(method, path, token, body) {
    const res = await fetch(`https://api.github.com/repos/${REPO}${path ? '/' + path : ''}`, {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* gövde yok */ }
    if (!res.ok) {
        const err = new Error((data && data.message) || `GitHub ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

function errText(e) {
    if (e && (e.status === 401 || e.status === 403)) return 'GitHub anahtarı geçersiz ya da yetkisiz (Contents: Read and write gerekir).';
    if (e && e.status === 404) return 'Depo bulunamadı ya da anahtarın bu depoya erişimi yok.';
    return (e && e.message) || 'bilinmeyen hata';
}

/* Görseli en uzun kenar `maxSide` olacak şekilde WebP'ye çevirir (kalite 0,8) */
async function toWebp(source, maxSide) {
    const bmp = await createImageBitmap(source, { imageOrientation: 'from-image' });
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return canvasBlob(c);
}

/* Liste kartı için ortadan kırpılmış 800x540 kopya */
async function toCard(source) {
    const bmp = await createImageBitmap(source, { imageOrientation: 'from-image' });
    const W = 800, H = 540;
    const k = Math.max(W / bmp.width, H / bmp.height);
    const sw = W / k, sh = H / k;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, W, H);
    return canvasBlob(c);
}

function canvasBlob(c) {
    return new Promise((resolve, reject) => {
        c.toBlob((b) => {
            if (!b || b.type !== 'image/webp') reject(new Error('Tarayıcı WebP üretemedi (güncel Chrome/Safari kullanın).'));
            else resolve(b);
        }, 'image/webp', 0.8);
    });
}

function toBase64(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(new Error('Dosya okunamadı.'));
        r.readAsDataURL(blob);
    });
}

async function putFile(token, path, blob, message) {
    await gh('PUT', `contents/${path}`, token, { message, content: await toBase64(blob), branch: BRANCH });
}

async function deleteFile(token, path, message) {
    try {
        const info = await gh('GET', `contents/${path}?ref=${BRANCH}`, token);
        await gh('DELETE', `contents/${path}`, token, { message, sha: info.sha, branch: BRANCH });
    } catch (e) {
        if (e.status !== 404) console.warn('Görsel silinemedi:', path, e.message);
    }
}

/* GitHub Pages yeni dosyayı yayınlayana kadar bekler (RTDB'ye erken yazılırsa site kırık resim gösterirdi) */
async function waitLive(path, onTick) {
    const until = Date.now() + 5 * 60 * 1000;
    for (let n = 0; Date.now() < until; n++) {
        try {
            const r = await fetch(`${SITE}/${path}?k=${Date.now()}`, { cache: 'no-store' });
            if (r.ok) return true;
        } catch (e) { /* ağ hatası: tekrar dene */ }
        onTick(n);
        await new Promise(r => setTimeout(r, 5000));
    }
    return false;
}

const clean = (s) => String(s || '').replace(/^\.\//, '').replace(/\?.*$/, '');

export function open(ctx) {
    const root = $('#product-images-modal');
    const body = $('#pimg-body');
    const esc = ctx.esc;
    let items = ctx.images.map(p => ({ path: clean(p), url: `${SITE}/${clean(p)}` }));
    const initial = items.map(i => i.path);
    let token = '';
    let busy = false;

    $('#pimg-title').textContent = `${ctx.name} · Görseller`;
    root.classList.add('open');

    const setStatus = (t, bad) => {
        const el = $('#pimg-status');
        if (!el) return;
        el.textContent = t || '';
        el.style.color = bad ? '#c0392b' : 'var(--text-muted)';
    };

    function render() {
        const tokenBox = token
            ? `<p class="pimg-token ok"><i class="fa-solid fa-key"></i> GitHub anahtarı kayıtlı <button type="button" class="btn-link" id="pimg-token-change">değiştir</button></p>`
            : `<div class="pimg-token">
                   <p style="margin:0 0 8px;font-size:.84rem;color:var(--text-muted);">Görselleri GitHub'a yüklemek için <b>yalnızca engrare/3d</b> deposuna <b>Contents: Read and write</b> yetkili bir fine-grained anahtar girin (bir kez). Anahtar yalnızca yönetici+2FA'nın okuyabildiği veritabanı alanında durur.</p>
                   <div style="display:flex;gap:8px;flex-wrap:wrap;">
                       <input type="password" id="pimg-token-input" class="input-box" placeholder="github_pat_..." autocomplete="off" style="flex:1;min-width:200px;">
                       <button type="button" class="btn primary" id="pimg-token-save">Kaydet ve doğrula</button>
                   </div>
               </div>`;
        const grid = items.map((it, i) => `
            <div class="pimg-item" data-i="${i}">
                <img src="${esc(it.preview || it.url)}" alt="">
                ${i === 0 ? '<span class="pimg-badge">Kapak</span>' : ''}
                <div class="pimg-actions">
                    <button type="button" data-act="left" title="Sola" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-left"></i></button>
                    <button type="button" data-act="right" title="Sağa" ${i === items.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-right"></i></button>
                    <button type="button" data-act="del" title="Kaldır"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`).join('');
        body.innerHTML = `
            ${tokenBox}
            <div class="pimg-grid">${grid || '<p class="section-desc" style="grid-column:1/-1;">Görsel yok.</p>'}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 6px;">
                <button type="button" class="btn" id="pimg-add"><i class="fa-solid fa-plus"></i> Görsel ekle</button>
                <input type="file" id="pimg-file" accept="image/*" multiple hidden>
                <button type="button" class="btn" id="pimg-reset"><i class="fa-solid fa-rotate-left"></i> Varsayılana dön</button>
                <button type="button" class="btn primary" id="pimg-save" style="margin-left:auto;"><i class="fa-solid fa-cloud-arrow-up"></i> Kaydet ve yayınla</button>
            </div>
            <p id="pimg-status" style="font-size:.84rem;min-height:1.2em;margin:6px 0 0;"></p>
            <p style="font-size:.78rem;color:var(--text-light);margin:8px 0 0;">İlk görsel kapaktır (listede ve ürünün başında görünür). Görseller WebP'ye çevrilip küçültülür. Kaydedince sitede yayınlanması yaklaşık 1-2 dakika sürer.</p>`;
    }

    async function loadToken() {
        try { token = (await ctx.getToken()) || ''; } catch (e) { token = ''; }
        render();
    }

    body.onclick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn || busy) return;
        const it = btn.closest('.pimg-item');
        if (it) {
            const i = Number(it.dataset.i);
            const act = btn.dataset.act;
            if (act === 'del') items.splice(i, 1);
            else if (act === 'left' && i > 0) [items[i - 1], items[i]] = [items[i], items[i - 1]];
            else if (act === 'right' && i < items.length - 1) [items[i + 1], items[i]] = [items[i], items[i + 1]];
            render();
            return;
        }
        if (btn.id === 'pimg-add') { $('#pimg-file').click(); return; }
        if (btn.id === 'pimg-token-change') { token = ''; render(); return; }
        if (btn.id === 'pimg-token-save') {
            const t = $('#pimg-token-input').value.trim();
            if (!t) return;
            busy = true; setStatus('Doğrulanıyor...');
            try {
                const r = await gh('GET', '', t);
                if (!r.permissions || !r.permissions.push) throw Object.assign(new Error('x'), { status: 403 });
                await ctx.setToken(t);
                token = t; busy = false; render();
                setStatus('Anahtar kaydedildi.');
            } catch (err) {
                busy = false; setStatus(errText(err), true);
            }
            return;
        }
        if (btn.id === 'pimg-reset') {
            if (!confirm('Bu ürünün görselleri koddaki varsayılanlara döndürülsün mü?')) return;
            await persist({ reset: true });
            return;
        }
        if (btn.id === 'pimg-save') await persist({});
    };

    body.onchange = async (e) => {
        if (e.target.id !== 'pimg-file' || busy) return;
        const files = Array.from(e.target.files || []);
        for (const f of files) {
            if (items.length >= MAX_IMAGES) { setStatus(`En çok ${MAX_IMAGES} görsel.`, true); break; }
            try {
                const blob = await toWebp(f, 1280);
                items.push({ path: null, blob, preview: URL.createObjectURL(blob) });
            } catch (err) {
                setStatus(`${f.name}: ${err.message}`, true);
            }
        }
        render();
    };

    async function persist({ reset }) {
        if (!token) { setStatus('Önce GitHub anahtarını girin.', true); return; }
        if (!reset && !items.length) { setStatus('En az bir görsel olmalı (ya da "Varsayılana dön").', true); return; }
        busy = true;
        $('#pimg-save').disabled = true;
        try {
            const stamp = Date.now().toString(36);
            const id = ctx.productId;
            const msg = `Panel: ürün ${id} görselleri`;
            const uploaded = [];       // yüklenen yeni dosyalar (yayın beklemesi için)
            let images = null, card = null;

            if (!reset) {
                let n = 0;
                for (const it of items) {
                    if (it.path) continue;
                    const path = `${PANEL_DIR}${id}/${stamp}-${++n}.webp`;
                    setStatus(`Yükleniyor: ${n}/${items.filter(x => !x.path).length}...`);
                    await putFile(token, path, it.blob, msg);
                    it.path = path;
                    uploaded.push(path);
                }
                images = items.map(i => i.path);
                // Kart: kapak değiştiyse yeni 800x540 kopya; kapak koddaki ilk görselse varsayılan kart
                const first = items[0];
                if (first.path === ctx.baseFirst) card = null;
                else if (first.path === initial[0] && ctx.card) card = ctx.card;
                else {
                    setStatus('Liste kartı hazırlanıyor...');
                    const src = first.blob || await (await fetch(`${SITE}/${first.path}`)).blob();
                    const cardPath = `${PANEL_DIR}${id}/kart-${stamp}.webp`;
                    await putFile(token, cardPath, await toCard(src), msg);
                    card = cardPath;
                    uploaded.push(cardPath);
                }
            }

            for (const p of uploaded) {
                const ok = await waitLive(p, (n) => setStatus(`Sitede yayınlanması bekleniyor... (${(n + 1) * 5} sn)`));
                if (!ok) throw new Error('Görsel sitede 5 dakikada yayınlanmadı; veritabanına yazılmadı. Biraz sonra yeniden "Kaydet" deyin.');
            }

            setStatus('Kaydediliyor...');
            await ctx.write({ images, card });

            // Artık kullanılmayan eski panel dosyaları GitHub'dan silinir (en iyi çaba)
            const keep = new Set([...(images || []), ...(card ? [card] : [])]);
            const old = [...initial, ...(ctx.card ? [ctx.card] : [])].filter(p => p.startsWith(PANEL_DIR) && !keep.has(p));
            for (const p of old) await deleteFile(token, p, `Panel: ürün ${id} eski görsel silindi`);

            ctx.audit(reset ? 'Varsayılana döndü' : `${images.length} görsel`);
            ctx.toast(reset ? 'Görseller varsayılana döndü.' : 'Görseller kaydedildi ve yayınlandı.', 'success');
            close();
        } catch (err) {
            console.error('Ürün görselleri:', err);
            setStatus('Hata: ' + errText(err), true);
        } finally {
            busy = false;
            const b = $('#pimg-save');
            if (b) b.disabled = false;
        }
    }

    function close() {
        root.classList.remove('open');
        body.innerHTML = '';
        items.forEach(i => i.preview && URL.revokeObjectURL(i.preview));
    }
    $('#close-pimg-modal').onclick = () => { if (!busy) close(); };

    render();
    loadToken();
}
