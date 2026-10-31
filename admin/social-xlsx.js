/* Sosyal Medya & Reklam sekmesinin Excel dışa aktarımı (düğmeye basınca social.js import() ile yükler).
   sheets(data, ov, orders, h) -> buildXlsx sayfa listesi. Yalnız ekranda olan veri yazılır (yeni sunucu çağrısı yok);
   `ov` reklam yönetimi özeti (kampanyalar), yoksa null. `h` social.js'teki ad çözücüler (sayfa/tıklama/hata adları).
   Sütun başlıkları birimi söyler: "(%)" yüzde sayısı, "(sn)" saniye, "(₺)" para. Tarih: gün = YYYY-AA-GG, an = tarih+saat (Türkiye saati). */

const money = (v) => ({ v: Math.round((Number(v) || 0) * 100) / 100, t: 'money' });
const stamp = (sec) => (sec ? { v: sec * 1000, t: 'date' } : '');
const iso = (s) => { const ms = Date.parse(s || ''); return Number.isFinite(ms) ? { v: ms, t: 'date' } : ''; };
const n0 = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v));
const r1 = (v) => (n0(v) === '' ? '' : Math.round(Number(v) * 10) / 10);
const ratio = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : '');   // yüzde, 1 ondalık

const VERDICT = { 'iyi': 'İyi', 'orta': 'Orta', 'zayıf': 'Zayıf' };
const OBJECTIVE = { OUTCOME_TRAFFIC: 'Siteye trafik', OUTCOME_SALES: 'Alışveriş yapma (satış)', OUTCOME_AWARENESS: 'Erişim' };
const GENDER = { all: 'Hepsi', male: 'Erkek', female: 'Kadın' };
const STATUS = {
    ACTIVE: 'Yayında', PAUSED: 'Duraklatıldı', IN_PROCESS: 'İşleniyor', WITH_ISSUES: 'Sorunlu', PENDING_REVIEW: 'İncelemede',
    DISAPPROVED: 'Reddedildi', CAMPAIGN_PAUSED: 'Duraklatıldı', ADSET_PAUSED: 'Duraklatıldı'
};
const SRC_ORDER = ['instagram', 'facebook', 'google', 'direkt', 'diger'];
const DUR_LABELS = ['5 sn altı', '5-15 sn', '15-30 sn', '30-60 sn', '1-2 dk', '2 dk üstü'];
const ev = (e, k) => (e && e[k]) || 0;

export function sheets(data, ov, orders, h) {
    const out = [];
    const days = data.days || [];
    const reels = data.reels || [];
    const site = data.site || null;

    // sipariş: gün -> {n, total} (panelin sipariş verisi; iptal ve ödeme bekleyenler hariç)
    const ord = {};
    for (const o of orders || []) {
        const d = h.istDay(o.t);
        ord[d] = ord[d] || { n: 0, total: 0 };
        ord[d].n += 1;
        ord[d].total += Number(o.total) || 0;
    }
    const fol = Object.fromEntries((data.followers || []).map((x) => [x.d, x.n]));

    // ------------------------------------------------------------ Özet
    const acc = data.account || {};
    const last30 = days.slice(-30);
    const sumDay = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const orders30 = last30.reduce((a, r) => a + (ord[r.d] ? ord[r.d].n : 0), 0);
    const revenue30 = last30.reduce((a, r) => a + (ord[r.d] ? ord[r.d].total : 0), 0);
    const s = data.summary || {};
    const ads0 = ((data.ads || {}).accounts || [])[0];
    const sum = [['Bölüm', 'Alan', 'Değer', 'Açıklama']];
    const add = (sec, field, value, note = '') => sum.push([sec, field, value, note]);
    add('Dosya', 'Oluşturulma zamanı', { v: Date.now(), t: 'date' }, 'Excel dosyasının indirildiği an');
    add('Dosya', 'Verinin son güncellenmesi', stamp(data.updated), data.updated_by === 'midnight' ? 'Gece 00:00 otomatik yenileme' : data.updated_by ? 'Yenile düğmesiyle' : '');
    add('Dosya', 'Günlük veri aralığı', days.length ? `${days[0].d} → ${days[days.length - 1].d} (${days.length} gün)` : '', 'Instagram günlük rakamları en çok son 90 gün saklanır; ekranda son 30 gün gösterilir');
    add('Hesap', 'Instagram kullanıcı adı', data.username ? '@' + data.username : '');
    add('Hesap', 'Takipçi sayısı', n0(acc.followers_count));
    add('Hesap', 'Takip edilen sayısı', n0(acc.follows_count));
    add('Hesap', 'Gönderi sayısı', n0(acc.media_count));
    add('Hesap', 'Profildeki web sitesi', acc.website || '');
    add('Son 30 gün (Instagram)', 'Erişim (günlük toplamların toplamı)', sumDay(last30, 'reach'), 'Aynı kişi birden çok gün sayılabilir');
    add('Son 30 gün (Instagram)', 'Görüntüleme', sumDay(last30, 'views'));
    add('Son 30 gün (Instagram)', 'Profil ziyareti', sumDay(last30, 'profile_views'));
    add('Son 30 gün (Instagram)', 'Profildeki site bağlantısına tıklama', sumDay(last30, 'website_clicks'));
    add('Son 30 gün (Instagram)', 'Etkileşime giren hesap', sumDay(last30, 'accounts_engaged'));
    add('Son 30 gün (Instagram)', 'Toplam etkileşim', sumDay(last30, 'total_interactions'));
    add('Son 30 gün (Sipariş)', 'Sipariş sayısı', orders30, 'Sitedeki tüm siparişler (iptal ve ödeme bekleyenler hariç); kaynağı ayrılmıyor');
    add('Son 30 gün (Sipariş)', 'Ciro (₺)', money(revenue30));
    add('Huni (son 30 gün)', 'Profil ziyareti / erişim (%)', ratio(sumDay(last30, 'profile_views'), sumDay(last30, 'reach')));
    add('Huni (son 30 gün)', 'Site tıklaması / profil ziyareti (%)', ratio(sumDay(last30, 'website_clicks'), sumDay(last30, 'profile_views')));
    add('Huni (son 30 gün)', 'Sipariş / site tıklaması (%)', ratio(orders30, sumDay(last30, 'website_clicks')));
    add('Reels (hesap ortalaması)', 'Reels sayısı', n0(s.n));
    add('Reels (hesap ortalaması)', 'Ortanca ilk 3 sn geçme oranı (%)', r1(s.med_skip));
    add('Reels (hesap ortalaması)', 'Ortanca izlenme oranı (%)', r1(s.med_hold));
    add('Reels (hesap ortalaması)', 'Ortanca erişim', s.med_reach ? Math.round(s.med_reach) : '');
    if (site && site.total) {
        add('Site davranışı (son 30 gün)', 'Ziyaret', n0(site.total.loads), 'Sayfa açılışı; aynı kişi tekrar gelirse yine sayılır');
        add('Site davranışı (son 30 gün)', 'Telefondan ziyaret', n0(site.total.mobile));
        add('Site davranışı (son 30 gün)', 'Oranlar ve sınırlar', 'Site Olayları sayfası', 'Huni olayı oranı ziyarete, kaynak oranı tüm ziyaretlere göredir; basılan yerler en çok 30, kampanya ve ödemeden ayrılma 10 satırla sınırlıdır');
        add('Site davranışı (son 30 gün)', 'Kimliksiz sayaç', 'Evet', 'Kişi, IP ya da cihaz kaydedilmez; olay sayıları kişi sayısı değildir');
    }
    const ads = data.ads || {};
    if (ov && (ov.campaigns || []).length) add('Reklam', 'Reklam Kampanyaları sayfası', `${ov.campaigns.length} kampanya`, 'Rakamlar kampanyanın açıldığı günden bugüne toplamdır; para birimi TRY');
    add('Reklam', 'Meta reklam hesabı bağlı', ads.connected ? 'Evet' : 'Hayır', ads.missing ? `Eksik izin/bağlantı: ${ads.missing}` : '');
    add('Reklam', 'Meta Pixel (engrare.com)', ads.pixel === true ? 'Kurulu' : ads.pixel === false ? 'Kurulu değil' : 'Kontrol edilemedi');
    if (ads0) {
        const t = ads0.total || {};
        add('Reklam (son 30 gün, hesap)', 'Hesap', ads0.name, `Para birimi: ${ads0.currency || ''}`);
        add('Reklam (son 30 gün, hesap)', 'Harcama', money(t.spend));
        add('Reklam (son 30 gün, hesap)', 'Gösterim', n0(t.impressions));
        add('Reklam (son 30 gün, hesap)', 'Erişim', n0(t.reach));
        add('Reklam (son 30 gün, hesap)', 'Bağlantı tıklaması', n0(t.inline_link_clicks));
        add('Reklam (son 30 gün, hesap)', 'Tıklama oranı (%)', n0(t.ctr));
        add('Reklam (son 30 gün, hesap)', 'Tıklama başı maliyet', money(t.cpc));
        add('Reklam (son 30 gün, hesap)', 'Bin gösterim maliyeti', money(t.cpm));
    }
    out.push({ name: 'Özet', widths: [30, 42, 26, 70], rows: sum });

    // ------------------------------------------------------------ Günlük Instagram
    const daily = [['Tarih', 'Erişim (tekil hesap)', 'Takipçi erişimi', 'Takipçi olmayan erişim', 'Görüntüleme', 'Profil ziyareti', 'Profildeki site tıklaması',
        'Etkileşime giren hesap', 'Toplam etkileşim', 'Beğeni', 'Yorum', 'Paylaşım', 'Kaydetme', 'Takipçi sayısı (gün sonu)', 'Sipariş sayısı', 'Ciro (₺)', 'Not']];
    for (const r of [...days].reverse()) {
        const o = ord[r.d] || { n: 0, total: 0 };
        daily.push([r.d, n0(r.reach), n0(r.reach_f), n0(r.reach_nf), n0(r.views), n0(r.profile_views), n0(r.website_clicks), n0(r.accounts_engaged),
            n0(r.total_interactions), n0(r.likes), n0(r.comments), n0(r.shares), n0(r.saves), n0(fol[r.d]), o.n, money(o.total), r.partial ? 'Gün sürüyor (rakamlar eksik olabilir)' : '']);
    }
    out.push({ name: 'Günlük Instagram', widths: [12, 14, 13, 16, 13, 13, 18, 16, 15, 9, 9, 10, 10, 18, 12, 12, 34], rows: daily });

    // ------------------------------------------------------------ Reels
    const reelRows = [['Reels No', 'Yayın zamanı', 'Süre (sn)', 'Açıklama', 'Genel puan (0-100)', 'Karar', 'Açılış puanı', 'İzlenme puanı', 'Değer puanı', 'Etkileşim puanı', 'Dağıtım puanı',
        'Erişim', 'Görüntüleme', 'İlk 3 sn\'de geçen (%)', 'Ort. izleme (sn)', 'Ort. izleme / video süresi (%)', 'Toplam izleme süresi (dk)', 'Beğeni', 'Yorum', 'Kaydetme',
        'Paylaşım', 'Yeniden paylaşım', 'Toplam etkileşim', 'Kaydet+paylaş / erişim (%)', 'Etkileşim / erişim (%)', 'Ses seviyesi (LUFS)', 'Açılış cümlesi',
        'AI Stüdyo işi', 'Rakamların söylediği', 'AI kararı', 'AI: neden', 'AI: korunacak', 'AI: düzeltilecek', 'Rakamların alındığı zaman', 'Instagram bağlantısı']];
    const diagKind = { good: 'İyi', bad: 'Sorun', info: 'Bilgi' };
    for (const r of [...reels].sort((a, b) => a.n - b.n)) {
        const m = r.m || {}, sc = r.score || {}, p = sc.parts || {}, ai = r.ai || {};
        const reach = m.reach || 0;
        reelRows.push([r.n, stamp(r.t), r1(r.dur), r.caption || '', n0(sc.total), sc.total === null || sc.total === undefined ? '' : (VERDICT[sc.verdict] || ''),
            n0(p.hook), n0(p.hold), n0(p.value), n0(p.engage), n0(p.reach),
            n0(m.reach), n0(m.views), r1(m.skip), m.avg_ms ? r1(m.avg_ms / 1000) : '', r.dur && m.avg_ms ? r1((m.avg_ms / 10) / r.dur) : '',
            m.total_ms ? r1(m.total_ms / 60000) : '', n0(m.likes), n0(m.comments), n0(m.saved), n0(m.shares), n0(m.reposts), n0(m.inter),
            reach ? ratio((m.saved || 0) + (m.shares || 0) + (m.reposts || 0), reach) : '', reach ? ratio(m.inter || 0, reach) : '', r1(r.lufs), r.hook || '',
            r.job ? `${r.job.title || ''} v${r.job.version || ''}`.trim() : 'AI Stüdyo dışında hazırlanmış',
            (r.diag || []).map((d) => `[${diagKind[d.t] || 'Bilgi'}] ${d.text}`).join('\n'),
            ai.verdict ? (VERDICT[ai.verdict] || ai.verdict) : '', (ai.why || []).join('\n'), (ai.keep || []).join('\n'), (ai.fix || []).join('\n'),
            stamp(r.m_at), r.permalink || '']);
    }
    out.push({ name: 'Reels', widths: [9, 17, 9, 40, 12, 9, 10, 10, 10, 11, 11, 10, 13, 14, 12, 16, 15, 9, 9, 10, 10, 12, 12, 15, 14, 12, 40, 28, 70, 10, 60, 60, 60, 17, 44], rows: reelRows });

    // ------------------------------------------------------------ Reels zaman içindeki değişim (rakamlar zamanla artar)
    const hist = [['Reels No', 'Yayın zamanı', 'Kayıt zamanı', 'Yayından sonra geçen süre (saat)', 'Erişim', 'Görüntüleme', 'İlk 3 sn\'de geçen (%)', 'Ort. izleme (sn)', 'Toplam etkileşim']];
    for (const r of [...reels].sort((a, b) => a.n - b.n)) {
        for (const x of r.hist || []) {
            hist.push([r.n, stamp(r.t), stamp(x[0]), r1((x[0] - r.t) / 3600), n0(x[1]), n0(x[2]), r1(x[3]), x[4] ? r1(x[4] / 1000) : '', n0(x[5])]);
        }
    }
    out.push({ name: 'Reels Gelişimi', widths: [9, 17, 17, 18, 10, 13, 16, 14, 14], rows: hist });

    // ------------------------------------------------------------ Reels sahne / konuşma / olay
    const tl = [['Reels No', 'Tür', 'Başlangıç (sn)', 'Bitiş (sn)', 'Ad / etiket', 'İçerik (başlık ya da söylenen)']];
    for (const r of [...reels].sort((a, b) => a.n - b.n)) {
        const t = r.timeline;
        if (!t) continue;
        for (const x of t.scenes || []) tl.push([r.n, 'Sahne', r1(x.s), r1(x.e), x.label || '', x.head || '']);
        for (const x of t.voice || []) tl.push([r.n, 'Konuşma', r1(x.s), r1(x.e), '', x.text || '']);
        for (const x of t.events || []) tl.push([r.n, 'Olay', r1(x.t), '', x.label || '', '']);
        for (const c of t.cuts || []) tl.push([r.n, 'Kesme', r1(c), '', '', '']);
    }
    out.push({ name: 'Reels Sahne-Konuşma', widths: [9, 11, 13, 11, 22, 80], rows: tl });

    // ------------------------------------------------------------ AI öğrenimleri
    const an = data.analysis || {};
    const lr = an.learnings || {};
    const learn = [['Bölüm', 'Madde', 'Güven', 'Dayanak']];
    if (an.summary) learn.push(['AI özeti', an.summary, '', '']);
    for (const [title, xs] of [['Korunacak', lr.keep], ['Bırakılacak', lr.avoid], ['Denenecek', lr.try]]) {
        for (const x of xs || []) learn.push([title, x.text || '', x.confidence || '', x.evidence || '']);
    }
    if (an.at) learn.push(['Bilgi', `Son AI yorumu ${new Date(an.at * 1000).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}, ${an.n} Reels üzerinden`, '', '']);
    const prompt = (data.prompt || []).filter((l) => String(l).trim());
    if (prompt.length) learn.push(['AI Stüdyo\'ya giden metin', prompt.join('\n'), '', '']);
    out.push({ name: 'AI Öğrenimleri', widths: [24, 90, 12, 50], rows: learn });

    // ------------------------------------------------------------ Reklam kampanyaları (panelin reklam yönetimi)
    if (ov && (ov.campaigns || []).length) {
        const camp = [['Kampanya', 'Kaynak', 'Hedef', 'Durum', 'Günlük bütçe (₺)', 'Oluşturulma', 'Bitiş', 'Konum', 'Yaş', 'Cinsiyet', 'İlgi alanları',
            'Toplam harcama (₺)', 'Toplam gösterim', 'Toplam erişim', 'Toplam bağlantı tıklaması', 'Sayfa açılışı', 'Sayfa açılışı / tıklama (%)', 'Satın alma (Pixel)', 'Tıklama oranı (%)', 'Tıklama başı maliyet', 'Bin gösterim maliyeti', 'Sorunlar', 'Instagram bağlantısı']];
        for (const c of ov.campaigns) {
            const m = c.m || {}, a = c.audience || {};
            const st = STATUS[c.ad_effective === 'ACTIVE' || c.ad_effective === 'PAUSED' ? c.effective : c.ad_effective] || STATUS[c.effective] || c.effective || '';
            camp.push([String(c.name || '').replace(/^Panel · /, ''), c.own ? 'Panelden açıldı' : 'Meta\'dan açıldı', OBJECTIVE[c.objective] || c.objective || '', st,
                money(c.daily), iso(c.created), iso(c.end),
                c.audience ? ((a.places || []).join(', ') || 'Türkiye') : '', a.age && a.age[0] ? `${a.age[0]}-${a.age[1]}` : '', GENDER[a.gender] || '', (a.interests || []).join(', '),
                money(m.spend), n0(m.impressions), n0(m.reach), n0(m.clicks), n0(m.lpv), m.clicks ? ratio(m.lpv || 0, m.clicks) : '',
                c.objective === 'OUTCOME_SALES' ? n0(m.purchases) : '', n0(m.ctr), m.cpc ? money(m.cpc) : '', m.cpm ? money(m.cpm) : '',
                (c.issues || []).join(' · '), c.permalink || '']);
        }
        out.push({ name: 'Reklam Kampanyaları', widths: [34, 16, 22, 14, 14, 17, 17, 24, 9, 10, 30, 12, 12, 12, 14, 12, 16, 14, 12, 14, 14, 36, 44], rows: camp });
    }

    // ------------------------------------------------------------ Reklam hesabı (Meta, son 30 gün)
    if (ads0) {
        const accRows = [['Hesap', 'Para birimi', 'Kayıt türü', 'Tarih / kampanya', 'Harcama', 'Gösterim', 'Erişim', 'Bağlantı tıklaması', 'Tıklama oranı (%)', 'Tıklama başı maliyet', 'Bin gösterim maliyeti']];
        for (const a of ads.accounts) {
            const t = a.total || {};
            accRows.push([a.name, a.currency || '', 'Hesap toplamı (son 30 gün)', '', money(t.spend), n0(t.impressions), n0(t.reach), n0(t.inline_link_clicks), n0(t.ctr), money(t.cpc), money(t.cpm)]);
            for (const c of a.campaigns || []) {
                accRows.push([a.name, a.currency || '', 'Kampanya (son 30 gün)', c.name, money(c.spend), n0(c.impressions), n0(c.reach), n0(c.clicks), n0(c.ctr), money(c.cpc), '']);
            }
            for (const d of a.daily || []) {
                accRows.push([a.name, a.currency || '', 'Günlük', d.d, money(d.spend), n0(d.impressions), '', n0(d.clicks), '', '', '']);
            }
        }
        out.push({ name: 'Reklam Hesabı 30 Gün', widths: [24, 11, 28, 40, 12, 12, 12, 16, 15, 17, 17], rows: accRows });
    }

    // ------------------------------------------------------------ Site davranışı (kimliksiz sayaç)
    if (site && site.total && (site.days || []).length) {
        const t = site.total;
        const sd = [['Tarih', 'Ziyaret', 'Sayfa görüntüleme', 'Ürüne bakma', 'Sepete ekleme', 'Ödemeye geçme', 'Kart ödemesine geçme', 'Satın alma']];
        for (const x of [...site.days].reverse()) {
            sd.push([x.d, x.loads || 0, x.views || 0, ev(x.ev, 'view_item'), ev(x.ev, 'add_to_cart'), ev(x.ev, 'begin_checkout'), ev(x.ev, 'odeme_baslat'), ev(x.ev, 'purchase')]);
        }
        out.push({ name: 'Site Günlük', widths: [12, 10, 17, 13, 14, 15, 20, 12], rows: sd });

        const pg = [['Sayfa', 'Sayfa yolu (ham)', 'Görüntüleme', 'Süresi ölçülen görüntüleme', 'Toplam süre (sn)', 'Ort. süre (sn)', ...DUR_LABELS.map((l) => `Kalma: ${l}`),
            'Sayfanın %25\'ine inen', 'Sayfanın %50\'sine inen', 'Sayfanın %75\'ine inen', 'Sayfanın sonuna inen', 'Sonuna inen / ölçülen (%)']];
        for (const [p, r] of Object.entries(t.pages || {}).sort((a, b) => b[1].v - a[1].v)) {
            const sc = r.scroll || [0, 0, 0, 0], du = r.dur || [0, 0, 0, 0, 0, 0];
            pg.push([h.sitePageName(p), p, r.v, r.n, r.sec, r.n ? r1(r.sec / r.n) : '', ...du, ...sc, r.n ? ratio(sc[3], r.n) : '']);
        }
        out.push({ name: 'Site Sayfalar', widths: [30, 22, 13, 18, 14, 13, 12, 12, 12, 12, 12, 12, 14, 14, 14, 14, 16], rows: pg });

        const srcTotal = Object.values(t.src || {}).reduce((a, n) => a + n, 0);
        const beh = [['Tür', 'Ad / açıklama', 'Sayı', 'Oran (%)', 'Ham anahtar']];
        for (const k of Object.keys(h.siteEv)) {
            if (t.events && t.events[k]) beh.push(['Huni olayı', h.siteEv[k], t.events[k], ratio(t.events[k], t.loads), k]);
        }
        for (const [k, n] of Object.entries(t.src || {}).sort((a, b) => b[1] - a[1] || SRC_ORDER.indexOf(a[0]) - SRC_ORDER.indexOf(b[0]))) {
            beh.push(['Nereden geldi', h.siteSrc[k] || k, n, ratio(n, srcTotal), k]);
        }
        for (const [k, n] of Object.entries(t.camp || {}).sort((a, b) => b[1] - a[1])) beh.push(['Reklam kampanyası (utm_campaign)', k, n, '', k]);
        for (const [k, n] of Object.entries(t.clicks || {}).sort((a, b) => b[1] - a[1])) beh.push(['Basılan / yazılan yer', h.siteClickName(k), n, '', k]);
        for (const [k, n] of Object.entries(t.events || {}).filter(([k]) => k.startsWith('sepet_hata_') || k.startsWith('hata_')).sort((a, b) => b[1] - a[1])) {
            beh.push(['Kullanıcının hata aldığı yer', h.siteErrName(k), n, '', k]);
        }
        for (const [k, n] of Object.entries(t.abandon || {}).sort((a, b) => b[1] - a[1])) beh.push(['Ödemeden ayrılırken son alan', k, n, '', k]);
        const known = new Set([...Object.keys(h.siteEv)]);
        for (const [k, n] of Object.entries(t.events || {}).sort((a, b) => b[1] - a[1])) {
            if (!known.has(k) && !k.startsWith('sepet_hata_') && !k.startsWith('hata_')) beh.push(['Diğer olay', k, n, '', k]);
        }
        out.push({ name: 'Site Olayları', widths: [32, 70, 11, 11, 36], rows: beh });
    }
    return out;
}
