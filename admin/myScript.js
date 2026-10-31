import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { getDatabase, ref, get, set, push, update, remove, onValue, query, orderByKey, limitToLast, endAt, serverTimestamp, runTransaction } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import { products as BASE_PRODUCTS } from "../products.js?v=15";

// Arka plana basıp pencerenin içinde (ör. yazı seçerken) sürükleyip dışarıda bırakmak pencereyi
// kapatmasın: arka plan tıklaması yalnızca basma da arka planda başladıysa geçerlidir.
(() => {
    let downOn = null;
    window.addEventListener('pointerdown', (e) => { downOn = e.target; }, true);
    window.addEventListener('click', (e) => {
        if (e.target.classList && e.target.classList.contains('modal-overlay') && downOn !== e.target) e.stopImmediatePropagation();
    }, true);
})();

const firebaseConfig = {
	apiKey: "AIzaSyBM7oB0EkTjGJiOHdo67ByXA6qxVcvPS8Y",
	authDomain: "engrar3d.firebaseapp.com",
	databaseURL: "https://engrar3d-default-rtdb.europe-west1.firebasedatabase.app",
	projectId: "engrar3d",
	storageBucket: "engrar3d.firebasestorage.app",
	messagingSenderId: "68298863793",
	appId: "1:68298863793:web:ba7ec7ded3424b4c779e90",
	measurementId: "G-NLSV32JMM2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const functions = getFunctions(app, 'europe-west1');

let globalAdminData = null;
let adminDataUnsubscribe = null;
let usersOrdersUnsubscribe = null;
let mailStatsUnsubscribe = null;
let printerStatusUnsubscribe = null;
let printerStatusTimer = null;
let lastPrinterStatus = null;
let serverTimeOffset = 0;

/* Kargo (Basit Kargo) sabitleri ve durumu: kapanış içindeki Kargo sekmesi/ sipariş detayı kullanır */
const BK_STATUS = {
    NEW: ['Taslak', 'badge-muted'], READY_TO_SHIP: ['Gönderime Hazır', 'badge-warning'], SHIPPED: ['Kargoda', 'badge-info'],
    OUT_FOR_DELIVERY: ['Dağıtımda', 'badge-info'], DELIVERED: ['Teslim Edildi', 'badge-purple'], RETURNING: ['İade Yolunda', 'badge-danger'],
    RETURNED: ['İade Edildi', 'badge-danger'], LOST: ['Kayıp', 'badge-danger'], DELAYED: ['Gecikti', 'badge-warning'], NEEDS_SUPPORT: ['Destek Gerekli', 'badge-danger']
};
const SHIP_HANDLERS = {
    ECONOMIC: 'En ucuz firma (otomatik)', FAST: 'En hızlı firma (otomatik)', ARAS: 'Aras Kargo', YURTICI: 'Yurtiçi Kargo',
    SURAT: 'Sürat Kargo', PTT: 'PTT Kargo', HEPSIJET: 'HepsiJET', KOLAYGELSIN: 'KolayGelsin'
};
const SHIP_DEFAULT_PKG = { width: 19, depth: 26, height: 5, weight: 0.5 };
const SHIP_LOW_BALANCE = 150; // altında uyarı çıkar (bir gönderi yaklaşık 100-130 TL)
let shipSettings = { defaultHandler: 'ECONOMIC', autoStatus: true, autoMail: true, packages: {} };
let shipSettingsUnsub = null;
let shipAccount = null, shipAccountAt = 0;
let shipTab = 'todo', shipBusy = false;
const shipSel = { todo: new Set(), transit: new Set() };
const kargoCtx = { userId: '', orderId: '', fees: null, desi: null, pkg: null, error: '', sig: '' };
const KARGO_AUDIT = { kargoCreate: 'Barkod oluşturuldu', kargoQuick: 'Hızlı kargolama', kargoCancel: 'Barkod iptal edildi', kargoReturn: 'İade barkodu oluşturuldu', kargoSetAddress: 'Adres düzeltildi' };
const kargoCall = (name, data) => httpsCallable(functions, name)(data || {}).then(r => {
    if (KARGO_AUDIT[name]) auditLog('kargo', data && data.orderId ? '#' + data.orderId : '', KARGO_AUDIT[name]);
    return r.data;
});
const kargoMoney = (v) => '₺' + (Number(v) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kargoOrder = () => (globalAdminData && globalAdminData.orders && globalAdminData.orders[kargoCtx.orderId]) || null;

/* İŞLEM GEÇMİŞİ (audit log): panelde yapılan önemli işlemler `audit_log`a doğrudan RTDB'den yazılır (sunucu fonksiyonu yok).
   Kurallar yalnızca yönetici+2FA'ya ekleme izni verir; mevcut kayıt değiştirilemez, yalnızca eskiler silinebilir.
   En son AUDIT_KEEP kayıt tutulur (auditTrim, oturumda bir kez). Yazım hatası paneli bozmaz. */
const AUDIT_KEEP = 1000;
const AUDIT_LABELS = {
    order_status: ['Sipariş durumu', 'fa-arrows-rotate'], order_status_bulk: ['Toplu durum', 'fa-layer-group'],
    order_delete: ['Sipariş silindi', 'fa-trash'], user_delete: ['Kullanıcı silindi', 'fa-user-xmark'],
    order_refund: ['Kart iadesi', 'fa-rotate-left'], order_note: ['Sipariş notu', 'fa-note-sticky'],
    discount_save: ['İndirim kodu', 'fa-tags'], discount_delete: ['İndirim kodu silindi', 'fa-tags'],
    products_save: ['Ürünler', 'fa-box'], product_images: ['Ürün görselleri', 'fa-images'], pricing_save: ['Fiyatlandırma', 'fa-calculator'],
    expense_add: ['Gider eklendi', 'fa-receipt'], tax_limit: ['Vergi limiti', 'fa-scale-balanced'], expense_delete: ['Gider silindi', 'fa-receipt'],
    review_save: ['Yorum', 'fa-star'], review_delete: ['Yorum silindi', 'fa-star'],
    kargo: ['Kargo', 'fa-truck-fast'], ship_settings: ['Kargo ayarları', 'fa-gear'],
    mfa: ['2FA', 'fa-shield-halved'], export: ['Excel dışa aktarma', 'fa-file-excel'],
    gider_pusulasi: ['Gider pusulası', 'fa-file-invoice'], order_edit: ['Sipariş düzeltme', 'fa-pen-to-square']
};
function auditLog(action, target, detail) {
    try {
        const u = auth.currentUser;
        if (!u) return;
        push(ref(db, 'audit_log'), {
            at: serverTimestamp(), uid: u.uid, by: String(u.email || '').slice(0, 100),
            action: String(action).slice(0, 40), target: String(target || '').slice(0, 80), detail: String(detail || '').slice(0, 300)
        }).catch((e) => console.warn('İşlem geçmişi yazılamadı:', e.message));
    } catch (e) { console.warn('İşlem geçmişi yazılamadı:', e.message); }
}
let auditTrimmed = false;
let backupStatusUnsub = null;
let auditShown = 0;
function renderBackupStatus(st) {
    const $l = $('#backup-status-line').removeClass('bad');
    if (!st || !st.at) { $l.text('Sunucu yedeği: henüz alınmadı (köprü servisi gün aşırı alır).'); return; }
    const when = new Date(st.at).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
    const ageH = (Date.now() - st.at) / 36e5;
    if (st.ok === false) { $l.addClass('bad').text(`Son yedek denemesi başarısız (${when}): ${st.error || 'bilinmeyen hata'}`); return; }
    const kb = st.bytes ? ` · ${(st.bytes / 1024 / 1024).toFixed(1)} MB` : '';
    const counts = st.orders !== undefined ? ` · ${st.orders} sipariş, ${st.users} kullanıcı${st.logos ? ', ' + st.logos + ' logo' : ''}` : '';
    if (ageH > 72) $l.addClass('bad');
    $l.text(`Son sunucu yedeği: ${when}${kb}${counts}${ageH > 72 ? ' — 3 günden eski, köprü servisini kontrol edin.' : ''}`);
}
async function loadAudit(limit) {
    const $list = $('#audit-list');
    try {
        const snap = await get(query(ref(db, 'audit_log'), orderByKey(), limitToLast(limit)));
        const rows = [];
        snap.forEach((c) => { rows.push({ key: c.key, ...c.val() }); });
        rows.reverse();
        auditShown = rows.length;
        $list.html(rows.map((r) => {
            const [label, icon] = AUDIT_LABELS[r.action] || [r.action, 'fa-circle-info'];
            const when = r.at ? new Date(r.at).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
            return `<li><div class="audit-main"><i class="fa-solid ${icon}"></i>${esc(label)}${r.target ? ' · ' + esc(r.target) : ''}</div>
                <div class="audit-sub">${r.detail ? esc(r.detail) + '<br>' : ''}${esc(when)} · ${esc(r.by || r.uid)}</div></li>`;
        }).join('') || '<li><div class="audit-sub">Henüz kayıt yok.</div></li>').prop('hidden', false);
        $('#btn-audit-more').prop('hidden', rows.length < limit || limit >= AUDIT_KEEP);
    } catch (e) { showToast('Geçmiş okunamadı: ' + e.message, 'error'); }
}
async function auditTrim() {
    if (auditTrimmed || !auth.currentUser) return;
    auditTrimmed = true;
    try {
        // Son AUDIT_KEEP+1 kayıt gelirse en eskisi sınırın dışındadır: ondan öncekilerle birlikte silinir
        const snap = await get(query(ref(db, 'audit_log'), orderByKey(), limitToLast(AUDIT_KEEP + 1)));
        if (snap.size <= AUDIT_KEEP) return;
        const oldestKept = Object.keys(snap.val()).sort()[1];
        const old = await get(query(ref(db, 'audit_log'), orderByKey(), endAt(oldestKept)));
        const updates = {};
        old.forEach((c) => { if (c.key !== oldestKept) updates[`audit_log/${c.key}`] = null; });
        if (Object.keys(updates).length) await update(ref(db), updates);
    } catch (e) { auditTrimmed = false; console.warn('İşlem geçmişi temizlenemedi:', e.message); }
}
const shipHandlerLabel = (code) => SHIP_HANDLERS[code] || code;


const TAX_EXEMPTION_LIMIT = 1900000; // 1.900.000 TL vergi muafiyeti ciro limiti (varsayılan; yıl bazında panelden değişir: admin/finance/tax_limits/<yıl>)
const ORDERS_PER_PAGE = 20; // Sipariş listesi sayfa boyu: telefonda kısa kaydırma, masaüstünde yeterli
let ordersPage = 1;
const orderFilter = { status: '', pay: '', prio: '', date: '' };
let taxYearSel = null; // Vergi kartında seçili takvim yılı (boşsa içinde bulunulan yıl)

// Firebase sunucu saati farkını dinle (bilgisayar saati ileri/geri olsa bile gerçek zamanı yakalamak için)
onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    serverTimeOffset = Number(snap.val()) || 0;
    if (globalAdminData) renderFinance();
}, () => {});

/* Sipariş verisi müşteriden geldiği için (yazı, ad, adres...) HTML'e basılmadan
   önce mutlaka kaçışlanmalı; aksi halde yönetici panelinde script çalıştırılabilir. */
function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* Müşteri yazı/QR bilgisini boş bırakmış olabilir (site engel koymaz, aranıp sorulur). Yazılı ürün: yazı yok;
   stand: platform kaydı var ama link boş. Hiçbiri olmayan (yazısız, QR'sız) kalem yazı bekleyen üründür. */
function itemMissing(item) {
    const m = [];
    if (item.socialPlatform1) { if (!item.socialLink1) m.push('1. QR'); if (item.socialPlatform2 && !item.socialLink2) m.push('2. QR'); }
    else if (!String(item.customText || '').trim()) m.push('Yazı');
    return m;
}
function orderMissing(order) {
    const items = (Array.isArray(order.items) ? order.items : Object.values(order.items || {})).filter(Boolean);
    return [...new Set(items.flatMap(itemMissing))];
}

function safeColor(value, fallback) {
    return /^#[0-9a-fA-F]{3,8}$/.test(value) || /^[a-zA-Z]{3,20}$/.test(value) ? value : fallback;
}

function safeUrl(value) {
    return (typeof value === 'string' && /^[A-Za-z0-9\-._~:/?#@!$&+,=%;]+$/.test(value)) ? value : '';
}

/* Ürün görselleri site köküne göre ("./content/...") tanımlı; admin paneli /admin/ altında
   olduğu için yolları bir üst dizine çevirir (ödeme sayfasındaki resolveAssetPath ile aynı mantık). */
function resolveAssetPath(src) {
    if (!src || typeof src !== 'string') return '';
    if (src.startsWith('./')) return '../' + src.slice(2);
    if (src.startsWith('content/')) return '../' + src;
    return src;
}

function formatTL(amount) {
    const n = Number(amount) || 0;
    const sign = n < 0 ? '-' : '';
    return sign + '₺' + Math.abs(n).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatShortTL(amount) {
    const n = Number(amount) || 0;
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1000) return `${sign}₺${(abs / 1000).toFixed(1).replace('.', ',')}B`;
    return `${sign}₺${Math.round(abs)}`;
}

function getOrderGrossSale(order) {
    if (!order || typeof order !== 'object') return 0;
    const direct = parseFloat(order.totalAmount ?? order.total ?? order.paidPrice ?? order.subtotal ?? 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    // Sunucunun yazdığı 0 TL'lik (%100 indirimli) sipariş gerçekten 0'dır; kalem toplamına düşüp gelir sayılmasın
    if (direct === 0 && order.subtotal !== undefined) return 0;
    if (order.items) {
        const itemsArr = Array.isArray(order.items) ? order.items : Object.values(order.items);
        const itemsSum = itemsArr.filter(Boolean).reduce((sum, item) => {
            return sum + (parseFloat(item.price) || 0) * (Number(item.quantity) || 1);
        }, 0);
        const ship = parseFloat(order.shippingCost) || 0;
        const disc = parseFloat(order.discountAmount) || 0;
        return Math.max(0, itemsSum + ship - disc);
    }
    return 0;
}

function extractOrdersFromUsers(usersObj) {
    const allOrders = {};
    if (!usersObj || typeof usersObj !== 'object') return allOrders;
    Object.entries(usersObj).forEach(([userId, user]) => {
        if (!user || !user.orders) return;
        Object.entries(user.orders).forEach(([orderId, order]) => {
            if (!order || typeof order !== 'object') return;
            allOrders[orderId] = {
                ...order,
                id: order.id || orderId,
                userId: order.userId || userId,
                customerName: (order.shippingInfo && (order.shippingInfo.fullname || order.shippingInfo.name))
                    ? (order.shippingInfo.fullname || `${order.shippingInfo.name} ${order.shippingInfo.surname || ''}`.trim())
                    : (user.profile ? (user.profile.fullname || user.profile.username || 'Bilinmeyen Kullanıcı') : 'Bilinmeyen Kullanıcı'),
                totalAmount: getOrderGrossSale(order)
            };
        });
    });
    return allOrders;
}

// Default Data Structure provided by the user (Fallback)
const DEFAULT_ADMIN_DATA = {
    "dashboard": { "stats": { "dailyRevenue": 0, "monthlyRevenue": 0 }, "live_status": { "message": "Sistem aktif." } },
    "orders": {},
    "inventory": { "filaments": {} },
    "finance": { "tax_tracking": { "limit": TAX_EXEMPTION_LIMIT, "current_total": 0 }, "expenses": {} }
};

$(document).ready(function() {
    
    // --- AUTHENTICATION LOGIC ---

    // 1. Trigger Login Modal
    $('#admin-login-trigger').click(function() {
        const currentUser = auth.currentUser;
        if (!currentUser) {
             $('#login-modal').addClass('open');
        }
    });
    // Kullanıcılar sayfasındaki "Giriş Yap" butonu
    $('#btn-admin-login').click(function() {
        $('#login-modal').addClass('open');
    });

    // 2. Handle Login Form Submit
    $('#admin-login-form').submit(async function(e) {
        e.preventDefault();
        
        const email = $('#login-email').val();
        const password = $('#login-password').val();
        const $btn = $(this).find('button[type="submit"]');
        const originalText = $btn.text();

        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Giriş Yapılıyor...');

        try {
            const prevUid = auth.currentUser && auth.currentUser.uid;
            await signInWithEmailAndPassword(auth, email, password);

            // Yönetici olup olmadığı ve 2FA, onAuthStateChanged içindeki kontrolde belli olur
            showToast("Giriş yapıldı, yetki kontrol ediliyor...", "success");
            $('#login-modal').removeClass('open');
            // Aynı hesapla yeniden girişte uid değişmez, onAuthStateChanged tetiklenmez: kontrol elle yapılır
            if (auth.currentUser && auth.currentUser.uid === prevUid) handleAuthUser(auth.currentUser);

            // NOTE: The onAuthStateChanged listener will handle loading the data via onValue
            // but we can trigger an initial fleet refresh here.
            refreshFleetStatus();

        } catch (error) {
            console.error("Login Error:", error);
            if (auth.currentUser) await signOut(auth);

            if (error.code === 'PERMISSION_DENIED' || error.message.includes('permission_denied')) {
                showToast("Hata: Lütfen admin hesabıyla giriş yapın.", "error");
            } else {
                showToast(error.message, "error");
            }
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });

    // 3. Logout Logic (hem kenar çubuğu hem Kullanıcılar sayfasındaki buton)
    function doAdminLogout() {
        if (confirm('Çıkış yapmak istediğinize emin misiniz?')) {
            signOut(auth).then(() => {
                showToast("Başarıyla çıkış yapıldı.", "success");
                setTimeout(() => location.reload(), 1000);
            }).catch((error) => {
                showToast("Çıkış hatası: " + error.message, "error");
            });
        }
    }
    $('#admin-logout-btn').click(function(e) {
        e.stopPropagation();
        doAdminLogout();
    });
    $('#btn-admin-logout').click(doAdminLogout);

    // 3b. Admin Şifre Değiştirme (mevcut şifre ile yeniden doğrulama + güncelleme)
    function openAdminPasswordModal() {
        if (!auth.currentUser) {
            $('#login-modal').addClass('open');
            showToast("Şifre değiştirmek için lütfen giriş yapın.", "error");
            return;
        }
        $('#admin-password-form')[0].reset();
        $('#admin-password-modal').addClass('open');
    }
    $('#btn-admin-change-password').click(openAdminPasswordModal);
    $('#close-admin-password-modal, #cancel-admin-password').click(function() {
        $('#admin-password-modal').removeClass('open');
    });

    $('#admin-password-form').submit(async function(e) {
        e.preventDefault();
        const user = auth.currentUser;
        if (!user || !user.email) {
            showToast("Oturum bulunamadı, lütfen tekrar giriş yapın.", "error");
            return;
        }
        const currentPwd = $('#pwd-current').val();
        const newPwd = $('#pwd-new').val();
        const confirmPwd = $('#pwd-confirm').val();

        if (!newPwd || newPwd.length < 6) {
            showToast("Yeni şifre en az 6 karakter olmalı.", "error");
            return;
        }
        if (newPwd !== confirmPwd) {
            showToast("Yeni şifreler birbiriyle uyuşmuyor.", "error");
            return;
        }

        const $btn = $('#btn-save-admin-password');
        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Güncelleniyor...');

        let reauthed = false;
        try {
            // Firebase, şifre değişikliği için yakın zamanda giriş ister; mevcut şifreyle yeniden doğrula
            const credential = EmailAuthProvider.credential(user.email, currentPwd);
            await reauthenticateWithCredential(user, credential);
            reauthed = true;
            await updatePassword(user, newPwd);
            $('#admin-password-modal').removeClass('open');
            showToast("Şifreniz başarıyla güncellendi.", "success");
        } catch (error) {
            console.error("Password Change Error:", error);
            let msg = error.message;
            if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
                msg = "Mevcut şifre hatalı.";
            } else if (error.code === 'auth/weak-password') {
                msg = "Yeni şifre çok zayıf (en az 6 karakter).";
            } else if (error.code === 'auth/too-many-requests') {
                msg = "Çok fazla deneme yapıldı, lütfen biraz sonra tekrar deneyin.";
            }
            showToast("Şifre güncellenemedi: " + msg, "error");
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
        // Yeniden giriş yeni bir oturum sayılır (2FA damgası oturuma bağlı, şifre değişince hatırlanan cihazlar da
        // geçersiz): veri dinleyicileri kapatılıp kod yeniden istenir, doğrulanınca panel yeniden yüklenir
        if (reauthed && auth.currentUser) {
            stopAdminListeners();
            if (await ensureMfaVerified(auth.currentUser) === 'ok') loadDataIfAdmin();
        }
    });

    // 4. Close Modal
    $('.modal-close, .modal-overlay').click(function(e) {
        // Bambu 2FA penceresi kendi işleyicisiyle kapanır; arka planı iptal sayılır, altındaki pencere açık kalır
        if ($(this).closest('#bambu-2fa-modal').length) {
            if (e.target === this && this.id === 'bambu-2fa-modal') $('#close-2fa-modal').trigger('click');
            return;
        }
        if (e.target === this) {
            // Giriş yapılmadan (kilitliyken) giriş penceresi kapatılamaz
            if ($('body').hasClass('auth-locked') && $(this).closest('#login-modal').length) return;
            $('#login-modal').removeClass('open');
            $('#expense-modal').removeClass('open');
            $('#admin-password-modal').removeClass('open');
            $('#discount-modal').removeClass('open');
            $('#bambu-2fa-modal').removeClass('active'); // Close 2FA modal too
            $('#printer-settings-modal').removeClass('open');
        }
    });

    // --- İKİ ADIMLI DOĞRULAMA (2FA) ---
    // Giriş sonrası checkMfaStatus çağrılır; damga yoksa panel açılmaz (veri zaten RTDB kurallarıyla kilitli).
    const callFn = (name, data) => httpsCallable(functions, name)(data || {}).then(r => r.data);
    let mfaResendTimer = null;

    // Sonuç: 'ok' (panel açılabilir), 'mfa' (kod penceresi açıldı), 'not-admin', 'error' ya da 'stale':
    // yanıt gelene kadar oturum değişti (ör. ana sitedeki misafir oturumun kontrolü sürerken yönetici girişi);
    // sonuç eski hesabındır, uygulanmaz (önceden yöneticinin yeni oturumuna uygulanıp "yetki yok" hatası veriyordu).
    async function ensureMfaVerified(user) {
        const deviceToken = localStorage.getItem('engrare_mfa_device_' + user.uid) || '';
        // checkMfaStatus required bayrağını yazar; çağrılamazsa RTDB kuralları veriyi vermez.
        // Geçici ağ hatalarına karşı birkaç kez denenir.
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt) await new Promise(r => setTimeout(r, 1500));
            if (auth.currentUser !== user) return 'stale';
            try {
                const res = await callFn('checkMfaStatus', { deviceToken });
                if (auth.currentUser !== user) return 'stale';
                if (res.verified) return 'ok';
                // Sunucu { required: false, verified: false } yalnızca yönetici olmayan hesaba döner
                if (!res.required) return 'not-admin';
                openMfaModal();
                return 'mfa';
            } catch (error) {
                console.warn(`2FA durumu alınamadı (deneme ${attempt + 1}):`, error.message);
            }
        }
        if (auth.currentUser !== user) return 'stale';
        showToast("Doğrulama durumu alınamadı. Lütfen sayfayı yenileyin.", "error");
        return 'error';
    }

    function openMfaModal() {
        $('#mfa-code').val('');
        $('#mfa-remember').prop('checked', false);
        $('#mfa-modal').addClass('open');
        sendMfaCode();
    }

    async function sendMfaCode() {
        try {
            await callFn('sendMfaCode', {});
            showToast("Doğrulama kodu e-postanıza gönderildi.", "success");
            startMfaResendCountdown();
        } catch (error) {
            showToast("Kod gönderilemedi: " + (error.message || "Bilinmeyen hata"), "error");
        }
    }

    function startMfaResendCountdown() {
        let sec = 60;
        const $link = $('#mfa-resend');
        $link.css({ 'pointer-events': 'none', 'opacity': '0.5' });
        clearInterval(mfaResendTimer);
        const tick = () => {
            $link.text(`Kodu tekrar gönder (${sec})`);
            if (sec-- <= 0) {
                clearInterval(mfaResendTimer);
                $link.text('Kodu tekrar gönder').css({ 'pointer-events': '', 'opacity': '' });
            }
        };
        tick();
        mfaResendTimer = setInterval(tick, 1000);
    }

    $('#mfa-resend').on('click', function(e) {
        e.preventDefault();
        if ($(this).css('pointer-events') === 'none') return;
        sendMfaCode();
    });

    $('#mfa-logout').on('click', function(e) {
        e.preventDefault();
        signOut(auth).then(() => location.reload());
    });

    $('#mfa-form').on('submit', async function(e) {
        e.preventDefault();
        const code = String($('#mfa-code').val() || '').replace(/\D/g, '');
        if (code.length !== 6) { showToast("Lütfen 6 haneli kodu girin.", "error"); return; }
        const $btn = $('#btn-mfa-verify');
        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Doğrulanıyor...');
        try {
            const res = await callFn('verifyMfaCode', {
                code,
                rememberDevice: $('#mfa-remember').is(':checked'),
                deviceLabel: (navigator.userAgent || '').slice(0, 80)
            });
            if (res.deviceToken && auth.currentUser) {
                localStorage.setItem('engrare_mfa_device_' + auth.currentUser.uid, res.deviceToken);
            }
            clearInterval(mfaResendTimer);
            $('#mfa-modal').removeClass('open');
            showToast("Doğrulama başarılı, panele giriş yapıldı.", "success");
            setAuthLock(false);
            loadDataIfAdmin();
        } catch (error) {
            showToast("Doğrulama başarısız: " + (error.message || "Bilinmeyen hata"), "error");
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
    });

    // --- 2FA E-POSTA LİSTESİ YÖNETİMİ ---
    async function loadMfaEmails() {
        try {
            const res = await callFn('listMfaEmails', {});
            renderMfaEmails(res.emails || []);
        } catch (error) {
            console.warn("2FA e-posta listesi alınamadı:", error.message);
        }
    }

    function renderMfaEmails(emails) {
        const $list = $('#mfa-email-list');
        if (!emails.length) {
            $list.empty();
            $('#mfa-email-empty').show();
            return;
        }
        $('#mfa-email-empty').hide();
        $list.html(emails.map(e => `
            <li class="mfa-email-item">
                <span><i class="fa-solid fa-envelope"></i> ${esc(e)}</span>
                <button type="button" class="btn-icon-sm mfa-email-remove" data-email="${esc(e)}" title="Kaldır"><i class="fa-solid fa-xmark"></i></button>
            </li>`).join(''));
    }

    $('#btn-add-mfa-email').on('click', async function() {
        const email = String($('#mfa-email-input').val() || '').trim().toLowerCase();
        if (!email) { showToast("E-posta girin.", "error"); return; }
        const $btn = $(this);
        $btn.prop('disabled', true);
        try {
            const res = await callFn('addMfaEmail', { email });
            renderMfaEmails(res.emails || []);
            $('#mfa-email-input').val('');
            showToast("2FA bu e-posta için etkinleştirildi.", "success");
            auditLog('mfa', email, '2FA e-postası eklendi');
        } catch (error) {
            showToast("Eklenemedi: " + (error.message || "Bilinmeyen hata"), "error");
        } finally {
            $btn.prop('disabled', false);
        }
    });

    $('#btn-audit-load').on('click', () => loadAudit(50));
    $('#btn-audit-more').on('click', () => loadAudit(Math.min(AUDIT_KEEP, auditShown + 100)));

    $('#mfa-email-list').on('click', '.mfa-email-remove', async function() {
        const email = $(this).data('email');
        if (!confirm(`"${email}" için 2FA kaldırılsın mı?`)) return;
        try {
            const res = await callFn('removeMfaEmail', { email });
            renderMfaEmails(res.emails || []);
            showToast("2FA bu e-posta için kaldırıldı.", "success");
            auditLog('mfa', email, '2FA e-postası kaldırıldı');
        } catch (error) {
            showToast("Kaldırılamadı: " + (error.message || "Bilinmeyen hata"), "error");
        }
    });

    // 5. Auth Observer
    // Giriş yapılmadan panel içeriği görünmez ve gezinilemez; yalnızca kapatılamayan
    // giriş penceresi açık kalır (arka plan bulanık). Giriş + 2FA tamamlanınca kilit açılır.
    function setAuthLock(locked) {
        $('body').toggleClass('auth-locked', locked);
        if (locked) {
            $('#login-modal').addClass('open');
        } else {
            $('#login-modal').removeClass('open');
        }
    }

    function stopAdminListeners() {
        if (adminDataUnsubscribe) { adminDataUnsubscribe(); adminDataUnsubscribe = null; }
        if (usersOrdersUnsubscribe) { usersOrdersUnsubscribe(); usersOrdersUnsubscribe = null; }
        if (mailStatsUnsubscribe) { mailStatsUnsubscribe(); mailStatsUnsubscribe = null; }
        if (printerStatusUnsubscribe) { printerStatusUnsubscribe(); printerStatusUnsubscribe = null; }
        stopPrinterCamera();
        if (printerStatusTimer) { clearInterval(printerStatusTimer); printerStatusTimer = null; }
        if (shipSettingsUnsub) { shipSettingsUnsub(); shipSettingsUnsub = null; }
        if (backupStatusUnsub) { backupStatusUnsub(); backupStatusUnsub = null; }
        auditTrimmed = false;
        shipAccount = null;
        lastPrinterStatus = null;
        renderPrinterStatus(null);
    }

    // Oturumsuz görünüm: panel kilitli, yalnızca giriş penceresi açık
    function showSignedOut() {
        $('#admin-name').text("Giriş Yap");
        $('#admin-role').text("Misafir");
        $('#admin-avatar').attr('src', "../content/images/default_user.png");
        $('#admin-logout-btn').hide();
        renderAdminSelf(null);
        $('#mfa-modal').removeClass('open');
        $('#mfa-emails-card').hide();
        resetSocial();
        setAuthLock(true);
    }

    async function handleAuthUser(user) {
        // Önceki hesabın dinleyicileri ve kod penceresi kapanır: yeni hesabın yetkisi kontrol edilirken eskisininki kalmasın
        stopAdminListeners();
        $('#mfa-modal').removeClass('open');
        // Ana site aynı tarayıcı deposunu paylaşır: orada logo yüklerken/ödemede açılan misafir (anonim) oturum
        // panelde oturum yok sayılır; yönetici girişi onun yerine geçer
        if (!user || user.isAnonymous) {
            showSignedOut();
            return;
        }
        $('#admin-name').text(user.displayName || "Yönetici");
        $('#admin-role').text("Kontrol ediliyor...");
        $('#admin-avatar').attr('src', user.photoURL || "../content/images/default_user.png");
        $('#admin-logout-btn').show();
        renderAdminSelf(user);

        // 2FA damgası yoksa panel açılmaz; doğrulanınca loadDataIfAdmin çağrılır
        const status = await ensureMfaVerified(user);
        if (status === 'ok') {
            setAuthLock(false);
            loadDataIfAdmin();
        } else if (status === 'mfa') {
            // 2FA bekleniyor: panel kilitli kalır, kod penceresi gösterilir
            $('#login-modal').removeClass('open');
        } else if (status === 'not-admin') {
            // Ana sitede açık kalmış müşteri hesabı: panel kilitli kalır, yönetici hesabıyla giriş beklenir
            showSignedOut();
            showToast(`${user.email || 'Bu hesap'} yönetici hesabı değil. Lütfen yönetici hesabıyla giriş yapın.`, "error");
        }
        // 'stale': oturum bu arada değişti, yeni oturumun kendi kontrolü sürüyor. 'error': giriş penceresi açık kalır.
    }

    onAuthStateChanged(auth, handleAuthUser);

    // Kullanıcılar sayfasındaki yönetici hesap kartını doldurur (giriş yapılmış / misafir durumu)
    function renderAdminSelf(user) {
        if (user) {
            $('#admin-self-logged-in, #admin-self-actions').show();
            $('#admin-self-guest, #admin-self-guest-actions').hide();
            $('#admin-self-name').text(user.displayName || 'Yönetici');
            $('#admin-self-email').text(user.email || '-');
            $('#admin-self-avatar').attr('src', user.photoURL || "../content/images/default_user.png");
        } else {
            $('#admin-self-logged-in, #admin-self-actions').hide();
            $('#admin-self-guest, #admin-self-guest-actions').show();
        }
    }

    function loadDataIfAdmin() {
        if (!auth.currentUser) return;

        // 1. Listen to Admin Data (Dashboard, Inventory, Pricing, Expenses, Admin Users, etc.)
        if (adminDataUnsubscribe) adminDataUnsubscribe();
        const adminRef = ref(db, 'admin');
        adminDataUnsubscribe = onValue(adminRef, (snapshot) => {
            const existingOrders = (globalAdminData && globalAdminData.orders) ? globalAdminData.orders : {};
            const existingAllUsers = (globalAdminData && globalAdminData.allUsers) ? globalAdminData.allUsers : {};
            const existingAuthUsers = (globalAdminData && globalAdminData.authUsers) ? globalAdminData.authUsers : {};
            if (snapshot.exists()) {
                const data = snapshot.val();
                if (data.orders) delete data.orders; // Prevent stale admin/orders from overwriting users/*/orders
                
                if (!globalAdminData) globalAdminData = {};
                globalAdminData.finance = data.finance || {};
                globalAdminData.adminUsers = (data.users && typeof data.users === 'object') ? data.users : {};
                Object.assign(globalAdminData, data);
                globalAdminData.orders = existingOrders;
                globalAdminData.allUsers = existingAllUsers;
                globalAdminData.authUsers = existingAuthUsers;
                
                renderDashboard(globalAdminData, false);
                renderUsers();
            } else {
                console.log("No admin data found, using defaults.");
                if (!globalAdminData) globalAdminData = { ...DEFAULT_ADMIN_DATA };
                globalAdminData.orders = existingOrders;
                globalAdminData.allUsers = existingAllUsers;
                globalAdminData.authUsers = existingAuthUsers;
                renderDashboard(globalAdminData, false);
                renderUsers();
            }
            $('#admin-role').text("Süper Admin");
        }, (error) => {
            console.error("Data Load Error:", error);
            // Yönetici olmayan hesap (ör. sitede oturumu açık müşteri): kurallar veriyi vermiyor, arayüz de söylesin
            $('#admin-role').text("Yetkisiz");
            showToast("Bu hesabın yönetici yetkisi yok.", "error");
        });

        // 2A. Tüm kullanıcıları ve siparişleri doğrudan Firebase Realtime Database (users/*) üzerinden canlı dinle
        if (usersOrdersUnsubscribe) usersOrdersUnsubscribe();
        usersOrdersUnsubscribe = onValue(ref(db, 'users'), (snapshot) => {
            const usersVal = snapshot.val() || {};
            const liveOrders = extractOrdersFromUsers(usersVal);
            if (!globalAdminData) globalAdminData = {};
            globalAdminData.allUsers = usersVal;
            globalAdminData.orders = liveOrders;

            renderOrders(liveOrders);
            renderFinance();
            renderUsers();
            console.log("Users & Orders loaded directly from Firebase RTDB:", Object.keys(usersVal).length, "users,", Object.keys(liveOrders).length, "orders");
        }, (error) => {
            console.warn("Direct RTDB users listener fallback to Cloud Function:", error.message);
        });

        // 2B. Yedek olarak Cloud Function (getAllOrders) üzerinden siparişleri ve Firebase Auth hesaplarını çek
        const getAllOrders = httpsCallable(functions, 'getAllOrders');
        getAllOrders()
            .then((result) => {
                const fnOrders = (result && result.data && result.data.orders) || {};
                const fnAuthUsers = (result && result.data && result.data.authUsers) || {};
                if (!globalAdminData) globalAdminData = {};
                // Mevcut doğrudan çekilen siparişlerle birleştir
                globalAdminData.orders = { ...(globalAdminData.orders || {}), ...fnOrders };
                globalAdminData.authUsers = fnAuthUsers;

                renderOrders(globalAdminData.orders);
                renderFinance();
                renderUsers();
                console.log("Orders & Auth users synced via Cloud Function:", Object.keys(globalAdminData.orders).length, "orders,", Object.keys(fnAuthUsers).length, "auth users");
            })
            .catch((error) => {
                console.error("Order Load Error:", error);
                if (error.code === 'functions/permission-denied') {
                    showToast("Bu hesabın yönetici yetkisi yok.", "error");
                }
            });
        
        // 3. E-posta gönderim sayaçları (grafik)
        if (mailStatsUnsubscribe) mailStatsUnsubscribe();
        mailStatsUnsubscribe = onValue(ref(db, 'stats/mail'), (snap) => renderMailStats(snap.val()),
            (error) => console.error("Mail Stats Error:", error));

        // 4. İndirim kodları (yalnızca yönetici okuyabilir)
        loadDiscounts();

        // 4A. Müşteri yorumları (herkese açık okunur; yazma yöneticiye)
        loadReviews();

        // 4B. Kargo ayarları (config/shipping) ve Basit Kargo hesabı
        initShipSettings();
        loadShipAccount(true);

        // 4C. İşlem geçmişi kartı + sunucu yedeği durumu; eski kayıtlar bir kez temizlenir
        $('#audit-card').show();
        if (backupStatusUnsub) backupStatusUnsub();
        backupStatusUnsub = onValue(ref(db, 'backup_status'), (snap) => renderBackupStatus(snap.val()), () => renderBackupStatus(null));
        setTimeout(auditTrim, 15000);

        // 5. 2FA e-posta listesi (yalnızca doğrulanmış yönetici)
        $('#mfa-emails-card').show();
        loadMfaEmails();

        // 6. Canlı baskı durumu (Bambu Lab yerel MQTT köprüsünün yazdığı printer/devices)
        initPrinterStatus();

        // Initial fleet refresh on load
        refreshFleetStatus();

        // 7. Sosyal Medya & Reklam sekmesi açıkken giriş tamamlandıysa verisini şimdi getirir
        if ($('#social-section').hasClass('active')) openSocial();
    }

    // --- NAVIGATION ---
    // Üst menü 5 ana sayfa. Sayfa adres çubuğundaki ?summary, ?orders gibi anahtarla seçilir;
    // yenileme, yer imi ve geri/ileri tuşları çalışır.
    const DEFAULT_PAGE = 'summary';
    const pages = new Map();
    $('.nav-item[data-page]').each(function() {
        pages.set($(this).data('page'), { $nav: $(this), target: $(this).data('target') });
    });
    let currentPage = null;

    function pageFromUrl() {
        return [...new URLSearchParams(location.search).keys()].find(key => pages.has(key)) || null;
    }

    // Telefonda alt çubukta yalnız Özet/Siparişler/Ürünler/Daha görünür: Kargo "Siparişler" altında,
    // Sosyal/Finans/Kullanıcılar "Daha" menüsünde. Etkin sayfa ait olduğu çubuk düğmesini vurgular.
    const MORE_PAGES = ['social', 'finance', 'users'];
    function setMoreOpen(open) {
        $('#more-sheet').prop('hidden', !open);
        $('#nav-more').attr('aria-expanded', open ? 'true' : 'false');
    }

    function showPage(page) {
        const { $nav, target } = pages.get(page);
        currentPage = page;
        setMoreOpen(false);
        $('.nav-item').removeClass('active');
        $nav.addClass('active');
        if (page === 'shipping') $('.nav-item[data-page="orders"]').addClass('active');
        if (MORE_PAGES.includes(page)) $('#nav-more').addClass('active');
        $('.content-section').hide().removeClass('active');
        $(target).fadeIn(300).addClass('active');
        if (target === '#finance-section' || target === '#dashboard-section') {
            renderFinance();
        } else if (target === '#users-section') {
            renderUsers();
        } else if (target === '#shipping-section') {
            renderShipping();
            showShipTab(shipTab);
            loadShipAccount();
        } else if (target === '#social-section') {
            openSocial();
        }
    }

    $('.nav-item[data-page]').click(function() {
        const page = $(this).data('page');
        if (page !== currentPage) history.pushState(null, '', location.pathname + '?' + page);
        showPage(page);
    });

    const goPage = (page) => {
        if (!pages.has(page)) return;
        if (page !== currentPage) history.pushState(null, '', location.pathname + '?' + page);
        showPage(page);
    };
    $(document).on('click', '.seg-tab, .more-item', function() { goPage($(this).data('goto')); });
    $('#nav-more').on('click keydown', function(e) {
        if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        setMoreOpen($('#more-sheet').prop('hidden'));
    });
    $(document).on('click', function(e) { if (!$(e.target).closest('#more-sheet, #nav-more').length) setMoreOpen(false); });

    window.addEventListener('popstate', () => showPage(pageFromUrl() || DEFAULT_PAGE));

    const initialPage = pageFromUrl();
    if (!initialPage) history.replaceState(null, '', location.pathname + '?' + DEFAULT_PAGE);
    showPage(initialPage || DEFAULT_PAGE);

    // --- NEW: FLEET MANAGEMENT ---
    
    $('#btn-refresh-fleet').click(function() {
        refreshFleetStatus();
    });

    // --- YAZICI BAĞLANTI AYARLARI (Bambu Lab: Bulut veya yerel MQTT) ---
    // Bulut modu: yazıcı bulutta kalır (Bambu Handy uzaktan çalışır); sunucu durumu bulut MQTT'sinden okur.
    // LAN modu: yazıcı yerel ağda olur; bu modda yazıcı buluttan ayrılır.
    let printerCloudAccount = '';   // 2FA adımında "kodu tekrar gönder" için saklanır
    let printerCloudTfaKey = '';    // kimlik doğrulayıcı (TFA) girişinde Bambu'nun verdiği anahtar
    function setPrinterMode(mode) {
        const isCloud = mode === 'cloud';
        $('.printer-mode-btn').removeClass('active').css({ 'background': '', 'color': '' });
        $(`.printer-mode-btn[data-mode="${mode}"]`).addClass('active').css({ 'background': 'var(--primary)', 'color': '#fff' });
        $('#printer-cloud-panel').toggle(isCloud);
        $('#printer-settings-form').css('display', isCloud ? 'none' : 'flex');
    }

    let printerSavedSelection = {};   // kayıtlı seçim: seri -> { name }
    async function loadPrinterCloudDevices() {
        const $list = $('#printer-cloud-list');
        $list.html('<div class="pr-pick-msg">Yükleniyor…</div>');
        try {
            const res = await httpsCallable(functions, 'bambuDevices')();
            const devices = (res && res.data && res.data.devices) || [];
            if (!devices.length) { $list.html('<div class="pr-pick-msg">Bağlı yazıcı bulunamadı.</div>'); return; }
            const onlySaved = Object.keys(printerSavedSelection).length > 0;
            $list.html(devices.map(d => {
                const serial = String(d.serial || '').toUpperCase();
                const saved = printerSavedSelection[serial];
                // Hiç seçim yoksa tümü işaretli gelir
                const checked = onlySaved ? !!saved : true;
                const name = (saved && saved.name) || d.name || serial;
                return `<label class="pr-pick-row">
                    <input type="checkbox" class="pr-pick-check" data-serial="${esc(serial)}" data-model="${esc(d.model || '')}" ${checked ? 'checked' : ''}>
                    <span class="pr-pick-dot ${d.online ? 'on' : ''}" title="${d.online ? 'Çevrimiçi' : 'Çevrimdışı'}"></span>
                    <span class="pr-pick-body">
                        <input type="text" class="input-box pr-pick-name" maxlength="40" value="${esc(name)}" aria-label="Yazıcı adı">
                        <small>${esc(d.model || 'Bambu Lab')}${d.online ? ' · çevrimiçi' : ' · çevrimdışı'}</small>
                    </span>
                </label>`;
            }).join(''));
        } catch (e) {
            $list.html('<div class="pr-pick-msg">Yazıcılar alınamadı.</div>');
            showToast('Yazıcı listesi alınamadı: ' + (e.message || e.code), 'error');
        }
    }

    $('#btn-printer-settings').on('click', async function() {
        if (!auth.currentUser) { $('#login-modal').addClass('open'); return; }
        let cfg = {};
        try {
            const snap = await get(ref(db, 'config/printer'));
            cfg = snap.val() || {};
        } catch (e) {
            showToast('Yazıcı ayarları okunamadı: ' + e.message, 'error');
        }
        $('#printer-ip').val(cfg.ip || '');
        $('#printer-serial').val(cfg.serial || '');
        $('#printer-access-code').val(cfg.accessCode || '');
        $('#printer-cloud-account').val(cfg.account || '');
        $('#printer-cloud-password').val('');
        printerSavedSelection = {};
        if (cfg.printers && typeof cfg.printers === 'object') {
            Object.keys(cfg.printers).forEach(k => { printerSavedSelection[k.toUpperCase()] = cfg.printers[k] || {}; });
        } else if (cfg.serial) {
            printerSavedSelection[String(cfg.serial).toUpperCase()] = {};
        }

        const hasCloud = !!(cfg.accessToken && cfg.uid);
        $('#printer-cloud-logged-out').toggle(!hasCloud);
        $('#printer-cloud-logged-in').toggle(hasCloud);
        if (hasCloud) loadPrinterCloudDevices();

        setPrinterMode(cfg.mode === 'cloud' ? 'cloud' : 'lan');
        $('#printer-settings-modal').addClass('open');
    });

    $('.printer-mode-btn').on('click', function() {
        setPrinterMode($(this).data('mode'));
    });

    $('#close-printer-settings').on('click', function() {
        $('#printer-settings-modal').removeClass('open');
    });

    // LAN kaydı
    $('#printer-settings-form').on('submit', async function(e) {
        e.preventDefault();
        if (!auth.currentUser) { $('#login-modal').addClass('open'); return; }

        let ip = String($('#printer-ip').val() || '').trim();
        ip = ip.replace(/^https?:\/\//i, '').replace(/:\d+$/, '').trim();
        const serial = String($('#printer-serial').val() || '').trim().toUpperCase();
        const accessCode = String($('#printer-access-code').val() || '').trim();

        $('#printer-ip').val(ip);
        $('#printer-serial').val(serial);
        $('#printer-access-code').val(accessCode);

        const parts = ip.split('.');
        const ipOk = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && parts.length === 4 && parts.every(o => {
            const n = Number(o);
            return Number.isInteger(n) && n >= 0 && n <= 255;
        });
        if (!ipOk) { showToast('Geçerli bir IP adresi girin (ör. 192.168.1.50).', 'error'); return; }
        if (!/^[A-Za-z0-9]{6,32}$/.test(serial)) { showToast('Geçerli bir seri numarası girin.', 'error'); return; }
        if (!/^[A-Za-z0-9]{4,32}$/.test(accessCode)) { showToast('Geçerli bir erişim kodu girin.', 'error'); return; }

        const $btn = $(this).find('button[type=submit]');
        $btn.prop('disabled', true);
        try {
            await update(ref(db, 'config/printer'), { mode: 'lan', ip, serial, accessCode, updatedAt: Date.now() });
            showToast('Yerel ağ (LAN) ayarları kaydedildi. Köprü yeni ayarlarla bağlanıyor.', 'success');
            $('#printer-settings-modal').removeClass('open');
        } catch (err) {
            showToast('Kaydetme hatası: ' + err.message, 'error');
        } finally {
            $btn.prop('disabled', false);
        }
    });

    // Bulut girişi (2FA gerekirse e-posta kodu istenir)
    $('#printer-cloud-form').on('submit', async function(e) {
        e.preventDefault();
        if (!auth.currentUser) { $('#login-modal').addClass('open'); return; }
        const account = String($('#printer-cloud-account').val() || '').trim();
        const password = String($('#printer-cloud-password').val() || '');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) { showToast('Geçerli bir e-posta girin.', 'error'); return; }
        if (!password) { showToast('Bambu şifrenizi girin.', 'error'); return; }

        const $btn = $(this).find('button[type=submit]');
        $btn.prop('disabled', true).text('Giriş yapılıyor…');
        printerCloudAccount = account;
        try {
            const res = await httpsCallable(functions, 'bambuLogin')({ account, password });
            if (res.data && res.data.needCode) {
                printerCloudTfaKey = res.data.tfaKey || '';
                const code = await promptFor2FA(res.data.method);
                if (!code) { showToast('Doğrulama iptal edildi.', 'info'); return; }
                await httpsCallable(functions, 'bambuVerify')({ account, code, tfaKey: printerCloudTfaKey });
            }
            $('#printer-cloud-password').val('');
            $('#printer-cloud-logged-out').hide();
            $('#printer-cloud-logged-in').show();
            await loadPrinterCloudDevices();
            showToast('Bambu hesabı bağlandı. Yazıcıyı seçip kaydedin.', 'success');
        } catch (err) {
            showToast('Bambu girişi başarısız: ' + (err.message || err.code), 'error');
        } finally {
            $btn.prop('disabled', false).text('Giriş Yap');
        }
    });

    // Bulut: işaretlenen yazıcıları kaydet
    $('#printer-cloud-save').on('click', async function() {
        if (!auth.currentUser) { $('#login-modal').addClass('open'); return; }
        const printers = {};
        $('#printer-cloud-list .pr-pick-row').each(function() {
            const $chk = $(this).find('.pr-pick-check');
            const serial = String($chk.data('serial') || '').trim().toUpperCase();
            if (!$chk.prop('checked') || !/^[A-Za-z0-9]{6,32}$/.test(serial)) return;
            printers[serial] = {
                name: String($(this).find('.pr-pick-name').val() || '').replace(/[<>]/g, '').trim().slice(0, 40) || serial,
                model: String($chk.data('model') || '').slice(0, 40)
            };
        });
        if (!Object.keys(printers).length) { showToast('En az bir yazıcı işaretleyin.', 'error'); return; }
        const $btn = $(this);
        $btn.prop('disabled', true);
        try {
            // Eski tek `serial` alanı kaldırılır (null = sil); `printers` yerine koyulur
            await update(ref(db, 'config/printer'), { mode: 'cloud', printers, serial: null, updatedAt: Date.now() });
            showToast('Yazıcılar kaydedildi. Köprü yeni ayarlarla bağlanıyor.', 'success');
            $('#printer-settings-modal').removeClass('open');
        } catch (err) {
            showToast('Kaydetme hatası: ' + err.message, 'error');
        } finally {
            $btn.prop('disabled', false);
        }
    });

    // Bulut: oturumu kapat
    $('#printer-cloud-logout').on('click', async function() {
        if (!auth.currentUser) { $('#login-modal').addClass('open'); return; }
        if (!confirm('Bambu hesabı bağlantısı kaldırılsın mı?')) return;
        try {
            await httpsCallable(functions, 'bambuLogout')();
            $('#printer-cloud-logged-in').hide();
            $('#printer-cloud-logged-out').show();
            showToast('Bambu oturumu kapatıldı.', 'success');
        } catch (err) {
            showToast('Çıkış hatası: ' + (err.message || err.code), 'error');
        }
    });

    // --- 2FA MODAL HANDLER ---
    function promptFor2FA(method) {
        return new Promise((resolve) => {
            const $modal = $('#bambu-2fa-modal');
            const $form = $('#bambu-2fa-form');
            const $input = $('#bambu-2fa-code');
            const $close = $('#close-2fa-modal');
            const $resendBtn = $('#resend-2fa-code');
            const $timerSpan = $('#resend-timer');
            
            // 1. Remove ANY existing listeners to prevent stacking
            $form.off();
            $close.off();
            $resendBtn.off();

            let countdownInterval;

            // Timer Logic
            const startCountdown = () => {
                let timeLeft = 60;
                $resendBtn.css({ 'pointer-events': 'none', 'opacity': '0.5' });
                $timerSpan.text(`(${timeLeft}s)`);
                
                clearInterval(countdownInterval);
                countdownInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        $timerSpan.text(`(${timeLeft}s)`);
                    } else {
                        clearInterval(countdownInterval);
                        $resendBtn.css({ 'pointer-events': 'auto', 'opacity': '1' });
                        $timerSpan.text('');
                    }
                }, 1000);
            };

            // Kimlik doğrulayıcı uygulama girişinde kod e-postayla gelmez, yeniden gönderme yoktur
            const isTfa = method === 'tfa';
            $('#bambu-2fa-desc').text(isTfa
                ? 'Bambu Lab kimlik doğrulayıcı uygulamanızdaki 6 haneli kodu giriniz.'
                : 'Bambu Lab hesabınız için e-postanıza gönderilen doğrulama kodunu giriniz.');
            $('#bambu-2fa-resend').toggle(!isTfa);

            // Reset UI
            $input.val('');
            $modal.addClass('open'); // Match CSS
            $input.focus();
            startCountdown();

            // Handle Submit
            const onSubmit = (e) => {
                e.preventDefault();
                const code = $input.val().trim();
                if (code) {
                    cleanup();
                    resolve(code);
                }
            };

            // Handle Resend: Bambu girişini yeniden tetikleyip yeni kod gönderir
            const onResend = async (e) => {
                e.preventDefault();
                const password = String($('#printer-cloud-password').val() || '');
                if (!printerCloudAccount || !password) {
                    showToast("Yeni kod için Bambu şifrenizi girip tekrar giriş yapın.", "info");
                    return;
                }
                $resendBtn.css({ 'pointer-events': 'none', 'opacity': '0.5' });
                try {
                    await httpsCallable(functions, 'bambuLogin')({ account: printerCloudAccount, password });
                    showToast("Yeni doğrulama kodu gönderildi.", "success");
                } catch (err) {
                    showToast("Kod gönderilemedi: " + (err.message || err.code), "error");
                } finally {
                    $resendBtn.css({ 'pointer-events': 'auto', 'opacity': '1' });
                }
            };

            // Handle Close/Cancel
            const onClose = () => {
                cleanup();
                resolve(null); 
            };

            const cleanup = () => {
                clearInterval(countdownInterval);
                $modal.removeClass('open'); 
                $form.off();
                $close.off();
                $resendBtn.off();
            };

            $form.on('submit', onSubmit);
            $close.on('click', onClose);
            $resendBtn.on('click', onResend);
        });
    }

    async function refreshFleetStatus(verificationCode = null) {
        const $btn = $('#btn-refresh-fleet');
        const $icon = $btn.find('i');
        const $grid = $('#device-grid');
        
        $grid.html('<div style="grid-column:1/-1; text-align:center; padding:20px; color:#94A3B8;">Filo durumu şu anlık kapalı.</div>');
        $btn.prop('disabled', false);
        $icon.removeClass('fa-spin'); 
        return;
    }

    // --- RENDER FUNCTION ---
    function renderDashboard(data, renderOrdersFlag = true) {
        // globalAdminData = data; // Already set in listener

        // 1. Live Status
        // Canlı Baskı Durumu kartı doğrudan renderPrinterStatus tarafından yönetilir.
        // renderDashboard içinde #live-status-msg üzerine yazma işlemi yarış durumunu önlemek için kaldırılmıştır.
        // if (data.dashboard && data.dashboard.live_status && !isPrinterStatusFresh()) {
        //     $('#live-status-msg').text(data.dashboard.live_status.message);
        // }

        // 4. Production Queue
        const $queue = $('#production-queue');
        $queue.empty();
        if (data.production_queue) {
            Object.values(data.production_queue).forEach(job => {
                $queue.append(`
                    <div class="queue-item" draggable="true">
                        <div class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></div>
                        <div class="queue-info">
                            <strong>Job: ${esc(job.job_id)}</strong>
                            <span>${esc(job.filename)} • Priority: ${esc(job.priority)}</span>
                        </div>
                        <div class="queue-status">
                            <span class="badge badge-info">${esc(job.status)}</span>
                        </div>
                    </div>
                `);
            });
        }

        // 5. Stock
        const $stock = $('#stock-list-container');
        $stock.empty();
        if (data.inventory && data.inventory.filaments) {
            Object.values(data.inventory.filaments).forEach(fil => {
                const color = safeColor(String(fil.color || '').toLowerCase(), '#cbd5e1');
                const remaining = Number(fil.remaining_g) || 0;
                $stock.append(`
                    <div class="stock-item">
                        <div class="stock-info">
                            <div class="color-indicator" style="background: ${color};"></div>
                            <div class="stock-text">
                                <strong>${esc(fil.type)} ${esc(fil.color)}</strong>
                                <span>${esc(fil.brand)}</span>
                            </div>
                        </div>
                        <div class="stock-progress">
                             <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${Math.max(0, Math.min(100, (remaining / 1000) * 100))}%; background: ${color};"></div>
                            </div>
                            <span class="stock-val">${remaining}g / 1000g</span>
                        </div>
                    </div>
                `);
            });
        }

        // 6. Orders
        if (renderOrdersFlag) {
            renderOrders(data.orders || {});
        }
        
        // 8. Files
        const $files = $('#file-grid');
        $files.empty();
        if (data.files_library) {
             Object.values(data.files_library).forEach(file => {
                $files.append(`
                    <div class="file-card">
                        <div class="file-icon"><i class="fa-solid fa-cube"></i></div>
                        <div class="file-details">
                            <strong>${esc(file.name)}</strong>
                            <span>Ready</span>
                        </div>
                         <div class="file-actions">
                            <button class="btn-icon-sm"><i class="fa-solid fa-download"></i></button>
                        </div>
                    </div>
                `);
            });
        }

        // 9. Pricing Parameters (admin/pricing)
        if (data.pricing && typeof data.pricing === 'object') {
            applyPricingParamsToInputs(data.pricing);
            $('#pricing-sync-badge').text('Firebase Kayıtlı').attr('class', 'badge badge-success');
            updatePricingUI();
        }

        // 7. Finance & Tax (Siparişler + Giderler + Fiyatlandırma Formülü)
        renderFinance();
    }

    // --- ORDER MANAGEMENT HELPERS ---

    function renderOrders(orders) {
        const $orderTable = $('#orders-table-body');
        $orderTable.empty();
        
        const searchTerm = ($('#order-search-input').val() || '').toLocaleLowerCase('tr').trim();
        const sortMode = $('#order-sort-select').val() || 'priority-desc';

        // Tablo başlığındaki aktif sıralama ikonunu güncelle
        $('.sortable-th').removeClass('active-sort').find('i').attr('class', 'fa-solid fa-sort');
        const [activeCol, activeDir] = sortMode.split('-');
        const $activeTh = $(`.sortable-th[data-sort-col="${activeCol}"]`);
        if ($activeTh.length) {
            $activeTh.addClass('active-sort');
            $activeTh.find('i').attr('class', activeDir === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down');
        }

        const isPriorityOrder = (order) => {
            const m = String(order.shippingMethod || 'standart').toLocaleLowerCase('tr');
            return m.includes('öncelikli') || m.includes('hızlı') || m.includes('priority') || m.includes('fast') || m.includes('express');
        };

        // Üretim durumu sıralaması: Ödendi (1) => Hazırlanıyor (2) => Kargolandı (3) => Ödeme Bekliyor (4) => Teslim Edildi (5) => İptal (6)
        const getStatusRank = (status) => {
            const s = String(status || '').toLocaleLowerCase('tr');
            if (s.includes('ödendi') || s.includes('paid')) return 1;
            if (s.includes('ödeme bekliyor') || s.includes('pending_payment') || s.includes('pending payment') || s.includes('payment_review')) return 4;
            if (s.includes('hazır') || s.includes('pending')) return 2;
            if (s.includes('kargo')) return 3;
            if (s.includes('teslim') || s.includes('tamam')) return 5;
            if (s.includes('iptal') || s.includes('cancel')) return 6;
            return 7;
        };
        
        // Helper for status badge
        const getStatusBadge = (status) => {
            let icon = 'fa-circle-question';
            let badgeClass = 'badge-muted';
            if (!status) status = 'Bilinmiyor';
            const s = String(status).toLocaleLowerCase('tr');
            
            if (s.includes('ödeme bekliyor') || s.includes('pending_payment') || s.includes('pending payment')) {
                icon = 'fa-circle-exclamation';
                badgeClass = 'badge-danger'; // Red/Warning style
                status = 'Ödeme Bekliyor';
            } else if (s.includes('payment_review')) {
                icon = 'fa-magnifying-glass-dollar';
                badgeClass = 'badge-warning';
                status = 'Ödeme İnceleniyor (iyzico)';
            } else if (s.includes('ödendi') || s.includes('paid')) {
                icon = 'fa-sack-dollar';
                badgeClass = 'badge-success'; // Green
                status = 'Ödendi';
            } else if (s.includes('hazır') || s.includes('pending')) {
                icon = 'fa-clock';
                badgeClass = 'badge-warning'; // Orange
                status = 'Hazırlanıyor';
            } else if (s.includes('kargo')) {
                icon = 'fa-truck';
                badgeClass = 'badge-info'; // Blue
                status = 'Kargolandı';
            } else if (s.includes('teslim') || s.includes('tamam')) {
                icon = 'fa-box-open';
                badgeClass = 'badge-purple'; // Purple (will add)
                status = 'Teslim Edildi';
            } else if (s.includes('iptal') || s.includes('cancel')) {
                icon = 'fa-ban';
                badgeClass = 'badge-danger'; // Red
                status = 'İptal Edildi';
            }
            
            return `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> ${esc(status)}</span>`;
        };

        const sortedOrders = Object.entries(orders).sort((a, b) => {
            const keyA = a[0];
            const keyB = b[0];
            const orderA = a[1] || {};
            const orderB = b[1] || {};
            
            const idA = parseInt(keyA.replace(/\D/g, ''), 10) || 0;
            const idB = parseInt(keyB.replace(/\D/g, ''), 10) || 0;
            const prioA = isPriorityOrder(orderA);
            const prioB = isPriorityOrder(orderB);
            const priceA = parseFloat(orderA.totalAmount) || 0;
            const priceB = parseFloat(orderB.totalAmount) || 0;
            const statusA = getStatusRank(orderA.status);
            const statusB = getStatusRank(orderB.status);

            switch (sortMode) {
                case 'id-desc':
                    return idB - idA;
                case 'id-asc':
                    return idA - idB;
                case 'price-desc':
                    return (priceB - priceA) || (idA - idB);
                case 'price-asc':
                    return (priceA - priceB) || (idA - idB);
                case 'status-asc':
                    return (statusA - statusB) || (prioB - prioA) || (idA - idB);
                case 'status-desc':
                    return (statusB - statusA) || (prioB - prioA) || (idA - idB);
                case 'priority-asc':
                    // Sadece Öncelikli <-> Standart yer değiştirir (Standart üstte), durum ve ID sıralaması aynı kalır
                    if (prioA !== prioB) return prioA ? 1 : -1;
                    if (statusA !== statusB) return statusA - statusB;
                    return idA - idB;
                case 'priority-desc':
                default:
                    // Önce Öncelikli, sonra durum (Ödendi => Hazırlanıyor => Kargolandı => Ödeme Bekliyor => Teslim Edildi), en son düşük ID üstte
                    if (prioA !== prioB) return prioA ? -1 : 1;
                    if (statusA !== statusB) return statusA - statusB;
                    return idA - idB;
            }
        });

        // --- Filtreleme: arama (çok sözcük, hepsi geçmeli) + durum + ödeme + üretim + tarih ---
        const istDay = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
        const nowMs = Date.now() + serverTimeOffset;
        const todayKey = istDay(nowMs);
        const terms = searchTerm.replace(/#/g, '').split(/\s+/).filter(Boolean);
        const info = (key, order) => {
            const ship = order.shippingInfo || {};
            const customerName = ship.fullname || [ship.name, ship.surname].filter(Boolean).join(' ').trim() || order.customerName || '-';
            const noteText = (orderNote(key) || {}).text || '';
            const itemNames = (Array.isArray(order.items) ? order.items : Object.values(order.items || {})).filter(Boolean).map(i => i.name || '').join(' ');
            const prio = isPriorityOrder(order);
            const text = `${key} ${customerName} ${ship.email || ''} ${ship.phone || ''} ${ship.city || ''} ${ship.district || ''} ${itemNames} ${order.userId || ''} ${order.status || ''} ${prio ? 'öncelikli hızlı express' : 'standart'} ${order.paymentMethod === 'iban' ? 'havale iban' : 'kart iyzico'} ${noteText}`.toLocaleLowerCase('tr');
            return { prio, customerName, noteText, rank: getStatusRank(order.status), pay: order.paymentMethod === 'iban' ? 'iban' : 'card', ts: getOrderTimestampMs(order), text };
        };
        const dateOk = (ts) => {
            if (!orderFilter.date) return true;
            if (!ts) return false;
            if (orderFilter.date === 'today') return istDay(ts) === todayKey;
            if (orderFilter.date === 'month') return istDay(ts).slice(0, 7) === todayKey.slice(0, 7);
            return ts >= nowMs - (orderFilter.date === '7d' ? 7 : 30) * 864e5;
        };
        const passes = (inf, skipStatus) =>
            terms.every(t => inf.text.includes(t)) &&
            (skipStatus || !orderFilter.status || inf.rank === Number(orderFilter.status)) &&
            (!orderFilter.pay || inf.pay === orderFilter.pay) &&
            (!orderFilter.prio || inf.prio === (orderFilter.prio === 'priority')) &&
            dateOk(inf.ts);

        const infos = new Map(sortedOrders.map(([key, order]) => [key, info(key, order)]));
        const rankCount = {};
        let allCount = 0;
        infos.forEach(inf => { if (passes(inf, true)) { allCount++; rankCount[inf.rank] = (rankCount[inf.rank] || 0) + 1; } });
        const chipDefs = [['', 'Tümü', allCount], ['4', 'Ödeme Bekliyor', rankCount[4]], ['1', 'Ödendi', rankCount[1]], ['2', 'Hazırlanıyor', rankCount[2]], ['3', 'Kargolandı', rankCount[3]], ['5', 'Teslim Edildi', rankCount[5]], ['6', 'İptal', rankCount[6]]];
        $('#order-status-chips').html(chipDefs.map(([r, label, n]) =>
            `<button type="button" class="order-chip${String(orderFilter.status) === r ? ' active' : ''}${!n && r ? ' empty' : ''}" data-rank="${r}">${label} <b>${n || 0}</b></button>`).join(''));
        $('#order-pay-filter').val(orderFilter.pay);
        $('#order-prio-filter').val(orderFilter.prio);
        $('#order-date-filter').val(orderFilter.date);
        $('#order-filter-clear').prop('hidden', !(searchTerm || orderFilter.status || orderFilter.pay || orderFilter.prio || orderFilter.date));

        const matched = sortedOrders.filter(([key]) => passes(infos.get(key)));
        const pageCount = Math.max(1, Math.ceil(matched.length / ORDERS_PER_PAGE));
        if (ordersPage > pageCount) ordersPage = pageCount;
        if (ordersPage < 1) ordersPage = 1;
        const pageStart = (ordersPage - 1) * ORDERS_PER_PAGE;
        const pageRows = matched.slice(pageStart, pageStart + ORDERS_PER_PAGE);
        $('#select-all-orders').prop('checked', false);

        const $pager = $('#orders-pager');
        if (!matched.length) {
            $pager.empty();
            $orderTable.append(`<tr><td colspan="7" class="orders-empty">${infos.size ? 'Bu filtreye uyan sipariş yok.' : 'Henüz sipariş yok.'}</td></tr>`);
        } else {
            $pager.html(`<span class="pager-info">${matched.length} sipariş${matched.length > ORDERS_PER_PAGE ? ` · ${pageStart + 1}–${pageStart + pageRows.length} gösteriliyor` : ''}</span>` +
                (pageCount > 1 ? `<div class="pager-btns">
                    <button type="button" class="btn secondary" data-orders-page="${ordersPage - 1}" ${ordersPage <= 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i> Önceki</button>
                    <span class="pager-now">${ordersPage} / ${pageCount}</span>
                    <button type="button" class="btn secondary" data-orders-page="${ordersPage + 1}" ${ordersPage >= pageCount ? 'disabled' : ''}>Sonraki <i class="fa-solid fa-chevron-right"></i></button>
                </div>` : ''));
        }

        pageRows.forEach(([key, order]) => {
            const { prio: isPriority, customerName, noteText } = infos.get(key);
            
            // Format Currency
            const total = formatTL(parseFloat(order.totalAmount) || 0);
            const userId = esc(order.userId || '');
            const safeKey = esc(key);
            const customerDisplay = `<span style="font-weight: 600; color: var(--text-main);">${esc(customerName)}</span>`;
            const productionBadge = isPriority
                ? `<span class="badge badge-priority" title="Öncelikli Üretim (2-3 iş günü)"><i class="fa-solid fa-bolt"></i> Öncelikli</span>`
                : `<span class="badge badge-muted">Standart</span>`;

            $orderTable.append(`
                <tr class="${isPriority ? 'priority-order-row' : ''}">
                    <td><input type="checkbox" class="order-checkbox" value="${safeKey}" data-userid="${userId}"></td>
                    <td><span style="font-family: monospace; font-weight: 700;">#${safeKey}</span>${orderMissing(order).length ? `<i class="fa-solid fa-phone order-missing-dot" title="Eksik bilgi: ${esc(orderMissing(order).join(', '))} (müşteriyi arayıp sorun)"></i>` : ''}${noteText ? `<i class="fa-solid fa-note-sticky order-note-dot" title="${esc(noteText.slice(0, 200))}"></i>` : ''}</td>
                    <td>${productionBadge}</td>
                    <td>${getStatusBadge(order.status)}${shipChip(order)}</td>
                    <td style="font-weight: 600;">${total}</td>
                    <td>${customerDisplay}</td>
                    <td style="overflow: visible;">
                        <div class="action-dropdown">
                            <button class="btn-sm secondary view-details-btn" data-id="${safeKey}">
                                <i class="fa-solid fa-eye"></i> Detay
                            </button>
                            <button class="btn-icon action-trigger" data-id="${safeKey}"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                            <div class="dropdown-menu">
                                ${shipKind(order) === 'todo' ? `<div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-ship="quick"><i class="fa-solid fa-bolt"></i> Hızlı Kargola</div>` : ''}
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="Ödeme Bekliyor" style="color: #EF4444;"><i class="fa-solid fa-circle-exclamation"></i> Ödeme Bekliyor</div>
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="Ödendi"><i class="fa-solid fa-money-bill"></i> Ödendi</div>
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="Hazırlanıyor"><i class="fa-solid fa-clock"></i> Hazırlanıyor</div>
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="Kargolandı"><i class="fa-solid fa-truck"></i> Kargolandı</div>
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="Teslim Edildi"><i class="fa-solid fa-check"></i> Teslim Edildi</div>
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="İptal" style="color: #EF4444;"><i class="fa-solid fa-ban"></i> İptal</div>
                            </div>
                        </div>
                    </td>
                </tr>
            `);
        });

        // Dropdown Trigger Listener
        $('.action-trigger').off('click').on('click', function(e) {
            e.stopPropagation();
            $('.dropdown-menu').not($(this).next('.dropdown-menu')).removeClass('show');
            $(this).next('.dropdown-menu').toggleClass('show');
        });

        // View Details Listener
        $('.view-details-btn').off('click').on('click', function(e) {
            e.stopPropagation();
            const orderId = $(this).data('id');
            const order = globalAdminData.orders[orderId];
            if (order) {
                openOrderDetailModal(order, orderId);
            }
        });

        // Status Change Listener
        $('.dropdown-item').off('click').on('click', async function(e) {
            e.stopPropagation();
            const orderId = $(this).data('id');
            const userId = $(this).data('userid');
            const newStatus = $(this).data('status');
            
            $('.dropdown-menu').removeClass('show');

            if ($(this).data('ship') === 'quick') {
                shipQuickRun([{ userId: String(userId), orderId: String(orderId) }]);
                return;
            }

            if(!orderId || !newStatus || !userId) {
                showToast("Hata: Kullanıcı veya sipariş bilgisi eksik.", "error");
                return;
            }
            
            // Kartla ödenmiş siparişi iptal ederken iade de otomatik yapılabilir
            if (newStatus === 'İptal') {
                const ord = globalAdminData && globalAdminData.orders && globalAdminData.orders[orderId];
                const left = ord && canCardRefund(ord) ? orderRefundInfo(ord).remaining : 0;
                if (left > 0) {
                    const doRefund = await askAdminConfirm({
                        eyebrow: 'KART İADESİ',
                        title: `Sipariş #${orderId} iptal edilirken ${formatTL(left)} karta iade edilsin mi?`,
                        desc: 'Evet derseniz sipariş iptal edilir, tutar müşterinin kartına iade edilir ve müşteriye e-posta gider. "Yalnızca iptal et" derseniz sadece durum değişir, iadeyi sonra sipariş detayından yapabilirsiniz.' + refundShipWarning(ord),
                        confirmText: 'Evet, İade Et', cancelText: 'Yalnızca iptal et', variant: 'danger', icon: 'fa-rotate-left', iconTone: 'rose'
                    });
                    if (doRefund) {
                        showToast('İade yapılıyor...', 'info');
                        try {
                            const d = await runCardRefund(userId, orderId, undefined, '');
                            showToast(`${formatTL(d.amount)} ${d.method === 'cancel' ? 'iptal edildi' : 'iade edildi'}, sipariş iptal edildi.`, 'success');
                            refreshDetailAfterRefund(String(orderId), d);
                        } catch (err) {
                            showToast('İade yapılamadı, sipariş iptal edilmedi: ' + (err.message || 'bilinmeyen hata'), 'error');
                        }
                        return;
                    }
                }
            }

            showToast(`Durum güncelleniyor: ${newStatus}...`, "info");

            try {
                // Update in User's path
                await update(ref(db, `users/${userId}/orders/${orderId}`), {
                    status: newStatus
                });
                showToast("Durum başarıyla güncellendi.", "success");
                auditLog('order_status', '#' + orderId, newStatus);

                if (globalAdminData && globalAdminData.orders && globalAdminData.orders[orderId]) {
                    globalAdminData.orders[orderId].status = newStatus;
                    renderOrders(globalAdminData.orders);
                    renderFinance();
                }
                await offerStatusMail([{ userId, orderId }], newStatus);
            } catch (error) {
                console.error("Status Update Error:", error);
                showToast("Hata: " + error.message, "error");
            }
        });

        renderShipping();
    }

    // --- MODAL LOGIC ---
    function formatOrderDateTime(order) {
        const raw = order.createdAt || order.serverTimestamp || order.paidAt || order.timestamp || order.date;
        if (!raw) return 'Bilinmiyor';
        const d = (typeof raw === 'object' && raw._seconds)
            ? new Date(raw._seconds * 1000)
            : new Date(raw);
        if (isNaN(d.getTime())) return String(raw);
        const datePart = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
        const timePart = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        return `${datePart} · ${timePart}`;
    }

    function openOrderDetailModal(order, fallbackId = '') {
        // Populate Info
        const statusText = String(order.status || 'Bilinmiyor');
        const displayId = order.id || fallbackId || '';
        $('#modal-order-id').text(displayId ? '#' + String(displayId).replace(/^#/, '') : '');
        $('#modal-order-status').text(statusText).attr('class', 'badge').addClass(
            statusText === 'paid' || statusText.includes('Ödendi') || statusText.includes('Tamam') ? 'badge-success' : 'badge-warning'
        );

        // Date & Time
        const dateTimeStr = formatOrderDateTime(order);
        $('#modal-order-date').text(dateTimeStr);
        $('#modal-order-datetime').text(dateTimeStr);

        // Customer
        const ship = order.shippingInfo || {};
        const fullName = ship.fullname || [ship.name, ship.surname].filter(Boolean).join(' ').trim() || order.customerName || '-';
        $('#modal-customer-name').text(fullName);
        $('#modal-customer-email').text(ship.email || '-');
        $('#modal-customer-phone').text(ship.phone || '-');
        $('#modal-customer-id').text(order.userId || '-');

        // Shipping
        $('#modal-shipping-address').text(
            [ship.address || ship.details, ship.district, ship.city, ship.zip].filter(Boolean).join(' ')
        );
        $('#modal-shipping-method').text(/öncelikli|express|hızlı|priority/i.test(String(order.shippingMethod || '')) ? 'Öncelikli üretim' : 'Standart üretim');
        $('#modal-payment-method').text(order.paymentMethod || 'Kredi Kartı');

        // Items
        const $tbody = $('#modal-items-body');
        $tbody.empty();
        
        if (order.items) {
            const itemsArray = Array.isArray(order.items) ? order.items : Object.values(order.items);
            itemsArray.filter(Boolean).forEach(item => {
                let img = item.image || item.photo || item.imageUrl || '../content/images/engrare_logo_elegant.png';
                if (typeof img === 'object' && img !== null) img = img.src || '../content/images/engrare_logo_elegant.png';
                if (typeof img === 'string' && img.startsWith('./')) {
                    img = '.' + img; // converts ./content/ to ../content/
                }
                img = safeUrl(img) || '../content/images/engrare_logo_elegant.png';

                // Retroactive fix for old orders
                let textToShow = item.customText || '';
                if (!textToShow && typeof item.desc === 'string' && item.desc.includes('Yazı:')) {
                    textToShow = item.desc.replace('Yazı:', '').trim();
                }

                const fontToShow = item.font || 'Inter';
                const textColorToShow = safeColor(item.textColor, '#ffffff'); // Default white
                const objColorToShow = safeColor(item.objColor, '#333333'); // Default black

                let detailsHtml = '';
                const eksik = itemMissing({ ...item, customText: textToShow });
                if (eksik.length) detailsHtml += `<span class="missing-info"><i class="fa-solid fa-phone"></i> Eksik bilgi (${esc(eksik.join(', '))}): müşteriyi arayıp sorun</span><br>`;
                if (textToShow) detailsHtml += `<span style="font-size: 0.8rem; color: var(--text-main);">Yazı: <strong>${esc(textToShow)}</strong></span><br>`;
                detailsHtml += `<span style="font-size: 0.75rem; color: var(--text-light);">Font: <strong>${esc(fontToShow)}</strong></span><br>`;
                if (item.selectedObject) detailsHtml += `<span style="font-size: 0.75rem; color: var(--text-light);">Seçenek: <strong>${esc(item.selectedObject)}</strong></span><br>`;
                [1, 2].forEach(i => {
                    if (item[`socialPlatform${i}`]) {
                        detailsHtml += `<span style="font-size: 0.75rem; color: var(--text-light);">${i}. Sosyal: <strong>${esc(item[`socialPlatform${i}`])}</strong> ${esc(item[`socialLink${i}`] || '')}</span><br>`;
                    }
                });
                const logoUrl = safeUrl(item.logoUrl);
                if (logoUrl && logoUrl.startsWith('https://')) {
                    detailsHtml += `<span style="font-size: 0.75rem;"><a href="${logoUrl}" target="_blank" rel="noopener noreferrer">Müşteri logosunu aç</a>${/%2F[^?]*\.jpe?g(\?|$)/i.test(logoUrl) ? ' <strong style="color:#B45309;">(JPEG: dış kısımlar kesilecek)</strong>' : ''}</span><br>`;
                } else if (logoUrl.startsWith('./content/') || logoUrl.startsWith('data:image/svg+xml;')) {
                    // Hazır logo (Engrare, kalp, yıldız): ikonun kendisi gösterilir; site yolu admin/ klasörüne göre çözülür.
                    // Varsayılan logo content/images/ altına taşınmadan önceki siparişler eski yolu taşır.
                    const presetLogo = logoUrl === './content/engrare_logo_elegant.svg' ? './content/images/engrare_logo_elegant.svg' : logoUrl;
                    const logoSrc = presetLogo.startsWith('./') ? '.' + presetLogo : presetLogo;
                    detailsHtml += `<span style="font-size: 0.75rem; color: var(--text-light); display: inline-flex; align-items: center; gap: 6px;">Logo: <img src="${logoSrc}" alt="Hazır logo" style="width: 18px; height: 18px; object-fit: contain;"></span><br>`;
                }
                
                let colorsHtml = `<div style="display:flex; gap: 10px; margin-top: 4px;">
                    <div style="display:flex; align-items:center; gap: 4px; font-size: 0.7rem; color: var(--text-light);"><div style="width:14px; height:14px; border-radius:50%; background:${textColorToShow}; border:1px solid #ccc;" title="Yazı Rengi"></div>Yazı</div>
                    <div style="display:flex; align-items:center; gap: 4px; font-size: 0.7rem; color: var(--text-light);"><div style="width:14px; height:14px; border-radius:50%; background:${objColorToShow}; border:1px solid #ccc;" title="Obje Rengi"></div>Obje</div>
                </div>`;

                $tbody.append(`
                    <tr>
                        <td style="display: flex; align-items: center; gap: 15px;">
                            <img src="${img}" style="width: 60px; height: 60px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border);">
                            <div>
                                <strong style="font-size: 0.95rem;">${esc(item.name || 'Ürün')}</strong>
                                <br>
                                ${detailsHtml}
                                ${colorsHtml}
                            </div>
                        </td>
                        <td>${formatTL(parseFloat(item.price) || 0)}</td>
                        <td>${esc(item.quantity || 1)}</td>
                        <td style="font-weight: 600;">${formatTL((parseFloat(item.price) || 0) * (Number(item.quantity) || 1))}</td>
                    </tr>
                `);
            });
        }

        // Totals
        $('#modal-subtotal').text(formatTL(parseFloat(order.subtotal || 0)));
        $('#modal-shipping-cost').text(formatTL(parseFloat(order.shippingCost || 0)));
        $('#modal-discount').text('-' + formatTL(parseFloat(order.discountAmount || 0)));
        $('#modal-total').text(formatTL(parseFloat(order.totalAmount || 0)));

        fillOrderExtras(order, String(displayId || fallbackId).replace(/^#/, ''));

        // Open
        $('#order-detail-modal').addClass('open');
    }

    /* --- Sipariş detayı: iç not ve kartlı ödeme iadesi --- */
    let detailCtx = { userId: '', orderId: '' };
    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const orderNote = (id) => (globalAdminData && globalAdminData.order_notes && globalAdminData.order_notes[id]) || null;
    function orderRefundInfo(order) {
        const paid = round2(order.totalAmount);
        // refundedAmount sunucunun yazdığı toplamdır; canlı veri gelmeden önce yerel güncelleme de bunu kullanır
        const refunded = Math.max(round2(Object.values(order.refunds || {}).reduce((sum, r) => sum + (r && r.status === 'success' ? Number(r.amount) || 0 : 0), 0)), round2(order.refundedAmount));
        return { paid, refunded, remaining: round2(paid - refunded) };
    }
    const canCardRefund = (order) => !!order && order.paymentMethod === 'iyzico' && !!order.iyzicoPaymentId && order.status !== 'pending_payment';

    function fillOrderExtras(order, orderId) {
        detailCtx = { userId: order.userId || '', orderId };
        fillEditBox(order);
        const note = orderNote(orderId);
        $('#modal-order-note').val(note ? note.text : '');
        $('#modal-order-note-meta').text(note && note.at ? `${new Date(note.at).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}${note.by ? ' · ' + note.by : ''}` : '');

        const $box = $('#modal-refund-box');
        if (!canCardRefund(order)) { $box.prop('hidden', true); return; }
        const inf = orderRefundInfo(order);
        $('#modal-refund-info').html(`Kartla ödenen: <strong>${formatTL(inf.paid)}</strong> · İade edilen: <strong>${formatTL(inf.refunded)}</strong> · Kalan: <strong>${formatTL(inf.remaining)}</strong>`);
        const rows = Object.values(order.refunds || {}).filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0)).map((r) => {
            const when = r.at ? new Date(r.at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '';
            const how = r.method === 'cancel' ? 'iptal' : 'iade';
            if (r.status === 'success') return `<li><span>${esc(formatTL(r.amount))} ${how}${r.reason ? ' · ' + esc(r.reason) : ''}</span><span>${esc(when)}</span></li>`;
            if (r.status === 'unknown') return `<li class="bad"><span>${esc(formatTL(r.amount))} · yanıt alınamadı, iyzico panelinden kontrol edin</span><span>${esc(when)}</span></li>`;
            return `<li class="bad"><span>${esc(formatTL(r.amount))} reddedildi${r.error ? ': ' + esc(r.error) : ''}</span><span>${esc(when)}</span></li>`;
        });
        $('#modal-refund-history').html(rows.join(''));
        $('#modal-refund-actions').toggle(inf.remaining > 0);
        $('#modal-refund-amount').val('');
        $box.prop('hidden', false);
    }

    /* --- Sipariş düzeltme (updateOrderDetails): yazı, QR bağlantısı, adres, telefon; fiyat/ürün/renk/adet değişmez --- */
    const EDIT_LOCKED = (o) => ['İptal', 'Teslim Edildi', 'pending_payment', 'incomplete_attempt'].includes(o.status);
    function fillEditBox(order) {
        $('#modal-edit-form').prop('hidden', true);
        $('#btn-edit-open').show().prop('disabled', EDIT_LOCKED(order)).attr('title', EDIT_LOCKED(order) ? 'Bu durumdaki sipariş düzeltilemez' : '');
        const edits = Object.values(order.edits || {}).filter(Boolean).sort((a, b) => (b.at || 0) - (a.at || 0));
        $('#modal-edit-history').html(edits.map((e) => `<div><strong>${esc(e.at ? new Date(e.at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '')}${e.by ? ' · ' + esc(e.by) : ''}</strong><br>${(e.changes || []).map(esc).join('<br>')}</div>`).join(''));
    }
    $('#btn-edit-open').on('click', function() {
        const o = globalAdminData && globalAdminData.orders && globalAdminData.orders[detailCtx.orderId];
        if (!o) return;
        const s = o.shippingInfo || {};
        $('#edit-fullname').val(s.fullname || [s.name, s.surname].filter(Boolean).join(' '));
        $('#edit-phone').val(s.phone || '');
        $('#edit-address').val(s.address || '');
        $('#edit-district').val(s.district || '');
        $('#edit-city').val(s.city || '');
        $('#edit-notify').prop('checked', false);
        const locked = o.shipment && o.shipment.state === 'barcode';
        $('#modal-edit-form').find('.order-edit-grid input').prop('disabled', !!locked);
        $('#modal-edit-hint').text(locked ? 'Kargo barkodu var: teslimat bilgisi için önce kargoyu iptal edin.' : '');
        $('#modal-edit-items').html(Object.entries(o.items || {}).filter(([, it]) => it).map(([key, it]) => {
            const qr = [1, 2].filter((i) => it[`socialPlatform${i}`]).map((i) =>
                `<input type="text" class="input-box" data-field="socialLink${i}" maxlength="200" value="${esc(it[`socialLink${i}`] || '')}" placeholder="${i}. QR bağlantısı (${esc(it[`socialPlatform${i}`])})" aria-label="${i}. QR bağlantısı">`).join('');
            return `<div class="order-edit-item" data-key="${esc(key)}"><strong>${esc(it.name || 'Ürün')}</strong>
                <input type="text" class="input-box" data-field="customText" maxlength="100" value="${esc(it.customText || '')}" placeholder="Üründeki yazı" aria-label="Üründeki yazı">${qr}</div>`;
        }).join(''));
        $('#modal-edit-form').prop('hidden', false);
        $(this).hide();
    });
    $('#btn-edit-cancel').on('click', function() {
        $('#modal-edit-form').prop('hidden', true);
        $('#btn-edit-open').show();
    });
    $('#btn-edit-save').on('click', async function() {
        const { userId, orderId } = detailCtx;
        const o = globalAdminData && globalAdminData.orders && globalAdminData.orders[orderId];
        if (!o || !userId) return;
        const shippingChanged = !$('#modal-edit-form .order-edit-grid input:first').prop('disabled');
        const payload = { userId: String(userId), orderId: String(orderId), notifyCustomer: $('#edit-notify').is(':checked') };
        if (shippingChanged) payload.shipping = { fullname: $('#edit-fullname').val(), phone: $('#edit-phone').val(), address: $('#edit-address').val(), district: $('#edit-district').val(), city: $('#edit-city').val(), zip: (o.shippingInfo || {}).zip || '' };
        payload.items = $('#modal-edit-items .order-edit-item').map(function() {
            const e = { key: $(this).data('key') };
            $(this).find('[data-field]').each(function() { e[$(this).data('field')] = $(this).val(); });
            return e;
        }).get();
        const ok = await askAdminConfirm({
            eyebrow: 'SİPARİŞ DÜZELTME',
            title: `Sipariş #${orderId} bilgileri düzeltilsin mi?`,
            desc: 'Yazı, QR bağlantısı, adres ve telefon değişir; fiyat, ürün, renk ve adet değişmez. Müşterinin sipariş sırasında onayladığı sözleşme PDF\'indeki bilgiler eski haliyle kalır. Her değişiklik siparişe işlenir.' + (payload.notifyCustomer ? ' Müşteriye bilgilendirme e-postası gönderilir.' : ' Müşteriye e-posta gönderilmez.') + (['Hazırlanıyor', 'Kargolandı'].includes(o.status) ? ' Dikkat: sipariş hazırlanıyor ya da kargoda; basılmış ürün bu düzeltmeden etkilenmez.' : ''),
            confirmText: 'Evet, Düzelt', cancelText: 'Vazgeç', icon: 'fa-pen-to-square', iconTone: 'amber'
        });
        if (!ok) return;
        const $btn = $(this), html = $btn.html();
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...');
        try {
            const res = (await httpsCallable(functions, 'updateOrderDetails')(payload)).data || {};
            if (!res.changed) { showToast('Değişen bir bilgi yok.', 'info'); return; }
            auditLog('order_edit', '#' + orderId, `${res.changed} değişiklik${res.mailed ? ', müşteriye e-posta gitti' : ''}`);
            showToast(`${res.changed} değişiklik kaydedildi${res.mailed ? ', müşteriye e-posta gitti' : ''}.`, 'success');
            // Canlı veri gelene kadar yerel kopyayı da güncelle
            if (payload.shipping) Object.assign(o.shippingInfo = o.shippingInfo || {}, payload.shipping);
            payload.items.forEach((e) => { const it = (o.items || {})[e.key]; if (it) ['customText', 'socialLink1', 'socialLink2'].forEach((f) => { if (e[f] !== undefined) it[f] = e[f]; }); });
            renderOrders(globalAdminData.orders);
            if ($('#order-detail-modal').hasClass('open')) openOrderDetailModal(o, orderId);
        } catch (err) {
            showToast('Düzeltilemedi: ' + (err.message || 'bilinmeyen hata'), 'error');
        } finally { $btn.prop('disabled', false).html(html); }
    });

    // Sunucu iade fonksiyonunu çağırır (tam: amount yok). Başarıda sipariş detayını tazeler.
    async function runCardRefund(userId, orderId, amount, reasonText) {
        const res = await httpsCallable(functions, 'refundIyzicoPayment')({ userId: String(userId), orderId: String(orderId), amount, reason: reasonText || '' });
        const d = res.data || {};
        auditLog('order_refund', '#' + orderId, `${formatTL(d.amount)} ${d.method === 'cancel' ? 'iptal' : 'iade'}${d.full ? ' (tam, sipariş iptal edildi)' : ' (kısmi)'}`);
        return d;
    }
    function refreshDetailAfterRefund(orderId, d) {
        const o = globalAdminData && globalAdminData.orders && globalAdminData.orders[orderId];
        if (o) {
            o.refundedAmount = d.refundedAmount;
            if (d.full) o.status = 'İptal';
            renderOrders(globalAdminData.orders);
            renderFinance();
            if ($('#order-detail-modal').hasClass('open')) openOrderDetailModal(o, orderId);
        }
    }
    function refundShipWarning(order) {
        const sh = order && order.shipment;
        if (sh && sh.state === 'barcode') return ' Bu siparişin kargo barkodu var: kargo henüz yola çıkmadıysa önce barkodu iptal edin.';
        if (order && /kargo/i.test(String(order.status || ''))) return ' Sipariş kargolanmış görünüyor.';
        return '';
    }

    $('#btn-refund-full, #btn-refund-partial').on('click', async function() {
        const partial = this.id === 'btn-refund-partial';
        const order = globalAdminData && globalAdminData.orders && globalAdminData.orders[detailCtx.orderId];
        if (!order || !canCardRefund(order)) return;
        const inf = orderRefundInfo(order);
        let amount = null;
        if (partial) {
            amount = Number(String($('#modal-refund-amount').val() || '').replace(/\./g, '').replace(',', '.'));
            if (!(amount > 0) || amount > inf.remaining + 0.001) { showToast(`İade tutarı 0'dan büyük ve en fazla ${formatTL(inf.remaining)} olmalı.`, 'error'); return; }
            if (Math.abs(amount - inf.remaining) < 0.005) amount = null; // kalanın tamamı = tam iade
        }
        const isFull = amount === null;
        const ok = await askAdminConfirm({
            eyebrow: 'KART İADESİ',
            title: isFull ? `Sipariş #${detailCtx.orderId} iptal edilip ${formatTL(inf.remaining)} iade edilsin mi?` : `${formatTL(amount)} kısmi iade yapılsın mı?`,
            desc: (isFull ? 'Sipariş "İptal" olur, tutar müşterinin kartına iade edilir ve müşteriye e-posta gider.' : 'Sipariş durumu değişmez; tutar müşterinin kartına iade edilir ve müşteriye e-posta gider.')
                + ' Bu işlem geri alınamaz.' + refundShipWarning(order),
            confirmText: isFull ? 'Evet, İptal Et ve İade Et' : 'Evet, İade Et', cancelText: 'Vazgeç', variant: 'danger', icon: 'fa-rotate-left', iconTone: 'rose'
        });
        if (!ok) return;
        const $btns = $('#btn-refund-full, #btn-refund-partial').prop('disabled', true);
        try {
            const d = await runCardRefund(detailCtx.userId, detailCtx.orderId, amount === null ? undefined : amount, '');
            showToast(`${formatTL(d.amount)} ${d.method === 'cancel' ? 'iptal edildi' : 'iade edildi'}.`, 'success');
            refreshDetailAfterRefund(detailCtx.orderId, d);
        } catch (err) {
            showToast('İade yapılamadı: ' + (err.message || 'bilinmeyen hata'), 'error');
        } finally { $btns.prop('disabled', false); }
    });

    /* --- Excel dışa aktarma: panel tüm siparişleri zaten bellekte tuttuğu için tarayıcıda üretilir (sunucu gidiş-dönüşü yok) --- */
    const EXPORT_STATUS = { paid: 'Ödendi', pending_payment: 'Ödeme Bekliyor', payment_review: 'Ödeme İnceleniyor (iyzico)' };
    $('#btn-export-xlsx').on('click', async function() {
        const orders = (globalAdminData && globalAdminData.orders) || {};
        const keys = Object.keys(orders);
        if (!keys.length) { showToast('Dışa aktarılacak sipariş yok.', 'error'); return; }
        const $btn = $(this).prop('disabled', true);
        try {
            const { buildXlsx } = await import('./xlsx-lite.js?v=1');
            keys.sort((a, b) => (parseInt(b.replace(/\D/g, ''), 10) || 0) - (parseInt(a.replace(/\D/g, ''), 10) || 0));
            const money = (v) => ({ v: round2(v), t: 'money' });
            const dateCell = (o) => { const ms = getOrderTimestampMs(o); return ms ? { v: ms, t: 'date' } : ''; };
            const itemsOf = (o) => (Array.isArray(o.items) ? o.items : Object.values(o.items || {})).filter(Boolean);
            const orderRows = [['Sipariş No', 'Tarih', 'Durum', 'Ödeme', 'Üretim', 'Ara Toplam', 'İndirim Kodu', 'İndirim', 'Öncelik Ücreti', 'Toplam', 'İade Edilen',
                'Müşteri', 'E-posta', 'Telefon', 'İl', 'İlçe', 'Adres', 'Posta Kodu', 'Misafir', 'Kargo Firması', 'Takip No', 'Ürünler', 'İç Not', 'Kullanıcı ID']];
            const itemRows = [['Sipariş No', 'Tarih', 'Durum', 'Ürün', 'Adet', 'Birim Fiyat', 'Tutar', 'Yazı', 'Yazı Tipi', 'Seçenek', 'Yazı Rengi', 'Obje Rengi', 'Sosyal 1', 'Sosyal 2', 'Logo']];
            keys.forEach((k) => {
                const o = orders[k] || {};
                const ship = o.shippingInfo || {};
                const sh = o.shipment || {};
                const status = EXPORT_STATUS[o.status] || String(o.status || '');
                const name = ship.fullname || [ship.name, ship.surname].filter(Boolean).join(' ').trim() || o.customerName || '';
                const items = itemsOf(o);
                orderRows.push([k, dateCell(o), status, o.paymentMethod === 'iban' ? 'Havale/EFT' : o.paymentMethod === 'iyzico' ? 'Kart (iyzico)' : String(o.paymentMethod || ''),
                    /öncelikli|express|hızlı|priority/i.test(String(o.shippingMethod || '')) ? 'Öncelikli' : 'Standart',
                    money(o.subtotal), o.discountCode || '', money(o.discountAmount), money(o.shippingCost), money(o.totalAmount), money(o.refundedAmount),
                    name, ship.email || '', ship.phone || '', ship.city || '', ship.district || '', ship.address || ship.details || '', ship.zip || '',
                    o.isGuest ? 'Evet' : 'Hayır', sh.handlerName || '', o.trackingNumber || '',
                    items.map((i) => `${i.name || 'Ürün'} x${i.quantity || 1}`).join('; '), (orderNote(k) || {}).text || '', o.userId || '']);
                items.forEach((i) => {
                    const qty = Number(i.quantity) || 1;
                    const logo = safeUrl(i.logoUrl);
                    itemRows.push([k, dateCell(o), status, i.name || 'Ürün', qty, money(i.price), money((parseFloat(i.price) || 0) * qty), i.customText || '', i.font || '', i.selectedObject || '',
                        i.textColor || '', i.objColor || '',
                        i.socialPlatform1 ? `${i.socialPlatform1} ${i.socialLink1 || ''}`.trim() : '', i.socialPlatform2 ? `${i.socialPlatform2} ${i.socialLink2 || ''}`.trim() : '',
                        logo && logo.startsWith('https://') ? logo : '']);
                });
            });
            const expRows = [['Tarih', 'Açıklama', 'Kategori', 'Tutar']];
            Object.values((globalAdminData.finance && globalAdminData.finance.expenses) || {}).filter((e) => e && typeof e === 'object')
                .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
                .forEach((e) => expRows.push([String(e.date || ''), e.title || '', e.category || '', money(e.amount)]));
            const blob = await buildXlsx([
                { name: 'Siparişler', widths: [11, 17, 22, 14, 11, 12, 14, 10, 12, 12, 12, 24, 28, 15, 14, 14, 44, 10, 8, 16, 18, 50, 40, 30], rows: orderRows },
                { name: 'Sipariş Kalemleri', widths: [11, 17, 22, 28, 7, 12, 12, 24, 16, 18, 11, 11, 28, 28, 40], rows: itemRows },
                { name: 'Giderler', widths: [12, 36, 22, 12], rows: expRows }
            ]);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `engrare-siparisler-${new Date().toLocaleDateString('sv-SE')}.xlsx`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
            auditLog('export', 'Excel', `${keys.length} sipariş, ${itemRows.length - 1} kalem, ${expRows.length - 1} gider`);
            showToast(`${keys.length} sipariş Excel dosyasına aktarıldı.`, 'success');
        } catch (err) {
            console.error('Excel hatası:', err);
            showToast('Excel oluşturulamadı: ' + err.message, 'error');
        } finally { $btn.prop('disabled', false); }
    });

    $('#btn-save-note').on('click', async function() {
        const id = detailCtx.orderId;
        if (!id || !auth.currentUser) return;
        const text = String($('#modal-order-note').val() || '').trim().slice(0, 1000);
        const $btn = $(this).prop('disabled', true);
        try {
            if (text) await set(ref(db, `admin/order_notes/${id}`), { text, at: Date.now(), by: String(auth.currentUser.email || '').slice(0, 100) });
            else await remove(ref(db, `admin/order_notes/${id}`));
            auditLog('order_note', '#' + id, text ? text.slice(0, 200) : 'Not silindi');
            showToast(text ? 'Not kaydedildi.' : 'Not silindi.', 'success');
            setTimeout(() => { if (globalAdminData && globalAdminData.orders) renderOrders(globalAdminData.orders); }, 300);
        } catch (err) { showToast('Not kaydedilemedi: ' + err.message, 'error'); }
        finally { $btn.prop('disabled', false); }
    });

    /* --- KARGO (Basit Kargo) ---
       Kargo sekmesi (kargolanacaklar / yoldakiler / tamamlananlar / ayarlar) ve sipariş detayındaki kargo bölümü.
       Veri siparişin altındaki `shipment` düğümünden gelir (RTDB canlı dinleniyor); durum ve takip kodunu sunucu
       (kargoSync, 15 dk) kendiliğinden günceller. Sunucu işlemleri: kargoQuote/Create/Quick/Refresh/Label(s)/Cancel/Return. */
    // Sipariş kargo aşaması: todo (kargolanacak) | transit (barkodlu, yolda) | done (teslim/iade/kayıp) | '' (kargo konusu değil)
    function shipKind(order) {
        const sh = order.shipment || {};
        if (sh.state === 'barcode') {
            return (['DELIVERED', 'RETURNED', 'LOST'].includes(sh.status) || order.status === 'Teslim Edildi') ? 'done' : 'transit';
        }
        return ['Ödendi', 'Hazırlanıyor', 'paid'].includes(order.status) ? 'todo' : '';
    }

    // Sunucudaki bkAutoPackage ile aynı mantık: ürün başına ölçü ayarlardan, çoklu ürün/adet üst üste
    function shipAutoPackage(order) {
        const items = (Array.isArray(order.items) ? order.items : Object.values(order.items || {})).filter(Boolean);
        if (!items.length) return { ...SHIP_DEFAULT_PKG };
        const sum = { width: 0, depth: 0, height: 0, weight: 0 };
        items.forEach((i) => {
            const p = shipSettings.packages[String(i.productId)] || SHIP_DEFAULT_PKG;
            const q = Math.max(1, Math.min(99, Number(i.quantity) || 1));
            sum.width = Math.max(sum.width, p.width); sum.depth = Math.max(sum.depth, p.depth);
            sum.height += p.height * q; sum.weight += p.weight * q;
        });
        return { width: sum.width, depth: sum.depth, height: Math.min(150, sum.height), weight: Math.min(30, Math.round(sum.weight * 100) / 100) };
    }

    // Sipariş listesinde durumun altında küçük kargo özeti (firma · takip kodu)
    function shipChip(order) {
        const sh = order.shipment || {};
        if (sh.state !== 'barcode') return '';
        const label = (BK_STATUS[sh.status] || [sh.status || ''])[0];
        return `<div class="ship-chip" title="${esc(label)}"><i class="fa-solid fa-truck-fast"></i> ${esc(sh.handlerName || 'Kargo')}${sh.handlerShipmentCode ? ' · ' + esc(sh.handlerShipmentCode) : ' · ' + esc(label)}</div>`;
    }

    function shipTimeAgo(ts) {
        const n = Number(ts);
        if (!n) return '';
        const m = Math.max(0, Math.round((Date.now() - n) / 60000));
        if (m < 1) return 'az önce';
        if (m < 60) return `${m} dk önce`;
        if (m < 1440) return `${Math.round(m / 60)} sa önce`;
        return `${Math.round(m / 1440)} gün önce`;
    }

    function shipBadge(sh) {
        const [label, cls] = BK_STATUS[sh.status] || [sh.status || 'Bilinmiyor', 'badge-muted'];
        return `<span class="badge ${cls}">${esc(label)}</span>`;
    }

    function shipTrackHtml(sh) {
        if (!sh.handlerShipmentCode) return '<span class="ship-muted">Takip kodu bekleniyor</span>';
        const code = esc(sh.handlerShipmentCode);
        return (typeof sh.trackingLink === 'string' && sh.trackingLink.startsWith('https://') && safeUrl(sh.trackingLink))
            ? `<a href="${esc(sh.trackingLink)}" target="_blank" rel="noopener noreferrer">${code}</a>` : `<span class="ship-code">${code}</span>`;
    }

    function shipItemsText(order) {
        const items = (Array.isArray(order.items) ? order.items : Object.values(order.items || {})).filter(Boolean);
        return items.map(i => `${Number(i.quantity) || 1}× ${i.name || 'Ürün'}`).join(', ');
    }

    function shipOrderLink(order, key) {
        const ship = order.shippingInfo || {};
        return {
            name: ship.fullname || [ship.name, ship.surname].filter(Boolean).join(' ').trim() || order.customerName || '-',
            place: [ship.district, ship.city].filter(Boolean).join(' / '),
            id: esc(key), uid: esc(order.userId || '')
        };
    }

    function shipCardHtml(kind, key, order) {
        const sh = order.shipment || {};
        const o = shipOrderLink(order, key);
        const prio = /öncelikli|express|hızlı|priority/i.test(String(order.shippingMethod || ''));
        const head = `<div class="ship-card-top"><strong>#${o.id}</strong>${prio ? '<span class="badge badge-priority"><i class="fa-solid fa-bolt"></i> Öncelikli</span>' : ''}
            <span class="ship-card-amount">${kargoMoney(order.totalAmount)}</span></div>
            <div class="ship-card-name">${esc(o.name)}</div>
            <div class="ship-card-sub"><i class="fa-solid fa-location-dot"></i> ${esc(o.place || 'Adres eksik')}</div>`;
        const attrs = `data-id="${o.id}" data-uid="${o.uid}"`;
        if (kind === 'todo') {
            return `<div class="ship-card" ${attrs}>
                <label class="ship-card-check"><input type="checkbox" class="ship-select" data-kind="todo" ${attrs}${shipSel.todo.has(key) ? ' checked' : ''}></label>
                <div class="ship-card-main">${head}<div class="ship-card-items">${esc(shipItemsText(order))}</div></div>
                <div class="ship-card-actions">
                    <button type="button" class="btn primary ship-act" data-act="quick" ${attrs}><i class="fa-solid fa-bolt"></i> Hızlı Kargola</button>
                    <button type="button" class="btn secondary ship-act" data-act="detail" ${attrs}><i class="fa-solid fa-sliders"></i> Seçenekler</button>
                </div></div>`;
        }
        const info = `<div class="ship-card-track"><i class="fa-solid fa-truck-fast"></i> <strong>${esc(sh.handlerName || sh.handlerCode || '-')}</strong> · ${shipTrackHtml(sh)}</div>
            ${sh.lastState ? `<div class="ship-card-items">${esc(sh.lastState)}</div>` : ''}
            <div class="ship-card-items ship-muted">Güncelleme: ${esc(shipTimeAgo(sh.updatedAt) || '-')}</div>`;
        const check = kind === 'transit' ? `<label class="ship-card-check"><input type="checkbox" class="ship-select" data-kind="transit" ${attrs}${shipSel.transit.has(key) ? ' checked' : ''}></label>` : '';
        const ret = (kind === 'done' && sh.status === 'DELIVERED' && !sh.returnCode)
            ? `<button type="button" class="btn secondary ship-act" data-act="return" ${attrs}><i class="fa-solid fa-rotate-left"></i> İade Barkodu</button>` : '';
        const retInfo = sh.returnCode ? `<div class="ship-card-items">İade kodu: <span class="ship-code">${esc(sh.returnCode)}</span></div>` : '';
        return `<div class="ship-card" ${attrs}>${check}
            <div class="ship-card-main">${head}<div class="ship-card-state">${shipBadge(sh)}</div>${info}${retInfo}</div>
            <div class="ship-card-actions">
                <button type="button" class="btn primary ship-act" data-act="label" ${attrs}><i class="fa-solid fa-print"></i> Etiket</button>
                ${kind === 'transit' ? `<button type="button" class="btn secondary ship-act" data-act="refresh" ${attrs}><i class="fa-solid fa-rotate"></i> Yenile</button>` : ''}
                ${ret}
                <button type="button" class="btn secondary ship-act" data-act="detail" ${attrs}><i class="fa-solid fa-eye"></i> Detay</button>
            </div></div>`;
    }

    function renderShipping() {
        const orders = (globalAdminData && globalAdminData.orders) || {};
        const lists = { todo: [], transit: [], done: [] };
        Object.entries(orders).forEach(([key, order]) => {
            if (!order || typeof order !== 'object') return;
            const kind = shipKind(order);
            if (kind) lists[kind].push([key, order]);
        });
        const idNum = (k) => parseInt(String(k).replace(/\D/g, ''), 10) || 0;
        const prio = (o) => /öncelikli|express|hızlı|priority/i.test(String(o.shippingMethod || '')) ? 1 : 0;
        lists.todo.sort((a, b) => (prio(b[1]) - prio(a[1])) || (idNum(a[0]) - idNum(b[0])));
        lists.transit.sort((a, b) => idNum(a[0]) - idNum(b[0]));
        lists.done.sort((a, b) => idNum(b[0]) - idNum(a[0]));
        lists.done = lists.done.slice(0, 30);

        // Artık listede olmayan siparişler seçimden düşer
        ['todo', 'transit'].forEach((k) => {
            const keys = new Set(lists[k].map(([key]) => key));
            [...shipSel[k]].forEach((key) => { if (!keys.has(key)) shipSel[k].delete(key); });
        });

        const empty = {
            todo: 'Kargolanacak sipariş yok. Ödemesi alınan siparişler burada görünür.',
            transit: 'Yolda gönderi yok.', done: 'Henüz tamamlanan gönderi yok.'
        };
        ['todo', 'transit', 'done'].forEach((k) => {
            $(`#ship-list-${k}`).html(lists[k].length ? lists[k].map(([key, o]) => shipCardHtml(k, key, o)).join('') : `<div class="ship-empty">${empty[k]}</div>`);
            $(`#ship-count-${k}`).text(lists[k].length);
        });
        $('#ship-nav-badge').text(lists.todo.length).prop('hidden', !lists.todo.length);
        $('#orders-nav-badge').text(lists.todo.length).prop('hidden', !lists.todo.length);
        $('.seg-count').text(lists.todo.length).prop('hidden', !lists.todo.length);
        updateShipToolbars(lists);
        // Açık sipariş detayında kargo durumu (sunucu/senkron) değiştiyse yenile; yazılan ölçüler gereksiz silinmesin
        const openOrder = kargoOrder();
        if (!shipBusy && openOrder && $('#kargo-modal').hasClass('open') && kargoCtx.sig !== (JSON.stringify(openOrder.shipment || null) + '|' + (openOrder.status || ''))) renderKargo();
    }

    function updateShipToolbars(lists) {
        const todo = shipSel.todo.size, transit = shipSel.transit.size;
        $('#ship-todo-go').prop('disabled', !todo || shipBusy).html(`<i class="fa-solid fa-bolt"></i> Seçilenleri Kargola (${todo})`);
        $('#ship-transit-labels').prop('disabled', !transit || shipBusy).html(`<i class="fa-solid fa-print"></i> Etiket Yazdır (${transit})`);
        if (lists) {
            $('#ship-todo-all').prop('checked', lists.todo.length > 0 && todo === lists.todo.length);
            $('#ship-transit-all').prop('checked', lists.transit.length > 0 && transit === lists.transit.length);
        }
        $('#ship-transit-refresh').prop('disabled', shipBusy);
    }

    function showShipTab(tab) {
        shipTab = tab;
        $('#ship-tabs .hub-tab').removeClass('active').filter(`[data-ship-tab="${tab}"]`).addClass('active');
        $('.ship-panel').hide();
        $(`#ship-panel-${tab}`).show();
    }

    // --- Hesap (bakiye) ---
    function renderShipAccount(err) {
        const $bal = $('#ship-balance'), $st = $('#ship-account-status'), $warn = $('#ship-account-warn');
        if (!shipAccount) {
            $bal.text('—');
            $st.attr('class', 'badge badge-muted').text(err ? 'Alınamadı' : 'Yükleniyor...');
            $warn.toggle(!!err).text(err || '');
            return;
        }
        $bal.text(kargoMoney(shipAccount.balance));
        $st.attr('class', `badge ${shipAccount.approved ? 'badge-success' : 'badge-warning'}`).text(shipAccount.statusLabel || (shipAccount.approved ? 'Onaylı' : 'Onay bekliyor'));
        const low = shipAccount.balance < SHIP_LOW_BALANCE;
        $warn.toggle(low || !shipAccount.approved).text(!shipAccount.approved
            ? 'Basit Kargo hesabı onaylı değil; barkod oluşturulamaz.'
            : `Bakiye düşük (${kargoMoney(shipAccount.balance)}). Barkod ücreti bakiyeden düşer; "Bakiye Yükle" ile yükleyin.`);
    }

    async function loadShipAccount(force) {
        if (!force && shipAccount && Date.now() - shipAccountAt < 60000) { renderShipAccount(); return; }
        if (!auth.currentUser) return;
        renderShipAccount();
        try {
            shipAccount = await kargoCall('kargoAccount');
            shipAccountAt = Date.now();
            renderShipAccount();
        } catch (err) {
            shipAccount = null;
            renderShipAccount(err.message || 'Hesap bilgisi alınamadı.');
        }
    }

    // --- Ayarlar ---
    function initShipSettings() {
        if (shipSettingsUnsub) shipSettingsUnsub();
        shipSettingsUnsub = onValue(ref(db, 'config/shipping'), (snap) => {
            const c = snap.val() || {};
            const packages = {};
            Object.entries(c.packages || {}).forEach(([id, p]) => {
                packages[id] = {
                    width: Number(p.width) || SHIP_DEFAULT_PKG.width, depth: Number(p.depth) || SHIP_DEFAULT_PKG.depth,
                    height: Number(p.height) || SHIP_DEFAULT_PKG.height, weight: Number(p.weight) || SHIP_DEFAULT_PKG.weight
                };
            });
            shipSettings = {
                defaultHandler: SHIP_HANDLERS[c.defaultHandler] ? c.defaultHandler : 'ECONOMIC',
                autoStatus: c.autoStatus !== false, autoMail: c.autoMail !== false, packages
            };
            fillShipSettingsForm();
        }, (err) => console.warn('Kargo ayarları okunamadı:', err.message));
    }

    function fillShipSettingsForm() {
        const $sel = $('#ship-set-handler');
        if (!$sel.children().length) $sel.html(Object.entries(SHIP_HANDLERS).map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join(''));
        $sel.val(shipSettings.defaultHandler);
        $('#ship-set-auto-status').prop('checked', shipSettings.autoStatus);
        $('#ship-set-auto-mail').prop('checked', shipSettings.autoMail);
        const products = (BASE_PRODUCTS || []).filter(p => p && p.id != null);
        $('#ship-set-packages').html(products.map((p) => {
            const v = shipSettings.packages[String(p.id)] || SHIP_DEFAULT_PKG;
            const f = (k, label, step) => `<label>${label}<input type="number" class="input-box" data-pid="${esc(p.id)}" data-k="${k}" value="${v[k]}" min="${k === 'weight' ? 0.1 : 1}" max="${k === 'weight' ? 30 : 150}" step="${step}" inputmode="decimal"></label>`;
            return `<div class="ship-pkg-row"><strong>${esc(p.name || 'Ürün ' + p.id)}</strong>
                <div class="ship-pkg-fields">${f('width', 'En (cm)', 1)}${f('depth', 'Boy (cm)', 1)}${f('height', 'Yükseklik (cm)', 1)}${f('weight', 'Ağırlık (kg)', 0.1)}</div></div>`;
        }).join(''));
    }

    // --- Etiket penceresi (sayfa içi; telefonda açılır pencere engeline takılmaz) ---
    async function openLabels(targets) {
        if (!targets.length) return;
        showToast('Etiketler hazırlanıyor...', 'info');
        const labels = [], failed = [];
        try {
            for (let i = 0; i < targets.length; i += 20) {
                const res = await kargoCall('kargoLabels', { orders: targets.slice(i, i + 20).map(t => ({ userId: String(t.userId), orderId: String(t.orderId) })) });
                labels.push(...res.labels); failed.push(...res.failed);
            }
        } catch (err) {
            showToast(err.message || 'Etiketler alınamadı.', 'error');
            return;
        }
        if (failed.length) showToast(`${failed.length} etiket alınamadı (#${failed.map(f => f.orderId).join(', #')}).`, 'error');
        if (!labels.length) return;
        // Etiket SVG'si <img> içinde gösterilir: img içindeki SVG betik çalıştıramaz
        $('#label-print-body').html(labels.map(l => {
            const b64 = btoa(unescape(encodeURIComponent(l.svg)));
            return `<figure class="label-item"><figcaption>Sipariş #${esc(l.orderId)}</figcaption><img alt="Kargo etiketi #${esc(l.orderId)}" src="data:image/svg+xml;base64,${b64}"></figure>`;
        }).join(''));
        $('#label-print-modal').addClass('open');
    }

    $(document).on('click', '#close-label-modal', () => $('#label-print-modal').removeClass('open'));
    $(document).on('click', '#label-print-btn', () => {
        document.body.classList.add('printing-labels');
        window.addEventListener('afterprint', () => document.body.classList.remove('printing-labels'), { once: true });
        window.print();
    });

    // --- Kargolama işlemleri ---
    function shipApplyLocal(orderId, shipment, trackingNumber) {
        const o = globalAdminData && globalAdminData.orders && globalAdminData.orders[orderId];
        if (!o) return;
        o.shipment = shipment;
        if (trackingNumber) o.trackingNumber = trackingNumber;
    }

    function setShipBusy(on) {
        shipBusy = on;
        $('#shipping-section .ship-act, #shipping-section .ship-select, #kargo-body button').prop('disabled', on);
        updateShipToolbars();
    }

    // Seçili siparişleri varsayılan firma ve otomatik paketle kargolar (bakiye bittiğinde kalanı denemez)
    async function shipQuickRun(targets) {
        if (shipBusy || !targets.length) return;
        const handler = shipSettings.defaultHandler;
        const ok = await askAdminConfirm({
            eyebrow: 'HIZLI KARGOLAMA', title: targets.length === 1 ? `Sipariş #${targets[0].orderId} kargolansın mı?` : `${targets.length} sipariş kargolansın mı?`,
            desc: `${shipHandlerLabel(handler)} ile barkod oluşturulur; paket ölçüsü ürün ayarlarından alınır. Ücret Basit Kargo bakiyenizden düşer (iptalde iade edilir).`,
            confirmText: 'Kargola', icon: 'fa-bolt', iconTone: 'purple'
        });
        if (!ok) return;
        setShipBusy(true);
        const done = [], failed = [];
        let total = 0;
        try {
            for (const t of targets) {
                showToast(`#${t.orderId} kargolanıyor (${done.length + failed.length + 1}/${targets.length})...`, 'info');
                try {
                    const res = await kargoCall('kargoQuick', { userId: String(t.userId), orderId: String(t.orderId) });
                    shipApplyLocal(t.orderId, res.shipment, res.trackingNumber);
                    total += Number(res.fee) || 0;
                    done.push(t);
                } catch (err) {
                    failed.push(`#${t.orderId}: ${err.message}`);
                    if (/bakiye/i.test(err.message)) break;
                }
            }
        } finally {
            setShipBusy(false);
            targets.forEach(t => shipSel.todo.delete(String(t.orderId)));
            renderShipping();
            loadShipAccount(true);
        }
        if (failed.length) showToast(failed.slice(0, 3).join(' · '), 'error');
        if (!done.length) return;
        showToast(`${done.length} barkod oluşturuldu${total ? ` (${kargoMoney(total)})` : ''}.`, 'success');
        showShipTab('transit');
        const print = await askAdminConfirm({
            eyebrow: 'ETİKET', title: 'Etiketler şimdi açılsın mı?',
            desc: 'Koliye yapıştırmak için kargo etiketlerini açıp yazdırabilirsiniz. Daha sonra "Yolda" sekmesinden de alınabilir.',
            confirmText: 'Etiketleri Aç', cancelText: 'Sonra', icon: 'fa-print', iconTone: 'emerald'
        });
        if (print) openLabels(done);
    }

    async function shipRefresh(t) {
        const res = await kargoCall('kargoRefresh', { userId: String(t.userId), orderId: String(t.orderId) });
        shipApplyLocal(t.orderId, res.shipment, res.trackingNumber);
        if (res.statusChanged) {
            const o = globalAdminData.orders[t.orderId];
            if (o) o.status = res.statusChanged;
        }
        return res;
    }

    async function shipReturn(t) {
        const ok = await askAdminConfirm({
            eyebrow: 'İADE BARKODU', title: `Sipariş #${t.orderId} için iade barkodu oluşturulsun mu?`,
            desc: 'Alıcı gönderici, siz alıcı olursunuz. Ücreti Basit Kargo belirler ve bakiyenizden düşebilir. İade kodunu müşteriye iletin.',
            confirmText: 'Oluştur', icon: 'fa-rotate-left', iconTone: 'amber'
        });
        if (!ok) return;
        const res = await kargoCall('kargoReturn', { userId: String(t.userId), orderId: String(t.orderId) });
        const o = globalAdminData.orders[t.orderId];
        if (o && o.shipment) o.shipment.returnCode = res.returnCode;
        showToast(`İade kodu: ${res.returnCode}`, 'success');
        renderShipping();
        loadShipAccount(true);
    }

    const shipTarget = ($el) => ({ userId: String($el.attr('data-uid') || ''), orderId: String($el.attr('data-id') || '') });

    $(document).on('click', '#shipping-section .ship-act', async function() {
        const $b = $(this), t = shipTarget($b), act = $b.attr('data-act');
        const order = globalAdminData && globalAdminData.orders && globalAdminData.orders[t.orderId];
        if (!order || !t.userId) { showToast('Sipariş bilgisi eksik.', 'error'); return; }
        try {
            if (act === 'quick') await shipQuickRun([t]);
            else if (act === 'detail') openKargoModal(order, t.orderId);
            else if (act === 'label') await openLabels([t]);
            else if (act === 'return') { setShipBusy(true); try { await shipReturn(t); } finally { setShipBusy(false); } }
            else if (act === 'refresh') {
                setShipBusy(true);
                try { await shipRefresh(t); renderShipping(); showToast('Kargo durumu güncellendi.', 'success'); } finally { setShipBusy(false); }
            }
        } catch (err) { showToast(err.message || 'İşlem başarısız.', 'error'); }
    });

    $(document).on('change', '#shipping-section .ship-select', function() {
        const kind = $(this).attr('data-kind'), id = String($(this).attr('data-id'));
        if (this.checked) shipSel[kind].add(id); else shipSel[kind].delete(id);
        updateShipToolbars();
    });
    $(document).on('change', '#ship-todo-all, #ship-transit-all', function() {
        const kind = this.id === 'ship-todo-all' ? 'todo' : 'transit';
        shipSel[kind].clear();
        if (this.checked) $(`#ship-list-${kind} .ship-select`).each(function() { shipSel[kind].add(String($(this).attr('data-id'))); });
        $(`#ship-list-${kind} .ship-select`).prop('checked', this.checked);
        updateShipToolbars();
    });
    $(document).on('click', '#ship-todo-go', () => {
        const orders = (globalAdminData && globalAdminData.orders) || {};
        shipQuickRun([...shipSel.todo].filter(id => orders[id]).map(id => ({ userId: orders[id].userId, orderId: id })));
    });
    $(document).on('click', '#ship-transit-labels', () => {
        const orders = (globalAdminData && globalAdminData.orders) || {};
        openLabels([...shipSel.transit].filter(id => orders[id]).map(id => ({ userId: orders[id].userId, orderId: id })));
    });
    $(document).on('click', '#ship-transit-refresh', async () => {
        const orders = (globalAdminData && globalAdminData.orders) || {};
        const list = Object.entries(orders).filter(([, o]) => shipKind(o) === 'transit').slice(0, 30);
        if (!list.length) { showToast('Yenilenecek gönderi yok.', 'info'); return; }
        setShipBusy(true);
        let changed = 0;
        try {
            for (const [id, o] of list) {
                try { const r = await shipRefresh({ userId: o.userId, orderId: id }); if (r.statusChanged) changed++; }
                catch (err) { showToast(`#${id}: ${err.message}`, 'error'); }
            }
        } finally { setShipBusy(false); renderShipping(); }
        showToast(changed ? `${changed} siparişin durumu değişti.` : 'Tüm gönderiler güncel.', 'success');
    });
    $(document).on('click', '#ship-tabs .hub-tab', function() { showShipTab($(this).attr('data-ship-tab')); });
    $(document).on('click', '#ship-account-refresh', () => loadShipAccount(true));

    $(document).on('submit', '#ship-settings-form', async function(e) {
        e.preventDefault();
        if (!auth.currentUser) { $('#login-modal').addClass('open'); return; }
        const packages = {};
        let valid = true;
        $('#ship-set-packages [data-pid]').each(function() {
            const pid = String($(this).attr('data-pid')), k = $(this).attr('data-k'), v = parseFloat(String($(this).val()).replace(',', '.'));
            const [min, max] = k === 'weight' ? [0.1, 30] : [1, 150];
            if (!(v >= min && v <= max)) valid = false;
            (packages[pid] = packages[pid] || {})[k] = v;
        });
        if (!valid) { showToast('Paket ölçüleri 1-150 cm, ağırlık 0,1-30 kg aralığında olmalı.', 'error'); return; }
        const $btn = $(this).find('button[type="submit"]').prop('disabled', true);
        try {
            await update(ref(db, 'config/shipping'), {
                defaultHandler: $('#ship-set-handler').val(), autoStatus: $('#ship-set-auto-status').is(':checked'),
                autoMail: $('#ship-set-auto-mail').is(':checked'), packages
            });
            showToast('Kargo ayarları kaydedildi.', 'success');
            auditLog('ship_settings', 'Kargo ayarları', `Varsayılan firma: ${$('#ship-set-handler').val()}`);
        } catch (err) { showToast('Kaydedilemedi: ' + err.message, 'error'); }
        finally { $btn.prop('disabled', false); }
    });

    /* --- Kargo işlemleri penceresi (kartlardaki "Seçenekler" / "Detay") --- */
    function openKargoModal(order, key) {
        kargoCtx.userId = order.userId || '';
        kargoCtx.orderId = String(key || order.id || '').replace(/^#/, '');
        kargoCtx.fees = null;
        kargoCtx.desi = null;
        kargoCtx.pkg = null;
        kargoCtx.error = '';
        const o = shipOrderLink(order, kargoCtx.orderId);
        $('#kargo-modal-id').text('#' + kargoCtx.orderId);
        $('#kargo-modal-who').text([o.name, o.place].filter(Boolean).join(' · '));
        renderKargo();
        $('#kargo-modal').addClass('open');
    }
    const closeKargoModal = () => $('#kargo-modal').removeClass('open');
    $(document).on('click', '#close-kargo-modal', closeKargoModal);
    $(document).on('click', '#kargo-modal', (e) => { if ($(e.target).is('#kargo-modal')) closeKargoModal(); });
    $(document).on('click', '#kargo-open-order', () => {
        const order = kargoOrder();
        if (order) { closeKargoModal(); openOrderDetailModal(order, kargoCtx.orderId); }
    });

    /* --- Kargo penceresi içeriği --- */
    function renderKargo() {
        const order = kargoOrder() || {};
        const sh = order.shipment || {};
        const $body = $('#kargo-body'), $status = $('#kargo-status');
        $status.hide();
        kargoCtx.sig = JSON.stringify(order.shipment || null) + '|' + (order.status || '');
        const errHtml = kargoCtx.error ? `<div class="kargo-error" role="alert"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(kargoCtx.error)}</div>` : '';
        const ship = order.shippingInfo || {};
        const addrFix = (kargoCtx.error && /adres|il\/ilçe|eksik/i.test(kargoCtx.error)) ? `
            <div class="kargo-addr">
                <strong>Adresi düzelt</strong>
                <div class="kargo-addr-grid">
                    <label>İl<input type="text" id="kargo-city" class="input-box" value="${esc(ship.city || '')}"></label>
                    <label>İlçe<input type="text" id="kargo-district" class="input-box" value="${esc(ship.district || '')}"></label>
                </div>
                <label>Açık adres<textarea id="kargo-address" class="input-box" rows="3">${esc(ship.address || '')}</textarea></label>
                <button type="button" class="btn primary" id="kargo-fix-address"><i class="fa-solid fa-check"></i> Kaydet</button>
            </div>` : '';

        if (sh.state === 'barcode') {
            const [stLabel, stClass] = BK_STATUS[sh.status] || [sh.status || 'Bilinmiyor', 'badge-muted'];
            $status.attr('class', `badge ${stClass}`).text(stLabel).show();
            const canReturn = sh.status === 'DELIVERED' && !sh.returnCode;
            $body.html(`
                <div class="kargo-rows">
                    <div><span>Firma</span><strong>${esc(sh.handlerName || sh.handlerCode || '-')}</strong></div>
                    <div><span>Barkod</span><strong class="ship-code">${esc(sh.barcode || '-')}</strong></div>
                    <div><span>Takip kodu</span><strong>${shipTrackHtml(sh)}</strong></div>
                    ${sh.lastState ? `<div><span>Son durum</span><strong>${esc(sh.lastState)}</strong></div>` : ''}
                    ${sh.returnCode ? `<div><span>İade kodu</span><strong class="ship-code">${esc(sh.returnCode)}</strong></div>` : ''}
                    <div><span>Güncelleme</span><strong>${esc(shipTimeAgo(sh.updatedAt) || '-')} <small class="ship-muted">(15 dk'da bir otomatik)</small></strong></div>
                </div>
                <div id="kargo-traces"></div>
                ${errHtml}
                <div class="kargo-actions">
                    <button type="button" class="btn primary" id="kargo-label"><i class="fa-solid fa-print"></i> Etiket</button>
                    <button type="button" class="btn secondary" id="kargo-refresh"><i class="fa-solid fa-rotate"></i> Yenile</button>
                    ${canReturn ? '<button type="button" class="btn secondary" id="kargo-return"><i class="fa-solid fa-rotate-left"></i> İade Barkodu</button>' : ''}
                    <button type="button" class="btn danger" id="kargo-cancel"><i class="fa-solid fa-ban"></i> İptal Et</button>
                </div>`);
            return;
        }

        if (!['todo'].includes(shipKind(order))) {
            $body.html(`<span class="ship-muted">"${esc(order.status || '-')}" durumundaki sipariş için kargo oluşturulamaz.</span>`);
            return;
        }

        const p = kargoCtx.pkg || shipAutoPackage(order);
        const input = (id, label, val, step) => `<label>${label}<input type="number" id="${id}" class="input-box" value="${val}" min="${step < 1 ? 0.1 : 1}" step="${step}" inputmode="decimal"></label>`;
        const fees = kargoCtx.fees;
        const feeRows = fees ? (fees.length ? fees.map(f => `
            <div class="kargo-fee${f.disabled ? ' disabled' : ''}">
                <span><strong>${esc(f.handler)}</strong><small class="ship-muted"> · ~${Math.max(1, Math.round(Number(f.duration) || 0))} gün</small></span>
                <span class="kargo-fee-right"><strong>${kargoMoney(f.fee)}</strong>
                    <button type="button" class="btn primary kargo-create" data-code="${esc(f.handlerCode)}" data-name="${esc(f.handler)}" data-fee="${Number(f.fee) || 0}"${f.disabled ? ' disabled' : ''}>Seç</button></span>
            </div>`).join('') : '<p>Bu paket için uygun kargo firması bulunamadı.</p>') : '';
        $body.html(`
            ${errHtml}${addrFix}
            <div class="kargo-pkg">
                ${input('kargo-w', 'En (cm)', p.width, 1)}${input('kargo-d', 'Boy (cm)', p.depth, 1)}${input('kargo-h', 'Yükseklik (cm)', p.height, 1)}${input('kargo-kg', 'Ağırlık (kg)', p.weight, 0.1)}
            </div>
            <div class="kargo-actions">
                <button type="button" class="btn primary" id="kargo-quick"><i class="fa-solid fa-bolt"></i> Hızlı Kargola</button>
                <button type="button" class="btn secondary" id="kargo-quote"><i class="fa-solid fa-magnifying-glass-dollar"></i> ${fees ? 'Yeniden Sorgula' : 'Firma Seç'}</button>
            </div>
            <p class="ship-hint">Hızlı Kargola: ${esc(shipHandlerLabel(shipSettings.defaultHandler))} ile bu ölçülerde barkod oluşturur (ayarlar: Kargo sekmesi).</p>
            ${fees && kargoCtx.desi ? `<p class="ship-hint">Hesaplanan desi/kg: ${esc(kargoCtx.desi)}</p>` : ''}
            ${feeRows}`);
    }

    function kargoReadPackage() {
        const num = (id) => parseFloat(String($(id).val()).replace(',', '.'));
        const pkg = { width: num('#kargo-w'), depth: num('#kargo-d'), height: num('#kargo-h'), weight: num('#kargo-kg') };
        if (![pkg.width, pkg.depth, pkg.height].every(v => v >= 1 && v <= 150) || !(pkg.weight >= 0.1 && pkg.weight <= 30)) {
            showToast('Paket ölçüleri 1-150 cm, ağırlık 0,1-30 kg aralığında olmalı.', 'error');
            return null;
        }
        return pkg;
    }

    async function kargoRun($btn, fn) {
        if (shipBusy) return;
        kargoCtx.error = '';
        $('.kargo-error').remove();
        setShipBusy(true);
        $btn.html(`<i class="fa-solid fa-spinner fa-spin"></i> ${$btn.text()}`);
        try { await fn(); }
        catch (err) { kargoCtx.error = err.message || 'İşlem başarısız.'; showToast(kargoCtx.error, 'error'); }
        finally { setShipBusy(false); renderKargo(); renderShipping(); }
    }

    const kargoTarget = () => ({ userId: String(kargoCtx.userId), orderId: String(kargoCtx.orderId) });

    $(document).on('click', '#kargo-quote', function() {
        const pkg = kargoReadPackage();
        if (!pkg) return;
        kargoCtx.pkg = pkg;
        kargoRun($(this), async () => {
            const res = await kargoCall('kargoQuote', { ...kargoTarget(), package: pkg });
            kargoCtx.fees = res.fees || [];
            kargoCtx.desi = res.desi;
            const o = kargoOrder();
            if (o) o.shipment = { state: 'draft', bkId: res.bkId };
        });
    });

    $(document).on('click', '#kargo-quick', function() {
        const pkg = kargoReadPackage();
        if (!pkg) return;
        kargoCtx.pkg = pkg;
        // Taslak girilen ölçüyle açılır, ardından varsayılan firmayla barkod üretilir
        kargoRun($(this), async () => {
            const t = kargoTarget();
            await kargoCall('kargoQuote', { ...t, package: pkg });
            const res = await kargoCall('kargoCreate', { ...t, handlerCode: shipSettings.defaultHandler });
            shipApplyLocal(t.orderId, res.shipment, res.trackingNumber);
            kargoCtx.fees = null;
            showToast(`Barkod oluşturuldu (${kargoMoney(res.fee)}).`, 'success');
            loadShipAccount(true);
        });
    });

    $(document).on('click', '.kargo-create', async function() {
        const $btn = $(this);
        const ok = await askAdminConfirm({
            eyebrow: 'KARGO BARKODU', title: `${$btn.data('name')} ile barkod oluşturulsun mu?`,
            desc: `Sipariş #${kargoCtx.orderId} için ${kargoMoney($btn.data('fee'))} tutarı Basit Kargo bakiyenizden düşer. Barkod iptal edilirse iade edilir.`,
            confirmText: 'Barkod Oluştur', icon: 'fa-truck-fast', iconTone: 'purple'
        });
        if (!ok) return;
        kargoRun($btn, async () => {
            const res = await kargoCall('kargoCreate', { ...kargoTarget(), handlerCode: String($btn.data('code')) });
            shipApplyLocal(kargoCtx.orderId, res.shipment, res.trackingNumber);
            kargoCtx.fees = null;
            showToast(`Barkod oluşturuldu (${kargoMoney(res.fee)}).`, 'success');
            loadShipAccount(true);
        });
    });

    $(document).on('click', '#kargo-refresh', function() {
        kargoRun($(this), async () => {
            const res = await shipRefresh(kargoTarget());
            // renderKargo (kargoRun sonu) gövdeyi yeniden çizer; hareketler ondan sonra yazılır
            setTimeout(() => {
                const rows = (res.traces || []).slice().reverse().map(t =>
                    `<div class="kargo-trace">${esc(t.time ? String(t.time).replace('T', ' ').slice(0, 16) : '')} · <strong>${esc(t.status)}</strong>${t.location ? ' · ' + esc(t.location) : ''}</div>`).join('');
                $('#kargo-traces').html(rows || '<span class="ship-muted">Henüz hareket yok.</span>');
            }, 0);
            showToast(res.statusChanged ? `Durum güncellendi: ${res.statusChanged}` : 'Kargo durumu güncellendi.', 'success');
        });
    });

    $(document).on('click', '#kargo-label', () => openLabels([kargoTarget()]));

    $(document).on('click', '#kargo-return', function() {
        kargoRun($(this), () => shipReturn(kargoTarget()));
    });

    $(document).on('click', '#kargo-fix-address', function() {
        const city = String($('#kargo-city').val() || '').trim(), district = String($('#kargo-district').val() || '').trim(), address = String($('#kargo-address').val() || '').trim();
        if (!city || !district || address.length < 5) { showToast('İl, ilçe ve açık adres gerekli.', 'error'); return; }
        kargoRun($(this), async () => {
            const fixed = await kargoCall('kargoSetAddress', { ...kargoTarget(), city, district, address });
            const o = kargoOrder();
            if (o) { o.shippingInfo = { ...(o.shippingInfo || {}), ...fixed }; }
            showToast('Adres güncellendi. Şimdi kargolayabilirsiniz.', 'success');
        });
    });

    $(document).on('click', '#kargo-cancel', async function() {
        const ok = await askAdminConfirm({
            eyebrow: 'KARGO İPTALİ', title: 'Kargo barkodu iptal edilsin mi?',
            desc: 'Barkod iptal edilir ve ücret Basit Kargo bakiyenize iade edilir. Kargo firması gönderiyi almışsa iptal reddedilebilir.',
            confirmText: 'Kargoyu İptal Et', variant: 'danger', icon: 'fa-ban', iconTone: 'rose'
        });
        if (!ok) return;
        kargoRun($(this), async () => {
            await kargoCall('kargoCancel', kargoTarget());
            const o = kargoOrder();
            if (o) {
                if (o.shipment && o.trackingNumber === o.shipment.handlerShipmentCode) o.trackingNumber = '';
                delete o.shipment;
            }
            kargoCtx.fees = null;
            showToast('Kargo iptal edildi.', 'success');
            loadShipAccount(true);
        });
    });

    // Modal Close Events
    $('#close-order-modal').click(function() {
        $('#order-detail-modal').removeClass('open');
    });

    $(window).click(function(e) {
        if ($(e.target).is('#order-detail-modal')) {
            $('#order-detail-modal').removeClass('open');
        }
    });

    // Close Dropdowns on Click Outside
    $(document).on('click', function() {
        $('.dropdown-menu').removeClass('show');
    });

    // Arama, sıralama, filtre ve sayfalama: filtre/sıralama değişince 1. sayfaya dönülür
    const rerenderOrders = (resetPage) => {
        if (resetPage) ordersPage = 1;
        if (globalAdminData && globalAdminData.orders) renderOrders(globalAdminData.orders);
    };
    $('#order-search-input').on('input', () => rerenderOrders(true));
    $('#order-sort-select').on('change', () => rerenderOrders(true));
    $('#order-pay-filter').on('change', function() { orderFilter.pay = this.value; rerenderOrders(true); });
    $('#order-prio-filter').on('change', function() { orderFilter.prio = this.value; rerenderOrders(true); });
    $('#order-date-filter').on('change', function() { orderFilter.date = this.value; rerenderOrders(true); });
    $('#order-status-chips').on('click', '.order-chip', function() {
        orderFilter.status = String($(this).data('rank') || '');
        rerenderOrders(true);
    });
    $('#order-filter-clear').on('click', function() {
        Object.assign(orderFilter, { status: '', pay: '', prio: '', date: '' });
        $('#order-search-input').val('');
        rerenderOrders(true);
    });
    $('#orders-pager').on('click', '[data-orders-page]', function() {
        ordersPage = Number($(this).data('orders-page')) || 1;
        rerenderOrders(false);
        const el = document.getElementById('order-filters');
        if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    // Vergi kartı: takvim yılı seçimi ve yıllık limit düzenleme
    $('#tax-year-select').on('change', function() { taxYearSel = this.value; $('#tax-limit-form').prop('hidden', true); renderFinance(); });
    $('#tax-limit-edit').on('click', function() {
        const lim = Number((((globalAdminData || {}).finance || {}).tax_limits || {})[taxYearSel]) || TAX_EXEMPTION_LIMIT;
        $('#tax-limit-input').val(lim);
        $('#tax-limit-form').prop('hidden', !$('#tax-limit-form').prop('hidden'));
    });
    $('#tax-limit-cancel').on('click', () => $('#tax-limit-form').prop('hidden', true));
    const saveTaxLimit = async (value) => {
        const year = taxYearSel;
        if (!year) return;
        try {
            const path = ref(db, `admin/finance/tax_limits/${year}`);
            if (value === null) await remove(path); else await set(path, value);
            auditLog('tax_limit', String(year), value === null ? 'varsayılana döndü' : formatTL(value));
            $('#tax-limit-form').prop('hidden', true);
            showToast(value === null ? 'Limit varsayılana döndü.' : 'Limit kaydedildi.', 'success');
        } catch (err) {
            showToast('Limit kaydedilemedi: ' + (err.message || err.code), 'error');
        }
    };
    $('#tax-limit-save').on('click', function() {
        const v = Math.round(Number($('#tax-limit-input').val()));
        if (!(v > 0) || v > 1e9) { showToast('Geçerli bir limit girin.', 'error'); return; }
        saveTaxLimit(v);
    });
    $('#tax-limit-reset').on('click', () => saveTaxLimit(null));

    $('.sortable-th').on('click', function() {
        const col = $(this).data('sort-col');
        if (!col) return;
        const current = $('#order-sort-select').val() || 'priority-desc';
        const [curCol, curDir] = current.split('-');
        const defaultDir = (col === 'status' || col === 'id') ? 'asc' : 'desc';
        const nextDir = (curCol === col) ? (curDir === 'desc' ? 'asc' : 'desc') : defaultDir;
        $('#order-sort-select').val(`${col}-${nextDir}`).trigger('change');
    });

    // Select All Listener
    $('#select-all-orders').change(function() {
        const isChecked = $(this).is(':checked');
        $('.order-checkbox').prop('checked', isChecked);
    });

    // Bulk Update Listener
    $('#btn-bulk-update').click(async function() {
        const selectedIds = [];
        const selectedUserIds = [];
        
        $('.order-checkbox:checked').each(function() {
            selectedIds.push($(this).val());
            selectedUserIds.push($(this).data('userid'));
        });

        const newStatus = $('#bulk-status-select').val();

        if (selectedIds.length === 0) {
            showToast("Lütfen en az bir sipariş seçin.", "error");
            return;
        }

        if (!newStatus) {
            showToast("Lütfen yeni bir durum seçin.", "error");
            return;
        }

        const confirmedBulk = await askAdminConfirm({
            eyebrow: 'TOPLU DURUM GÜNCELLEME',
            title: `${selectedIds.length} Sipariş Güncellensin mi?`,
            desc: `Seçilen ${selectedIds.length} siparişin durumu "${newStatus}" olarak değiştirilecek. Devam etmek istiyor musunuz?`,
            confirmText: 'Evet, Güncelle',
            cancelText: 'Vazgeç',
            variant: newStatus === 'İptal' ? 'danger' : 'primary',
            icon: newStatus === 'İptal' ? 'fa-ban' : 'fa-layer-group',
            iconTone: newStatus === 'İptal' ? 'rose' : 'amber'
        });
        if (!confirmedBulk) {
            return;
        }

        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i>');

        try {
            const updates = {};
            selectedIds.forEach((orderId, index) => {
                const userId = selectedUserIds[index];
                if(userId) {
                    updates[`users/${userId}/orders/${orderId}/status`] = newStatus;
                    if (globalAdminData && globalAdminData.orders && globalAdminData.orders[orderId]) {
                        globalAdminData.orders[orderId].status = newStatus;
                    }
                }
            });

            await update(ref(db), updates);

            showToast(`${selectedIds.length} sipariş güncellendi.`, "success");
            auditLog('order_status_bulk', `${selectedIds.length} sipariş`, `${newStatus}: ${selectedIds.map(id => '#' + id).join(', ')}`);
            if (newStatus === 'İptal') {
                const unrefunded = selectedIds.filter(id => { const o = globalAdminData.orders[id]; return o && canCardRefund(o) && orderRefundInfo(o).remaining > 0; });
                if (unrefunded.length) showToast(`${unrefunded.length} siparişin kart ödemesi iade edilmedi (${unrefunded.map(id => '#' + id).join(', ')}). Sipariş detayından iade edin.`, 'error');
            }
            await offerStatusMail(selectedIds.map((orderId, i) => ({ userId: selectedUserIds[i], orderId })).filter(o => o.userId), newStatus);
            
            // Uncheck select all
            $('#select-all-orders').prop('checked', false);
            
            renderOrders(globalAdminData.orders);
            renderFinance();
            
        } catch (error) {
            console.error("Bulk Update Error:", error);
            showToast("Güncelleme hatası: " + error.message, "error");
        } finally {
            $btn.prop('disabled', false).text('Güncelle');
        }
    });

    // --- DRAG DROP ---
    $('.queue-item').on('dragstart', function(e) { /* ... */ });

    // --- FİYATLANDIRMA PARAMETRELERİ (Ürün fiyatlarını belirler) ---
    // Parametreler katlanabilir kartta; başlığa tıklayınca aç/kapa
    $('#pricing-params-toggle').on('click', function() {
        $('#pricing-params-body').slideToggle(180);
        $(this).toggleClass('open');
    });

    // Parametre değişince ürün fiyatlarını anında yeniden hesapla
    $('.pricing-calc-trigger').on('input change', function() {
        updatePricingUI();
    });

    // Varsayılan değerlerle ilk hesaplamayı çalıştır
    updatePricingUI();

    // Varsayılana Dön
    $('#btn-reset-pricing-params').on('click', function() {
        applyPricingParamsToInputs(DEFAULT_PRICING_PARAMS, true);
        updatePricingUI();
        showToast("Formül parametreleri varsayılan değerlere döndürüldü.", "info");
    });

    // Firebase'e Kaydet
    $('#btn-save-pricing-params').on('click', async function() {
        if (!auth.currentUser) {
            $('#login-modal').addClass('open');
            showToast("Parametreleri kaydetmek için lütfen yönetici girişi yapın.", "error");
            return;
        }

        const $btn = $(this);
        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...');

        const currentInputs = readPricingInputs();
        const payload = {
            G_saat: currentInputs.G_saat,
            t_hazirlik: currentInputs.t_hazirlik,
            F_kg: currentInputs.F_kg,
            P_makine: currentInputs.P_makine,
            E_kwh: currentInputs.E_kwh,
            A_saat: currentInputs.A_saat,
            M_ambalaj: currentInputs.M_ambalaj,
            K_kargo: currentInputs.K_kargo,
            r_fire: currentInputs.r_fire,
            k_kar: currentInputs.k_kar,
            c_oran: currentInputs.c_oran,
            c_sabit: currentInputs.c_sabit,
            v_devlet: currentInputs.v_devlet,
            updatedAt: Date.now()
        };

        try {
            await set(ref(db, 'admin/pricing'), payload);
            $('#pricing-sync-badge').text('Firebase Kayıtlı').attr('class', 'badge badge-success');
            showToast("Fiyatlandırma parametreleri Firebase'e kaydedildi.", "success");
            auditLog('pricing_save', 'Fiyatlandırma parametreleri', '');
        } catch (error) {
            console.error("Pricing Save Error:", error);
            showToast("Kaydetme hatası: " + error.message, "error");
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
    });

    // --- ÜRÜN YÖNETİMİ ---
    renderProductsAdmin();
    loadProductOverrides();

    // Üretim süresi veya ürün çarpanı değişince o satırın fiyatını anında yeniden hesapla
    $('#products-admin-list').on('click', '.pimg-open', function() {
        openProductImages($(this).closest('.product-admin-row').data('product-id'));
    });
    $('#products-admin-list').on('input change', '.product-hours-input, .product-multiplier-input, .product-discount-input', function() {
        recomputeProductPrices();
    });

    $('#btn-save-products').on('click', async function() {
        if (!auth.currentUser) {
            $('#login-modal').addClass('open');
            showToast("Ürünleri kaydetmek için lütfen yönetici girişi yapın.", "error");
            return;
        }

        const $btn = $(this);
        const originalHtml = $btn.html();
        const params = readPricingInputs();
        const updates = {};
        const summary = [];
        let invalid = false;

        $('#products-admin-list .product-admin-row').each(function() {
            const $row = $(this);
            const id = String($row.data('product-id'));
            const name = String($row.find('.product-name-input').val() || '').trim();
            const hours = Number(String($row.find('.product-hours-input').val() ?? '').replace(',', '.'));
            const multiplierRaw = Number(String($row.find('.product-multiplier-input').val() ?? '').replace(',', '.'));
            const multiplier = (Number.isFinite(multiplierRaw) && multiplierRaw > 0) ? Math.round(multiplierRaw * 100) / 100 : 1;
            if (!name || !Number.isFinite(hours) || hours <= 0) { invalid = true; return; }
            const raw = hesaplaSatisFiyati({ ...params, t: hours }) * multiplier;
            const price = roundPriceToNine(raw);
            const discountMultiplier = readDiscountMultiplier($row.find('.product-discount-input').val());
            const oldPrice = oldPriceFor(raw, price, discountMultiplier);
            // Alan bazlı yazılır: tüm düğümü değiştirmek panelden seçilen görselleri (images, card) silerdi
            const fields = {
                name: name.slice(0, 120),
                price: price,
                productionHours: Math.round(hours * 100) / 100,
                multiplier: multiplier,
                discountMultiplier: discountMultiplier,
                oldPrice: oldPrice,
                updatedAt: Date.now()
            };
            for (const [k, v] of Object.entries(fields)) updates[`config/products/${id}/${k}`] = v;
            summary.push(`${fields.name}: ₺${price}${oldPrice ? ` (eski ₺${oldPrice})` : ''}`);
        });

        if (invalid) {
            showToast("Lütfen tüm ürünler için geçerli bir ad ve 0'dan büyük üretim süresi girin.", "error");
            return;
        }
        if (!Object.keys(updates).length) {
            showToast("Kaydedilecek ürün bulunamadı.", "error");
            return;
        }

        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...');
        try {
            await update(ref(db), updates);
            showToast("Ürün bilgileri kaydedildi. Site ve ödeme tutarı güncellendi.", "success");
            auditLog('products_save', `${summary.length} ürün`, summary.join(', '));
            publishStaticPrices();
        } catch (error) {
            console.error("Product Save Error:", error);
            showToast("Kaydetme hatası: " + error.message, "error");
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
    });

    // --- İNDİRİM KODLARI ---
    $('#btn-add-discount').on('click', function() { openDiscountModal(null); });
    $('#close-discount-modal, #cancel-discount-modal').on('click', function() {
        $('#discount-modal').removeClass('open');
    });
    $('#discounts-table-body').on('click', '.discount-edit', function() {
        openDiscountModal($(this).data('code'));
    });
    $('#discounts-table-body').on('click', '.discount-delete', function() {
        deleteDiscount($(this).data('code'));
    });
    $('#discount-form').on('submit', saveDiscount);

    // --- MÜŞTERİ YORUMLARI ---
    $('#btn-add-review').on('click', function() { openReviewModal(null); });
    $('#close-review-modal, #cancel-review-modal').on('click', function() { $('#review-modal').removeClass('open'); });
    $('#reviews-admin-list').on('click', '.review-edit', function() { openReviewModal($(this).data('product'), $(this).data('key')); });
    $('#reviews-admin-list').on('click', '.review-delete', function() { deleteReview($(this).data('product'), $(this).data('key')); });
    $('#review-form').on('submit', saveReview);

    // --- FİNANS & GİDER YÖNETİMİ ---
    $('#profit-chart-mode').on('change', function() {
        renderFinance();
    });

    function openExpenseModal() {
        if (!auth.currentUser) {
            $('#login-modal').addClass('open');
            showToast("Gider eklemek için lütfen yönetici girişi yapın.", "error");
            return;
        }
        const todayIst = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
        $('#expense-title').val('');
        $('#expense-category').val('Filament & Malzeme');
        $('#expense-amount').val('');
        $('#expense-date').val(todayIst);
        $('#expense-modal').addClass('open');
        setTimeout(() => $('#expense-title').trigger('focus'), 50);
    }

    $('#btn-open-expense-modal, #btn-open-expense-modal-top').on('click', function() {
        openExpenseModal();
    });

    $('#close-expense-modal, #cancel-expense-modal').on('click', function() {
        $('#expense-modal').removeClass('open');
    });

    $('#expense-form').on('submit', async function(e) {
        e.preventDefault();
        if (!auth.currentUser) {
            $('#login-modal').addClass('open');
            showToast("Gider eklemek için lütfen yönetici girişi yapın.", "error");
            return;
        }

        const title = String($('#expense-title').val() || '').trim();
        const category = String($('#expense-category').val() || 'Diğer').trim();
        const amountRaw = String($('#expense-amount').val() || '').replace(',', '.').trim();
        const amount = parseFloat(amountRaw);
        const date = String($('#expense-date').val() || '').trim() || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });

        if (!title) {
            showToast("Lütfen gider açıklaması girin.", "error");
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            showToast("Lütfen geçerli bir gider tutarı girin.", "error");
            return;
        }

        const $btn = $('#btn-save-expense');
        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...');

        const expenseId = 'exp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const expenseItem = {
            id: expenseId,
            title,
            category,
            amount: Number(amount.toFixed(2)),
            date,
            createdAt: Date.now()
        };

        try {
            await set(ref(db, `admin/finance/expenses/${expenseId}`), expenseItem);
            if (!globalAdminData) globalAdminData = {};
            if (!globalAdminData.finance) globalAdminData.finance = {};
            if (!globalAdminData.finance.expenses) globalAdminData.finance.expenses = {};
            globalAdminData.finance.expenses[expenseId] = expenseItem;
            auditLog('expense_add', expenseItem.title || expenseId, `₺${expenseItem.amount}`);

            renderFinance();
            $('#expense-modal').removeClass('open');
            showToast("Gider kaydedildi (Vergi muafiyeti ciro limitini etkilemez).", "success");
        } catch (error) {
            console.error("Expense Save Error:", error);
            showToast("Gider kaydedilemedi: " + error.message, "error");
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
    });

    $('#expense-list').on('click', '.btn-delete-expense', async function() {
        const expId = $(this).data('id');
        if (!expId) return;
        if (!auth.currentUser) {
            $('#login-modal').addClass('open');
            showToast("İşlem için yönetici girişi yapın.", "error");
            return;
        }
        const confirmedDel = await askAdminConfirm({
            eyebrow: 'GİDER SİLME ONAYI',
            title: 'Gider Kaydı Silinsin mi?',
            desc: 'Bu gider kaydını kalıcı olarak silmek istediğinize emin misiniz?',
            confirmText: 'Evet, Sil',
            cancelText: 'Vazgeç',
            variant: 'danger',
            icon: 'fa-trash-can',
            iconTone: 'rose'
        });
        if (!confirmedDel) return;

        try {
            const delExp = globalAdminData?.finance?.expenses?.[expId];
            await remove(ref(db, `admin/finance/expenses/${expId}`));
            auditLog('expense_delete', (delExp && delExp.title) || expId, delExp && delExp.amount !== undefined ? `₺${delExp.amount}` : '');
            if (globalAdminData?.finance?.expenses) {
                delete globalAdminData.finance.expenses[expId];
            }
            renderFinance();
            showToast("Gider kaydı silindi.", "success");
        } catch (error) {
            console.error("Expense Delete Error:", error);
            showToast("Silme hatası: " + error.message, "error");
        }
    });

    // --- KULLANICI YÖNETİMİ (USER MANAGEMENT) LISTENERS ---
    window.__openOrderDetailModal = openOrderDetailModal;
    window.__renderOrders = renderOrders;

    $('#user-search-input').on('input', function() {
        renderUsers();
    });

    $('#user-role-filter, #user-sort-select').on('change', function() {
        renderUsers();
    });

    // Kullanıcı satırına veya Detay butonuna tıklayınca Kullanıcı Detay Pop-up'ını aç
    $('#users-table-body').on('click', 'tr.user-row', function(e) {
        if ($(e.target).closest('.btn-delete-user-row').length) return;
        const uid = $(this).attr('data-uid');
        if (uid) openUserDetailModal(uid);
    });

    // Tablodaki Sil butonuna tıklayınca doğrudan Silme Pop-up'ını aç (Adminler için devre dışı)
    $('#users-table-body').on('click', '.btn-delete-user-row', function(e) {
        e.stopPropagation();
        const uid = $(this).attr('data-uid');
        if (uid) openUserDeleteModal(uid);
    });

    // Kullanıcı Detay Pop-up kapatma
    $('#close-user-detail-modal, #btn-close-user-detail').on('click', function() {
        $('#user-detail-modal').removeClass('open');
    });

    $('#user-detail-modal').on('click', function(e) {
        if ($(e.target).is('#user-detail-modal')) {
            $('#user-detail-modal').removeClass('open');
        }
    });

    // Kullanıcı Detay Pop-up içinden UID kopyalama
    $('#ud-uid-pill').on('click', function() {
        const uidText = $('#ud-uid').text().trim();
        if (uidText && uidText !== '-' && navigator.clipboard) {
            navigator.clipboard.writeText(uidText).then(() => {
                showToast("Kullanıcı UID panoya kopyalandı.", "info");
            }).catch(() => {});
        }
    });

    // Kullanıcı Detay Pop-up içindeki sipariş satırından Sipariş Detay Modalını aç
    $('#ud-orders-tbody').on('click', '.btn-user-order-detail', function(e) {
        e.stopPropagation();
        const orderId = $(this).attr('data-orderid');
        const uid = $('#user-detail-modal').attr('data-uid');
        const userOrders = (uid && globalAdminData?.allUsers?.[uid]?.orders) || {};
        const order = (globalAdminData?.orders && globalAdminData.orders[orderId]) || userOrders[orderId];
        if (order) {
            openOrderDetailModal({ ...order, id: order.id || orderId, userId: order.userId || uid }, orderId);
        }
    });

    // Kullanıcı Detay Pop-up içindeki siparişlerin toplu seçimi (Tümünü Seç)
    $('#ud-orders-select-all').on('change', function() {
        const isChecked = $(this).is(':checked');
        $('#ud-orders-tbody .ud-order-row-check').prop('checked', isChecked);
        syncUserOrdersBulkSelectionUI();
    });

    // Tekil checkbox değişimi
    $('#ud-orders-tbody').on('change', '.ud-order-row-check', function() {
        syncUserOrdersBulkSelectionUI();
    });

    // Sipariş satırına tıklayınca (buton/checkbox dışı) seçim kutusunu değiştir
    $('#ud-orders-tbody').on('click', 'tr.ud-order-row', function(e) {
        if ($(e.target).closest('button, input, a').length) return;
        const $chk = $(this).find('.ud-order-row-check');
        if ($chk.length) {
            $chk.prop('checked', !$chk.is(':checked'));
            syncUserOrdersBulkSelectionUI();
        }
    });

    // Toplu "Seçilen Siparişleri Sil" butonu
    $('#btn-delete-selected-user-orders').on('click', function() {
        const uid = $('#user-detail-modal').attr('data-uid');
        const selected = [];
        $('#ud-orders-tbody .ud-order-row-check:checked').each(function() {
            selected.push({
                orderId: String($(this).attr('data-orderid') || ''),
                userId: String($(this).attr('data-userid') || uid || ''),
                amount: parseFloat($(this).attr('data-amount')) || 0
            });
        });
        if (selected.length === 0) {
            showToast("Lütfen silmek istediğiniz en az bir siparişi seçin.", "error");
            return;
        }
        openUserOrdersDeleteModal(uid, selected);
    });

    // Tekil sipariş satırındaki çöp kutusu butonu
    $('#ud-orders-tbody').on('click', '.btn-delete-single-user-order', function(e) {
        e.stopPropagation();
        const uid = $('#user-detail-modal').attr('data-uid');
        const orderId = String($(this).attr('data-orderid') || '');
        const userId = String($(this).attr('data-userid') || uid || '');
        const amount = parseFloat($(this).attr('data-amount')) || 0;
        if (!orderId) return;
        openUserOrdersDeleteModal(uid, [{ orderId, userId, amount }]);
    });

    // Kullanıcı Detay Pop-up içindeki "Kullanıcıyı ve Tüm Verilerini Sil" butonu
    $('#btn-open-user-delete').on('click', function() {
        const uid = $('#user-detail-modal').attr('data-uid');
        if (uid) openUserDeleteModal(uid);
    });

    // Kullanıcı Silme & Sipariş Silme Pop-up (2 saniye basılı tutma / Hold-to-Delete) mekanizmaları
    initUserDeleteHoldHandler();
    initUserOrdersDeleteHoldHandler();

});

const DEFAULT_PRICING_PARAMS = {
    t: 1,
    G_saat: 35,       // Saatlik filament tüketimi (gram/saat)
    t_hazirlik: 10,   // İlk hazırlık süresi (dakika) - filament harcanmayan süre
    F_kg: 500,        // Filament kg fiyatı (TL) - PETG için 700
    P_makine: 0.15,   // Güç tüketimi (kW) - ~150W
    E_kwh: 3.24,      // Elektrik kWh fiyatı (TL)
    A_saat: 8.0,      // Saatlik amortisman (TL)
    M_ambalaj: 15.0,  // Ambalaj maliyeti (TL)
    K_kargo: 108,     // Kargo maliyeti (TL) - müşteriye ücretsiz, satıcı öder
    r_fire: 0.10,     // Fire oranı (%10)
    k_kar: 1.8,       // Kâr çarpanı
    c_oran: 0.0449,   // iyzico komisyon oranı (%4.49)
    c_sabit: 0.25,    // iyzico sabit işlem ücreti (TL)
    v_devlet: 0.04    // Devlet vergi / stopaj oranı (%4 - iyzico'nun yatırdığı tutar üzerinden)
};

function parseNumInput(selector, fallback) {
    const raw = String($(selector).val() ?? '').replace(',', '.').trim();
    const num = parseFloat(raw);
    return Number.isFinite(num) ? num : fallback;
}

function readPricingInputs() {
    return {
        G_saat: Math.max(0, parseNumInput('#param-G_saat', DEFAULT_PRICING_PARAMS.G_saat)),
        t_hazirlik: Math.max(0, parseNumInput('#param-t_hazirlik', DEFAULT_PRICING_PARAMS.t_hazirlik)),
        F_kg: Math.max(0, parseNumInput('#param-F_kg', DEFAULT_PRICING_PARAMS.F_kg)),
        P_makine: Math.max(0, parseNumInput('#param-P_makine', DEFAULT_PRICING_PARAMS.P_makine)),
        E_kwh: Math.max(0, parseNumInput('#param-E_kwh', DEFAULT_PRICING_PARAMS.E_kwh)),
        A_saat: Math.max(0, parseNumInput('#param-A_saat', DEFAULT_PRICING_PARAMS.A_saat)),
        M_ambalaj: Math.max(0, parseNumInput('#param-M_ambalaj', DEFAULT_PRICING_PARAMS.M_ambalaj)),
        K_kargo: Math.max(0, parseNumInput('#param-K_kargo', DEFAULT_PRICING_PARAMS.K_kargo)),
        r_fire: Math.max(0, parseNumInput('#param-r_fire', DEFAULT_PRICING_PARAMS.r_fire)),
        k_kar: Math.max(0, parseNumInput('#param-k_kar', DEFAULT_PRICING_PARAMS.k_kar)),
        c_oran: Math.min(0.99, Math.max(0, parseNumInput('#param-c_oran', DEFAULT_PRICING_PARAMS.c_oran))),
        c_sabit: Math.max(0, parseNumInput('#param-c_sabit', DEFAULT_PRICING_PARAMS.c_sabit)),
        v_devlet: Math.min(0.99, Math.max(0, parseNumInput('#param-v_devlet', DEFAULT_PRICING_PARAMS.v_devlet)))
    };
}

function applyPricingParamsToInputs(params, forceOverwrite = false) {
    if (!params || typeof params !== 'object') return;
    const setIfNotFocused = (selector, val) => {
        if (val === undefined || val === null || !Number.isFinite(Number(val))) return;
        const $el = $(selector);
        if (forceOverwrite || !$el.is(':focus')) {
            $el.val(Number(val));
        }
    };
    setIfNotFocused('#param-G_saat', params.G_saat);
    setIfNotFocused('#param-t_hazirlik', params.t_hazirlik);
    setIfNotFocused('#param-F_kg', params.F_kg);
    setIfNotFocused('#param-P_makine', params.P_makine);
    setIfNotFocused('#param-E_kwh', params.E_kwh);
    setIfNotFocused('#param-A_saat', params.A_saat);
    setIfNotFocused('#param-M_ambalaj', params.M_ambalaj);
    setIfNotFocused('#param-K_kargo', params.K_kargo);
    setIfNotFocused('#param-r_fire', params.r_fire);
    setIfNotFocused('#param-k_kar', params.k_kar);
    setIfNotFocused('#param-c_oran', params.c_oran);
    setIfNotFocused('#param-c_sabit', params.c_sabit);
    setIfNotFocused('#param-v_devlet', params.v_devlet);
}

/* Tek adet ürünün ham maliyeti (fire dahil, kargo ve kâr hariç). Satış fiyatı ve Finans & Vergi
   kâr analizi aynı formülü kullansın diye ortak fonksiyon. */
function hesaplaHamMaliyet({
    t,                 // Baskı süresi (saat)
    G_saat = 35,       // Saatlik filament tüketimi (gram/saat)
    t_hazirlik = 10,   // İlk hazırlık süresi (dakika, filament harcanmayan süre)
    F_kg = 500,        // Filament kg fiyatı (TL) - PETG için 700
    P_makine = 0.15,   // Güç tüketimi (kW) - ~150W
    E_kwh = 3.24,      // Elektrik kWh fiyatı (TL)
    A_saat = 8.0,      // Saatlik amortisman (TL)
    M_ambalaj = 15.0,  // Ambalaj maliyeti (TL)
    r_fire = 0.10      // Fire oranı (%10)
}) {
    // 0. İlk hazırlık süresi (dakika -> saat) düşülerek harcanan filament gramajı (w)
    const netFilamentSuresi = Math.max(0, t - (t_hazirlik / 60));
    const w = netFilamentSuresi * G_saat;

    // 1. Birim maliyetler
    const malzemeMaliyeti = w * (F_kg / 1000);
    const makineMaliyeti = t * (P_makine * E_kwh + A_saat);

    // 2. Ham maliyet (fire dahil)
    return (malzemeMaliyeti + makineMaliyeti + M_ambalaj) * (1 + r_fire);
}

function hesaplaSatisFiyati({
    t,                 // Baskı süresi (saat)
    G_saat = 35,
    t_hazirlik = 10,
    F_kg = 500,
    P_makine = 0.15,
    E_kwh = 3.24,
    A_saat = 8.0,
    M_ambalaj = 15.0,
    K_kargo = 108,     // Kargo maliyeti (TL) - müşteriye ücretsiz
    r_fire = 0.10,
    k_kar = 1.8,       // Kâr çarpanı
    c_oran = 0.0449,   // iyzico komisyon oranı (%4.49)
    c_sabit = 0.25,    // iyzico sabit işlem ücreti (TL)
    v_devlet = 0.04    // Devlet vergi oranı (%4 - iyzico'nun yatırdığı tutar üzerinden kesilir)
}) {
    // 1. Ham maliyet (fire dahil)
    const hamMaliyet = hesaplaHamMaliyet({ t, G_saat, t_hazirlik, F_kg, P_makine, E_kwh, A_saat, M_ambalaj, r_fire });

    // 2. Kâr eklenmiş net hedef tutar (devlet vergisi ve iyzico kesintisi sonrası elde kalması gereken)
    //    Kargo da toplam operasyonel maliyete dahil edilerek kâr çarpanı ile çarpılır
    const hedefTutar = (hamMaliyet + K_kargo) * k_kar;

    // 3. Devlet %4 vergiyi iyzico'nun bankaya yatırdığı tutar üzerinden kestiği için iyzico'dan yatması gereken tutar:
    const iyzicoYatmasiGereken = hedefTutar / (1 - v_devlet);

    // 4. iyzico komisyonunu da kompanse eden nihai satış fiyatı:
    const satisFiyati = (iyzicoYatmasiGereken + c_sabit) / (1 - c_oran);

    return Number(satisFiyati.toFixed(2));
}

/* Fiyatın son hanesini her zaman 9 yapar (ör. 360 -> 359, 440 -> 439).
   En yakın 10'a yuvarlanır, sonra 1 çıkarılır. */
function roundPriceToNine(price) {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.max(9, Math.round(n / 10) * 10 - 1);
}

/* İndirim çarpanı (≥1; 1 = indirim yok). Çarpan, 9'a yuvarlanmadan önceki ham fiyata uygulanır;
   eski (üstü çizili) fiyat da son hanesi 9 olacak şekilde yuvarlanır. Yeni fiyattan büyük değilse 0 (gösterilmez). */
function readDiscountMultiplier(v) {
    const n = Number(String(v ?? '').replace(',', '.'));
    return (Number.isFinite(n) && n > 1) ? Math.min(10, Math.round(n * 100) / 100) : 1;
}
function oldPriceFor(raw, price, discountMultiplier) {
    if (!(discountMultiplier > 1)) return 0;
    const old = roundPriceToNine(raw * discountMultiplier);
    return old > price ? old : 0;
}

/* Fiyatlandırma parametreleri değiştiğinde (ve ilk açılışta) ürün fiyatlarını yeniden hesaplar
   ve Finans & Vergi kâr analizini günceller. */
function updatePricingUI() {
    recomputeProductPrices();
    renderFinance();
}

/* Ürün listesindeki her satırın fiyatını, girilen üretim süresi ve güncel parametrelerle yeniden hesaplar. */
function recomputeProductPrices() {
    const params = readPricingInputs();
    $('#products-admin-list .product-admin-row').each(function() {
        const $row = $(this);
        const hours = Number(String($row.find('.product-hours-input').val() ?? '').replace(',', '.'));
        const multiplierRaw = Number(String($row.find('.product-multiplier-input').val() ?? '').replace(',', '.'));
        const multiplier = (Number.isFinite(multiplierRaw) && multiplierRaw > 0) ? multiplierRaw : 1;
        const $value = $row.find('.product-price-value');
        const $raw = $row.find('.product-price-raw');
        if (Number.isFinite(hours) && hours > 0) {
            const raw = hesaplaSatisFiyati({ ...params, t: hours }) * multiplier;
            const price = roundPriceToNine(raw);
            // Tek adetlik siparişin kârı: finans sekmesiyle aynı kesintiler (kartlı ödeme varsayımı)
            const ham = hesaplaHamMaliyet({ ...params, t: hours });
            const iyzicoCut = Math.max(0, price - Math.max(0, price * (1 - params.c_oran) - params.c_sabit));
            const stateTax = (price - iyzicoCut) * params.v_devlet;
            const brut = price - ham;
            const net = price - (ham + params.K_kargo + iyzicoCut + stateTax);
            const oldPrice = oldPriceFor(raw, price, readDiscountMultiplier($row.find('.product-discount-input').val()));
            $value.html(esc(formatTL(price)) + (oldPrice ? ` <s class="old-price">${formatTL(oldPrice)}</s>` : '')).data('price', price);
            $raw.html(`<span>Ham Maliyet: ${formatTL(ham)}</span>`
                + `<span class="${brut < 0 ? 'neg' : 'pos'}">Brüt Kâr: ${formatTL(brut)}</span>`
                + `<span class="${net < 0 ? 'neg' : 'pos'}">Net Kâr: ${formatTL(net)}</span>`);
        } else {
            $value.text('—').data('price', null);
            $raw.text('Üretim süresi girin');
        }
    });
}

/* Siparişin mevcut durumuna (current state) göre kazanca/ciroya dahil edilip edilmeyeceği:
   İptal edilmiş ('iptal', 'cancel') veya henüz ödemesi beklenen ('ödeme bekliyor', 'pending_payment', 'payment_review')
   siparişler hariç tüm mevcut siparişler doğrudan toplanır. */
function isEligibleFinanceOrder(order) {
    if (!order || typeof order !== 'object') return false;
    const s = String(order.status || '').toLocaleLowerCase('tr').trim();
    if (s.includes('iptal') || s.includes('cancel')) return false;
    if (s.includes('ödeme bekliyor') || s.includes('pending_payment') || s.includes('pending payment') || s.includes('payment_review')) return false;
    return true;
}

function getOrderTimestampMs(order) {
    if (!order) return null;
    const raw = order.createdAt || order.serverTimestamp || order.paidAt || order.timestamp || order.date;
    if (!raw) return null;
    const d = (typeof raw === 'object' && raw._seconds)
        ? new Date(raw._seconds * 1000)
        : new Date(raw);
    const ms = d.getTime();
    return isNaN(ms) ? null : ms;
}

/* Siparişteki ürünlerin gerçek ham maliyeti: her kalem için üretim süresinden (saat) hesaplanır
   (fiyat formülündeki hamMaliyet) ve adetle çarpılır. Satış fiyatından TERSİNE hesaplanmaz:
   indirimli / düşük tutarlı / ücretsiz siparişte ham maliyet gerçekte neyse o görünür, zarar gizlenmez.
   Üretim süresi sırasıyla: siparişte kayıtlı süre (item.productionHours) > kalemin sipariş anındaki
   fiyatından geri hesap (hoursForPrice) > ürünün güncel üretim süresi (config/products). */
function calculateOrderBaseCost(order, p) {
    if (!order || !order.items) return 0;
    const items = (Array.isArray(order.items) ? order.items : Object.values(order.items)).filter(Boolean);
    return items.reduce((sum, item) => {
        const qty = Math.max(1, Number(item.quantity) || 1);
        let hours = Number(item.productionHours);
        if (!(hours > 0)) {
            const price = Number(item.price);
            if (price > 0) hours = hoursForPrice(price, p);
        }
        if (!(hours > 0)) {
            const o = productOverrides[item.productId];
            hours = o ? Number(o.productionHours) : 0;
        }
        if (!(hours > 0)) return sum;
        return sum + hesaplaHamMaliyet({ ...p, t: hours }) * qty;
    }, 0);
}

/* Sipariş kârı:
   - Ürün ham maliyeti: calculateOrderBaseCost (gerçek üretim süresinden, fire dahil)
   - Kargo: K_kargo (sipariş başı, satıcı öder)
   - iyzico kesintisi: S * c_oran + c_sabit (havalede yok)
   - Devlet vergisi: iyzico'nun yatırdığı tutarın v_devlet'i (S ücretsizse 0)
   - Brüt Ürün Kârı = S - ham maliyet; Net Sipariş Kârı = S - (ham maliyet + kargo + iyzico + vergi)
   Ücretsiz (0 TL) siparişte gelir 0'dır ama ham maliyet ve kargo yine gider yazılır. */
function calculateOrderFinancials(order, pricingParams) {
    const p = pricingParams || readPricingInputs();
    // Kısmi iade (refundedAmount): gelir iade kadar azalır; iyzico komisyonu iadede geri gelmez, ham maliyet de yapılmıştır
    const origSale = getOrderGrossSale(order);
    const refunded = Math.min(origSale, Math.max(0, Number(order.refundedAmount) || 0));
    const grossSale = origSale - refunded;
    const baseCost = calculateOrderBaseCost(order, p);
    if (origSale <= 0 && baseCost <= 0) {
        return {
            grossSale: 0,
            iyzicoYatan: 0,
            iyzicoCut: 0,
            stateTax: 0,
            netAfterTax: 0,
            baseCost: 0,
            shipCost: 0,
            totalCost: 0,
            grossProductProfit: 0,
            orderProfit: 0
        };
    }
    // Havale (IBAN) doğrudan hesaba geçer: iyzico komisyonu yok
    const viaIyzico = order.paymentMethod !== 'iban' && origSale > 0;
    const iyzicoPayout = viaIyzico ? Math.max(0, origSale * (1 - p.c_oran) - p.c_sabit) : origSale;
    const iyzicoCut = Math.max(0, origSale - iyzicoPayout);
    const iyzicoYatan = Math.max(0, iyzicoPayout - refunded);
    const stateTax = iyzicoYatan * p.v_devlet;
    const netAfterTax = Math.max(0, iyzicoYatan - stateTax);
    // ponytail: sipariş başı tek koli varsayımı; çok kolili siparişte K_kargo × koli gerekir
    const shipCost = p.K_kargo || 0;
    const totalCost = baseCost + shipCost + iyzicoCut + stateTax;
    const grossProductProfit = grossSale - baseCost; // Satış Fiyatı - Ürün Ham Maliyeti
    const orderProfit = grossSale - totalCost;       // Satış Fiyatı - (Ham Maliyet + Kargo + iyzico + %4 Vergi)

    return {
        grossSale,
        iyzicoYatan,
        iyzicoCut,
        stateTax,
        netAfterTax,
        baseCost,
        shipCost,
        totalCost,
        grossProductProfit,
        orderProfit
    };
}

function renderFinance() {
    const ordersObj = (globalAdminData && globalAdminData.orders) || {};
    const expensesObj = (globalAdminData && globalAdminData.finance && globalAdminData.finance.expenses) || {};
    const pricingParams = readPricingInputs();

    const ist = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); // YYYY-MM-DD

    // Sunucu zamanını baz al; eğer bilgisayar saati ileri/geri olduğu için sipariş tarihleri
    // son 30 gün penceresinin dışında kalıyorsa en güncel sipariş tarihini referans al
    let refNowMs = Date.now() + serverTimeOffset;
    let latestOrderTs = 0;
    Object.values(ordersObj).forEach(order => {
        if (!isEligibleFinanceOrder(order)) return;
        const ts = getOrderTimestampMs(order);
        if (ts && ts > latestOrderTs) latestOrderTs = ts;
    });
    if (latestOrderTs > 0 && Math.abs(refNowMs - latestOrderTs) > 25 * 864e5) {
        refNowMs = latestOrderTs;
    }

    const days = [...Array(30)].map((_, i) => ist(new Date(refNowMs - (29 - i) * 864e5)));
    const refDate = new Date(refNowMs);
    const months = [...Array(12)].map((_, i) => ist(new Date(refDate.getFullYear(), refDate.getMonth() - 11 + i, 15)).slice(0, 7));
    const todayKey = days[29];
    const thisMonthKey = months[11];

    let totalRevenue = 0;
    let totalBaseCost = 0;
    let totalShipCost = 0;
    let totalIyzicoCut = 0;
    let totalStateTax = 0;
    let totalGrossProductProfit = 0;
    let totalOrderProfit = 0;
    let activeOrderCount = 0;

    const yearRevenueMap = {};
    const yearCountMap = {};
    const dailyRevenueMap = {};
    const monthlyRevenueMap = {};
    const dailyOrderProfitMap = {};
    const monthlyOrderProfitMap = {};
    const dailyGrossProfitMap = {};
    const monthlyGrossProfitMap = {};

    Object.values(ordersObj).forEach(order => {
        if (!isEligibleFinanceOrder(order)) return; // İptal edilmiş veya ödeme bekleyen siparişler dahil edilmez
        // Sipariş anındaki parametreler (finParams) varsa onlar; eski siparişlerde güncel ayarlar
        const fin = calculateOrderFinancials(order, order.finParams ? { ...pricingParams, ...order.finParams } : pricingParams);
        if (fin.grossSale <= 0 && fin.totalCost <= 0) return;

        activeOrderCount++;
        totalRevenue += fin.grossSale;
        totalBaseCost += fin.baseCost;
        totalShipCost += fin.shipCost;
        totalIyzicoCut += fin.iyzicoCut;
        totalStateTax += fin.stateTax;
        totalGrossProductProfit += fin.grossProductProfit;
        totalOrderProfit += fin.orderProfit;

        const ts = getOrderTimestampMs(order);
        const dayKey = ts ? ist(new Date(ts)) : todayKey;
        const monthKey = dayKey.slice(0, 7);
        const yearKey = dayKey.slice(0, 4);
        yearRevenueMap[yearKey] = (yearRevenueMap[yearKey] || 0) + fin.grossSale;
        yearCountMap[yearKey] = (yearCountMap[yearKey] || 0) + 1;

        dailyRevenueMap[dayKey] = (dailyRevenueMap[dayKey] || 0) + fin.grossSale;
        monthlyRevenueMap[monthKey] = (monthlyRevenueMap[monthKey] || 0) + fin.grossSale;
        dailyOrderProfitMap[dayKey] = (dailyOrderProfitMap[dayKey] || 0) + fin.orderProfit;
        monthlyOrderProfitMap[monthKey] = (monthlyOrderProfitMap[monthKey] || 0) + fin.orderProfit;
        dailyGrossProfitMap[dayKey] = (dailyGrossProfitMap[dayKey] || 0) + fin.grossProductProfit;
        monthlyGrossProfitMap[monthKey] = (monthlyGrossProfitMap[monthKey] || 0) + fin.grossProductProfit;
    });

    // Giderleri işle (ÖNEMLİ: Giderler vergi muafiyeti ciro limitini DÜŞÜRMEZ, yalnızca Net Kâr'dan düşülür)
    const normalizeExpenseDate = (rawDate, rawCreatedAt) => {
        if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawDate.trim())) {
            return rawDate.trim().slice(0, 10);
        }
        if (typeof rawDate === 'number' && Number.isFinite(rawDate) && rawDate > 100000) {
            const d = new Date(rawDate > 1e11 ? rawDate : rawDate * 1000);
            if (!isNaN(d.getTime())) return ist(d);
        }
        if (typeof rawDate === 'string' && rawDate.trim()) {
            const parsed = new Date(rawDate.trim());
            if (!isNaN(parsed.getTime())) return ist(parsed);
        }
        if (rawCreatedAt) {
            const c = new Date(Number(rawCreatedAt));
            if (!isNaN(c.getTime())) return ist(c);
        }
        return todayKey;
    };

    const expenseEntries = Object.entries(expensesObj)
        .filter(([, val]) => val !== null && val !== undefined)
        .map(([key, val]) => {
            const isObj = typeof val === 'object';
            const rawAmt = isObj ? (val.amount ?? val.price ?? val.cost ?? val.total ?? 0) : val;
            return {
                id: (isObj && val.id) ? String(val.id) : String(key),
                title: isObj ? String(val.title || val.name || val.description || val.desc || 'Gider') : String(key),
                category: isObj ? String(val.category || val.type || 'Diğer') : 'Diğer',
                amount: Math.max(0, parseFloat(rawAmt) || 0),
                date: String(normalizeExpenseDate(isObj ? val.date : null, isObj ? val.createdAt : null)),
                createdAt: isObj ? (Number(val.createdAt) || 0) : 0
            };
        })
        .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt - a.createdAt));

    let totalExpenses = 0;
    const dailyExpenseMap = {};
    const monthlyExpenseMap = {};

    expenseEntries.forEach(exp => {
        totalExpenses += exp.amount;
        const dateStr = String(exp.date || todayKey);
        const dKey = dateStr.slice(0, 10);
        const mKey = dateStr.slice(0, 7);
        dailyExpenseMap[dKey] = (dailyExpenseMap[dKey] || 0) + exp.amount;
        monthlyExpenseMap[mKey] = (monthlyExpenseMap[mKey] || 0) + exp.amount;
    });

    const netProfit = totalOrderProfit - totalExpenses;
    const totalFormulaCosts = totalBaseCost + totalShipCost + totalIyzicoCut + totalStateTax;

    // 1. Vergi Muafiyet Ciro Limiti — takvim yılı bazında (Türkiye saati), Giderlerden BAĞIMSIZ, brüt ciro üzerinden.
    // Limit yıl başına panelden değişir (admin/finance/tax_limits/<yıl>); yoksa TAX_EXEMPTION_LIMIT.
    const curYear = todayKey.slice(0, 4);
    const taxYears = [...new Set([...Object.keys(yearRevenueMap), curYear])].sort().reverse();
    if (!taxYearSel || !taxYears.includes(taxYearSel)) taxYearSel = curYear;
    const taxYear = taxYearSel;
    const taxLimits = (globalAdminData && globalAdminData.finance && globalAdminData.finance.tax_limits) || {};
    const taxLimit = Number(taxLimits[taxYear]) > 0 ? Number(taxLimits[taxYear]) : TAX_EXEMPTION_LIMIT;
    const taxRevenue = yearRevenueMap[taxYear] || 0;
    const taxOrderCount = yearCountMap[taxYear] || 0;
    const remainingLimit = Math.max(0, taxLimit - taxRevenue);
    const limitPercent = (taxRevenue / taxLimit) * 100;

    const $taxYearSel = $('#tax-year-select');
    if ($taxYearSel.find('option').map((_, o) => o.value).get().join() !== taxYears.join()) {
        $taxYearSel.html(taxYears.map(y => `<option value="${y}">${y}</option>`).join(''));
    }
    $taxYearSel.val(taxYear);
    $('#tax-year-label').text(taxYear);
    $('#tax-current').text(`${taxYear} Cirosu: ${formatTL(taxRevenue)} (${taxOrderCount} aktif sipariş)`);
    $('#tax-remaining').text(`Kalan Hak: ${formatTL(remainingLimit)}`);
    $('#tax-limit').text(`Limit: ${formatTL(taxLimit)}`);
    $('#tax-bar').css('width', `${Math.min(100, Math.max(0, limitPercent))}%`);

    const $taxDesc = $('#tax-desc');
    const $taxBadge = $('#tax-badge');
    $taxDesc.removeClass('warn danger');

    if (taxRevenue >= taxLimit) {
        $taxDesc.addClass('danger').html(`<i class="fa-solid fa-triangle-exclamation"></i> Vergi muafiyeti ciro limiti (${formatTL(taxLimit)}) aşıldı! (%${limitPercent.toFixed(2)})`);
        $taxBadge.text('Limit Aşıldı').attr('class', 'badge badge-danger');
    } else if (limitPercent >= 80) {
        $taxDesc.addClass('warn').html(`<i class="fa-solid fa-circle-exclamation"></i> Muafiyet limitinin %${limitPercent.toFixed(2)}'i doldu. Kalan ciro hakkınız: ${formatTL(remainingLimit)}`);
        $taxBadge.text('Limite Yaklaşıyor').attr('class', 'badge badge-warning');
    } else {
        $taxDesc.html(`<i class="fa-solid fa-check-circle"></i> Muafiyet Kapsamındasınız (%${limitPercent.toFixed(2)} Doldu · Giderler bu limiti düşürmez)`);
        $taxBadge.text('Muafiyet Aktif').attr('class', 'badge badge-success');
    }

    // 2. Panel Özeti (Dashboard) Gelir & Kâr Özeti kartını gerçek sipariş verisiyle senkronize et
    const todayRevenue = dailyRevenueMap[todayKey] || 0;
    const monthRevenue = monthlyRevenueMap[thisMonthKey] || 0;
    $('#rev-total').text(formatTL(totalRevenue));
    $('#rev-profit').text(formatTL(netProfit));
    $('#rev-daily').text(formatTL(todayRevenue));
    $('#rev-monthly').text(formatTL(monthRevenue));
    $('#rev-active-count').text(`${activeOrderCount} Aktif Sipariş`);

    // 3. Finans KPI Kartları
    const monthOrderProfit = monthlyOrderProfitMap[thisMonthKey] || 0;

    $('#fin-total-revenue').text(formatTL(totalRevenue));
    $('#fin-revenue-sub').text(`${activeOrderCount} Sipariş · Bu Ay: ${formatTL(monthRevenue)} · Son Gün: ${formatTL(todayRevenue)}`);

    $('#fin-total-costs').text(formatTL(totalFormulaCosts));
    $('#fin-costs-sub').text(`Ürün Ham Maliyet: ${formatTL(totalBaseCost)} · Kargo: ${formatTL(totalShipCost)} · iyzico: ${formatTL(totalIyzicoCut)} · %${(pricingParams.v_devlet * 100).toFixed(0)} Vergi: ${formatTL(totalStateTax)}`);

    $('#fin-order-profit').text(formatTL(totalOrderProfit));
    $('#fin-order-profit-sub').text(`Satış - Ham Maliyet: ${formatTL(totalGrossProductProfit)} · Bu Ay Net: ${formatTL(monthOrderProfit)}`);

    $('#fin-net-profit')
        .text(formatTL(netProfit))
        .toggleClass('negative', netProfit < 0);
    $('#fin-net-profit-sub').text(`Ekstra Giderler: -${formatTL(totalExpenses)} (${expenseEntries.length} kayıt)`);

    // 4. Günlük & Aylık Kâr Grafikleri
    const chartMode = $('#profit-chart-mode').val() || 'order';
    const dailyChartData = {};
    const monthlyChartData = {};

    days.forEach(k => {
        const ordP = dailyOrderProfitMap[k] || 0;
        const grossP = dailyGrossProfitMap[k] || 0;
        const exp = dailyExpenseMap[k] || 0;
        dailyChartData[k] = chartMode === 'gross' ? grossP : (chartMode === 'net' ? (ordP - exp) : ordP);
    });
    months.forEach(k => {
        const ordP = monthlyOrderProfitMap[k] || 0;
        const grossP = monthlyGrossProfitMap[k] || 0;
        const exp = monthlyExpenseMap[k] || 0;
        monthlyChartData[k] = chartMode === 'gross' ? grossP : (chartMode === 'net' ? (ordP - exp) : ordP);
    });

    const renderProfitBars = (keys, dataMap) => {
        const maxAbs = Math.max(1, ...keys.map(k => Math.abs(dataMap[k] || 0)));
        const yAxis = `<i style="bottom:100%">${formatShortTL(maxAbs)}</i><i style="bottom:50%">${formatShortTL(maxAbs / 2)}</i><i style="bottom:0">₺0</i>`;
        return yAxis + keys.map(k => {
            const val = dataMap[k] || 0;
            const heightPct = val === 0 ? 2 : Math.max(4, Math.round((Math.abs(val) / maxAbs) * 100));
            const cls = val < 0 ? 'negative' : (val === 0 ? 'zero' : '');
            const labelAttr = Math.abs(val) >= 1 ? ` data-n="${esc(formatShortTL(val))}"` : '';
            return `<div class="${cls}" style="height:${heightPct}%" title="${k}: ${formatTL(val)}"${labelAttr}></div>`;
        }).join('');
    };

    const axis = (keys, fmt, every) => keys.map((k, i) => `<span>${(keys.length - 1 - i) % every === 0 ? fmt(k) : ''}</span>`).join('');

    $('#profit-daily-bars').html(renderProfitBars(days, dailyChartData));
    $('#profit-monthly-bars').html(renderProfitBars(months, monthlyChartData));
    $('#profit-daily-axis').html(axis(days, k => `${k.slice(8)}.${k.slice(5, 7)}`, 7));
    $('#profit-monthly-axis').html(axis(months, k => new Date(`${k}-15`).toLocaleDateString('tr-TR', { month: 'short' }), 1));

    $('#profit-today').text(formatTL(dailyChartData[todayKey] || 0));
    $('#profit-month').text(formatTL(monthlyChartData[thisMonthKey] || 0));

    // 5. Gider Listesi
    $('#expense-total-badge').text(`Toplam: -${formatTL(totalExpenses)}`);
    const $expenseList = $('#expense-list');
    $expenseList.empty();

    if (expenseEntries.length === 0) {
        $expenseList.append(`<li class="expense-empty"><i class="fa-solid fa-receipt" style="margin-right: 6px;"></i> Henüz kayıtlı gider bulunmuyor. "+ Gider Ekle" butonuyla işletme giderlerinizi ekleyebilirsiniz.</li>`);
    } else {
        expenseEntries.forEach(exp => {
            const formattedDate = (() => {
                const d = new Date(`${exp.date}T12:00:00`);
                return isNaN(d.getTime()) ? exp.date : d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
            })();
            $expenseList.append(`
                <li>
                    <div class="expense-info">
                        <strong>${esc(exp.title)}</strong>
                        <div class="expense-meta">
                            <span class="badge badge-muted">${esc(exp.category)}</span>
                            <span><i class="fa-regular fa-calendar"></i> ${esc(formattedDate)}</span>
                        </div>
                    </div>
                    <div class="expense-right">
                        <span class="expense-amount">-${formatTL(exp.amount)}</span>
                        <button type="button" class="btn-icon-sm danger btn-delete-expense" data-id="${esc(exp.id)}" title="Gideri Sil">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </li>
            `);
        });
    }
    renderGiderPusulasi();
}

/* --- Gider Pusulası (Finans) ---
   Faturayı biz kesemiyoruz (gelir vergisinden muaf esnaf): alıcı şirket/esnafsa gider pusulası burada hazırlanır, yazdırılıp imzalatılır.
   Kayıt admin/finance/gider_pusulalari/<id>; numara yıl bazlı sayaçtan (admin/finance/gp_sayac/<yıl>) transaction'la alınır. */
const gpRound = (n) => Math.round((Number(n) || 0) * 100) / 100;
const GP_SELLER = { name: 'Kaya Sertel (Esnaf)', taxOffice: 'Halkalı', taxNo: '7630841323', address: 'Atakent Mah. Bosphorus City 52B Blok, Daire 5, Küçükçekmece / İstanbul' };
const gpRecords = () => Object.values((globalAdminData && globalAdminData.finance && globalAdminData.finance.gider_pusulalari) || {}).filter((r) => r && typeof r === 'object');
const orderItemsArr = (o) => (Array.isArray(o.items) ? o.items : Object.values(o.items || {})).filter(Boolean);

function gpLinesFromOrder(o) {
    const lines = orderItemsArr(o).map((it) => {
        const qty = Number(it.quantity) || 1, unit = gpRound(parseFloat(it.price) || 0);
        return { desc: String(it.name || 'Ürün').slice(0, 120), qty, unit, total: gpRound(unit * qty) };
    });
    const ship = gpRound(o.shippingCost), disc = gpRound(o.discountAmount);
    if (ship > 0) lines.push({ desc: 'Öncelikli üretim / kargo', qty: 1, unit: ship, total: ship });
    if (disc > 0) lines.push({ desc: 'İndirim', qty: 1, unit: -disc, total: -disc });
    return lines;
}

function renderGiderPusulasi() {
    const $sel = $('#gp-order');
    if (!$sel.length) return;
    const orders = (globalAdminData && globalAdminData.orders) || {};
    const used = new Set(gpRecords().filter((r) => !r.cancelled && r.orderId).map((r) => String(r.orderId)));
    const opts = Object.entries(orders).filter(([, o]) => isEligibleFinanceOrder(o))
        .sort((a, b) => (getOrderTimestampMs(b[1]) || 0) - (getOrderTimestampMs(a[1]) || 0)).slice(0, 80)
        .map(([id, o]) => {
            const ship = o.shippingInfo || {};
            const name = ship.fullname || [ship.name, ship.surname].filter(Boolean).join(' ').trim() || o.customerName || '';
            return `<option value="${esc(id)}">#${esc(id)} · ${esc(name)} · ${esc(formatTL(o.totalAmount))}${used.has(String(id)) ? ' · pusula var' : ''}</option>`;
        });
    const cur = $sel.val();
    $sel.html(`<option value="">Elle gir (siparişsiz)</option>${opts.join('')}`);
    if (cur && $sel.find(`option[value="${CSS.escape(cur)}"]`).length) $sel.val(cur);
    $('#gp-manual').prop('hidden', !!$sel.val());

    const recs = gpRecords().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    $('#gp-list').html(recs.length ? recs.map((r) => `
        <li class="${r.cancelled ? 'cancelled' : ''}">
            <div class="gp-info"><strong>${esc(r.no)}</strong><span>${esc((r.buyer || {}).name)} · ${esc(r.date)}${r.orderId ? ' · sipariş #' + esc(r.orderId) : ''}${r.cancelled ? ' · İPTAL' : ''}</span></div>
            <div class="gp-right"><strong>${esc(formatTL(r.total))}</strong>
                <button type="button" class="btn-sm secondary gp-view" data-id="${esc(r.id)}"><i class="fa-solid fa-eye"></i> Görüntüle</button>
                ${r.cancelled ? '' : `<button type="button" class="btn-icon-sm danger gp-cancel" data-id="${esc(r.id)}" title="İptal et"><i class="fa-solid fa-ban"></i></button>`}
            </div></li>`).join('') : '<li class="gp-empty">Henüz gider pusulası yok.</li>');
}

function gpDocHtml(r) {
    const b = r.buyer || {};
    const dateTr = (() => { const d = new Date(`${r.date}T12:00:00`); return isNaN(d) ? r.date : d.toLocaleDateString('tr-TR'); })();
    const party = (title, p) => `<div class="gp-party"><h4>${title}</h4><strong>${esc(p.name)}</strong><br>${esc(p.address || '')}<br>Vergi Dairesi: ${esc(p.taxOffice || '-')}<br>Vergi / TC Kimlik No: ${esc(p.taxNo || '-')}</div>`;
    return `<div class="gp-doc">${r.cancelled ? '<div class="gp-cancel">İPTAL</div>' : ''}
        <h2>GİDER PUSULASI</h2>
        <div class="gp-meta"><span>Belge No: <strong>${esc(r.no)}</strong></span><span>Tarih: <strong>${esc(dateTr)}</strong></span>${r.orderId ? `<span>Sipariş: <strong>#${esc(r.orderId)}</strong></span>` : ''}</div>
        <div class="gp-parties">${party('Malı / hizmeti satın alan (düzenleyen)', b)}${party('Malı / hizmeti satan', GP_SELLER)}</div>
        <table><thead><tr><th>Mal / hizmet cinsi</th><th class="num">Miktar</th><th class="num">Birim fiyat</th><th class="num">Tutar</th></tr></thead><tbody>
        ${(r.lines || []).map((l) => `<tr><td>${esc(l.desc)}</td><td class="num">${esc(l.qty)}</td><td class="num">${esc(formatTL(l.unit))}</td><td class="num">${esc(formatTL(l.total))}</td></tr>`).join('')}
        <tr class="gp-total"><td colspan="3" class="num">Genel Toplam</td><td class="num">${esc(formatTL(r.total))}</td></tr></tbody></table>
        <div class="gp-note">Satıcı gelir vergisinden muaf esnaftır; bu belgede KDV ve stopaj hesaplanmamıştır.</div>
        <div class="gp-sign"><div>Satıcı (teslim eden) - imza</div><div>Alıcı (düzenleyen) - kaşe / imza</div></div></div>`;
}

function openGpModal(r) {
    $('#gp-print-body').html(gpDocHtml(r));
    $('#gp-print-modal').addClass('open');
}

$(document).on('change', '#gp-order', () => $('#gp-manual').prop('hidden', !!$('#gp-order').val()));
$(document).on('click', '#close-gp-modal', () => $('#gp-print-modal').removeClass('open'));
$(document).on('click', '#gp-print-btn', () => {
    document.body.classList.add('printing-gp');
    window.addEventListener('afterprint', () => document.body.classList.remove('printing-gp'), { once: true });
    window.print();
});
$(document).on('click', '.gp-view', function () {
    const r = gpRecords().find((x) => x.id === String($(this).data('id')));
    if (r) openGpModal(r);
});
$(document).on('click', '.gp-cancel', async function () {
    const r = gpRecords().find((x) => x.id === String($(this).data('id')));
    if (!r || !auth.currentUser) return;
    const ok = await askAdminConfirm({
        eyebrow: 'GİDER PUSULASI İPTALİ', title: `${r.no} iptal edilsin mi?`,
        desc: 'Belge listede "İPTAL" damgasıyla kalır, numarası başka belgeye verilmez. Alıcıya verdiyseniz geri isteyin.',
        confirmText: 'Evet, İptal Et', cancelText: 'Vazgeç', variant: 'danger', icon: 'fa-ban', iconTone: 'rose'
    });
    if (!ok) return;
    try {
        await update(ref(db, `admin/finance/gider_pusulalari/${r.id}`), { cancelled: true });
        auditLog('gider_pusulasi', r.no, 'iptal edildi');
        showToast('Gider pusulası iptal edildi.', 'success');
    } catch (e) { showToast('İptal edilemedi: ' + e.message, 'error'); }
});
$(document).on('click', '#gp-create', async function () {
    if (!auth.currentUser) { $('#login-modal').addClass('open'); showToast('İşlem için yönetici girişi yapın.', 'error'); return; }
    const val = (id) => String($(id).val() || '').trim();
    const buyer = { name: val('#gp-buyer-name'), taxNo: val('#gp-buyer-taxno').replace(/\s/g, ''), taxOffice: val('#gp-buyer-office'), address: val('#gp-buyer-address') };
    if (!buyer.name || !buyer.taxNo || !buyer.taxOffice || !buyer.address) { showToast('Alıcının unvan, vergi no, vergi dairesi ve adresini girin.', 'error'); return; }
    if (!/^\d{10,11}$/.test(buyer.taxNo)) { showToast('Vergi / TC kimlik no 10 veya 11 haneli olmalı.', 'error'); return; }
    const orderId = val('#gp-order');
    let lines;
    if (orderId) {
        const o = globalAdminData && globalAdminData.orders && globalAdminData.orders[orderId];
        if (!o) { showToast('Sipariş bulunamadı.', 'error'); return; }
        lines = gpLinesFromOrder(o);
        if (!lines.length) { showToast('Siparişte kalem yok.', 'error'); return; }
    } else {
        const amt = gpRound(parseFloat(String(val('#gp-amount')).replace(',', '.')));
        if (!val('#gp-desc') || !(amt > 0)) { showToast('Açıklama ve geçerli bir tutar girin.', 'error'); return; }
        lines = [{ desc: val('#gp-desc'), qty: 1, unit: amt, total: amt }];
    }
    const total = gpRound(lines.reduce((t, l) => t + l.total, 0));
    if (!(total > 0)) { showToast('Toplam tutar sıfırdan büyük olmalı.', 'error'); return; }
    const dup = orderId && gpRecords().find((r) => !r.cancelled && String(r.orderId) === orderId);
    const ok = await askAdminConfirm({
        eyebrow: 'GİDER PUSULASI',
        title: `${buyer.name} için ${formatTL(total)} tutarında gider pusulası oluşturulsun mu?`,
        desc: (dup ? `Bu sipariş için ${dup.no} numaralı belge zaten var. ` : '') + 'Belge numarası sırayla verilir ve oluşturulduktan sonra değiştirilemez; hata olursa iptal edip yenisini düzenlersiniz.',
        confirmText: 'Oluştur', cancelText: 'Vazgeç', icon: 'fa-file-invoice', iconTone: 'amber'
    });
    if (!ok) return;
    const $btn = $(this);
    const html = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Oluşturuluyor...');
    try {
        const year = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }).slice(0, 4);
        const tx = await runTransaction(ref(db, `admin/finance/gp_sayac/${year}`), (n) => (Number(n) || 0) + 1);
        if (!tx.committed) throw new Error('Numara alınamadı.');
        const no = `GP-${year}-${String(tx.snapshot.val()).padStart(4, '0')}`;
        const rec = { id: no, no, date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }), createdAt: Date.now(), buyer, lines, total, ...(orderId ? { orderId } : {}) };
        await set(ref(db, `admin/finance/gider_pusulalari/${no}`), rec);
        if (!globalAdminData.finance) globalAdminData.finance = {};
        if (!globalAdminData.finance.gider_pusulalari) globalAdminData.finance.gider_pusulalari = {};
        globalAdminData.finance.gider_pusulalari[no] = rec;
        auditLog('gider_pusulasi', no, `${buyer.name} · ${formatTL(total)}${orderId ? ' · #' + orderId : ''}`);
        renderGiderPusulasi();
        openGpModal(rec);
        showToast(`${no} oluşturuldu.`, 'success');
    } catch (e) {
        console.error('Gider pusulası hatası:', e);
        showToast('Oluşturulamadı: ' + e.message, 'error');
    } finally { $btn.prop('disabled', false).html(html); }
});

/* Elegant genel onay pop-up penceresi (#admin-confirm-modal) */
function askAdminConfirm({
    eyebrow = 'İŞLEM ONAYI',
    title = 'İşlemi Onaylıyor musunuz?',
    desc = '',
    confirmText = 'Onayla',
    cancelText = 'Vazgeç',
    variant = 'primary',
    icon = 'fa-circle-question',
    iconTone = 'amber'
} = {}) {
    return new Promise((resolve) => {
        const $modal = $('#admin-confirm-modal');
        if (!$modal.length) {
            resolve(false);
            return;
        }

        $('#admin-confirm-eyebrow').text(eyebrow);
        $('#admin-confirm-title').text(title);
        $('#admin-confirm-desc').text(desc);
        $('#cancel-admin-confirm').text(cancelText);
        $('#accept-admin-confirm')
            .text(confirmText)
            .attr('class', `btn ${variant === 'danger' ? 'danger' : 'primary'}`);
        $('#admin-confirm-icon')
            .attr('class', `notify-modal-icon ${iconTone}`)
            .html(`<i class="fa-solid ${icon}"></i>`);

        const cleanup = (result) => {
            $modal.removeClass('open');
            $('#accept-admin-confirm').off('click.adminConfirm');
            $('#cancel-admin-confirm, #close-admin-confirm').off('click.adminConfirm');
            $modal.off('click.adminConfirmBackdrop');
            $(document).off('keydown.adminConfirmEsc');
            resolve(result);
        };

        $('#accept-admin-confirm').off('click.adminConfirm').on('click.adminConfirm', () => cleanup(true));
        $('#cancel-admin-confirm, #close-admin-confirm').off('click.adminConfirm').on('click.adminConfirm', () => cleanup(false));
        $modal.off('click.adminConfirmBackdrop').on('click.adminConfirmBackdrop', (e) => {
            if ($(e.target).is('#admin-confirm-modal')) cleanup(false);
        });
        $(document).off('keydown.adminConfirmEsc').on('keydown.adminConfirmEsc', (e) => {
            if (e.key === 'Escape') cleanup(false);
        });

        $modal.addClass('open');
        setTimeout(() => $('#accept-admin-confirm').trigger('focus'), 40);
    });
}

/* Sipariş Bildirim Sistemi için durum görsel temaları */
const STATUS_NOTIFY_THEME = {
    'Ödendi': {
        tone: 'emerald',
        icon: 'fa-sack-dollar',
        badgeClass: 'badge-success',
        desc: 'Sipariş ödemesi onaylandı. Müşteriye ödeme onayı ve sipariş özeti e-postası gönderilsin mi?'
    },
    'Hazırlanıyor': {
        tone: 'amber',
        icon: 'fa-gears',
        badgeClass: 'badge-warning',
        desc: 'Sipariş üretim aşamasına alındı. Müşteriye üretimin başladığını bildiren e-posta gönderilsin mi?'
    },
    'Kargolandı': {
        tone: 'purple',
        icon: 'fa-truck-fast',
        badgeClass: 'badge-info',
        desc: 'Sipariş kargoya verildi. Müşteriye kargo bilgilendirme e-postası göndermek ister misiniz?'
    },
    'Teslim Edildi': {
        tone: 'emerald',
        icon: 'fa-box-open',
        badgeClass: 'badge-purple',
        desc: 'Sipariş teslim edildi olarak işaretlendi. Müşteriye teslimat bildirimi e-postası gönderilsin mi?'
    },
    'İptal': {
        tone: 'rose',
        icon: 'fa-ban',
        badgeClass: 'badge-danger',
        desc: 'Sipariş iptal edildi. Müşteriye iptal bilgilendirme e-postası göndermek ister misiniz?'
    }
};

/* Sipariş durumu değiştiğinde açılan şık bildirim pop-up penceresi (#status-notify-modal) */
function promptStatusNotificationModal(targets, status) {
    return new Promise((resolve) => {
        const $modal = $('#status-notify-modal');
        if (!$modal.length) {
            resolve({ confirmed: false, trackingNumber: '' });
            return;
        }

        const theme = STATUS_NOTIFY_THEME[status] || {
            tone: '',
            icon: 'fa-envelope-open-text',
            badgeClass: 'badge-info',
            desc: 'Sipariş durumu güncellendi. Müşteriye yeni durumu içeren bilgilendirme e-postası göndermek ister misiniz?'
        };

        const isSingle = targets.length === 1;
        const firstOrderId = isSingle ? String(targets[0].orderId).replace(/^#/, '') : '';
        const orderObj = (isSingle && globalAdminData && globalAdminData.orders)
            ? globalAdminData.orders[targets[0].orderId]
            : null;
        const ship = (orderObj && orderObj.shippingInfo) || {};
        const customerName = ship.fullname || [ship.name, ship.surname].filter(Boolean).join(' ').trim() || (orderObj && orderObj.customerName) || '';
        const customerEmail = ship.email || (orderObj && orderObj.email) || '';

        $('#notify-modal-icon')
            .attr('class', `notify-modal-icon ${theme.tone}`)
            .html(`<i class="fa-solid ${theme.icon}"></i>`);

        $('#notify-modal-title').text(
            isSingle ? 'Müşteriye Bildirim Gönderilsin mi?' : `${targets.length} Müşteriye Bildirim Gönderilsin mi?`
        );
        $('#notify-modal-desc').text(theme.desc);

        if (isSingle) {
            const recipientLabel = customerName ? `${customerName} (#${firstOrderId})` : `Sipariş #${firstOrderId}`;
            $('#notify-summary-recipient').text(recipientLabel);
            if (customerEmail) {
                $('#notify-summary-email').text(customerEmail);
                $('#notify-summary-email-row').show();
            } else {
                $('#notify-summary-email-row').hide();
            }
        } else {
            const previewIds = targets.slice(0, 3).map(t => `#${String(t.orderId).replace(/^#/, '')}`).join(', ');
            const moreText = targets.length > 3 ? ` +${targets.length - 3} diğer` : '';
            $('#notify-summary-recipient').text(`${targets.length} Sipariş (${previewIds}${moreText})`);
            $('#notify-summary-email-row').hide();
        }

        $('#notify-summary-status').html(
            `<span class="badge ${theme.badgeClass}"><i class="fa-solid ${theme.icon}"></i> ${esc(status)}</span>`
        );

        const showTracking = status === 'Kargolandı' && isSingle;
        const existingTracking = (orderObj && orderObj.trackingNumber) ? String(orderObj.trackingNumber) : '';
        $('#notify-tracking-input').val(existingTracking);
        if (showTracking) {
            $('#notify-tracking-group').show();
        } else {
            $('#notify-tracking-group').hide();
        }

        const cleanup = (confirmed) => {
            const trackingNumber = (confirmed && showTracking)
                ? String($('#notify-tracking-input').val() || '').trim()
                : '';
            $modal.removeClass('open');
            $('#status-notify-form').off('submit.notifyModal');
            $('#cancel-notify-modal, #close-notify-modal').off('click.notifyModal');
            $modal.off('click.notifyModalBackdrop');
            $(document).off('keydown.notifyModalEsc');
            resolve({ confirmed, trackingNumber });
        };

        $('#status-notify-form').off('submit.notifyModal').on('submit.notifyModal', (e) => {
            e.preventDefault();
            cleanup(true);
        });
        $('#cancel-notify-modal, #close-notify-modal').off('click.notifyModal').on('click.notifyModal', () => {
            cleanup(false);
        });
        $modal.off('click.notifyModalBackdrop').on('click.notifyModalBackdrop', (e) => {
            if ($(e.target).is('#status-notify-modal')) cleanup(false);
        });
        $(document).off('keydown.notifyModalEsc').on('keydown.notifyModalEsc', (e) => {
            if (e.key === 'Escape') cleanup(false);
        });

        $modal.addClass('open');
        setTimeout(() => {
            if (showTracking) {
                $('#notify-tracking-input').trigger('focus');
            } else {
                $('#confirm-notify-modal').trigger('focus');
            }
        }, 50);
    });
}

/* Durum değişince müşteriye e-posta: yalnızca bildirimi olan durumlarda sorulur (sunucu: notifyOrderStatus) */
const MAIL_STATUSES = ['Ödendi', 'Hazırlanıyor', 'Kargolandı', 'Teslim Edildi', 'İptal'];
async function offerStatusMail(targets, status) {
    if (!MAIL_STATUSES.includes(status) || !targets.length) return;
    const { confirmed, trackingNumber } = await promptStatusNotificationModal(targets, status);
    if (!confirmed) return;

    const notify = httpsCallable(functions, 'notifyOrderStatus');
    let sent = 0;
    for (const t of targets) {
        // jQuery .data() sayısal id'leri Number'a çevirir; sunucu string bekliyor
        try {
            await notify({ userId: String(t.userId), orderId: String(t.orderId), trackingNumber });
            sent++;
        } catch (err) {
            showToast(`#${t.orderId}: e-posta gönderilemedi (${err.message})`, 'error');
        }
    }
    if (sent) showToast(`${sent} bildirim e-postası gönderildi.`, 'success');
}

/* Sosyal Medya & Reklam sekmesi (admin/social.js): yalnızca sekme açılınca yüklenir. Veri edit.engrare.com
   sunucusunda; socialStats/socialRefresh fonksiyonları yönetici + 2FA kontrolünden sonra oradan getirir.
   Huni ve sipariş grafikleri için siparişler buradan verilir (ciroya giren siparişler: iptal/ödeme bekleyen hariç). */
let socialModule = null;
function socialOrders() {
    return Object.values((globalAdminData && globalAdminData.orders) || {}).filter(isEligibleFinanceOrder)
        .map(o => ({ t: getOrderTimestampMs(o), total: Number(o.totalAmount) || getOrderGrossSale(o) }))
        .filter(o => o.t);
}
function openSocial() {
    if (!auth.currentUser || document.body.classList.contains('auth-locked')) return;
    (socialModule ||= import('./social.js?v=14')).then(m => m.show({
        call: (name, payload) => httpsCallable(functions, name)(payload).then(r => r.data),
        orders: socialOrders,
        audit: auditLog,
        toast: showToast
    })).catch(err => {
        socialModule = null;
        console.error('Sosyal sekmesi:', err);
        showToast('Sosyal medya sekmesi yüklenemedi.', 'error');
    });
}
function resetSocial() {
    try { localStorage.removeItem('engrare_social_cache'); } catch (e) { /* yok sayılır */ }
    if (socialModule) socialModule.then(m => m.reset()).catch(() => {});
}

/* Gönderilen e-posta grafiği: son 30 gün ve son 12 ay (Resend ücretsiz kota: 100/gün, 3000/ay).
   Çubuklar dönemin en yüksek değerine göre ölçeklenir; kotanın %80'ini geçen gün/ay kırmızı. */
const MAIL_QUOTA = { day: 100, month: 3000 };
function renderMailStats(stats) {
    const daily = (stats && stats.daily) || {}, monthly = (stats && stats.monthly) || {};
    const ist = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); // YYYY-MM-DD
    const days = [...Array(30)].map((_, i) => ist(new Date(Date.now() - (29 - i) * 864e5)));
    const now = new Date();
    const months = [...Array(12)].map((_, i) => ist(new Date(now.getFullYear(), now.getMonth() - 11 + i, 15)).slice(0, 7));
    const bars = (keys, data, quota) => {
        const max = Math.max(1, ...keys.map(k => data[k] || 0));
        // Sol eksen: üst = en yüksek değer, orta, 0
        const yAxis = `<i style="bottom:100%">${max}</i>${max > 1 ? `<i style="bottom:50%">${Math.round(max / 2)}</i>` : ''}<i style="bottom:0">0</i>`;
        return yAxis + keys.map(k => {
            const n = data[k] || 0;
            return `<div class="${n >= quota * 0.8 ? 'warn' : ''}" style="height:${n / max * 100}%" title="${k}: ${n} e-posta"${n ? ` data-n="${n}"` : ''}></div>`;
        }).join('');
    };
    // Alt eksen: bugünden geriye her `every` çubukta bir etiket
    const axis = (keys, fmt, every) => keys.map((k, i) => `<span>${(keys.length - 1 - i) % every === 0 ? fmt(k) : ''}</span>`).join('');
    $('#mail-daily-bars').html(bars(days, daily, MAIL_QUOTA.day));
    $('#mail-monthly-bars').html(bars(months, monthly, MAIL_QUOTA.month));
    $('#mail-daily-axis').html(axis(days, k => `${k.slice(8)}.${k.slice(5, 7)}`, 7));
    $('#mail-monthly-axis').html(axis(months, k => new Date(`${k}-15`).toLocaleDateString('tr-TR', { month: 'short' }), 1));
    $('#mail-today').text(`${daily[days[29]] || 0} / ${MAIL_QUOTA.day}`);
    $('#mail-month').text(`${monthly[months[11]] || 0} / ${MAIL_QUOTA.month}`);
}

// Helper
function showToast(message, type = "info") {
    const $container = $('#toast-container');
    const id = Date.now();
    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
    const toastHtml = `<div id="toast-${id}" class="toast ${type}"><i class="fa-solid ${icon} toast-icon"></i><span class="toast-message">${esc(message)}</span></div>`;
    $container.append(toastHtml);
    setTimeout(() => { $(`#toast-${id}`).addClass('hiding').remove(); }, 4000);
}

/* ============================================================================
   CANLI BASKI DURUMU (Bambu Lab yerel MQTT köprüsü)
   Köprü servisi (printer-bridge) her yazıcının MQTT verisini RTDB printer/devices/<seri>
   altına yazar; panel bu düğümü canlı dinler ve yazıcılar arasında geçiş yaptırır. updatedAt tazeliği köprünün
   çalıştığını, online alanı yazıcının bağlı olduğunu gösterir.
   ============================================================================ */
const PRINTER_STALE_MS = 90000; // 90 sn veri gelmezse köprü çevrimdışı sayılır

const PRINTER_SELECTED_KEY = 'engrare_panel_yazici';
const PRINTER_SPEED = { 1: 'Sessiz', 2: 'Standart', 3: 'Spor', 4: 'Çılgın' };
const PRINTER_RING = 2 * Math.PI * 52;   // SVG ilerleme halkasının çevresi (r=52)

// Yazıcı başlığı: Bambu'daki/panelde verilen ad, yoksa model (seri numarası gösterilmez)
function printerTitle(d) { return String((d && (d.name || d.model)) || 'Yazıcı'); }

function isPrinterFresh(st) {
    const u = st && Number(st.updatedAt);
    return u > 0 && ((Date.now() + serverTimeOffset) - u) < PRINTER_STALE_MS;
}

function initPrinterStatus() {
    if (printerStatusUnsubscribe) printerStatusUnsubscribe();
    printerStatusUnsubscribe = onValue(ref(db, 'printer/devices'), (snap) => {
        lastPrinterStatus = snap.val();
        renderPrinterStatus(lastPrinterStatus);
    }, (error) => {
        console.warn('Printer status error:', error.message);
        lastPrinterStatus = null;
        renderPrinterStatus(null);
    });

    if (printerStatusTimer) clearInterval(printerStatusTimer);
    printerStatusTimer = setInterval(() => renderPrinterStatus(lastPrinterStatus), 15000);
}

// Yazıcılar arasında geçiş (seçim bu tarayıcıda hatırlanır)
$(document).on('click', '#printer-tabs .pr-tab', function() {
    try { localStorage.setItem(PRINTER_SELECTED_KEY, String($(this).data('serial'))); } catch (e) { /* yok say */ }
    renderPrinterStatus(lastPrinterStatus);
});

function printerClass(st, online) {
    if (!online) return 'off';
    switch (String(st.state || '')) {
        case 'RUNNING': return 'run';
        case 'PAUSE': case 'PREPARE': case 'SLICING': return 'pause';
        case 'FAILED': return 'fail';
        case 'FINISH': return 'done';
        default: return 'idle';
    }
}

function printerGauge(icon, label, cur, target, max) {
    const c = Number(cur);
    if (cur === null || cur === undefined || !Number.isFinite(c)) return '';
    const t = Number(target) > 0 ? Number(target) : 0;
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const heating = t > 0 && c < t - 3;
    return `<div class="pr-gauge${heating ? ' heating' : ''}">
        <div class="pr-gauge-top"><span><i class="fa-solid ${icon}"></i> ${label}</span><b>${c.toFixed(0)}°C</b></div>
        <div class="pr-gauge-bar"><i style="width:${clamp(c / max * 100)}%"></i>${t ? `<em style="left:${clamp(t / max * 100)}%"></em>` : ''}</div>
        <div class="pr-gauge-sub">${t ? `Hedef ${t.toFixed(0)}°C${heating ? ' · ısınıyor' : ''}` : 'Hedef yok'}</div>
    </div>`;
}

function printerAms(st) {
    if (!Array.isArray(st.ams) || !st.ams.length) return '';
    const now = Number(st.trayNow);
    return `<div class="pr-ams">` + st.ams.map((u) => {
        const hum = Number(u.humidity);
        const trays = (Array.isArray(u.trays) ? u.trays : []).map((t) => {
            const color = /^[0-9A-F]{6}$/.test(String(t.color || '')) ? '#' + t.color : '';
            const remain = Number.isFinite(Number(t.remain)) && t.remain !== null ? Math.max(0, Math.min(100, Number(t.remain))) : null;
            const active = Number.isFinite(now) && now === (Number(u.id) || 0) * 4 + (Number(t.id) || 0);
            return `<div class="pr-spool${active ? ' active' : ''}${color || t.type ? '' : ' empty'}" title="${esc(t.type || 'Boş')}${remain !== null ? ' · ' + remain + '%' : ''}">
                <span class="pr-spool-dot"${color ? ` style="background:${color}"` : ''}></span>
                <b>${esc(t.type || 'Boş')}</b>
                <small>${remain !== null ? remain + '%' : '&nbsp;'}</small>
                <span class="pr-spool-bar"><i style="width:${remain !== null ? remain : 0}%${color ? `;background:${color}` : ''}"></i></span>
            </div>`;
        }).join('');
        return `<div class="pr-ams-unit"><div class="pr-ams-title"><i class="fa-solid fa-layer-group"></i> AMS ${(Number(u.id) || 0) + 1}${Number.isFinite(hum) && u.humidity !== null ? ` · nem ${hum}` : ''}</div><div class="pr-spools">${trays}</div></div>`;
    }).join('') + `</div>`;
}

function printerChips(st) {
    const chip = (icon, text, cls = '') => `<span class="pr-chip ${cls}"><i class="fa-solid ${icon}"></i> ${esc(text)}</span>`;
    const c = [];
    if (st.speedLevel) c.push(chip('fa-gauge-high', 'Hız: ' + (PRINTER_SPEED[st.speedLevel] || st.speedLevel)));
    if (st.light !== undefined && st.light !== null) c.push(chip('fa-lightbulb', 'Işık ' + (st.light ? 'açık' : 'kapalı'), st.light ? 'on' : ''));
    if (Number.isFinite(Number(st.partFan)) && st.partFan !== null) c.push(chip('fa-fan', 'Parça fanı %' + st.partFan));
    if (Number.isFinite(Number(st.auxFan)) && st.auxFan !== null) c.push(chip('fa-wind', 'Yardımcı fan %' + st.auxFan));
    if (Number.isFinite(Number(st.chamberFan)) && st.chamberFan !== null) c.push(chip('fa-fan', 'Hazne fanı %' + st.chamberFan));
    if (st.nozzleDiameter) c.push(chip('fa-circle-dot', 'Nozzle ' + st.nozzleDiameter + ' mm'));
    if (st.wifiSignal) c.push(chip('fa-wifi', st.wifiSignal));
    if (Number(st.errorCode) > 0) c.push(chip('fa-triangle-exclamation', 'Hata kodu ' + st.errorCode, 'bad'));
    else if (Number(st.hmsCount) > 0) c.push(chip('fa-triangle-exclamation', st.hmsCount + ' uyarı', 'bad'));
    return c.length ? `<div class="pr-chips">${c.join('')}</div>` : '';
}

function renderPrinterStatus(devices) {
    const $badge = $('#printer-badge');
    const $tabs = $('#printer-tabs');
    const $msg = $('#live-status-msg');
    const $view = $('#printer-view');
    const setBadge = (cls, text) => $badge.removeClass('badge-muted badge-success badge-warning badge-danger badge-info').addClass(cls).text(text);

    const list = Object.keys(devices || {}).map(k => devices[k]).filter(d => d && typeof d === 'object')
        .map((d, i) => ({ ...d, serial: String(d.serial || Object.keys(devices)[i]) }))
        .sort((a, b) => String(a.name || a.serial).localeCompare(String(b.name || b.serial), 'tr'));

    if (!list.length) {
        $tabs.empty(); $view.hide();
        setBadge('badge-muted', 'Bağlantı Yok');
        $msg.text('Henüz yazıcı yok. Dişli simgesinden Bambu hesabınızı bağlayıp yazıcıları seçin; köprü servisinin çalıştığından emin olun.').show();
        syncPrinterCamera(null);
        return;
    }
    if (!list.some(isPrinterFresh)) {
        $tabs.empty(); $view.hide();
        setBadge('badge-muted', 'Bağlantı Yok');
        $msg.text('Köprü servisi çalışmıyor veya veri gelmiyor.').show();
        syncPrinterCamera(null);
        return;
    }
    $msg.hide();

    let selected = null;
    try { selected = localStorage.getItem(PRINTER_SELECTED_KEY); } catch (e) { /* yok say */ }
    const st = list.find(d => d.serial === selected) || list[0];

    // Yazıcı sekmeleri
    $tabs.html(list.map((d) => {
        const on = isPrinterFresh(d) && d.online !== false;
        const cls = printerClass(d, on);
        const pct = on && d.state === 'RUNNING' ? ` <small>%${Math.round(Number(d.progress) || 0)}</small>` : '';
        return `<button type="button" class="pr-tab pr-${cls}${d.serial === st.serial ? ' active' : ''}" data-serial="${esc(d.serial)}">
            <span class="pr-dot"></span><span class="pr-tab-name">${esc(printerTitle(d))}</span>${pct}</button>`;
    }).join(''));

    const fresh = isPrinterFresh(st);
    const online = fresh && st.online !== false;
    const cls = printerClass(st, online);
    const label = online ? String(st.stateLabel || st.state || 'Bilinmiyor') : 'Çevrimdışı';
    const badgeCls = { run: 'badge-info', pause: 'badge-warning', fail: 'badge-danger', done: 'badge-success', idle: 'badge-success', off: 'badge-warning' }[cls];
    setBadge(badgeCls, label);

    const progress = online ? Math.max(0, Math.min(100, Number(st.progress) || 0)) : 0;
    const rem = Number(st.remainingMinutes);
    const hasJob = online && (st.state === 'RUNNING' || st.state === 'PAUSE' || st.state === 'PREPARE' || progress > 0);
    const nowMs = Date.now() + serverTimeOffset;
    const eta = hasJob && Number.isFinite(rem) && rem > 0
        ? new Date(nowMs + rem * 60000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
    const layers = (Number(st.layerNum) > 0 || Number(st.totalLayers) > 0) ? `${Number(st.layerNum) || 0} / ${Number(st.totalLayers) || 0}` : '';
    const meta = [
        layers ? `<span class="pr-chip"><i class="fa-solid fa-layer-group"></i> Katman ${esc(layers)}</span>` : '',
        hasJob && Number.isFinite(rem) && rem > 0 ? `<span class="pr-chip"><i class="fa-regular fa-clock"></i> Kalan ${esc(formatPrinterDuration(rem))}</span>` : '',
        eta ? `<span class="pr-chip"><i class="fa-solid fa-flag-checkered"></i> Bitiş ${esc(eta)}</span>` : ''
    ].join('');

    const hero = `<div class="pr-hero pr-${cls}">
        <div class="pr-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
                <circle class="pr-ring-bg" cx="60" cy="60" r="52"></circle>
                <circle class="pr-ring-fg" cx="60" cy="60" r="52" transform="rotate(-90 60 60)"
                        stroke-dasharray="${PRINTER_RING.toFixed(1)}" stroke-dashoffset="${(PRINTER_RING * (1 - progress / 100)).toFixed(1)}"></circle>
            </svg>
            <div class="pr-ring-text"><b>%${Math.round(progress)}</b><span>${esc(label)}</span></div>
        </div>
        <div class="pr-hero-info">
            <div class="pr-title">${esc(printerTitle(st))}${st.model && st.name ? ` <small>${esc(st.model)}</small>` : ''}</div>
            <div class="pr-file" title="${esc(st.fileName || '')}">${online ? esc(st.fileName || (hasJob ? 'Adsız baskı' : 'Aktif baskı yok')) : esc(st.reason || 'Yazıcı çevrimdışı')}</div>
            <div class="pr-meta">${meta}</div>
        </div>
    </div>`;

    const gauges = online ? [
        printerGauge('fa-temperature-half', 'Nozzle', st.nozzleTemp, st.nozzleTarget, 300),
        printerGauge('fa-border-all', 'Tabla', st.bedTemp, st.bedTarget, 120),
        printerGauge('fa-box', 'Hazne', st.chamberTemp, 0, 70)
    ].join('') : '';

    $view.html(hero
        + (gauges ? `<div class="pr-gauges">${gauges}</div>` : '')
        + (online ? printerAms(st) + printerChips(st) : '')
        + `<div class="pr-foot">${esc([printerTitle(st), st.model && st.name ? st.model : ''].filter(Boolean).join(' · '))} · Son güncelleme ${new Date(Number(st.updatedAt)).toLocaleTimeString('tr-TR')}</div>`).show();
    syncPrinterCamera(st);
}

/* --- Kamera: yazıcı kartının içinde. Açıkken panel `printer/watch/<seri>` işaretini 15 sn'de bir
   tazeler; köprü işaret tazeyken yazıcıdan kare alıp `printer/camera/<seri>`'ye yazar (yaklaşık 2 sn'de
   bir kare). Kapatınca/sekme arka plana geçince/10 dk dolunca işaret silinir ve köprü bağlantıyı keser. --- */
const PRINTER_CAM_MAX_MS = 10 * 60 * 1000;
let camSerial = null;        // kamera açıkken izlenen yazıcı (açık değilse null)
let camTimer = null, camLimit = null, camUnsub = null;
let camSelected = null;      // kartta seçili yazıcı { serial, name, online }

function camMessage(text) {
    $('#pr-cam-img').hide();
    $('#pr-cam-msg').text(text);
    $('#pr-cam-ph').show();
    $('#pr-cam-live').hide();
}

function stopPrinterCamera(message) {
    if (camTimer) { clearInterval(camTimer); camTimer = null; }
    if (camLimit) { clearTimeout(camLimit); camLimit = null; }
    if (camUnsub) { camUnsub(); camUnsub = null; }
    if (camSerial) { remove(ref(db, 'printer/watch/' + camSerial)).catch(() => {}); }
    camSerial = null;
    $('#pr-cam-toggle').html('<i class="fa-solid fa-play"></i> Aç');
    camMessage(message || 'Kamera kapalı');
}

function startPrinterCamera(serial) {
    if (!serial) return;
    stopPrinterCamera();
    camSerial = serial;
    const mark = () => set(ref(db, 'printer/watch/' + serial), Date.now() + serverTimeOffset)
        .catch((e) => { if (camSerial === serial) camMessage('Kamera isteği yazılamadı: ' + (e && e.code || e && e.message || 'bilinmeyen hata')); });
    mark();
    camTimer = setInterval(mark, 15000);
    camLimit = setTimeout(() => stopPrinterCamera('10 dakika doldu. Devam etmek için kamerayı yeniden açın.'), PRINTER_CAM_MAX_MS);
    $('#pr-cam-toggle').html('<i class="fa-solid fa-stop"></i> Kapat');
    camMessage('Kameraya bağlanılıyor…');
    camUnsub = onValue(ref(db, 'printer/camera/' + serial), (snap) => {
        const v = snap.val();
        if (!v) return;
        if (v.frame) {
            $('#pr-cam-img').attr('src', 'data:image/jpeg;base64,' + v.frame).show();
            $('#pr-cam-ph').hide();
            $('#pr-cam-live').show();
        } else if (v.error) {
            camMessage(String(v.error).slice(0, 200));
        }
    });
}

// Kart yeniden çizildiğinde seçili yazıcıya göre kamera bloğunu eşitle
function syncPrinterCamera(st) {
    const $box = $('#printer-camera');
    if (!st) { camSelected = null; stopPrinterCamera(); $box.hide(); return; }
    const online = isPrinterFresh(st) && st.online !== false;
    camSelected = { serial: st.serial, online };
    $box.show();
    $('#pr-cam-name').text(printerTitle(st));
    $('#pr-cam-toggle').prop('disabled', !online && !camSerial).attr('title', online ? '' : 'Yazıcı çevrimdışı');
    // Kamera açıkken başka yazıcıya geçildiyse yeni yazıcıya aktar
    if (camSerial && camSerial !== st.serial) startPrinterCamera(st.serial);
}

$(document).on('click', '#pr-cam-toggle', function() {
    if (camSerial) stopPrinterCamera();
    else if (camSelected) startPrinterCamera(camSelected.serial);
});
$(document).on('click', '#pr-cam-full', function() {
    const el = document.getElementById('pr-cam-stage');
    if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {});
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden && camSerial) stopPrinterCamera('Sekme arka planda olduğu için kamera kapatıldı.');
});
window.addEventListener('pagehide', () => { if (camSerial) remove(ref(db, 'printer/watch/' + camSerial)).catch(() => {}); });

function formatPrinterTemp(cur, target) {
    if (cur === null || cur === undefined || cur === "") return "-";
    const c = Number(cur), t = Number(target);
    if (!Number.isFinite(c)) return '-';
    return (Number.isFinite(t) && t > 0) ? `${c.toFixed(0)}°C / ${t.toFixed(0)}°C` : `${c.toFixed(0)}°C`;
}

function formatPrinterDuration(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(m / 60), mm = m % 60;
    return h > 0 ? `${h} sa ${mm} dk` : `${mm} dk`;
}

/* ============================================================================
   ÜRÜN YÖNETİMİ (PRODUCT MANAGEMENT)
   Her ürün için ad (yazı) ve üretim süresi (saat) girilir; fiyat, fiyatlandırma
   parametreleriyle otomatik hesaplanır ve son hanesi her zaman 9 olur (roundPriceToNine).
   Değerler RTDB config/products altına yazılır; site (products.js > applyProductOverrides)
   ve ödeme tutarı (functions/index.js > loadProductCatalog) buradan okur. Tahsil edilen
   tutarı HER ZAMAN sunucu hesaplar; paneldeki fiyat yalnızca gösterim içindir.
   ============================================================================ */
let productOverrides = {};

/* Verilen hedef fiyatı üreten üretim süresini (saat) geri hesaplar (ikili arama).
   Kayıtlı üretim süresi olmayan ürünlerde başlangıç değeri olarak kullanılır. */
function hoursForPrice(targetPrice, params) {
    const target = Number(targetPrice);
    if (!Number.isFinite(target) || target <= 0) return 0;
    let lo = 0, hi = 500;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (hesaplaSatisFiyati({ ...params, t: mid }) < target) lo = mid; else hi = mid;
    }
    return Math.round(((lo + hi) / 2) * 10) / 10;
}

/* Ürünün güncel görsel yolları (./ ve ?v= olmadan): panelde seçilmişse o, yoksa koddaki varsayılan */
function productImagePaths(p) {
    const o = productOverrides[p.id] || {};
    const list = Array.isArray(o.images) ? o.images.filter(x => typeof x === 'string') : [];
    if (list.length) return list;
    return (p.images || []).map(i => String(i.src || '').replace(/^\.\//, '').replace(/\?.*$/, '')).filter(Boolean);
}

/* Ürün görselleri penceresi (admin/gorsel.js): görseller GitHub'a doğrudan tarayıcıdan yüklenir */
let gorselModule = null;
function openProductImages(id) {
    if (!auth.currentUser || document.body.classList.contains('auth-locked')) return;
    const p = BASE_PRODUCTS.find(x => String(x.id) === String(id));
    if (!p) return;
    const o = productOverrides[p.id] || {};
    const base = (p.images || []).map(i => String(i.src || '').replace(/^\.\//, '').replace(/\?.*$/, '')).filter(Boolean);
    (gorselModule ||= import('./gorsel.js?v=3')).then(m => m.open({
        productId: p.id,
        name: (typeof o.name === 'string' && o.name.trim()) ? o.name : p.name,
        images: productImagePaths(p),
        baseFirst: base[0] || '',
        card: typeof o.card === 'string' ? o.card : '',
        esc,
        toast: showToast,
        getToken: async () => { const s = await get(ref(db, 'config/github_upload/token')); return s.exists() ? String(s.val()) : ''; },
        setToken: (t) => set(ref(db, 'config/github_upload/token'), t),
        write: async ({ images, card }) => {
            await update(ref(db), {
                [`config/products/${p.id}/images`]: images,
                [`config/products/${p.id}/card`]: card
            });
            publishStaticPrices();
        },
        audit: (detail) => auditLog('product_images', `Ürün ${p.id}`, detail)
    })).catch(err => {
        gorselModule = null;
        console.error('Ürün görselleri:', err);
        showToast('Görsel penceresi yüklenemedi.', 'error');
    });
}

function renderProductsAdmin() {
    const $list = $('#products-admin-list');
    if (!$list.length) return;

    if (!BASE_PRODUCTS.length) {
        $list.html('<p class="section-desc">Ürün kataloğu yüklenemedi.</p>');
        return;
    }

    const params = readPricingInputs();
    const rows = BASE_PRODUCTS.map(p => {
        const o = productOverrides[p.id] || {};
        const name = (typeof o.name === 'string' && o.name.trim()) ? o.name : p.name;
        const storedPrice = Number.isFinite(Number(o.price)) ? Number(o.price) : p.price;
        // Üretim süresi: kayıtlıysa onu kullan, yoksa mevcut fiyattan geri hesapla
        let hours = Number(o.productionHours);
        if (!Number.isFinite(hours) || hours <= 0) hours = hoursForPrice(storedPrice, params);
        const multiplier = (Number.isFinite(Number(o.multiplier)) && Number(o.multiplier) > 0) ? Number(o.multiplier) : 1;
        const discountMultiplier = readDiscountMultiplier(o.discountMultiplier);
        const img = productImagePaths(p)[0] ? resolveAssetPath('./' + productImagePaths(p)[0]) : '';
        return `
            <div class="product-admin-row" data-product-id="${p.id}">
                <div class="product-admin-media">
                    <div class="product-admin-thumb">
                        ${img ? `<img src="${esc(img)}" alt="${esc(name)}">` : '<i class="fa-solid fa-box"></i>'}
                    </div>
                    <button type="button" class="btn pimg-open"><i class="fa-solid fa-images"></i> Görseller</button>
                </div>
                <div class="product-admin-fields">
                    <div class="form-group">
                        <label>Ürün Adı (Yazı) <small style="color: var(--text-light); font-weight: 500;">#${p.id}</small></label>
                        <input type="text" class="input-box product-name-input" maxlength="120" value="${esc(name)}" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label>Üretim Süresi (saat)</label>
                        <input type="number" class="input-box product-hours-input" min="0" step="0.1" value="${hours > 0 ? hours : ''}" placeholder="Örn: 3.5" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label>Ürün Çarpanı <small style="color: var(--text-light); font-weight: 500;">(1 = standart)</small></label>
                        <input type="number" class="input-box product-multiplier-input" min="0.1" max="10" step="0.05" value="${multiplier}" placeholder="1" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label>İndirim Çarpanı <small style="color: var(--text-light); font-weight: 500;">(1 = üstü çizili fiyat yok)</small></label>
                        <input type="number" class="input-box product-discount-input" min="1" max="10" step="0.05" value="${discountMultiplier}" placeholder="1" autocomplete="off">
                        <small style="color: var(--text-light); display:block; margin-top:4px;">Örn. 1,2 → eski fiyat, ham fiyatın 1,2 katı (son hane 9). Eski fiyat gerçekten uygulanmış olmalı (son 30 günün en düşüğü).</small>
                    </div>
                    <div class="form-group">
                        <label>Fiyat (otomatik)</label>
                        <div class="product-price-display">
                            <span class="product-price-value">—</span>
                            <small class="product-price-raw"></small>
                        </div>
                    </div>
                </div>
            </div>`;
    }).join('');

    $list.html(rows);
    recomputeProductPrices();
}

/* Güncel ürün verisini siteye statik dosya (fiyat.js) olarak da gönderir: site ilk açılışta Firebase'i beklemeden
   fiyatı gösterir. Firebase yazımı zaten bitti; burada hata olursa site yine çalışır (yalnız ilk ziyaretçi bir an "₺…" görür).
   Anahtar görsel penceresindeki GitHub anahtarıdır. */
async function publishStaticPrices() {
    try {
        const t = await get(ref(db, 'config/github_upload/token'));
        const token = t.exists() ? String(t.val()) : '';
        if (!token) {
            showToast("Fiyat dosyası siteye gönderilmedi: GitHub anahtarı yok (Ürünler > Görseller penceresinden bir kez girin). Site Firebase'den okumaya devam eder.", "error");
            return;
        }
        const snap = await get(ref(db, 'config/products'));
        const { publish } = await import('./fiyat-yayin.js?v=1');
        const sonuc = await publish(token, snap.val() || {});
        showToast(sonuc === 'ayni' ? 'Fiyat dosyası zaten güncel.' : 'Fiyat dosyası siteye gönderildi (1-2 dk içinde yayında).', "success");
    } catch (error) {
        console.error('Fiyat dosyası yazılamadı:', error);
        showToast("Fiyat dosyası siteye gönderilemedi: " + (error.message || 'bilinmeyen hata') + ". Site Firebase'den okumaya devam eder.", "error");
    }
}

function loadProductOverrides() {
    onValue(ref(db, 'config/products'), (snap) => {
        productOverrides = snap.val() || {};
        renderProductsAdmin();
        renderFinance(); // eski siparişlerin ham maliyeti ürün üretim süresine bağlı olabilir
    }, (error) => {
        console.warn("Ürün geçersiz kılmaları okunamadı:", error.message);
        renderProductsAdmin();
    });
}

/* ============================================================================
   İNDİRİM KODLARI (DISCOUNT CODES)
   RTDB: discounts/<KOD> = { type: "percent"|"fixed", value, limit?, expiryDate?, used? }
   Sunucu (functions/index.js > findDiscount) yalnızca bu alanları okur; kullanım sayacı
   sipariş kaydedilirken otomatik artar (used).
   ============================================================================ */
let globalDiscounts = {};
let discountUnsubscribe = null;

function loadDiscounts() {
    if (discountUnsubscribe) discountUnsubscribe();
    discountUnsubscribe = onValue(ref(db, 'discounts'), (snap) => {
        globalDiscounts = snap.val() || {};
        renderDiscounts();
    }, (error) => {
        console.warn("İndirim kodları okunamadı:", error.message);
    });
}

function renderDiscounts() {
    const $body = $('#discounts-table-body');
    if (!$body.length) return;
    const entries = Object.entries(globalDiscounts || {});
    if (!entries.length) {
        $body.empty();
        $('#discounts-empty').show();
        return;
    }
    $('#discounts-empty').hide();
    $body.html(entries.map(([code, d]) => {
        const type = d.type === 'percent' ? 'Yüzde' : 'Sabit';
        const value = d.type === 'percent' ? `%${Number(d.value)}` : formatTL(d.value);
        const limit = d.limit ? Number(d.limit) : '∞';
        const used = Number(d.used) || 0;
        const expiry = d.expiryDate ? new Date(Number(d.expiryDate)).toLocaleDateString('tr-TR') : '—';
        return `<tr>
            <td class="dc-code"><code>${esc(code)}</code></td>
            <td data-label="Tür">${type}</td>
            <td data-label="Değer">${value}</td>
            <td data-label="Limit">${limit}</td>
            <td data-label="Kullanım">${used}</td>
            <td data-label="Son Tarih">${expiry}</td>
            <td class="dc-actions" style="text-align:right; white-space:nowrap;">
                <button type="button" class="btn-icon-sm discount-edit" data-code="${esc(code)}" title="Düzenle"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="btn-icon-sm discount-delete" data-code="${esc(code)}" title="Sil"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    }).join(''));
}

function openDiscountModal(code) {
    if (!auth.currentUser) {
        $('#login-modal').addClass('open');
        showToast("İndirim kodu eklemek için lütfen yönetici girişi yapın.", "error");
        return;
    }
    $('#discount-form')[0].reset();
    if (code && globalDiscounts[code]) {
        const d = globalDiscounts[code];
        $('#discount-modal-title').text('İndirim Kodunu Düzenle');
        $('#discount-code').val(code).prop('readonly', true);
        $('#discount-type').val(d.type === 'fixed' ? 'fixed' : 'percent');
        $('#discount-value').val(d.value);
        $('#discount-limit').val(d.limit || '');
        $('#discount-expiry').val(d.expiryDate ? new Date(Number(d.expiryDate)).toLocaleDateString('sv-SE') : '');
    } else {
        $('#discount-modal-title').text('Yeni İndirim Kodu');
        $('#discount-code').val('').prop('readonly', false);
        $('#discount-type').val('percent');
    }
    $('#discount-modal').addClass('open');
}

async function saveDiscount(e) {
    e.preventDefault();
    if (!auth.currentUser) {
        showToast("Kaydetmek için yönetici girişi yapın.", "error");
        return;
    }
    const code = String($('#discount-code').val() || '').trim().toUpperCase();
    const type = $('#discount-type').val() === 'fixed' ? 'fixed' : 'percent';
    const value = Number($('#discount-value').val());
    const limitRaw = $('#discount-limit').val();
    const expiryRaw = $('#discount-expiry').val();

    if (!/^[A-Z0-9_-]{1,40}$/.test(code)) {
        showToast("Kod yalnızca harf, rakam, tire ve alt çizgi içerebilir (en fazla 40 karakter).", "error");
        return;
    }
    if (!Number.isFinite(value) || value <= 0) {
        showToast("Geçerli bir indirim değeri girin.", "error");
        return;
    }
    if (type === 'percent' && value > 100) {
        showToast("Yüzde indirimi 100'den büyük olamaz.", "error");
        return;
    }

    const payload = { type, value: Math.round(value * 100) / 100 };
    const limit = Number(limitRaw);
    if (Number.isFinite(limit) && limit > 0) payload.limit = Math.floor(limit);
    if (expiryRaw) {
        const exp = new Date(expiryRaw + 'T23:59:59');
        if (!isNaN(exp.getTime())) payload.expiryDate = exp.getTime();
    }
    // Düzenlemede kullanım sayacını koru
    const existing = globalDiscounts[code];
    if (existing && Number(existing.used) > 0) payload.used = Number(existing.used);

    const $btn = $('#btn-save-discount');
    const originalHtml = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...');
    try {
        await set(ref(db, `discounts/${code}`), payload);
        auditLog('discount_save', code, '');
        $('#discount-modal').removeClass('open');
        showToast("İndirim kodu kaydedildi.", "success");
    } catch (error) {
        console.error("Discount Save Error:", error);
        showToast("Kaydetme hatası: " + error.message, "error");
    } finally {
        $btn.prop('disabled', false).html(originalHtml);
    }
}

function deleteDiscount(code) {
    if (!auth.currentUser) {
        showToast("Silmek için yönetici girişi yapın.", "error");
        return;
    }
    if (!code) return;
    if (!confirm(`"${code}" indirim kodunu silmek istediğinize emin misiniz?`)) return;
    remove(ref(db, `discounts/${code}`))
        .then(() => { showToast("İndirim kodu silindi.", "success"); auditLog('discount_delete', code, ''); })
        .catch((error) => showToast("Silme hatası: " + error.message, "error"));
}

/* ============================================================================
   MÜŞTERİ YORUMLARI
   RTDB: config/reviews/<ürünNo>/<yorumNo> = { name, rating (1-5), text, date }
   Mağaza (myScript.js > renderDetailExtras) bunları ürün sayfasında gösterir; sahte yorum riski olmasın diye
   yorumlar yalnızca buradan elle girilir (müşteri formu yok).
   ============================================================================ */
let globalReviews = {};
let reviewsUnsubscribe = null;

function loadReviews() {
    if (reviewsUnsubscribe) reviewsUnsubscribe();
    reviewsUnsubscribe = onValue(ref(db, 'config/reviews'), (snap) => {
        globalReviews = snap.val() || {};
        renderReviewsAdmin();
    }, (error) => console.warn("Yorumlar okunamadı:", error.message));
}

function reviewProductName(id) {
    const base = (BASE_PRODUCTS || []).find(p => String(p.id) === String(id));
    const over = productOverrides && productOverrides[id];
    return (over && over.name) || (base && base.name) || `Ürün ${id}`;
}

function renderReviewsAdmin() {
    const $list = $('#reviews-admin-list');
    if (!$list.length) return;
    const rows = [];
    Object.entries(globalReviews).forEach(([pid, byKey]) => {
        Object.entries(byKey || {}).forEach(([key, r]) => rows.push({ pid, key, r }));
    });
    rows.sort((a, b) => (b.r.date || 0) - (a.r.date || 0));
    $('#reviews-admin-empty').toggle(!rows.length);
    $list.html(rows.map(({ pid, key, r }) => {
        const n = Math.max(1, Math.min(5, Math.round(Number(r.rating) || 0)));
        const when = r.date ? new Date(Number(r.date)).toLocaleDateString('tr-TR') : '—';
        return `<div class="rev-admin-item">
            <div class="rev-admin-main">
                <div class="rev-admin-top">
                    <span class="rev-admin-stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>
                    <b>${esc(r.name)}</b><span>${esc(reviewProductName(pid))}</span><span>${when}</span>
                </div>
                <div class="rev-admin-text">${esc(r.text)}</div>
            </div>
            <div class="rev-admin-actions">
                <button type="button" class="btn-icon-sm review-edit" data-product="${esc(pid)}" data-key="${esc(key)}" title="Düzenle"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="btn-icon-sm review-delete" data-product="${esc(pid)}" data-key="${esc(key)}" title="Sil"><i class="fa-solid fa-trash"></i></button>
            </div>
        </div>`;
    }).join(''));
}

let editingReview = null; // { product, key } (düzenlemede)

function openReviewModal(pid, key) {
    if (!auth.currentUser) {
        showToast("Yorum eklemek için lütfen yönetici girişi yapın.", "error");
        return;
    }
    $('#review-form')[0].reset();
    $('#review-product').html((BASE_PRODUCTS || []).filter(p => p && p.id != null)
        .map(p => `<option value="${esc(p.id)}">${esc(reviewProductName(p.id))}</option>`).join(''));
    const r = pid != null && key ? (globalReviews[pid] || {})[key] : null;
    editingReview = r ? { product: String(pid), key } : null;
    $('#review-modal-title').text(r ? 'Yorumu Düzenle' : 'Yeni Yorum');
    if (r) {
        $('#review-product').val(String(pid));
        $('#review-rating').val(String(r.rating));
        $('#review-name').val(r.name);
        $('#review-text').val(r.text);
        $('#review-date').val(r.date ? new Date(Number(r.date)).toLocaleDateString('sv-SE') : '');
    } else {
        $('#review-date').val(new Date().toLocaleDateString('sv-SE'));
    }
    $('#review-modal').addClass('open');
}

async function saveReview(e) {
    e.preventDefault();
    if (!auth.currentUser) { showToast("Kaydetmek için yönetici girişi yapın.", "error"); return; }
    const pid = String($('#review-product').val() || '');
    const name = String($('#review-name').val() || '').trim();
    const text = String($('#review-text').val() || '').trim();
    const rating = Number($('#review-rating').val());
    const date = new Date(($('#review-date').val() || '') + 'T12:00:00').getTime();
    if (!pid || !name || !text || !(rating >= 1 && rating <= 5) || isNaN(date)) {
        showToast("Ürün, puan, ad, tarih ve yorum metni zorunludur.", "error");
        return;
    }
    const $btn = $('#btn-save-review');
    const originalHtml = $btn.html();
    $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...');
    try {
        const payload = { name, rating, text, date };
        // Ürün değiştirildiyse eski kaydı kaldırıp yenisini oluştur; aynı üründe yerinde güncelle
        if (editingReview && editingReview.product === pid) {
            await set(ref(db, `config/reviews/${pid}/${editingReview.key}`), payload);
        } else {
            await set(push(ref(db, `config/reviews/${pid}`)), payload);
            if (editingReview) await remove(ref(db, `config/reviews/${editingReview.product}/${editingReview.key}`));
        }
        $('#review-modal').removeClass('open');
        showToast("Yorum kaydedildi.", "success");
        auditLog('review_save', reviewProductName(pid), `${name} (${rating}/5)`);
    } catch (error) {
        console.error("Review Save Error:", error);
        showToast("Kaydetme hatası: " + error.message, "error");
    } finally {
        $btn.prop('disabled', false).html(originalHtml);
    }
}

async function deleteReview(pid, key) {
    if (!auth.currentUser || !pid || !key) return;
    const ok = await askAdminConfirm({
        eyebrow: 'YORUM SİLME', title: 'Yorum silinsin mi?',
        desc: 'Bu yorum ürün sayfasından kaldırılır.', confirmText: 'Sil', variant: 'danger', icon: 'fa-trash', iconTone: 'red'
    });
    if (!ok) return;
    remove(ref(db, `config/reviews/${pid}/${key}`))
        .then(() => { showToast("Yorum silindi.", "success"); auditLog('review_delete', reviewProductName(pid), ''); })
        .catch((error) => showToast("Silme hatası: " + error.message, "error"));
}

/* ============================================================================
   KULLANICI YÖNETİMİ (USER MANAGEMENT) — Detay Pop-up & 2 Sn Basılı Tutarak Silme
   ============================================================================ */

function isUserAdmin(uid, rawUser = null) {
    if (!uid) return false;
    if (auth.currentUser && auth.currentUser.uid === uid) return true;
    const adminMap = (globalAdminData && globalAdminData.adminUsers) || {};
    if (adminMap[uid] === true) return true;
    const u = rawUser || (globalAdminData && globalAdminData.allUsers && globalAdminData.allUsers[uid]) || {};
    const p = u.profile || {};
    if (p.isAdmin === true || p.role === 'admin' || u.isAdmin === true || u.role === 'admin') return true;
    return false;
}

function formatUserTimestamp(ms, includeTime = true) {
    if (!ms || !Number.isFinite(Number(ms)) || Number(ms) <= 0) return 'Bilinmiyor';
    const d = new Date(Number(ms));
    if (isNaN(d.getTime())) return 'Bilinmiyor';
    const dateStr = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
    if (!includeTime) return dateStr;
    const timeStr = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    return `${dateStr} · ${timeStr}`;
}

function getUserStatusBadgeHtml(status) {
    let icon = 'fa-circle-question';
    let badgeClass = 'badge-muted';
    const raw = String(status || 'Bilinmiyor');
    const s = raw.toLocaleLowerCase('tr');

    if (s.includes('ödeme bekliyor') || s.includes('pending_payment') || s.includes('pending payment')) {
        icon = 'fa-circle-exclamation';
        badgeClass = 'badge-danger';
        return `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> Ödeme Bekliyor</span>`;
    }
    if (s.includes('payment_review')) {
        icon = 'fa-magnifying-glass-dollar';
        badgeClass = 'badge-warning';
        return `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> İnceleniyor</span>`;
    }
    if (s.includes('ödendi') || s.includes('paid')) {
        icon = 'fa-sack-dollar';
        badgeClass = 'badge-success';
        return `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> Ödendi</span>`;
    }
    if (s.includes('hazır') || s.includes('pending')) {
        icon = 'fa-clock';
        badgeClass = 'badge-warning';
        return `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> Hazırlanıyor</span>`;
    }
    if (s.includes('kargo')) {
        icon = 'fa-truck';
        badgeClass = 'badge-info';
        return `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> Kargolandı</span>`;
    }
    if (s.includes('teslim') || s.includes('tamam')) {
        icon = 'fa-box-open';
        badgeClass = 'badge-purple';
        return `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> Teslim Edildi</span>`;
    }
    if (s.includes('iptal') || s.includes('cancel')) {
        icon = 'fa-ban';
        badgeClass = 'badge-danger';
        return `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> İptal</span>`;
    }
    return `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> ${esc(raw)}</span>`;
}

function buildNormalizedUserRecord(uid) {
    const allUsers = (globalAdminData && globalAdminData.allUsers) || {};
    const authUsers = (globalAdminData && globalAdminData.authUsers) || {};
    const rawUser = allUsers[uid] || {};
    const authUser = authUsers[uid] || {};
    const profile = (rawUser && typeof rawUser.profile === 'object' && rawUser.profile) ? rawUser.profile : {};
    const addressesObj = (rawUser && typeof rawUser.addresses === 'object' && rawUser.addresses) ? rawUser.addresses : {};
    const userOrdersObj = (rawUser && typeof rawUser.orders === 'object' && rawUser.orders) ? { ...rawUser.orders } : {};

    // Global siparişlerde bu kullanıcıya ait olup henüz userOrdersObj içinde olmayanları da dahil et
    const globalOrders = (globalAdminData && globalAdminData.orders) || {};
    Object.entries(globalOrders).forEach(([ordId, ord]) => {
        if (ord && String(ord.userId) === String(uid) && !userOrdersObj[ordId]) {
            userOrdersObj[ordId] = ord;
        }
    });

    const isAdmin = isUserAdmin(uid, rawUser);
    const isCurrentAdmin = Boolean(auth.currentUser && auth.currentUser.uid === uid);

    const addressesList = Object.entries(addressesObj)
        .filter(([, a]) => a && typeof a === 'object')
        .map(([addrId, a]) => ({
            id: addrId,
            title: a.title || 'Adres',
            fullname: a.fullname || [a.name, a.surname].filter(Boolean).join(' ').trim() || '-',
            phone: a.phone || '-',
            city: a.city || '',
            district: a.district || '',
            details: a.details || a.address || '-'
        }));

    const ordersList = Object.entries(userOrdersObj)
        .filter(([, o]) => o && typeof o === 'object')
        .map(([ordId, o]) => {
            const ts = getOrderTimestampMs(o) || 0;
            const gross = getOrderGrossSale(o);
            return {
                ...o,
                id: o.id || ordId,
                orderKey: ordId,
                timestampMs: ts,
                grossSale: gross,
                eligibleFinance: isEligibleFinanceOrder(o)
            };
        })
        .sort((a, b) => (b.timestampMs - a.timestampMs) || String(b.id).localeCompare(String(a.id)));

    let totalSpent = 0;
    let totalGrossOrdered = 0;
    let firstOrderTs = 0;
    let lastOrderTs = 0;

    ordersList.forEach((o) => {
        totalGrossOrdered += o.grossSale;
        if (o.eligibleFinance) {
            totalSpent += o.grossSale;
        }
        if (o.timestampMs > 0) {
            if (!firstOrderTs || o.timestampMs < firstOrderTs) firstOrderTs = o.timestampMs;
            if (!lastOrderTs || o.timestampMs > lastOrderTs) lastOrderTs = o.timestampMs;
        }
    });

    const latestOrderShip = (ordersList[0] && ordersList[0].shippingInfo) || {};
    const firstAddr = addressesList[0] || {};

    const hasProfile = Boolean(
        profile.email || profile.fullname || profile.username || profile.createdAt || authUser.email || authUser.fullname || isAdmin
    );
    const roleType = isAdmin ? 'admin' : (hasProfile ? 'registered' : 'guest');

    const fallbackOrderName = latestOrderShip.fullname || [latestOrderShip.name, latestOrderShip.surname].filter(Boolean).join(' ').trim() || (ordersList[0] && ordersList[0].customerName) || '';

    const resolvedName = profile.fullname
        || profile.username
        || authUser.fullname
        || (isCurrentAdmin && auth.currentUser.displayName ? auth.currentUser.displayName : '')
        || fallbackOrderName
        || (firstAddr.fullname && firstAddr.fullname !== '-' ? firstAddr.fullname : '')
        || (authUser.email ? authUser.email.split('@')[0] : '')
        || (isAdmin ? (isCurrentAdmin ? 'Yönetici (Siz)' : 'Yönetici') : 'Misafir Kullanıcı');

    const email = profile.email
        || authUser.email
        || (isCurrentAdmin && auth.currentUser.email ? auth.currentUser.email : '')
        || latestOrderShip.email
        || '';

    const phone = profile.phone
        || authUser.phone
        || latestOrderShip.phone
        || (firstAddr.phone && firstAddr.phone !== '-' ? firstAddr.phone : '')
        || '';

    const createdAtMs = Number(profile.createdAt) || Number(authUser.createdAt) || firstOrderTs || 0;
    const lastActiveMs = Math.max(Number(profile.createdAt) || 0, Number(authUser.lastSignInAt) || 0, Number(authUser.createdAt) || 0, lastOrderTs || 0);

    return {
        uid,
        displayName: resolvedName,
        email,
        phone,
        isAdmin,
        isCurrentAdmin,
        hasProfile,
        roleType, // 'admin' | 'registered' | 'guest'
        addressesList,
        ordersList,
        addressCount: addressesList.length,
        orderCount: ordersList.length,
        totalSpent,
        totalGrossOrdered,
        createdAtMs,
        lastActiveMs,
        mergedUids: [uid],
        rawUser
    };
}

function mergeNormalizedUserRecords(primary, secondary) {
    // Siparişleri birleştir (orderKey bazında tekilleştir)
    const orderMap = new Map();
    [...(primary.ordersList || []), ...(secondary.ordersList || [])].forEach((o) => {
        if (o && o.orderKey && !orderMap.has(o.orderKey)) {
            orderMap.set(o.orderKey, o);
        }
    });
    const ordersList = Array.from(orderMap.values()).sort(
        (a, b) => (b.timestampMs - a.timestampMs) || String(b.id).localeCompare(String(a.id))
    );

    let totalSpent = 0;
    let totalGrossOrdered = 0;
    ordersList.forEach((o) => {
        totalGrossOrdered += o.grossSale;
        if (o.eligibleFinance) totalSpent += o.grossSale;
    });

    // Adresleri birleştir
    const addrMap = new Map();
    [...(primary.addressesList || []), ...(secondary.addressesList || [])].forEach((a) => {
        if (!a) return;
        const dedupKey = `${a.title || ''}|${a.fullname || ''}|${a.details || ''}`.toLowerCase();
        if (!addrMap.has(dedupKey)) {
            addrMap.set(dedupKey, a);
        }
    });
    const addressesList = Array.from(addrMap.values());

    const isAdmin = Boolean(primary.isAdmin || secondary.isAdmin);
    const isCurrentAdmin = Boolean(primary.isCurrentAdmin || secondary.isCurrentAdmin);
    const hasProfile = Boolean(primary.hasProfile || secondary.hasProfile);
    const roleType = isAdmin ? 'admin' : (hasProfile ? 'registered' : 'guest');

    const displayName = (primary.displayName && primary.displayName !== 'Misafir Kullanıcı')
        ? primary.displayName
        : (secondary.displayName || primary.displayName);

    const createdCandidates = [primary.createdAtMs, secondary.createdAtMs].filter(v => v > 0);
    const createdAtMs = createdCandidates.length > 0 ? Math.min(...createdCandidates) : 0;
    const lastActiveMs = Math.max(primary.lastActiveMs || 0, secondary.lastActiveMs || 0);

    const mergedUids = Array.from(new Set([...(primary.mergedUids || [primary.uid]), ...(secondary.mergedUids || [secondary.uid])]));

    return {
        ...primary,
        displayName,
        email: primary.email || secondary.email || '',
        phone: primary.phone || secondary.phone || '',
        isAdmin,
        isCurrentAdmin,
        hasProfile,
        roleType,
        addressesList,
        ordersList,
        addressCount: addressesList.length,
        orderCount: ordersList.length,
        totalSpent,
        totalGrossOrdered,
        createdAtMs,
        lastActiveMs,
        mergedUids
    };
}

function buildNormalizedUsersList() {
    const uidSet = new Set();
    const allUsers = (globalAdminData && globalAdminData.allUsers) || {};
    const authUsers = (globalAdminData && globalAdminData.authUsers) || {};
    const adminUsers = (globalAdminData && globalAdminData.adminUsers) || {};
    const allOrders = (globalAdminData && globalAdminData.orders) || {};

    Object.keys(allUsers).forEach(uid => { if (uid) uidSet.add(uid); });
    Object.keys(authUsers).forEach(uid => { if (uid) uidSet.add(uid); });
    Object.keys(adminUsers).forEach(uid => { if (uid && adminUsers[uid] === true) uidSet.add(uid); });
    Object.values(allOrders).forEach(ord => { if (ord && ord.userId) uidSet.add(String(ord.userId)); });
    if (auth.currentUser && auth.currentUser.uid) {
        uidSet.add(auth.currentUser.uid);
    }

    const rawRecords = Array.from(uidSet).map(uid => buildNormalizedUserRecord(uid));

    // Aynı e-posta adresine sahip kayıtlı + misafir (anonim) kayıtları tek kullanıcı altında birleştir
    const byEmail = new Map();
    const result = [];

    // Önce admin ve kayıtlı üyeler işlensin ki birincil UID her zaman kayıtlı hesap olsun
    rawRecords.sort((a, b) => {
        const score = (u) => (u.isAdmin ? 3 : (u.roleType === 'registered' ? 2 : 1));
        return score(b) - score(a);
    });

    rawRecords.forEach((rec) => {
        const normEmail = String(rec.email || '').trim().toLowerCase();
        // Hiçbir verisi, e-postası, siparişi ve adresi olmayan boş anonim oturumları listede kalabalık yapmasın
        if (!rec.isAdmin && !rec.hasProfile && !normEmail && rec.orderCount === 0 && rec.addressCount === 0) {
            return;
        }
        if (normEmail) {
            if (byEmail.has(normEmail)) {
                const existingIdx = byEmail.get(normEmail);
                result[existingIdx] = mergeNormalizedUserRecords(result[existingIdx], rec);
                return;
            }
            byEmail.set(normEmail, result.length);
        }
        result.push(rec);
    });

    return result;
}

function getNormalizedUserByUid(uid) {
    const list = buildNormalizedUsersList();
    const found = list.find(u => u.uid === uid || (Array.isArray(u.mergedUids) && u.mergedUids.includes(uid)));
    return found || buildNormalizedUserRecord(uid);
}

function renderUsers() {
    const $tbody = $('#users-table-body');
    if (!$tbody.length) return;

    const allRecords = buildNormalizedUsersList();

    const totalCount = allRecords.length;
    const adminCount = allRecords.filter(u => u.isAdmin).length;
    const registeredCount = allRecords.filter(u => !u.isAdmin && u.roleType === 'registered').length;
    const guestCount = allRecords.filter(u => !u.isAdmin && u.roleType === 'guest').length;

    $('#users-total-badge').text(`${totalCount} Kullanıcı`);
    $('#users-kpi-total').text(totalCount);
    $('#users-kpi-registered').text(registeredCount);
    $('#users-kpi-guests').text(guestCount);
    $('#users-kpi-admins').text(adminCount);

    const roleFilter = $('#user-role-filter').val() || 'all';
    const sortMode = $('#user-sort-select').val() || 'recent-desc';
    const searchTerm = ($('#user-search-input').val() || '').toLocaleLowerCase('tr').trim();

    const filtered = allRecords.filter((u) => {
        if (roleFilter === 'admin' && !u.isAdmin) return false;
        if (roleFilter === 'registered' && (u.isAdmin || u.roleType !== 'registered')) return false;
        if (roleFilter === 'guest' && (u.isAdmin || u.roleType !== 'guest')) return false;
        if (roleFilter === 'with-orders' && u.orderCount === 0) return false;

        if (searchTerm) {
            const roleKeywords = u.isAdmin ? 'yönetici admin' : (u.roleType === 'registered' ? 'kayıtlı üye' : 'misafir');
            const haystack = `${u.displayName} ${u.email} ${u.phone} ${u.uid} ${roleKeywords}`.toLocaleLowerCase('tr');
            if (!haystack.includes(searchTerm)) return false;
        }
        return true;
    });

    filtered.sort((a, b) => {
        // Yöneticiler varsayılan sıralamada veya eşitlikte kolay erişim için belirgin olsun
        switch (sortMode) {
            case 'recent-asc':
                return (a.createdAtMs || a.lastActiveMs || 0) - (b.createdAtMs || b.lastActiveMs || 0);
            case 'orders-desc':
                return (b.orderCount - a.orderCount) || (b.totalSpent - a.totalSpent);
            case 'spent-desc':
                return (b.totalSpent - a.totalSpent) || (b.orderCount - a.orderCount);
            case 'name-asc':
                return String(a.displayName).localeCompare(String(b.displayName), 'tr');
            case 'recent-desc':
            default:
                return (b.lastActiveMs - a.lastActiveMs) || (b.orderCount - a.orderCount);
        }
    });

    $tbody.empty();

    if (filtered.length === 0) {
        $tbody.append(`
            <tr>
                <td colspan="7" style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
                    <i class="fa-solid fa-users-slash" style="font-size: 1.5rem; margin-bottom: 8px; display: block; color: var(--text-light);"></i>
                    Arama veya filtre kriterlerine uygun kullanıcı bulunamadı.
                </td>
            </tr>
        `);
        return;
    }

    filtered.forEach((u) => {
        const initial = String(u.displayName || 'K').trim().charAt(0).toLocaleUpperCase('tr') || 'K';
        const avatarClass = u.isAdmin ? 'admin' : (u.roleType === 'guest' ? 'guest' : '');
        const shortUid = u.uid.length > 16 ? `${u.uid.slice(0, 8)}…${u.uid.slice(-4)}` : u.uid;

        let roleBadgeHtml = '';
        if (u.isAdmin) {
            roleBadgeHtml = `<span class="badge badge-purple"><i class="fa-solid fa-user-shield"></i> Yönetici${u.isCurrentAdmin ? ' (Siz)' : ''}</span>`;
        } else if (u.roleType === 'registered') {
            roleBadgeHtml = `<span class="badge badge-success"><i class="fa-solid fa-user-check"></i> Kayıtlı Üye</span>`;
        } else {
            roleBadgeHtml = `<span class="badge badge-warning"><i class="fa-solid fa-user-clock"></i> Misafir Alıcı</span>`;
        }

        const emailHtml = u.email
            ? `<span><i class="fa-regular fa-envelope" style="color: var(--text-light);"></i> ${esc(u.email)}</span>`
            : `<small>E-posta kaydı yok</small>`;
        const phoneHtml = u.phone
            ? `<small><i class="fa-solid fa-phone" style="font-size: 0.7rem;"></i> ${esc(u.phone)}</small>`
            : '';

        const addrBadge = u.addressCount > 0
            ? `<span class="badge badge-info"><i class="fa-solid fa-location-dot"></i> ${u.addressCount} Adres</span>`
            : `<span style="color: var(--text-light); font-size: 0.82rem;">Yok</span>`;

        const orderAndSpentHtml = u.orderCount > 0
            ? `<div style="display: flex; flex-direction: column; gap: 2px;">
                   <strong style="color: var(--primary); font-size: 0.88rem;">${u.orderCount} Sipariş</strong>
                   <span style="font-size: 0.8rem; color: #10B981; font-weight: 700;">${formatTL(u.totalSpent)}</span>
               </div>`
            : `<span style="color: var(--text-light); font-size: 0.82rem;">Sipariş Yok</span>`;

        const dateLabel = u.lastActiveMs > 0
            ? formatUserTimestamp(u.lastActiveMs, true)
            : 'Kayıt tarihi yok';

        // Adminler için silme butonu kilitlidir / yapılamaz
        const actionRightHtml = u.isAdmin
            ? `<span class="admin-lock-pill" title="Yönetici hesapları silinemez">
                   <i class="fa-solid fa-lock"></i> Korumalı
               </span>`
            : `<button type="button" class="btn-icon-sm danger btn-delete-user-row" data-uid="${esc(u.uid)}" title="Kullanıcıyı ve Verilerini Sil">
                   <i class="fa-solid fa-trash-can"></i>
               </button>`;

        $tbody.append(`
            <tr class="user-row ${u.isAdmin ? 'is-admin-row' : ''}" data-uid="${esc(u.uid)}" title="Kullanıcı detaylarını görmek için tıklayın">
                <td>
                    <div class="user-cell-main">
                        <div class="user-avatar-badge ${avatarClass}">${esc(initial)}</div>
                        <div class="user-cell-info">
                            <span class="user-cell-name">${esc(u.displayName)}</span>
                            <span class="user-cell-uid" title="${esc(u.uid)}">UID: ${esc(shortUid)}</span>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="user-contact-stack">
                        ${emailHtml}
                        ${phoneHtml}
                    </div>
                </td>
                <td>${roleBadgeHtml}</td>
                <td>${addrBadge}</td>
                <td>${orderAndSpentHtml}</td>
                <td style="font-size: 0.82rem; color: var(--text-muted);">${esc(dateLabel)}</td>
                <td style="text-align: right;">
                    <div class="user-row-actions">
                        <button type="button" class="btn-sm secondary btn-view-user" data-uid="${esc(u.uid)}">
                            <i class="fa-solid fa-eye"></i> Detay
                        </button>
                        ${actionRightHtml}
                    </div>
                </td>
            </tr>
        `);
    });
}

function openUserDetailModal(uid) {
    if (!uid) return;
    const u = getNormalizedUserByUid(uid);
    const $modal = $('#user-detail-modal');
    $modal.attr('data-uid', u.uid);

    const initial = String(u.displayName || 'K').trim().charAt(0).toLocaleUpperCase('tr') || 'K';
    const avatarClass = u.isAdmin ? 'admin' : (u.roleType === 'guest' ? 'guest' : '');
    $('#ud-avatar').attr('class', `user-detail-avatar ${avatarClass}`).text(initial);
    $('#ud-name').text(u.displayName);
    $('#ud-uid').text(u.uid);

    if (u.isAdmin) {
        $('#ud-role-badge')
            .attr('class', 'badge badge-purple')
            .html(`<i class="fa-solid fa-user-shield"></i> Yönetici${u.isCurrentAdmin ? ' (Siz)' : ''}`);
    } else if (u.roleType === 'registered') {
        $('#ud-role-badge')
            .attr('class', 'badge badge-success')
            .html(`<i class="fa-solid fa-user-check"></i> Kayıtlı Üye`);
    } else {
        $('#ud-role-badge')
            .attr('class', 'badge badge-warning')
            .html(`<i class="fa-solid fa-user-clock"></i> Misafir Alıcı`);
    }

    $('#ud-created-at').text(
        u.createdAtMs > 0 ? `Kayıt / İlk İşlem: ${formatUserTimestamp(u.createdAtMs, true)}` : 'Kayıt tarihi belirtilmemiş'
    );

    // İstatistikler
    $('#ud-stat-orders').text(u.orderCount);
    $('#ud-stat-spent').text(formatTL(u.totalSpent));
    $('#ud-stat-addresses').text(u.addressCount);
    $('#ud-stat-last-active').text(u.lastActiveMs > 0 ? formatUserTimestamp(u.lastActiveMs, false) : '-');

    // Profil & İletişim Verileri
    $('#ud-info-name').text(u.displayName || '-');
    $('#ud-info-email').text(u.email || 'Belirtilmemiş');
    $('#ud-info-phone').text(u.phone || 'Belirtilmemiş');
    $('#ud-info-type').text(
        u.isAdmin
            ? 'Yönetici (Tam Yetkili · Silinemez)'
            : (u.roleType === 'registered' ? 'Kayıtlı Müşteri Hesabı' : 'Misafir (Anonim Sipariş Kaydı)')
    );

    // Kayıtlı Adresler
    $('#ud-addr-count').text(u.addressCount);
    const $addrList = $('#ud-addresses-list');
    $addrList.empty();
    if (u.addressesList.length === 0) {
        $addrList.html(`<div class="user-empty-box" style="grid-column: 1 / -1;"><i class="fa-solid fa-map-location-dot" style="margin-right: 6px;"></i> Kullanıcının kayıtlı adresi bulunmuyor.</div>`);
    } else {
        u.addressesList.forEach((addr) => {
            const loc = [addr.district, addr.city].filter(Boolean).join(' / ');
            $addrList.append(`
                <div class="user-address-card">
                    <div class="user-address-card-head">
                        <span><i class="fa-solid fa-location-dot" style="color: var(--accent); margin-right: 5px;"></i>${esc(addr.title)}</span>
                        ${loc ? `<span class="badge badge-muted" style="font-size: 0.7rem;">${esc(loc)}</span>` : ''}
                    </div>
                    <p><strong>Alıcı:</strong> ${esc(addr.fullname)}</p>
                    <p><strong>Telefon:</strong> ${esc(addr.phone)}</p>
                    <p>${esc(addr.details)}</p>
                </div>
            `);
        });
    }

    // Sipariş Geçmişi
    $('#ud-orders-count').text(u.orderCount);
    const $ordersTbody = $('#ud-orders-tbody');
    $ordersTbody.empty();
    $('#ud-orders-select-all').prop('checked', false).prop('indeterminate', false);

    if (u.ordersList.length === 0) {
        $('#ud-orders-bulk-bar').hide();
        $('#ud-orders-select-all').prop('disabled', true);
        $ordersTbody.html(`
            <tr>
                <td colspan="7" style="text-align: center; padding: 20px; color: var(--text-light);">
                    Bu kullanıcıya ait sipariş kaydı bulunmuyor.
                </td>
            </tr>
        `);
    } else {
        $('#ud-orders-bulk-bar').css('display', 'inline-flex');
        $('#ud-orders-select-all').prop('disabled', false);
        u.ordersList.forEach((ord) => {
            const itemsArr = Array.isArray(ord.items) ? ord.items : (ord.items ? Object.values(ord.items) : []);
            const itemsText = itemsArr
                .filter(Boolean)
                .map(i => `${i.name || 'Ürün'} ×${i.quantity || 1}`)
                .join(', ') || ord.itemsSummary || 'Ürün detayı yok';
            const dateStr = ord.timestampMs > 0 ? formatUserTimestamp(ord.timestampMs, true) : 'Bilinmiyor';
            const cleanOrderId = String(ord.id || ord.orderKey).replace(/^#/, '');
            const orderOwnerUid = String(ord.userId || u.uid);

            $ordersTbody.append(`
                <tr class="ud-order-row" data-orderid="${esc(ord.orderKey)}" data-userid="${esc(orderOwnerUid)}" style="cursor: pointer;">
                    <td style="text-align: center;">
                        <input type="checkbox" class="ud-order-checkbox ud-order-row-check" value="${esc(ord.orderKey)}" data-orderid="${esc(ord.orderKey)}" data-userid="${esc(orderOwnerUid)}" data-amount="${Number(ord.grossSale) || 0}">
                    </td>
                    <td><strong style="font-family: monospace;">#${esc(cleanOrderId)}</strong></td>
                    <td style="font-size: 0.8rem; color: var(--text-muted);">${esc(dateStr)}</td>
                    <td style="max-width: 240px; font-size: 0.83rem;">${esc(itemsText)}</td>
                    <td>${getUserStatusBadgeHtml(ord.status)}</td>
                    <td style="font-weight: 700;">${formatTL(ord.grossSale)}</td>
                    <td style="text-align: right;">
                        <div class="user-row-actions">
                            <button type="button" class="btn-sm secondary btn-user-order-detail" data-orderid="${esc(ord.orderKey)}">
                                <i class="fa-solid fa-up-right-from-square"></i> Sipariş
                            </button>
                            <button type="button" class="btn-icon-sm danger btn-delete-single-user-order" data-orderid="${esc(ord.orderKey)}" data-userid="${esc(orderOwnerUid)}" data-amount="${Number(ord.grossSale) || 0}" title="Bu Siparişi Sil">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `);
        });
        syncUserOrdersBulkSelectionUI();
    }

    // Silme Butonu & Admin Koruması
    if (u.isAdmin) {
        $('#btn-open-user-delete').hide();
        $('#ud-admin-protected-badge').css('display', 'inline-flex');
    } else {
        $('#ud-admin-protected-badge').hide();
        $('#btn-open-user-delete').show();
    }

    $modal.addClass('open');
}

function syncUserOrdersBulkSelectionUI() {
    const $allChecks = $('#ud-orders-tbody .ud-order-row-check');
    const totalCount = $allChecks.length;
    let checkedCount = 0;

    $allChecks.each(function() {
        const isChecked = $(this).is(':checked');
        if (isChecked) checkedCount++;
        $(this).closest('tr.ud-order-row').toggleClass('selected-order-row', isChecked);
    });

    const $selectAll = $('#ud-orders-select-all');
    if (totalCount === 0) {
        $selectAll.prop('checked', false).prop('indeterminate', false);
    } else if (checkedCount === 0) {
        $selectAll.prop('checked', false).prop('indeterminate', false);
    } else if (checkedCount === totalCount) {
        $selectAll.prop('checked', true).prop('indeterminate', false);
    } else {
        $selectAll.prop('checked', false).prop('indeterminate', true);
    }

    $('#ud-selected-orders-badge').text(`${checkedCount} Seçildi`);
    const $delBtn = $('#btn-delete-selected-user-orders');
    if (checkedCount > 0) {
        $delBtn.prop('disabled', false).html(`<i class="fa-solid fa-trash-can"></i> Seçilen Siparişleri Sil (${checkedCount})`);
    } else {
        $delBtn.prop('disabled', true).html(`<i class="fa-solid fa-trash-can"></i> Seçilen Siparişleri Sil`);
    }
}

/* --- 2 SANİYE BASILI TUTMALI KULLANICI SİLME POP-UP SİSTEMİ --- */
let pendingDeleteUserUid = null;
let holdAnimFrameId = null;
let holdStartPerfMs = 0;
let isDeletingUserInProgress = false;
const HOLD_DELETE_DURATION_MS = 2000; // Tam 2.0 saniye basılı tutma süresi

function resetHoldDeleteButtonUI() {
    if (holdAnimFrameId) {
        cancelAnimationFrame(holdAnimFrameId);
        holdAnimFrameId = null;
    }
    holdStartPerfMs = 0;
    const $btn = $('#btn-hold-delete-user');
    $btn.removeClass('holding').prop('disabled', false);
    $('#hold-delete-fill').css('width', '0%');
    $('#hold-delete-label').html('<i class="fa-solid fa-trash-can"></i> Silmek İçin 2 Sn Basılı Tutun');
}

function closeUserDeleteModal() {
    if (isDeletingUserInProgress) return;
    resetHoldDeleteButtonUI();
    pendingDeleteUserUid = null;
    $('#user-delete-modal').removeClass('open');
}

function openUserDeleteModal(uid) {
    if (!uid) return;
    const u = getNormalizedUserByUid(uid);

    // Adminler için silme işlemi kesinlikle yapılamaz
    if (u.isAdmin) {
        showToast("Yönetici (Admin) hesapları korumalıdır ve silinemez!", "error");
        return;
    }

    pendingDeleteUserUid = u.uid;
    isDeletingUserInProgress = false;
    resetHoldDeleteButtonUI();

    $('#del-user-name').text(u.displayName);
    $('#del-user-meta').text(u.email ? `${u.email} (${u.uid})` : `UID: ${u.uid}`);

    const parts = [];
    if (u.hasProfile) parts.push('Profil kaydı');
    parts.push(`${u.addressCount} kayıtlı adres`);
    parts.push(`${u.orderCount} sipariş geçmişi`);
    $('#del-user-stats').text(parts.join(' · '));

    $('#user-delete-modal').addClass('open');
}

function initUserDeleteHoldHandler() {
    const $btn = $('#btn-hold-delete-user');
    const $modal = $('#user-delete-modal');

    $('#close-user-delete-modal, #cancel-user-delete-modal').on('click', function() {
        closeUserDeleteModal();
    });

    $modal.on('click', function(e) {
        if ($(e.target).is('#user-delete-modal')) {
            closeUserDeleteModal();
        }
    });

    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $modal.hasClass('open')) {
            closeUserDeleteModal();
        }
    });

    const startHold = (e) => {
        if (isDeletingUserInProgress || !pendingDeleteUserUid) return;
        if (e.type === 'mousedown' && e.button !== 0) return; // Sadece sol tık
        if (e.type === 'keydown' && (e.repeat || (e.key !== ' ' && e.key !== 'Enter'))) return;
        if (e.type === 'touchstart') e.preventDefault();

        // Admin kontrolünü tekrar doğrula
        if (isUserAdmin(pendingDeleteUserUid)) {
            showToast("Yönetici hesapları silinemez!", "error");
            closeUserDeleteModal();
            return;
        }

        if (holdAnimFrameId) cancelAnimationFrame(holdAnimFrameId);
        holdStartPerfMs = performance.now();
        $btn.addClass('holding');

        const step = (now) => {
            const elapsed = now - holdStartPerfMs;
            const progressPct = Math.min(100, (elapsed / HOLD_DELETE_DURATION_MS) * 100);
            const remainingSec = Math.max(0, (HOLD_DELETE_DURATION_MS - elapsed) / 1000).toFixed(1);

            $('#hold-delete-fill').css('width', `${progressPct}%`);
            $('#hold-delete-label').html(
                `<i class="fa-solid fa-fire-flame-curved"></i> Basılı Tutun... ${remainingSec} sn`
            );

            if (elapsed >= HOLD_DELETE_DURATION_MS) {
                holdAnimFrameId = null;
                executeDeleteUser(pendingDeleteUserUid);
                return;
            }
            holdAnimFrameId = requestAnimationFrame(step);
        };

        holdAnimFrameId = requestAnimationFrame(step);
    };

    const cancelHold = () => {
        if (isDeletingUserInProgress) return;
        if (holdAnimFrameId) {
            resetHoldDeleteButtonUI();
        }
    };

    $btn.on('mousedown touchstart keydown', startHold);
    $btn.on('mouseup mouseleave touchend touchcancel keyup blur', cancelHold);
}

async function executeDeleteUser(uid) {
    if (!uid || isDeletingUserInProgress) return;

    if (!auth.currentUser) {
        $('#login-modal').addClass('open');
        showToast("İşlem için yönetici girişi yapın.", "error");
        return;
    }

    if (isUserAdmin(uid)) {
        showToast("Yönetici hesapları silinemez!", "error");
        closeUserDeleteModal();
        return;
    }

    const userRecord = getNormalizedUserByUid(uid);
    const targetEmail = userRecord.email || '';
    const allTargetUids = Array.isArray(userRecord.mergedUids) && userRecord.mergedUids.length > 0
        ? userRecord.mergedUids
        : [uid];

    isDeletingUserInProgress = true;
    const $btn = $('#btn-hold-delete-user');
    $btn.removeClass('holding').prop('disabled', true);
    $('#hold-delete-fill').css('width', '100%');
    $('#hold-delete-label').html('<i class="fa-solid fa-spinner fa-spin"></i> Kullanıcı Siliniyor...');

    try {
        let deletedOk = false;
        let authRemoved = false;
        let lastErr = null;

        // 1. Önce Cloud Function (deleteUserByAdmin) ile hem Firebase Authentication hesabını hem RTDB verilerini (users + order_lookup) sil
        const deleteUserFn = httpsCallable(functions, 'deleteUserByAdmin');
        for (const targetId of allTargetUids) {
            try {
                const res = await deleteUserFn({ userId: String(targetId), email: String(targetEmail) });
                deletedOk = true;
                if (res && res.data && res.data.authDeleted) authRemoved = true;
            } catch (fnErr) {
                lastErr = fnErr;
                console.warn("Cloud Function deleteUserByAdmin error, trying direct RTDB remove:", fnErr.message);
            }
        }

        // 2. Doğrudan Realtime Database üzerinden de tüm ilişkili users/{targetId} düğümlerinin silindiğinden emin ol
        for (const targetId of allTargetUids) {
            try {
                await remove(ref(db, `users/${targetId}`));
                deletedOk = true;
            } catch (rtdbErr) {
                if (!deletedOk) lastErr = rtdbErr;
            }
        }

        if (!deletedOk && lastErr) {
            throw lastErr;
        }

        // Yerel önbellekten (globalAdminData) kullanıcıyı, Auth kaydını ve siparişlerini anında temizle
        if (globalAdminData) {
            allTargetUids.forEach((targetId) => {
                if (globalAdminData.allUsers && globalAdminData.allUsers[targetId]) {
                    delete globalAdminData.allUsers[targetId];
                }
                if (globalAdminData.authUsers && globalAdminData.authUsers[targetId]) {
                    delete globalAdminData.authUsers[targetId];
                }
                if (globalAdminData.orders) {
                    Object.keys(globalAdminData.orders).forEach((ordId) => {
                        if (globalAdminData.orders[ordId] && String(globalAdminData.orders[ordId].userId) === String(targetId)) {
                            delete globalAdminData.orders[ordId];
                        }
                    });
                }
            });
        }

        auditLog('user_delete', String(targetEmail || uid), `uid: ${allTargetUids.join(', ')}`);
        isDeletingUserInProgress = false;
        closeUserDeleteModal();
        $('#user-detail-modal').removeClass('open');

        renderUsers();
        if (typeof window.__renderOrders === 'function' && globalAdminData && globalAdminData.orders) {
            window.__renderOrders(globalAdminData.orders);
        }
        renderFinance();

        showToast(
            authRemoved
                ? "Kullanıcı hesabı (Authentication) ve tüm verileri kalıcı olarak silindi."
                : "Kullanıcı ve tüm verileri kalıcı olarak silindi.",
            "success"
        );
    } catch (error) {
        console.error("User Delete Error:", error);
        isDeletingUserInProgress = false;
        resetHoldDeleteButtonUI();
        showToast("Kullanıcı silinemedi: " + (error.message || "Yetki hatası"), "error");
    }
}

/* --- 2 SANİYE BASILI TUTMALI SİPARİŞ SİLME (TEKİL & TOPLU) POP-UP SİSTEMİ --- */
let pendingDeleteOrdersOwnerUid = null;
let pendingDeleteOrdersList = [];
let holdOrdersAnimFrameId = null;
let holdOrdersStartPerfMs = 0;
let isDeletingOrdersInProgress = false;

function resetHoldDeleteOrdersButtonUI() {
    if (holdOrdersAnimFrameId) {
        cancelAnimationFrame(holdOrdersAnimFrameId);
        holdOrdersAnimFrameId = null;
    }
    holdOrdersStartPerfMs = 0;
    const $btn = $('#btn-hold-delete-orders');
    $btn.removeClass('holding').prop('disabled', false);
    $('#hold-delete-orders-fill').css('width', '0%');
    $('#hold-delete-orders-label').html('<i class="fa-solid fa-trash-can"></i> Silmek İçin 2 Sn Basılı Tutun');
}

function closeUserOrdersDeleteModal() {
    if (isDeletingOrdersInProgress) return;
    resetHoldDeleteOrdersButtonUI();
    pendingDeleteOrdersOwnerUid = null;
    pendingDeleteOrdersList = [];
    $('#user-orders-delete-modal').removeClass('open');
}

function openUserOrdersDeleteModal(uid, selectedOrders) {
    if (!Array.isArray(selectedOrders) || selectedOrders.length === 0) return;

    const u = uid ? getNormalizedUserByUid(uid) : { displayName: 'Müşteri', email: '' };
    pendingDeleteOrdersOwnerUid = uid || (selectedOrders[0] && selectedOrders[0].userId) || '';
    pendingDeleteOrdersList = selectedOrders;
    isDeletingOrdersInProgress = false;
    resetHoldDeleteOrdersButtonUI();

    const count = selectedOrders.length;
    $('#del-orders-modal-title').text(
        count === 1 ? 'Sipariş Kalıcı Olarak Silinsin mi?' : `${count} Sipariş Kalıcı Olarak Silinsin mi?`
    );
    $('#del-orders-user-name').text(u.email ? `${u.displayName} (${u.email})` : (u.displayName || '-'));

    const previewIds = selectedOrders
        .slice(0, 4)
        .map(o => `#${String(o.orderId).replace(/^#/, '')}`)
        .join(', ');
    const moreSuffix = count > 4 ? ` +${count - 4} diğer` : '';
    $('#del-orders-count-text').text(`${count} Sipariş (${previewIds}${moreSuffix})`);

    const totalAmount = selectedOrders.reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    $('#del-orders-total-amount').text(formatTL(totalAmount));

    $('#user-orders-delete-modal').addClass('open');
}

function initUserOrdersDeleteHoldHandler() {
    const $btn = $('#btn-hold-delete-orders');
    const $modal = $('#user-orders-delete-modal');

    $('#close-user-orders-delete-modal, #cancel-user-orders-delete-modal').on('click', function() {
        closeUserOrdersDeleteModal();
    });

    $modal.on('click', function(e) {
        if ($(e.target).is('#user-orders-delete-modal')) {
            closeUserOrdersDeleteModal();
        }
    });

    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $modal.hasClass('open')) {
            closeUserOrdersDeleteModal();
        }
    });

    const startHold = (e) => {
        if (isDeletingOrdersInProgress || !pendingDeleteOrdersList.length) return;
        if (e.type === 'mousedown' && e.button !== 0) return;
        if (e.type === 'keydown' && (e.repeat || (e.key !== ' ' && e.key !== 'Enter'))) return;
        if (e.type === 'touchstart') e.preventDefault();

        if (holdOrdersAnimFrameId) cancelAnimationFrame(holdOrdersAnimFrameId);
        holdOrdersStartPerfMs = performance.now();
        $btn.addClass('holding');

        const step = (now) => {
            const elapsed = now - holdOrdersStartPerfMs;
            const progressPct = Math.min(100, (elapsed / HOLD_DELETE_DURATION_MS) * 100);
            const remainingSec = Math.max(0, (HOLD_DELETE_DURATION_MS - elapsed) / 1000).toFixed(1);

            $('#hold-delete-orders-fill').css('width', `${progressPct}%`);
            $('#hold-delete-orders-label').html(
                `<i class="fa-solid fa-fire-flame-curved"></i> Basılı Tutun... ${remainingSec} sn`
            );

            if (elapsed >= HOLD_DELETE_DURATION_MS) {
                holdOrdersAnimFrameId = null;
                executeDeleteUserOrders();
                return;
            }
            holdOrdersAnimFrameId = requestAnimationFrame(step);
        };

        holdOrdersAnimFrameId = requestAnimationFrame(step);
    };

    const cancelHold = () => {
        if (isDeletingOrdersInProgress) return;
        if (holdOrdersAnimFrameId) {
            resetHoldDeleteOrdersButtonUI();
        }
    };

    $btn.on('mousedown touchstart keydown', startHold);
    $btn.on('mouseup mouseleave touchend touchcancel keyup blur', cancelHold);
}

async function executeDeleteUserOrders() {
    if (isDeletingOrdersInProgress || !pendingDeleteOrdersList.length) return;

    if (!auth.currentUser) {
        $('#login-modal').addClass('open');
        showToast("İşlem için yönetici girişi yapın.", "error");
        return;
    }

    const ordersToRemove = [...pendingDeleteOrdersList];
    const ownerUid = pendingDeleteOrdersOwnerUid;

    isDeletingOrdersInProgress = true;
    const $btn = $('#btn-hold-delete-orders');
    $btn.removeClass('holding').prop('disabled', true);
    $('#hold-delete-orders-fill').css('width', '100%');
    $('#hold-delete-orders-label').html('<i class="fa-solid fa-spinner fa-spin"></i> Siparişler Siliniyor...');

    try {
        let deletedOk = false;
        let lastErr = null;

        // 1. Cloud Function ile hem users/{uid}/orders/{orderId} hem de order_lookup/{orderId} kayıtlarını sil
        try {
            const deleteOrdersFn = httpsCallable(functions, 'deleteUserOrdersByAdmin');
            await deleteOrdersFn({
                orders: ordersToRemove.map(item => ({
                    orderId: String(item.orderId),
                    userId: String(item.userId || ownerUid || '')
                }))
            });
            deletedOk = true;
        } catch (fnErr) {
            lastErr = fnErr;
            console.warn("Cloud Function deleteUserOrdersByAdmin error, trying direct RTDB remove:", fnErr.message);
        }

        // 2. Doğrudan Realtime Database üzerinden de ilgili sipariş düğümlerinin silindiğinden emin ol
        for (const item of ordersToRemove) {
            const targetUser = item.userId || ownerUid;
            if (!targetUser || !item.orderId) continue;
            try {
                await remove(ref(db, `users/${targetUser}/orders/${item.orderId}`));
                deletedOk = true;
            } catch (rtdbErr) {
                if (!deletedOk) lastErr = rtdbErr;
            }
        }

        if (!deletedOk && lastErr) {
            throw lastErr;
        }

        // Yerel önbellekten (globalAdminData) silinen siparişleri anında temizle
        if (globalAdminData) {
            ordersToRemove.forEach((item) => {
                const ordId = String(item.orderId);
                const tUid = String(item.userId || ownerUid || '');
                if (globalAdminData.orders && globalAdminData.orders[ordId]) {
                    delete globalAdminData.orders[ordId];
                }
                if (tUid && globalAdminData.allUsers?.[tUid]?.orders?.[ordId]) {
                    delete globalAdminData.allUsers[tUid].orders[ordId];
                }
            });
        }

        auditLog('order_delete', `${ordersToRemove.length} sipariş`, ordersToRemove.map(o => '#' + o.orderId).join(', '));
        isDeletingOrdersInProgress = false;
        closeUserOrdersDeleteModal();

        // Açık olan Kullanıcı Detay modalını ve arka plandaki tüm tabloları/grafikleri anında güncelle
        if (ownerUid && $('#user-detail-modal').hasClass('open')) {
            openUserDetailModal(ownerUid);
        }
        renderUsers();
        if (typeof window.__renderOrders === 'function' && globalAdminData && globalAdminData.orders) {
            window.__renderOrders(globalAdminData.orders);
        }
        renderFinance();

        showToast(
            ordersToRemove.length === 1
                ? "Seçilen sipariş kalıcı olarak silindi."
                : `${ordersToRemove.length} adet sipariş kalıcı olarak silindi.`,
            "success"
        );
    } catch (error) {
        console.error("User Orders Delete Error:", error);
        isDeletingOrdersInProgress = false;
        resetHoldDeleteOrdersButtonUI();
        showToast("Siparişler silinemedi: " + (error.message || "Yetki hatası"), "error");
    }
}


