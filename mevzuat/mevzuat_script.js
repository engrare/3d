/* ---------------------------------------------------------------------------
   Mevzuat sayfaları için hafif üst menü betiği.

   Önceden bu statik metin sayfaları yalnızca sepet rozetini ve giriş/profil
   düğmesini güncellemek için jQuery (~89 KB) + Firebase app & auth (~180 KB)
   indiriyordu. Artık jQuery hiç yüklenmiyor ve Firebase yalnızca ilk çizimden
   sonra, arka planda geliyor.
   --------------------------------------------------------------------------- */

const firebaseConfig = {
    apiKey: "AIzaSyBM7oB0EkTjGJiOHdo67ByXA6qxVcvPS8Y",
    authDomain: "engrar3d.firebaseapp.com",
    databaseURL: "https://engrar3d-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "engrar3d",
    storageBucket: "engrar3d.firebasestorage.app",
    messagingSenderId: "68298863793",
    appId: "1:68298863793:web:ba7ec7ded3424b4c779e90"
};

const $id = (id) => document.getElementById(id);
const show = (el, mode) => { if (el) el.style.display = mode; };

/* Sepet rozeti — localStorage'dan, ağ isteği olmadan */
function updateCartBadge() {
    const badge = $id('cart-badge');
    if (!badge) return;
    try {
        const cart = JSON.parse(localStorage.getItem('engrare_cart') || '[]');
        badge.textContent = Array.isArray(cart) ? cart.length : 0;
    } catch (e) {
        badge.textContent = '0';
    }
}

function setLoggedIn(isIn) {
    show($id('nav-login-btn'),       isIn ? 'none' : 'flex');
    show($id('nav-user-profile'),    isIn ? 'flex' : 'none');
    show($id('nav-logout-container'), isIn ? 'flex' : 'none');
}

async function initAuth() {
    const [{ initializeApp }, { getAuth, onAuthStateChanged, signOut }] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js")
    ]);

    const auth = getAuth(initializeApp(firebaseConfig));

    onAuthStateChanged(auth, (user) => setLoggedIn(!!user && !user.isAnonymous));

    const logout = $id('action-logout');
    if (logout) {
        logout.addEventListener('click', () => {
            signOut(auth).then(() => { window.location.href = "../../?products"; });
        });
    }
}

function boot() {
    updateCartBadge();
    setLoggedIn(false);
    // Firebase'i kritik yoldan çıkar: sayfa çizildikten sonra yükle
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => initAuth(), { timeout: 2000 });
    } else {
        setTimeout(initAuth, 200);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
