/* Sipariş sonrası misafir müşteriye tek alanlı hesap oluşturma penceresi (ödeme sayfası ve iyzico dönüş sayfası ortak kullanır).
   Ad ve e-posta siparişten gelir; müşteri yalnızca şifre yazar. Misafir (anonim) oturum e-posta kimliğine BAĞLANIR (linkWithCredential):
   uid değişmez, bu yüzden az önce verilen sipariş (ve öncekiler) yeni hesabın Siparişlerim listesinde görünür. */

const SDK = 'https://www.gstatic.com/firebasejs/10.7.1/';
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

/* iyzico'ya giderken ad/e-posta saklanır; dönüş sayfası (result.html) pencereyi buradan açar */
const HINT_KEY = 'engrare_misafir_ipucu';
const HINT_TTL = 3 * 60 * 60 * 1000;

export function rememberGuest(name, email) {
    try { localStorage.setItem(HINT_KEY, JSON.stringify({ name, email, at: Date.now() })); } catch (e) { /* özel gezinti: pencere açılmaz */ }
}

export function takeGuestHint() {
    try {
        const hint = JSON.parse(localStorage.getItem(HINT_KEY) || 'null');
        localStorage.removeItem(HINT_KEY);
        return hint && hint.email && Date.now() - hint.at < HINT_TTL ? hint : null;
    } catch (e) { return null; }
}

// Simgeler satır içi SVG: iyzico dönüş sayfasında Font Awesome yok
const ICON_USER = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>';
const ICON_CHECK = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
.ga-overlay { position: fixed; inset: 0; z-index: 4000; display: flex; align-items: center; justify-content: center; padding: 16px;
    background: rgba(15, 23, 42, 0.55); opacity: 0; transition: opacity .2s; font-family: 'Plus Jakarta Sans', sans-serif; }
.ga-overlay.show { opacity: 1; }
.ga-card { position: relative; width: 100%; max-width: 400px; max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box;
    background: #fff; border-radius: 18px; padding: 28px 22px 20px; text-align: center; box-shadow: 0 20px 50px rgba(15, 23, 42, .3);
    transform: translateY(12px); transition: transform .2s; }
.ga-overlay.show .ga-card { transform: none; }
.ga-close { position: absolute; top: 6px; right: 8px; width: 32px; height: 32px; border: none; background: none; color: #94A3B8; font-size: 1.3rem; cursor: pointer; }
.ga-icon { width: 54px; height: 54px; margin: 0 auto 12px; border-radius: 50%; background: #EFF6FF; color: #3B82F6; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; }
.ga-card h3 { margin: 0 0 6px; font-size: 1.15rem; color: #0F172A; }
.ga-card p { margin: 0 0 14px; font-size: .88rem; line-height: 1.5; color: #64748B; }
.ga-info { text-align: left; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 4px 14px; margin-bottom: 12px; }
.ga-info div { padding: 8px 0; }
.ga-info div + div { border-top: 1px solid #E2E8F0; }
.ga-info small { display: block; font-size: .68rem; text-transform: uppercase; letter-spacing: .4px; color: #94A3B8; font-weight: 700; }
.ga-info b { display: block; font-size: .92rem; color: #0F172A; overflow-wrap: anywhere; }
.ga-pass { position: relative; margin-bottom: 8px; }
.ga-pass input { width: 100%; box-sizing: border-box; height: 48px; padding: 0 62px 0 14px; border: 1.5px solid #E2E8F0; border-radius: 10px; font: inherit; font-size: 16px; }
.ga-pass input:focus { outline: none; border-color: #3B82F6; }
.ga-pass button { position: absolute; right: 0; top: 0; width: 62px; height: 48px; border: none; background: none; color: #64748B; cursor: pointer; font: inherit; font-size: .78rem; font-weight: 700; }
.ga-err { min-height: 18px; margin: 0 0 6px !important; font-size: .8rem !important; color: #DC2626 !important; text-align: left; }
.ga-err a { color: #3B82F6; font-weight: 700; }
.ga-submit { width: 100%; height: 48px; border: none; border-radius: 10px; background: #0F172A; color: #fff; font: inherit; font-weight: 700; font-size: .95rem; cursor: pointer; }
.ga-submit:disabled { opacity: .6; cursor: default; }
.ga-skip { margin-top: 6px; padding: 10px; border: none; background: none; color: #94A3B8; font: inherit; font-size: .82rem; cursor: pointer; }
.ga-note { margin: 4px 0 0 !important; font-size: .7rem !important; color: #94A3B8 !important; }
.ga-note a { color: inherit; }
.ga-done a { display: block; line-height: 48px; border-radius: 10px; background: #0F172A; color: #fff; text-decoration: none; font-weight: 700; margin-top: 6px; }
`;

async function loadSdk() {
    const [appM, authM, dbM] = await Promise.all(['firebase-app', 'firebase-auth', 'firebase-database'].map(m => import(`${SDK}${m}.js`)));
    const app = appM.getApps()[0] || appM.initializeApp(firebaseConfig);
    return { authM, dbM, auth: authM.getAuth(app), db: dbM.getDatabase(app) };
}

export function offerGuestAccount(name, email) {
    if (!email || document.querySelector('.ga-overlay')) return;
    if (!document.getElementById('ga-style')) {
        const st = document.createElement('style');
        st.id = 'ga-style';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    const root = document.createElement('div');
    root.className = 'ga-overlay';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'ga-title');
    root.innerHTML = `
        <div class="ga-card">
            <button type="button" class="ga-close" aria-label="Kapat">&times;</button>
            <div class="ga-body">
                <div class="ga-icon">${ICON_USER}</div>
                <h3 id="ga-title">Siparişlerinizi hesabınızdan takip edin</h3>
                <p>Bu bilgilerle hesabınız hazır, yalnızca bir şifre belirlemeniz yeterli.</p>
                <div class="ga-info">
                    ${name ? `<div><small>Ad Soyad</small><b>${esc(name)}</b></div>` : ''}
                    <div><small>E-posta</small><b>${esc(email)}</b></div>
                </div>
                <form class="ga-form" novalidate>
                    <div class="ga-pass">
                        <input type="password" class="ga-input" placeholder="Şifre belirleyin (en az 6 karakter)" autocomplete="new-password" aria-label="Şifre">
                        <button type="button" class="ga-eye" aria-label="Şifreyi göster">Göster</button>
                    </div>
                    <p class="ga-err" role="alert"></p>
                    <button type="submit" class="ga-submit">Hesap Oluştur</button>
                </form>
                <button type="button" class="ga-skip">Şimdi değil</button>
                <p class="ga-note">Hesap oluşturarak <a href="/mevzuat/kvkk/" target="_blank">KVKK Aydınlatma Metni</a>'ni okuduğunuzu kabul edersiniz.</p>
            </div>
        </div>`;
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('show'));

    const $ = (sel) => root.querySelector(sel);
    const input = $('.ga-input'), err = $('.ga-err'), submit = $('.ga-submit');
    const close = () => { root.classList.remove('show'); setTimeout(() => root.remove(), 200); };
    $('.ga-close').onclick = close;
    $('.ga-skip').onclick = close;
    if (window.matchMedia('(hover: hover)').matches) input.focus();

    $('.ga-eye').onclick = () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        $('.ga-eye').textContent = show ? 'Gizle' : 'Göster';
    };

    $('.ga-form').onsubmit = async (e) => {
        e.preventDefault();
        err.textContent = '';
        const pass = input.value;
        if (pass.length < 6) { err.textContent = 'Şifre en az 6 karakter olmalı.'; input.focus(); return; }
        submit.disabled = true;
        submit.textContent = 'Hesap oluşturuluyor...';
        try {
            const { authM, dbM, auth, db } = await loadSdk();
            await auth.authStateReady();
            let user = auth.currentUser;
            if (user && !user.isAnonymous) { close(); return; } // zaten üye
            if (user) {
                user = (await authM.linkWithCredential(user, authM.EmailAuthProvider.credential(email, pass))).user;
            } else {
                user = (await authM.createUserWithEmailAndPassword(auth, email, pass)).user;
            }
            if (name) await authM.updateProfile(user, { displayName: name });
            await user.getIdToken(true); // profil e-posta kuralı yeni jetonu ister
            try {
                await dbM.set(dbM.ref(db, `users/${user.uid}/profile`), { fullname: name || '', email, createdAt: Date.now() });
            } catch (dbErr) {
                console.warn('Profil yazılamadı (hesap yine de hazır):', dbErr);
            }
            localStorage.setItem('engrare_uye', '1');
            $('.ga-body').innerHTML = `
                <div class="ga-done">
                    <div class="ga-icon" style="background:#F0FDF4;color:#16a34a">${ICON_CHECK}</div>
                    <h3>Hesabınız hazır</h3>
                    <p>Siparişleriniz artık profilinizde. Bir sonraki girişte e-posta ve şifrenizi kullanın.</p>
                    <a href="/?dashboard">Siparişlerime git</a>
                    <button type="button" class="ga-skip ga-ok">Kapat</button>
                </div>`;
            $('.ga-ok').onclick = close;
        } catch (error) {
            console.warn('Hesap oluşturulamadı:', error.code || error.message);
            const used = error.code === 'auth/email-already-in-use' || error.code === 'auth/credential-already-in-use';
            err.innerHTML = used
                ? 'Bu e-postayla zaten bir hesap var. <a href="/?login">Giriş yapın</a>.'
                : error.code === 'auth/weak-password' ? 'Şifre çok zayıf, en az 6 karakter kullanın.'
                : 'Hesap oluşturulamadı, lütfen tekrar deneyin.';
            submit.disabled = false;
            submit.textContent = 'Hesap Oluştur';
        }
    };
}
