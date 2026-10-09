import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { getDatabase, ref, get, set, update, remove, onValue } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import { products as BASE_PRODUCTS } from "../products.js";

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
let serverTimeOffset = 0;

const TAX_EXEMPTION_LIMIT = 1900000; // 1.900.000 TL vergi muafiyeti ciro limiti

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
    if (abs >= 1000) return `${sign}₺${(abs / 1000).toFixed(1)}B`;
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
            await signInWithEmailAndPassword(auth, email, password);
            
            showToast("Yönetici girişi başarılı.", "success");
            $('#login-modal').removeClass('open');
            
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
            if (adminDataUnsubscribe) { adminDataUnsubscribe(); adminDataUnsubscribe = null; }
            if (usersOrdersUnsubscribe) { usersOrdersUnsubscribe(); usersOrdersUnsubscribe = null; }
            if (await ensureMfaVerified(auth.currentUser)) loadDataIfAdmin();
        }
    });

    // 4. Close Modal
    $('.modal-close, .modal-overlay').click(function(e) {
        if (e.target === this) {
            // Giriş yapılmadan (kilitliyken) giriş penceresi kapatılamaz
            if ($('body').hasClass('auth-locked') && $(this).closest('#login-modal').length) return;
            $('#login-modal').removeClass('open');
            $('#expense-modal').removeClass('open');
            $('#admin-password-modal').removeClass('open');
            $('#discount-modal').removeClass('open');
            $('#bambu-2fa-modal').removeClass('active'); // Close 2FA modal too
        }
    });

    // --- İKİ ADIMLI DOĞRULAMA (2FA) ---
    // Giriş sonrası checkMfaStatus çağrılır; damga yoksa panel açılmaz (veri zaten RTDB kurallarıyla kilitli).
    const callFn = (name, data) => httpsCallable(functions, name)(data || {}).then(r => r.data);
    let mfaResendTimer = null;

    async function ensureMfaVerified(user) {
        const deviceToken = localStorage.getItem('engrare_mfa_device_' + user.uid) || '';
        // checkMfaStatus required bayrağını yazar; çağrılamazsa RTDB kuralları veriyi vermez.
        // Geçici ağ hatalarına karşı birkaç kez denenir.
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await callFn('checkMfaStatus', { deviceToken });
                if (!res.required || res.verified) return true;
                openMfaModal();
                return false;
            } catch (error) {
                console.warn(`2FA durumu alınamadı (deneme ${attempt + 1}):`, error.message);
                if (attempt < 2) await new Promise(r => setTimeout(r, 1500));
            }
        }
        showToast("Doğrulama durumu alınamadı. Lütfen sayfayı yenileyin.", "error");
        return false;
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
        } catch (error) {
            showToast("Eklenemedi: " + (error.message || "Bilinmeyen hata"), "error");
        } finally {
            $btn.prop('disabled', false);
        }
    });

    $('#mfa-email-list').on('click', '.mfa-email-remove', async function() {
        const email = $(this).data('email');
        if (!confirm(`"${email}" için 2FA kaldırılsın mı?`)) return;
        try {
            const res = await callFn('removeMfaEmail', { email });
            renderMfaEmails(res.emails || []);
            showToast("2FA bu e-posta için kaldırıldı.", "success");
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

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            $('#admin-name').text(user.displayName || "Yönetici");
            $('#admin-role').text("Kontrol ediliyor...");
            $('#admin-avatar').attr('src', user.photoURL || "../content/images/default_user.png");
            $('#admin-logout-btn').show();
            renderAdminSelf(user);

            // 2FA damgası yoksa panel açılmaz; doğrulanınca loadDataIfAdmin çağrılır
            if (await ensureMfaVerified(user)) {
                setAuthLock(false);
                loadDataIfAdmin();
            } else {
                // 2FA bekleniyor: panel kilitli kalır, kod penceresi gösterilir.
                // Durum alınamadıysa (kod penceresi açılmadıysa) giriş penceresi açık kalır.
                if ($('#mfa-modal').hasClass('open')) $('#login-modal').removeClass('open');
            }
        } else {
            $('#admin-name').text("Giriş Yap");
            $('#admin-role').text("Misafir");
            $('#admin-avatar').attr('src', "../content/images/default_user.png");
            $('#admin-logout-btn').hide();
            renderAdminSelf(null);
            $('#mfa-modal').removeClass('open');
            $('#mfa-emails-card').hide();
            if (adminDataUnsubscribe) { adminDataUnsubscribe(); adminDataUnsubscribe = null; }
            if (usersOrdersUnsubscribe) { usersOrdersUnsubscribe(); usersOrdersUnsubscribe = null; }
            setAuthLock(true);
        }
    });

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

        // 5. 2FA e-posta listesi (yalnızca doğrulanmış yönetici)
        $('#mfa-emails-card').show();
        loadMfaEmails();

        // Initial fleet refresh on load
        refreshFleetStatus();
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

    function showPage(page) {
        const { $nav, target } = pages.get(page);
        currentPage = page;
        $('.nav-item').removeClass('active');
        $nav.addClass('active');
        $('.content-section').hide().removeClass('active');
        $(target).fadeIn(300).addClass('active');
        if (target === '#finance-section' || target === '#dashboard-section') {
            renderFinance();
        } else if (target === '#users-section') {
            renderUsers();
        }
    }

    $('.nav-item[data-page]').click(function() {
        const page = $(this).data('page');
        if (page !== currentPage) history.pushState(null, '', location.pathname + '?' + page);
        showPage(page);
    });

    window.addEventListener('popstate', () => showPage(pageFromUrl() || DEFAULT_PAGE));

    const initialPage = pageFromUrl();
    if (!initialPage) history.replaceState(null, '', location.pathname + '?' + DEFAULT_PAGE);
    showPage(initialPage || DEFAULT_PAGE);

    // --- NEW: FLEET MANAGEMENT ---
    
    $('#btn-refresh-fleet').click(function() {
        refreshFleetStatus();
    });

    // --- 2FA MODAL HANDLER ---
    function promptFor2FA() {
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

            // Handle Resend (Direct Call)
            const onResend = async (e) => {
                e.preventDefault();
                $resendBtn.css({ 'pointer-events': 'none', 'opacity': '0.5' }); 
                // ponytail: yazıcı (Bambu) bağlantısı kapalı; sunucuda getAllPrintersStatus fonksiyonu yok.
                // Filo modülü yeniden açılınca kod gönderme çağrısı buraya geri eklenecek.
                showToast("Yazıcı bağlantısı şu an kapalı.", "info");
                $resendBtn.css({ 'pointer-events': 'auto', 'opacity': '1' });
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
        if (data.dashboard && data.dashboard.live_status) {
            $('#live-status-msg').text(data.dashboard.live_status.message);
        }

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

        sortedOrders.forEach(([key, order]) => {
            const isPriority = isPriorityOrder(order);
            const priorityKeywords = isPriority ? 'öncelikli hızlı express' : 'standart';
            const ship = order.shippingInfo || {};
            const customerName = ship.fullname || [ship.name, ship.surname].filter(Boolean).join(' ').trim() || order.customerName || '-';
            // Search Filter
            const searchString = `${key} ${customerName} ${ship.email || ''} ${ship.phone || ''} ${order.userId || ''} ${order.status || ''} ${priorityKeywords}`.toLocaleLowerCase('tr');
            if (searchTerm && !searchString.includes(searchTerm)) {
                return; // Skip if doesn't match
            }
            
            // Format Currency
            const total = (parseFloat(order.totalAmount) || 0).toFixed(2);
            const userId = esc(order.userId || '');
            const safeKey = esc(key);
            const customerDisplay = `<span style="font-weight: 600; color: var(--text-main);">${esc(customerName)}</span>`;
            const productionBadge = isPriority
                ? `<span class="badge badge-priority" title="Öncelikli Üretim (2-3 iş günü)"><i class="fa-solid fa-bolt"></i> Öncelikli</span>`
                : `<span class="badge badge-muted">Standart</span>`;

            $orderTable.append(`
                <tr class="${isPriority ? 'priority-order-row' : ''}">
                    <td><input type="checkbox" class="order-checkbox" value="${safeKey}" data-userid="${userId}"></td>
                    <td><span style="font-family: monospace; font-weight: 700;">#${safeKey}</span></td>
                    <td>${productionBadge}</td>
                    <td>${getStatusBadge(order.status)}</td>
                    <td style="font-weight: 600;">₺${total}</td>
                    <td>${customerDisplay}</td>
                    <td style="overflow: visible;">
                        <div class="action-dropdown">
                            <button class="btn-sm secondary view-details-btn" data-id="${safeKey}">
                                <i class="fa-solid fa-eye"></i> Detay
                            </button>
                            <button class="btn-icon action-trigger" data-id="${safeKey}"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                            <div class="dropdown-menu">
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

            if(!orderId || !newStatus || !userId) {
                showToast("Hata: Kullanıcı veya sipariş bilgisi eksik.", "error");
                return;
            }
            
            showToast(`Durum güncelleniyor: ${newStatus}...`, "info");

            try {
                // Update in User's path
                await update(ref(db, `users/${userId}/orders/${orderId}`), {
                    status: newStatus
                });
                showToast("Durum başarıyla güncellendi.", "success");

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
        $('#modal-shipping-method').text(order.shippingMethod || 'Standart');
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
                    detailsHtml += `<span style="font-size: 0.75rem;"><a href="${logoUrl}" target="_blank" rel="noopener noreferrer">Müşteri logosunu aç</a></span><br>`;
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
                        <td>₺${(parseFloat(item.price) || 0).toFixed(2)}</td>
                        <td>${esc(item.quantity || 1)}</td>
                        <td style="font-weight: 600;">₺${((parseFloat(item.price) || 0) * (Number(item.quantity) || 1)).toFixed(2)}</td>
                    </tr>
                `);
            });
        }

        // Totals
        $('#modal-subtotal').text('₺' + parseFloat(order.subtotal || 0).toFixed(2));
        $('#modal-shipping-cost').text('₺' + parseFloat(order.shippingCost || 0).toFixed(2));
        $('#modal-discount').text('-₺' + parseFloat(order.discountAmount || 0).toFixed(2));
        $('#modal-total').text('₺' + parseFloat(order.totalAmount || 0).toFixed(2));

        // Open
        $('#order-detail-modal').addClass('open');
    }

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

    // Search & Sort Listeners
    $('#order-search-input').on('input', function() {
        if (globalAdminData && globalAdminData.orders) {
            renderOrders(globalAdminData.orders);
        }
    });

    $('#order-sort-select').on('change', function() {
        if (globalAdminData && globalAdminData.orders) {
            renderOrders(globalAdminData.orders);
        }
    });

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
            t: currentInputs.t,
            updatedAt: Date.now()
        };

        try {
            await set(ref(db, 'admin/pricing'), payload);
            $('#pricing-sync-badge').text('Firebase Kayıtlı').attr('class', 'badge badge-success');
            showToast("Fiyatlandırma parametreleri Firebase'e kaydedildi.", "success");
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

    // Üretim süresi değişince o satırın fiyatını anında yeniden hesapla
    $('#products-admin-list').on('input', '.product-hours-input', function() {
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
        let invalid = false;

        $('#products-admin-list .product-admin-row').each(function() {
            const $row = $(this);
            const id = String($row.data('product-id'));
            const name = String($row.find('.product-name-input').val() || '').trim();
            const hours = Number(String($row.find('.product-hours-input').val() ?? '').replace(',', '.'));
            if (!name || !Number.isFinite(hours) || hours <= 0) { invalid = true; return; }
            const price = roundPriceToNine(hesaplaSatisFiyati({ ...params, t: hours }));
            updates[`config/products/${id}`] = {
                name: name.slice(0, 120),
                price: price,
                productionHours: Math.round(hours * 100) / 100,
                updatedAt: Date.now()
            };
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
            await remove(ref(db, `admin/finance/expenses/${expId}`));
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
    //    Kargo kâr çarpanı/fire almaz, maliyetinde eklenir
    const hedefTutar = hamMaliyet * k_kar + K_kargo;

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
        const $value = $row.find('.product-price-value');
        const $raw = $row.find('.product-price-raw');
        if (Number.isFinite(hours) && hours > 0) {
            const raw = hesaplaSatisFiyati({ ...params, t: hours });
            const price = roundPriceToNine(raw);
            // Tek adetlik siparişin kârı: finans sekmesiyle aynı kesintiler (kartlı ödeme varsayımı)
            const ham = hesaplaHamMaliyet({ ...params, t: hours });
            const iyzicoCut = Math.max(0, price - Math.max(0, price * (1 - params.c_oran) - params.c_sabit));
            const stateTax = (price - iyzicoCut) * params.v_devlet;
            const brut = price - ham;
            const net = price - (ham + params.K_kargo + iyzicoCut + stateTax);
            $value.text(formatTL(price)).data('price', price);
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
    const grossSale = getOrderGrossSale(order);
    const baseCost = calculateOrderBaseCost(order, p);
    if (grossSale <= 0 && baseCost <= 0) {
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
    const viaIyzico = order.paymentMethod !== 'iban' && grossSale > 0;
    const iyzicoYatan = viaIyzico ? Math.max(0, grossSale * (1 - p.c_oran) - p.c_sabit) : grossSale;
    const iyzicoCut = Math.max(0, grossSale - iyzicoYatan);
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

    // 1. Vergi Muafiyet Ciro Limiti (1.900.000 TL) — Giderlerden BAĞIMSIZ, brüt ciro üzerinden
    const remainingLimit = Math.max(0, TAX_EXEMPTION_LIMIT - totalRevenue);
    const limitPercent = (totalRevenue / TAX_EXEMPTION_LIMIT) * 100;

    $('#tax-current').text(`Mevcut Ciro: ${formatTL(totalRevenue)} (${activeOrderCount} aktif sipariş)`);
    $('#tax-remaining').text(`Kalan Hak: ${formatTL(remainingLimit)}`);
    $('#tax-limit').text(`Limit: ${formatTL(TAX_EXEMPTION_LIMIT)}`);
    $('#tax-bar').css('width', `${Math.min(100, Math.max(0, limitPercent))}%`);

    const $taxDesc = $('#tax-desc');
    const $taxBadge = $('#tax-badge');
    $taxDesc.removeClass('warn danger');

    if (totalRevenue >= TAX_EXEMPTION_LIMIT) {
        $taxDesc.addClass('danger').html(`<i class="fa-solid fa-triangle-exclamation"></i> Vergi muafiyeti ciro limiti (₺1.900.000) aşıldı! (%${limitPercent.toFixed(2)})`);
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
}

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
        const img = (p.images && p.images[0] && p.images[0].src) ? resolveAssetPath(p.images[0].src) : '';
        return `
            <div class="product-admin-row" data-product-id="${p.id}">
                <div class="product-admin-thumb">
                    ${img ? `<img src="${esc(img)}" alt="${esc(name)}">` : '<i class="fa-solid fa-box"></i>'}
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
        .then(() => showToast("İndirim kodu silindi.", "success"))
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


