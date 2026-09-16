import { getPreviewImage } from './preview-engine.js';

// --- FIREBASE CONFIG ---
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

/* --------------------------------------------------------------------------
   FIREBASE: TEMBEL (LAZY) YUKLEME
   Onceden 4 Firebase SDK modulu (~400 KB) statik import ediliyordu; bu yuzden
   urunler ekrana basilmadan once tamaminin inip ayrisitirilmasi gerekiyordu.
   Artik SDK arka planda, ilk cizimden SONRA yukleniyor. Firebase'e ihtiyac
   duyan her isleyici basinda `await fbReady()` cagiriyor.
   -------------------------------------------------------------------------- */
let auth, db, storage;
let createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
    onAuthStateChanged, updateProfile, signInAnonymously, sendPasswordResetEmail;
let ref, set, onValue, remove, get;
let storageRef, uploadBytes, getDownloadURL, deleteObject;

let _fbPromise = null;
function fbReady() {
    if (!_fbPromise) {
        _fbPromise = Promise.all([
            import("firebase/app"),
            import("firebase/auth"),
            import("firebase/database"),
            import("firebase/storage")
        ]).then(([appM, authM, dbM, stM]) => {
            ({ createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
               onAuthStateChanged, updateProfile, signInAnonymously,
               sendPasswordResetEmail } = authM);
            ({ ref, set, onValue, remove, get } = dbM);
            storageRef      = stM.ref;
            uploadBytes     = stM.uploadBytes;
            getDownloadURL  = stM.getDownloadURL;
            deleteObject    = stM.deleteObject;

            const app = appM.initializeApp(firebaseConfig);
            auth    = authM.getAuth(app);
            db      = dbM.getDatabase(app);
            storage = stM.getStorage(app);
        });
    }
    return _fbPromise;
}

/* Oturum kalıcı depodan geri yüklenene kadar bekler. SDK yeni indiğinde
   auth.currentUser henüz null olabilir; bu durumda giriş yapmış kullanıcı
   misafir sanılıyor, hatta anonim oturumla eziliyordu. */
async function authReady() {
    await fbReady();
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
        });
    });
}

/* --- XSS KORUMASI ---
   Kullanıcının girdiği metinler (sepet, sipariş, adres) HTML'e yazılmadan önce
   kaçışlanır; stil içine giren renk ve adresler ayrıca doğrulanır. */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeColor(value, fallback) {
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/* CSS url(...) ve src içinde güvenle kullanılabilecek adres (tırnak/parantez içermez) */
function safeUrl(value) {
    return (typeof value === 'string' && /^[A-Za-z0-9\-._~:/?#@!$&+,=%;]+$/.test(value)) ? value : '';
}

const MAX_QUANTITY = 999;
function clampQty(value) {
    const qty = parseInt(value, 10);
    if (isNaN(qty) || qty < 1) return 1;
    return Math.min(qty, MAX_QUANTITY);
}

let cart = [];
let currentProduct = null;

// --- BASİTLEŞTİRİLMİŞ ÜRÜN DATASI ---
const products = [
    {
        id: 1,
        name: "Araba İçi Numaratör",
        desc: "Basarak aç kapa yapılabilen elegant numaratör.",
		customTextLabel: "araç içinde görünecek telefon numaranızı giriniz.",
		customTextPlaceholder: "Örn: 0541 555 55 55",
		customTextPlaceholderPreview: "0541 555 55 55",
		fixedTextSize: 48,
		fixedLogoSize: 48,
        price: 179.90,
        isDashedLine: false,
        images: [
            { src: "./content/products/1/3.jpg" },
            { src: "./content/products/1/2.jpg" },
            { src: "./content/products/1/1.jpg" },
            { src: "./content/products/1/4.jpg" }
        ],
        previewTextArea: { top: '13.6%', left: '10.4%', width: '78.2%', height: '34.6%' },
        previewLogoArea: { top: '0.0%', left: '7.2%', width: '85.7%', height: '100.0%' },
		 colors: [
            { color1: "#FBC02D", color2: "#222222", label1: "Yazı", label2: "Zemin" },
            { color1: "#FFFFFF", color2: "#1976D2", label1: "Yazı", label2: "Zemin" },
            { color1: "#222222", color2: "#FFFFFF", label1: "Yazı", label2: "Zemin" },
            { color1: "#E91E63", color2: "#388E3C", label1: "Yazı", label2: "Zemin" }
        ],
    },
    {
        id: 2,
        name: "Duvara Yapışmalı Özel Ad Plakası",
        desc: "Kapı veya duvarlar için tasarlanmış isimlik.",
        price: 180,
        allowLogo: true,
        isDashedLine: false,
        images: [
            { src: "./content/products/2/1.jpg" },
            { src: "./content/products/2/2.jpg" },
            { src: "./content/products/2/3.jpg" },
            { src: "./content/products/2/4.jpg" }
        ],
        previewTextArea: { top: '49.2%', left: '6.5%', width: '86.6%', height: '44.8%' },
        previewLogoArea: { top: '8.6%', left: '2.8%', width: '93.9%', height: '42.0%' },
		 colors: [
            { color1: "#FBC02F", color2: "#222222", label1: "Yazı", label2: "Zemin" },
            { color1: "#FFFFFF", color2: "#1976D2", label1: "Yazı", label2: "Zemin" },
            { color1: "#222222", color2: "#FFFFFF", label1: "Yazı", label2: "Zemin" },
            { color1: "#E91E63", color2: "#388E3C", label1: "Yazı", label2: "Zemin" }
        ],
    },
	{
        id: 3,
        name: "Kişiselleştirilmiş QR & Kartvizit Standı",
        desc: "İhtiyacınıza göre şekillenen profesyonel kartvizitlik.",
        price: 180,
		isCustomObject: [
            { 
                objectName: "1 Kartvizit Bölmeli", 
                src: "./content/products/5/preview-1-bolme.png",
                previewSocialLogo1: { top_left_x: '42.0%', top_left_y: '38.0%', top_right_x: '48.0%', top_right_y: '34.0%', bottom_right_x: '48.0%', bottom_right_y: '42.0%', bottom_left_x: '42.0%', bottom_left_y: '46.0%' },
                previewSocialQR1: { top_left_x: '42.0%', top_left_y: '50.0%', top_right_x: '55.0%', top_right_y: '40.0%', bottom_right_x: '55.0%', bottom_right_y: '60.0%', bottom_left_x: '42.0%', bottom_left_y: '70.0%' },
                previewSocialLogo2: { top_left_x: '60.0%', top_left_y: '28.0%', top_right_x: '66.0%', top_right_y: '24.0%', bottom_right_x: '66.0%', bottom_right_y: '32.0%', bottom_left_x: '60.0%', bottom_left_y: '36.0%' },
                previewSocialQR2: { top_left_x: '60.0%', top_left_y: '40.0%', top_right_x: '73.0%', top_right_y: '30.0%', bottom_right_x: '73.0%', bottom_right_y: '50.0%', bottom_left_x: '60.0%', bottom_left_y: '60.0%' }
            },
            { 
                objectName: "2 Kartvizit Bölmeli", 
                src: "./content/products/5/preview-2-bolme.png",
                previewSocialLogo1: { top_left_x: '44.0%', top_left_y: '36.0%', top_right_x: '50.0%', top_right_y: '32.0%', bottom_right_x: '50.0%', bottom_right_y: '40.0%', bottom_left_x: '44.0%', bottom_left_y: '44.0%' },
                previewSocialQR1: { top_left_x: '44.0%', top_left_y: '48.0%', top_right_x: '57.0%', top_right_y: '38.0%', bottom_right_x: '57.0%', bottom_right_y: '58.0%', bottom_left_x: '44.0%', bottom_left_y: '68.0%' },
                previewSocialLogo2: { top_left_x: '62.0%', top_left_y: '26.0%', top_right_x: '68.0%', top_right_y: '22.0%', bottom_right_x: '68.0%', bottom_right_y: '30.0%', bottom_left_x: '62.0%', bottom_left_y: '34.0%' },
                previewSocialQR2: { top_left_x: '62.0%', top_left_y: '38.0%', top_right_x: '75.0%', top_right_y: '28.0%', bottom_right_x: '75.0%', bottom_right_y: '48.0%', bottom_left_x: '62.0%', bottom_left_y: '58.0%' }
            },
            { 
                objectName: "3 Kartvizit Bölmeli", 
                src: "./content/products/5/preview-3-bolme.png",
                previewSocialLogo1: { top_left_x: '46.0%', top_left_y: '34.0%', top_right_x: '52.0%', top_right_y: '30.0%', bottom_right_x: '52.0%', bottom_right_y: '38.0%', bottom_left_x: '46.0%', bottom_left_y: '42.0%' },
                previewSocialQR1: { top_left_x: '46.0%', top_left_y: '46.0%', top_right_x: '59.0%', top_right_y: '36.0%', bottom_right_x: '59.0%', bottom_right_y: '56.0%', bottom_left_x: '46.0%', bottom_left_y: '66.0%' },
                previewSocialLogo2: { top_left_x: '64.0%', top_left_y: '24.0%', top_right_x: '70.0%', top_right_y: '20.0%', bottom_right_x: '70.0%', bottom_right_y: '28.0%', bottom_left_x: '64.0%', bottom_left_y: '32.0%' },
                previewSocialQR2: { top_left_x: '64.0%', top_left_y: '36.0%', top_right_x: '77.0%', top_right_y: '26.0%', bottom_right_x: '77.0%', bottom_right_y: '46.0%', bottom_left_x: '64.0%', bottom_left_y: '56.0%' }
            }
        ],
		isCustomQR:  [
            { QR_Link: "1 Kartvizit Bölmeli", src: "./content/products/5/preview-1-bolme.png" },
            { QR_Link: "2 Kartvizit Bölmeli", src: "./content/products/5/preview-2-bolme.png" }
        ],
		 colors: [
            { color1: "#FBC02D", color2: "#222222", label1: "Yazı", label2: "Zemin" },
            { color1: "#FFFFFF", color2: "#1976D2", label1: "Yazı", label2: "Zemin" },
            { color1: "#222222", color2: "#FFFFFF", label1: "Yazı", label2: "Zemin" },
            { color1: "#E91E63", color2: "#388E3C", label1: "Yazı", label2: "Zemin" }
        ],
        images: [
            { src: "./content/products/5/1.jpg" },
            { src: "./content/products/5/2.jpg" },
            { src: "./content/products/5/3.jpg" },
            { src: "./content/products/5/4.jpg" }
        ]
    }/*,
    {
        id: 3,
        name: "Araba Plaka Çerçevesi",
        desc: "Plakanızın dışına yüksek kalite ile basılmış logo ve yazı ekleyebildiğiniz çerçevenizi tasarlayın.",
        price: 180,
        images: [
            { src: "./content/products/3/1.jpg" },
            { src: "./content/products/3/2.jpg" },
            { src: "./content/products/3/3.jpg" },
            { src: "./content/products/3/4.jpg" }
        ],
        previewTextArea: { top: '15%', left: '10%', width: '80%', height: '70%' },
        previewLogoArea: { top: '15%', left: '10%', width: '80%', height: '70%' }
    },
    {
        id: 4,
        name: "Masaüstü USB'li fan",
        desc: "Renklerini seçebildiğiniz size özel fan.",
        price: 180,
        images: [
            { src: "./content/products/4/1.jpg" },
            { src: "./content/products/4/2.jpg" },
            { src: "./content/products/4/3.jpg" },
            { src: "./content/products/4/4.jpg" }
        ],
        previewTextArea: { top: '15%', left: '10%', width: '80%', height: '70%' },
        previewLogoArea: { top: '15%', left: '10%', width: '80%', height: '70%' }
    },
    {
        id: 6,
        name: "Özet Tasarım Anahtarlık",
        desc: "Üzerine isim yazdırılabilen dekoratif anahtarlık.",
		isCustomText: false,
		CustomColorText1: "Üst Renk",   // Renk seçici 1'in etiketi
		CustomColorText2: "Alt Renk",    // Renk seçici 2'nin etiketi
        price: 180,
        images: [
            { src: "./content/products/6/1.jpg" },
            { src: "./content/products/6/2.jpg" },
            { src: "./content/products/6/3.jpg" },
            { src: "./content/products/6/4.jpg" }
        ],
        previewTextArea: { top: '15%', left: '10%', width: '80%', height: '70%' },
        previewLogoArea: { top: '15%', left: '10%', width: '80%', height: '70%' }
    }*/
];

// --- DOM READY ---

function cropTransparentSpace(dataUrl, callback) {
    const img = new Image();
    img.onload = function() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Ensure reasonable resolution for vector formats
        const w = img.width || 1024;
        const h = img.height || 1024;
        
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        
        let imageData;
        try {
            imageData = ctx.getImageData(0, 0, w, h);
        } catch(e) {
            return callback(dataUrl); // fallback if CORS or tainted
        }
        
        const data = imageData.data;
        let minX = w, minY = h, maxX = 0, maxY = 0;
        let hasPixels = false;
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const alpha = data[(y * w + x) * 4 + 3];
                if (alpha > 5) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                    hasPixels = true;
                }
            }
        }
        
        if (!hasPixels) return callback(dataUrl);
        
        const cropWidth = maxX - minX + 1;
        const cropHeight = maxY - minY + 1;
        
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropWidth;
        cropCanvas.height = cropHeight;
        cropCanvas.getContext('2d').drawImage(canvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        
        callback(cropCanvas.toDataURL('image/png'));
    };
    img.onerror = function() {
        callback(dataUrl);
    };
    img.src = dataUrl;
}

$(document).ready(function() {
    // Not: Alt menü tıklamaları aşağıdaki '.bottom-nav-item' işleyicisiyle yönetiliyor.
    // Burada ikinci bir işleyici olması sayfa geçişini iki kez tetikleyip geçmişe
    // (history) çift kayıt ekliyordu.

    $('#upload-logo-trigger').on('click', function() {
        $('#custom-logo-input').click();
    });

    $(document).on('click', '.logo-bubble', function() {
        $('.logo-bubble').css('border-color', 'var(--border)').removeClass('active');
        $(this).css('border-color', 'var(--primary)').addClass('active');

        const src = $(this).attr('data-src');
        if (src) {
            // Apply mask
            $('.preview-dynamic-logo').css({
                'mask-image':            `url(${src})`,
                '-webkit-mask-image':    `url(${src})`,
                'mask-repeat':           'no-repeat',
                '-webkit-mask-repeat':   'no-repeat',
                'mask-size': 'contain', '-webkit-mask-size': 'contain', 'mask-position': 'center',
                '-webkit-mask-position': 'center',
                'background-color':      $('#custom-text-color').val()
            }).show();
            $('.preview-dynamic-logo').attr('data-active-logo', src); // Custom attribute for cart
        }
    });

    // Mobile Menu Logic
    $('#mobile-menu-toggle').click(function() {
        $('#nav-menu').addClass('open');
        $('#mobile-backdrop').addClass('open');
    });
    
    $('#mobile-menu-close, #mobile-backdrop').click(function() {
        $('#nav-menu').removeClass('open');
        $('#mobile-backdrop').removeClass('open');
    });
    
    $('.nav-menu li').click(function() {
        if ($(window).width() <= 768) {
            $('#nav-menu').removeClass('open');
            $('#mobile-backdrop').removeClass('open');
        }
    });

    loadCart();
    renderProducts();

    // Helper: Slugify for URLs
    window.slugify = function(text) {
        return text.toString().toLowerCase().trim()
            .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
            .replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-');
    };

    // Initial Routing
    const urlParams = new URLSearchParams(window.location.search);
    let initialPage = '#products-page';
    let detailProductId = null;

    if (urlParams.has('detail')) {
        const slug = urlParams.get('detail');
        const p = products.find(x => slugify(x.name) === slug || x.id.toString() === slug);
        if (p) {
            initialPage = '#product-detail-page';
            detailProductId = p.id;
        } else if (!slug) {
            // fallback if someone just visits ?detail without slug
            initialPage = '#product-detail-page';
            detailProductId = products[0]?.id; // Default to first product to prevent empty page
        }
    } else if (urlParams.has('checkout')) {
        initialPage = '#checkout-page';
    } else if (urlParams.has('login')) {
        initialPage = '#login-page';
    } else if (urlParams.has('dashboard')) {
        initialPage = '#dashboard-page';
    }

    // Save initial state if it doesn't exist
    if (!window.history.state) {
        window.history.replaceState({ page: initialPage, productId: detailProductId }, "", window.location.href);
    }
    
    if (initialPage === '#product-detail-page' && detailProductId) {
        openProductDetail(detailProductId, false); // Initialize the detail page correctly
    } else {
        switchPage(initialPage, false);
    }

    // Tarayıcı Geri/İleri Tuşları İçin Popstate Dinleyicisi
    window.addEventListener('popstate', function(event) {
        if (event.state && event.state.page) {
            if (event.state.page === '#product-detail-page' && event.state.productId) {
                openProductDetail(event.state.productId, false);
            } else {
                switchPage(event.state.page, false);
            }
        } else {
            switchPage('#products-page', false);
        }
    });

    // Navigasyon — üst menü ve nav-trigger'lar
    $('.nav-menu li, .nav-trigger').click(function(e) {
        e.stopPropagation();
        const target = $(this).data('target');
        if (target) switchPage(target);
    });

    // Mobil alt navigasyon — delegated handler (DOM'da script'ten sonra geliyor)
    $(document).on('click', '.bottom-nav-item', function(e) {
        e.stopPropagation();
        const target = $(this).data('target');
        if (target) switchPage(target);
    });

    // Sepete Ekle
    $('#add-to-cart').click(addToCart);

    // Firebase Auth İzleyici — SDK indikten sonra bağlanır (ilk çizimi bloklamaz)
    fbReady().then(() => onAuthStateChanged(auth, (user) => {
        // Önceki oturumun canlı dinleyicilerini kapat ve ekranda kalan verisini temizle
        stopUserDataListeners();

        const isRegistered = !!user && !user.isAnonymous;
        if (!isRegistered && activePageId === '#dashboard-page') {
            switchPage('#login-page', false);
        }

        if (user) {
            if (user.isAnonymous) {
                $('#nav-login-btn').css('display', 'flex');
                $('#nav-user-profile').hide();
                // Alt menü: misafir görünümü
                $('#mobile-nav-login').show();
                $('#mobile-nav-profile').hide();
            } else {
                $('#nav-login-btn').hide();
                $('#nav-user-profile').css('display', 'flex');
                $('#dash-user-name').text(user.displayName || "Kullanıcı");
                $('#dash-user-email').text(user.email);
                // Alt menü: giriş yapılmış görünümü
                $('#mobile-nav-login').hide();
                $('#mobile-nav-profile').css('display', 'flex');

                // Realtime Database profilinde tam adın (fullname) doğruluğunu güvenceye al
                if (user.displayName) {
                    get(ref(db, `users/${user.uid}/profile`)).then((snap) => {
                        const prof = snap.val() || {};
                        if (!prof.fullname || prof.fullname !== user.displayName) {
                            set(ref(db, `users/${user.uid}/profile`), {
                                fullname: user.displayName,
                                email: user.email || prof.email,
                                createdAt: prof.createdAt || Date.now()
                            });
                        }
                    }).catch(() => {});
                }
            }
            loadUserOrders(user.uid);
            loadUserAddresses(user.uid);
        } else {
            $('#nav-login-btn').css('display', 'flex');
            $('#nav-user-profile').hide();
            // Alt menü: çıkış yapılmış görünümü
            $('#mobile-nav-login').show();
            $('#mobile-nav-profile').hide();
        }
    }));

    // Çıkış Yap
    $('#action-logout').click(async () => {
        await fbReady();
        switchPage('#products-page');
        signOut(auth).then(() => {
            showToast("Çıkış yapıldı.", "success");
        }).catch(() => showToast("Çıkış yapılamadı.", "error"));
    });

    // Checkout Modal Devam
    $('#btn-checkout-start').click(async function() {
        if(cart.length === 0) return showToast("Sepetiniz boş.", "error");
        window.location.href = "./payment";
    });

    $('#modal-btn-login').click(() => {
        $('#auth-decision-modal').removeClass('open');
        switchPage('#login-page');
    });

    $('#modal-btn-guest').click(async () => {
        try {
            const user = await authReady();
            if (!user) await signInAnonymously(auth);
            window.location.href = "./payment";
        } catch (error) {
            console.error("Misafir oturumu açılamadı:", error);
            showToast("Misafir oturumu başlatılamadı. Lütfen tekrar deneyin.", "error");
        }
    });

    // Modal Kapatma Mantığı (Dışa Tıklama / Tıklayıp Sürükleyip Bırakınca Yanlışlıkla Kapanmama)
    let mousedownTarget = null;
    $(document).on('mousedown', '.modal-overlay', function(e) {
        mousedownTarget = e.target;
    });
    
    $(document).on('mouseup', '.modal-overlay', function(e) {
        // Tıklama dışarıda başladıysa ve dışarıda bittiyse ve overlay ise kapat
        if (mousedownTarget === e.target && $(e.target).hasClass('modal-overlay')) {
            $(e.target).removeClass('open');
            $('body').removeClass('no-scroll');
        }
    });

    $(document).on('click', '.modal-close', function() {
        $(this).closest('.modal-overlay').removeClass('open');
        $('body').removeClass('no-scroll');
    });

    // --- ŞİFRE GÖSTER/GİZLE ---
    $(document).on('click', '.toggle-password', function() {
        $(this).toggleClass("fa-eye fa-eye-slash");
        const input = $(this).siblings("input");
        if (input.attr("type") === "password") {
            input.attr("type", "text");
        } else {
            input.attr("type", "password");
        }
    });

    // --- ÖZEL RENK SEÇİCİ (PLA 10 Renk) ---
    $(document).on('click', '.pla-color-select', function(e) {
        e.stopPropagation();
        const targetId = $(this).data('target');
        $('.pla-options-dropdown').not('#' + targetId).removeClass('open');
        $('#' + targetId).toggleClass('open');
    });

    // Sepet satırındaki renk seçici
    $(document).on('click', '.pla-swatch', function(e) {
        e.stopPropagation();
        const index = $(this).data('cart-index');
        if (index === undefined || !cart[index]) return;
        const c1 = $(this).data('color1') || $(this).data('color');
        cart[index].textColor = c1;
        cart[index].objColor = $(this).data('color2') || c1;
        saveCart();
        renderCart();
    });

    $('#custom-object-input').on('change', function() {
        if (typeof currentProduct !== 'undefined' && currentProduct && currentProduct.isCustomObject) {
            const idx = $(this).val();
            const obj = currentProduct.isCustomObject[idx];
            if (obj) {
                const textColor = $('#custom-text-color').val() || '#FBC02D';
                const objColor = $('#custom-obj-color').val() || '#222222';
                $('.preview-object-color-layer').css('background-color', objColor);
                if (window.applyFilterToPreview) {
                    window.applyFilterToPreview(currentProduct.id, textColor, obj.src);
                } else {
                    $('.preview-overlay-img').attr('src', obj.src);
                }
            }
        }
    });

    $(document).click(function() {
        $('.pla-options-dropdown').removeClass('open');
    });

    // Panel Sekmeleri
    $('.dash-menu li').click(function() {
        $('.dash-menu li').removeClass('active');
        $(this).addClass('active');
        $('.dash-tab').hide();
        $(`#tab-${$(this).data('tab')}`).fadeIn();
    });

    // Sepetten Silme
    $(document).on('click', '.remove-btn', function() {
        const itemIndex = $(this).data('index');
        const itemToRemove = cart[itemIndex];
        
        // Eğer üründe logo varsa Storage'dan sil
        if (itemToRemove && itemToRemove.logoStoragePath) {
            deleteCartLogo(itemToRemove.logoStoragePath);
        }
        
        cart.splice(itemIndex, 1);
        saveCart();
        renderCart();
    });

    // Sepet İçi Düzenleme (Adet / Yazı - Canlı 2D Güncelleme)
    $(document).on('change', '.cart-qty-input', function() {
        const index = $(this).data('index');
        if (!cart[index]) return;
        cart[index].quantity = clampQty($(this).val());
        saveCart();
        renderCart();
    });

    $(document).on('input', '.cart-text-input', function() {
        const index = $(this).data('index');
        const val = $(this).val();
        if (cart[index]) {
            cart[index].customText = val;
            $(`#cart-dynamic-text-${index}`).text(val);
            if (typeof window.fitCartItemText === 'function') {
                window.fitCartItemText(index);
            }
            saveCart();
        }
    });

    $(document).on('change', '.cart-text-input', function() {
        const index = $(this).data('index');
        if (cart[index]) {
            cart[index].customText = $(this).val();
            saveCart();
        }
    });

    $(document).on('change', '.cart-object-select', function() {
        const index = $(this).data('index');
        const selectedObj = $(this).val();
        if (cart[index]) {
            cart[index].selectedObject = selectedObj;
            saveCart();
            renderCart();
        }
    });

    // Adres İşlemleri
    $('#btn-add-address').click(() => {
        $('#address-modal-title').text('Yeni Adres Ekle');
        $('#addr-id').val('');
        $('#address-form')[0].reset();
        $('#address-modal').addClass('open');
    });

    $('#address-form').submit(async (e) => {
        e.preventDefault();
        await fbReady();
        if (!auth.currentUser) return;
        
        const userId = auth.currentUser.uid;
        const addrId = $('#addr-id').val() || Date.now().toString();

        const fullname = $('#addr-fullname').val().trim();
        const nameParts = fullname.split(/\s+/);
        const details = $('#addr-details').val().trim();
        // Ödeme sayfası da bu adresi okuyabilsin diye iki formatın alanları birlikte yazılıyor
        const addrData = {
            title: $('#addr-title').val().trim(),
            fullname: fullname,
            name: nameParts[0] || '',
            surname: nameParts.slice(1).join(' '),
            phone: $('#addr-phone').val().trim(),
            city: $('#addr-city').val().trim(),
            district: $('#addr-district').val().trim(),
            details: details,
            address: details
        };

        try {
            await set(ref(db, `users/${userId}/addresses/${addrId}`), addrData);
            showToast("Adres başarıyla kaydedildi.", "success");
            $('#address-modal').removeClass('open');
        } catch (error) {
            showToast("Adres kaydedilirken hata oluştu.", "error");
        }
    });

    $(document).on('click', '.delete-addr-btn', async function() {
        await fbReady();
        if (!auth.currentUser) return;
        if (!confirm('Bu adresi silmek istediğinize emin misiniz?')) return;
        
        const addrId = $(this).data('id');
        try {
            await remove(ref(db, `users/${auth.currentUser.uid}/addresses/${addrId}`));
            showToast("Adres başarıyla silindi.", "success");
        } catch (error) {
            showToast("Adres silinirken hata oluştu.", "error");
        }
    });

    $(document).on('click', '.edit-addr-btn', async function() {
        await fbReady();
        if (!auth.currentUser) return;
        const addrId = $(this).data('id');
        
        const addr = window.userAddresses && window.userAddresses[addrId];
        if (!addr) return;
        
        $('#address-modal-title').text('Adresi Düzenle');
        $('#addr-id').val(addrId);
        $('#addr-title').val(addr.title || '');
        $('#addr-fullname').val(addr.fullname || [addr.name, addr.surname].filter(Boolean).join(' '));
        $('#addr-phone').val(addr.phone || '');
        $('#addr-city').val(addr.city || '');
        $('#addr-district').val(addr.district || '');
        $('#addr-details').val(addr.details || addr.address || '');
        
        $('#address-modal').addClass('open');
    });



    // Detay Sayfası Miktar Artırma/Azaltma ve Manuel Giriş
    $('#quantity-input').on('change', function() {
        $(this).val(clampQty($(this).val()));
    });
    $('#detail-qty-minus').click(function() {
        let val = clampQty($('#quantity-input').val());
        if (val > 1) $('#quantity-input').val(val - 1);
    });
    $('#detail-qty-plus').click(function() {
        let val = clampQty($('#quantity-input').val());
        $('#quantity-input').val(Math.min(val + 1, MAX_QUANTITY));
    });

    // --- GİRİŞ YAP İŞLEMİ ---
    $('#btn-signin').click(async () => {
        const email = $('#signin-email').val().trim();
        const pass  = $('#signin-password').val().trim();

        if (!email || !pass) return showToast("Lütfen e-posta ve şifrenizi girin.", "error");

        const $btn = $('#btn-signin');
        $btn.prop('disabled', true).text('Giriş Yapılıyor...');

        try {
            await fbReady();
            await signInWithEmailAndPassword(auth, email, pass);
            showToast("Başarıyla giriş yapıldı.", "success");
            switchPage('#products-page');
            $('#signin-email').val('');
            $('#signin-password').val('');
        } catch (error) {
            showToast("Giriş Başarısız. Bilgilerinizi kontrol edin.", "error");
        } finally {
            $btn.prop('disabled', false).text('Giriş Yap');
        }
    });

    $('#signin-email, #signin-password').on('keypress', function(e) {
        if (e.which === 13) { e.preventDefault(); $('#btn-signin').click(); }
    });

    // --- ŞİFREMİ UNUTTUM İŞLEMİ ---
    $('#btn-forgot-password').click(async () => {
        const email = $('#forgot-email').val().trim();
        if (!email) return showToast("Lütfen e-posta adresinizi girin.", "error");

        const $btn = $('#btn-forgot-password');
        $btn.prop('disabled', true).text('Gönderiliyor...');

        try {
            await fbReady();
            await sendPasswordResetEmail(auth, email);
            showToast("Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.", "success");
            $('#forgot-email').val('');
            $('#view-forgot-password').hide();
            $('#view-signin').fadeIn();
        } catch (error) {
            console.error("Şifre sıfırlama hatası:", error);
            showToast("İşlem başarısız. Lütfen e-posta adresinizi kontrol edin.", "error");
        } finally {
            $btn.prop('disabled', false).text('Bağlantı Gönder');
        }
    });

    $('#forgot-email').on('keypress', function(e) {
        if (e.which === 13) { e.preventDefault(); $('#btn-forgot-password').click(); }
    });

    // --- KAYIT OL İŞLEMİ ---
    $('#btn-signup').click(async () => {
        const fullname    = $('#signup-fullname').val().trim();
        const email       = $('#signup-email').val().trim();
        const pass        = $('#signup-password').val().trim();
        const passConfirm = $('#signup-password-confirm').val().trim();
        const isKvkk      = $('#signup-kvkk').is(':checked');

        if (!fullname || !email || !pass || !passConfirm) return showToast("Lütfen tüm alanları doldurun.", "error");
        if (pass !== passConfirm) return showToast("Şifreler uyuşmuyor.", "error");
        if (!isKvkk) return showToast("Lütfen KVKK metnini onaylayın.", "error");

        const $btn = $('#btn-signup');
        $btn.prop('disabled', true).text('Hesap Oluşturuluyor...');

        try {
            await fbReady();
            const userCred = await createUserWithEmailAndPassword(auth, email, pass);
            await updateProfile(userCred.user, { displayName: fullname });
            
            // Realtime Database'e kullanıcının tam adını (fullname) kaydet
            const saveProfileData = async () => {
                try {
                    await set(ref(db, `users/${userCred.user.uid}/profile`), {
                        fullname: fullname,
                        email: email,
                        createdAt: Date.now()
                    });
                } catch (dbErr) {
                    console.warn("Profil Realtime Database'e yazılamadı:", dbErr);
                }
            };

            await saveProfileData();
            setTimeout(saveProfileData, 800);
            setTimeout(saveProfileData, 2500);

            showToast("Hesap başarıyla oluşturuldu!", "success");
            switchPage('#products-page');
            $('#signup-fullname, #signup-email, #signup-password, #signup-password-confirm').val('');
            $('#signup-kvkk').prop('checked', false);
        } catch (error) {
            showToast("Kayıt Hatası: " + error.message, "error");
        } finally {
            $btn.prop('disabled', false).text('Kaydol');
        }
    });

    // --- TELEFON NUMARASI FORMATLAMA (05XX XXX XX XX) ---
    window.formatTurkishPhoneNumber = function(value) {
        let clean = (value || '').replace(/\D/g, '');
        if (clean.startsWith('90') && clean.length > 10) {
            clean = clean.slice(2);
        }
        if (clean.length > 0 && !clean.startsWith('0')) {
            clean = '0' + clean;
        }
        clean = clean.slice(0, 11);
        
        let formatted = '';
        if (clean.length > 0) formatted += clean.substring(0, 4);
        if (clean.length > 4) formatted += ' ' + clean.substring(4, 7);
        if (clean.length > 7) formatted += ' ' + clean.substring(7, 9);
        if (clean.length > 9) formatted += ' ' + clean.substring(9, 11);
        return formatted;
    };

    $('#addr-phone').on('input', function() {
        const formatted = window.formatTurkishPhoneNumber(this.value);
        if (this.value !== formatted) {
            this.value = formatted;
        }
    });

    // --- KLAVYE & MOBİL SABİT BAR ÇAKIŞMASI VE 2D ÖNİZLEME SCROLL ---
    $(document).on('focus', '.customization-box input, .customization-box select', function() {
        if (window.innerWidth <= 768) {
            $('body').addClass('input-focused keyboard-open');
            const previewEl = document.getElementById('advanced-2d-preview-container');
            if (previewEl && $('#product-detail-page').hasClass('active')) {
                setTimeout(() => {
                    const navHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')) || 70;
                    const rect = previewEl.getBoundingClientRect();
                    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                    const targetY = scrollTop + rect.top - (navHeight + 10);
                    window.scrollTo({
                        top: Math.max(0, targetY),
                        behavior: 'smooth'
                    });
                }, 80);
            }
        }
    });

    $(document).on('blur', '.customization-box input, .customization-box select', function() {
        setTimeout(() => {
            if (!$('.customization-box input:focus, .customization-box select:focus').length) {
                $('body').removeClass('input-focused keyboard-open');
            }
        }, 150);
    });

    // --- 2D PREVIEW LISTENER'LARI ---
    const $dynText = $('.preview-dynamic-text');
    let textFitRaf = 0;
    $('#custom-text-input').on('input.preview', function() {
        const val = $(this).val();
        const defaultText = (typeof currentProduct !== 'undefined' && currentProduct && currentProduct.customTextPlaceholderPreview)
            ? currentProduct.customTextPlaceholderPreview : 'ENGRARE';
        $dynText.text(val || defaultText);
        // Her tuş vuruşunda değil, kare başına bir kez ölçüm yap
        if (textFitRaf) return;
        textFitRaf = requestAnimationFrame(() => {
            textFitRaf = 0;
            if (typeof window.fitTextToContainer === 'function') window.fitTextToContainer();
        });
    });

    // Font is fixed to AGENCYB
    $dynText.css('font-family', "'AGENCYB', sans-serif");

    window.fitTextToContainer = function() {
        $('.preview-printable-area').each(function() {
            const $container = $(this);
            const $text = $container.find('.preview-dynamic-text');
            if (!$container.length || !$text.length) return;

            const textVal = $text.text().trim();
            if (!textVal) return;

            // Referans ölçüm için geçici sıfırlama
            $text.css({
                'font-family': "'AGENCYB', sans-serif",
                'font-size': '10px',
                'white-space': 'nowrap',
                'transform': 'none',
                'width': 'auto',
                'display': 'inline-block',
                'line-height': '1'
            });

            const containerW = $container.width();
            const containerH = $container.height();
            const textW = $text.width();
            const textH = $text.height();

            if (textW === 0 || textH === 0 || containerW === 0 || containerH === 0) return;

            // 1. ADIM: Kutunun yüksekliğini tam dolduracak boyutu bul
            let targetFontSize = (containerH / textH) * 10;

            // 2. ADIM: Bu boyutta genişlik taşıyorsa, genişliğe göre sınırla
            const projectedWidth = (targetFontSize / 10) * textW;
            if (projectedWidth > containerW) {
                targetFontSize = (containerW / textW) * 10;
            }

            // Kenar taşmalarını önlemek için %96 emniyet katsayısı
            $text.css('font-size', (targetFontSize * 0.96) + 'px');
        });
    };

    // --- LOGO YÜKLEME ---
    
    $('#custom-logo-input').on('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
        if (!allowedTypes.includes(file.type)) {
            alert('Sadece PNG, JPG, JPEG veya SVG formatında logo yükleyebilirsiniz.');
            $(this).val('');
            return;
        }

        const reader = new FileReader();
        reader.onload = function(event) {
            cropTransparentSpace(event.target.result, function(croppedDataUrl) {
                // Update the custom bubble
                $('#custom-uploaded-img').attr('src', event.target.result); // Show original in bubble
                $('#custom-uploaded-bubble').attr('data-src', croppedDataUrl).css('display', 'flex').click(); // trigger click to set as active
            });
        };
        reader.readAsDataURL(file);
    });

    

});

// --- FONKSİYONLAR ---


function updateMobileHeader(targetId) {
    const $brandLogo = $('.navbar .brand-logo');
    if (!$brandLogo.length) return;

    if (targetId === '#product-detail-page') {
        $brandLogo.html(`
            <div class="nav-back-link nav-trigger" data-target="#products-page" title="Ürünlere Dön">
                <div class="nav-back-icon-box">
                    <i class="fa-solid fa-arrow-left"></i>
                </div>
                <span class="nav-back-text">Ürünlere Dön</span>
            </div>
        `);
    } else {
        const isMobile = window.innerWidth <= 768;
        const logoHeight = isMobile ? '50px' : '65px';
        $brandLogo.html(`
            <img src="./content/engrare_logo_elegant.png" height="${logoHeight}" alt="Engrare" style="object-fit: contain;" onerror="this.style.display='none'; this.parentElement.innerText='ENGRARE.'">
        `);
    }
}

// Geri butonuna veya linkine tıklanınca ürünler sayfasına dön
$(document).on('click', '.nav-back-link, .nav-back-icon-box, #mobile-detail-back-btn', function(e) {
    e.stopPropagation();
    switchPage('#products-page');
});

function resetCarouselState() {
    const $carousel = $('#detail-main-carousel');
    if ($carousel.length && $carousel[0]) {
        $carousel.css('scroll-behavior', 'auto');
        $carousel[0].scrollLeft = 0;
        $carousel.scrollLeft(0);
        $carousel.css('scroll-behavior', 'smooth');
    }
    $('.product-thumb').css({'border-color': 'transparent', 'opacity': '0.6'});
    $('.product-thumb[data-idx="0"]').css({'border-color': 'var(--accent)', 'opacity': '1'});
    $('#carousel-prev').css({ 'opacity': '0.3', 'pointer-events': 'none' });
    const hasMultiple = currentProduct && currentProduct.images && currentProduct.images.length > 1;
    $('#carousel-next').css({ 'opacity': hasMultiple ? '1' : '0.3', 'pointer-events': hasMultiple ? 'auto' : 'none' });
}

let activePageId = '#products-page';
let pageSwitchToken = 0;

function switchPage(targetId, pushState = true) {
    const $target = $(targetId);
    if (!$target.length) return;

    // Detay sayfasından çıkarken karuseli başa sar
    if (targetId !== '#product-detail-page') {
        const $c = $('#detail-main-carousel');
        if ($c.length && $c[0]) {
            $c.css('scroll-behavior', 'auto');
            $c[0].scrollLeft = 0;
            $c.scrollLeft(0);
        }
    }

    const $current = $('.page.active');

    if ($current.length && $current[0] === $target[0]) return;

    activePageId = targetId;
    // Hızlı art arda tıklamalarda eski geçişlerin geri çağrıları iptal edilir;
    // aksi halde iki sayfa aynı anda görünür kalabiliyordu.
    const token = ++pageSwitchToken;
    $('.page').not($current).not($target).stop(true, false).removeClass('active').css({ display: '', opacity: '' });

    $('.nav-menu li').removeClass('active');
    $(`.nav-menu li[data-target="${targetId}"]`).addClass('active');
    $('.bottom-nav-item').removeClass('active');
    $(`.bottom-nav-item[data-target="${targetId}"]`).addClass('active');

    if (pushState) {
        const map = { '#products-page': 'products', '#checkout-page': 'checkout', '#login-page': 'login', '#dashboard-page': 'dashboard', '#product-detail-page': 'detail' };
        window.history.pushState({ page: targetId }, "", window.location.pathname + '?' + (map[targetId] || 'products'));
    }

    if ($current.length) {
        $current.fadeOut(120, function() {
            if (token !== pageSwitchToken) return;
            $current.removeClass('active');
            $current.css('display', ''); // clean up

            window.scrollTo(0, 0);
            if(typeof updateMobileHeader === 'function') updateMobileHeader(targetId);

            $target.fadeIn(120, function() {
                if (token !== pageSwitchToken) return;
                $target.addClass('active');
                $target.css('display', ''); // clean up inline block, CSS handles it
                if (targetId === '#product-detail-page') {
                    resetCarouselState();
                    // Sayfa görünür olduktan SONRA ölç: önizleme önbellekten anında
                    // geldiğinde kutu, sayfa daha gizliyken hesaplanmış olabiliyor.
                    if (typeof window.updatePreviewBoxDimensions === 'function') {
                        window.updatePreviewBoxDimensions();
                    }
                    if (typeof window.fitTextToContainer === 'function') {
                        window.fitTextToContainer();
                    }
                }
            });
        });
    } else {
        $('.page').removeClass('active');
        $target.addClass('active');
        window.scrollTo(0, 0);
        if(typeof updateMobileHeader === 'function') updateMobileHeader(targetId);
        if (targetId === '#product-detail-page') {
            resetCarouselState();
            if (typeof window.updatePreviewBoxDimensions === 'function') {
                window.updatePreviewBoxDimensions();
            }
            if (typeof window.fitTextToContainer === 'function') {
                window.fitTextToContainer();
            }
        }
    }
}


function renderProducts() {
    // Tek seferde HTML üret, tek seferde DOM'a yaz (her kart için ayrı append
    // her seferinde yeniden yerleşim/boyama tetikliyordu).
    const html = products.map(p => {
        const imgObj = p.images[0] || { src: "./content/default.jpg" };
        const imgSrc = imgObj.src;
        return `
            <div class="model-card" onclick="openProductDetail(${p.id})">
                <div class="card-image"><img src="${imgSrc}" alt="${p.name}" width="400" height="250" loading="lazy" decoding="async"/></div>
                <div class="model-info">
                    <div class="model-title">${p.name}</div>
                    <div class="model-desc">${p.desc}</div>
                    <div class="card-meta">
                        <span class="price-tag" style="margin: auto 0;">₺${p.price.toFixed(2)}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    $('#products-grid-container').html(html);
}
function applyPerspectiveTransform(el, coords, w, h) {
    if (!el || !coords) {
        if(el) { el.style.transform = ''; el.style.display = 'none'; }
        return;
    }
    const x0 = (parseFloat(coords.top_left_x) / 100) * w;
    const y0 = (parseFloat(coords.top_left_y) / 100) * h;
    const x1 = (parseFloat(coords.top_right_x) / 100) * w;
    const y1 = (parseFloat(coords.top_right_y) / 100) * h;
    const x2 = (parseFloat(coords.bottom_right_x) / 100) * w;
    const y2 = (parseFloat(coords.bottom_right_y) / 100) * h;
    const x3 = (parseFloat(coords.bottom_left_x) / 100) * w;
    const y3 = (parseFloat(coords.bottom_left_y) / 100) * h;

    let dx1 = x1 - x2, dy1 = y1 - y2;
    let dx2 = x3 - x2, dy2 = y3 - y2;
    let dx3 = x0 - x1 + x2 - x3;
    let dy3 = y0 - y1 + y2 - y3;

    let m11, m12, m13, m21, m22, m23, m31, m32, m33;
    if (Math.abs(dx3) < 0.001 && Math.abs(dy3) < 0.001) {
        m11 = x1 - x0; m21 = x2 - x1; m31 = x0;
        m12 = y1 - y0; m22 = y2 - y1; m32 = y0;
        m13 = 0;       m23 = 0;       m33 = 1;
    } else {
        let det1 = dx1 * dy2 - dy1 * dx2;
        if (det1 === 0) return; 
        let a13 = (dx3 * dy2 - dy3 * dx2) / det1;
        let a23 = (dx1 * dy3 - dy1 * dx3) / det1;

        m11 = x1 - x0 + a13 * x1; m21 = x3 - x0 + a23 * x3; m31 = x0;
        m12 = y1 - y0 + a13 * y1; m22 = y3 - y0 + a23 * y3; m32 = y0;
        m13 = a13;                m23 = a23;                m33 = 1;
    }

    m11 /= w; m12 /= w; m13 /= w;
    m21 /= h; m22 /= h; m23 /= h;

    const mat = [ m11, m12, 0, m13, m21, m22, 0, m23, 0, 0, 1, 0, m31, m32, 0, m33 ];
    el.style.transformOrigin = '0 0';
    el.style.transform = `matrix3d(${mat.join(',')})`;
    el.style.display = 'block';
}

window.updateSocialPreview = function() {
    if (!currentProduct || !currentProduct.isCustomObject) return;
    const objIndex = parseInt($('#custom-object-input').val() || '0');
    const obj = currentProduct.isCustomObject[objIndex];
    if (!obj || (!obj.previewSocialLogo1 && !obj.previewSocialLogo2)) return;

    const $box = $('#advanced-2d-preview-box');
    const w = $box.width();
    const h = $box.height();
    const color = $('#custom-text-color').val() || '#000000';

    [1, 2].forEach(i => {
        const plat = $(`#custom-social-platform-${i}`).val();
        const link = $(`#custom-social-link-${i}`).val().trim();
        const qrArea = document.getElementById(`preview-social-qr-area-${i}`);
        const logoArea = document.getElementById(`preview-social-logo-area-${i}`);
        const coordsQR = obj[`previewSocialQR${i}`];
        const coordsLogo = obj[`previewSocialLogo${i}`];

        if (link && coordsQR) {
            if (typeof QRious !== 'undefined') {
                const qr = new QRious({
                    value: link,
                    size: 300,
                    foreground: color,
                    background: 'transparent'
                });
                $(`#preview-social-qr-img-${i}`).attr('src', qr.toDataURL());
            }
            applyPerspectiveTransform(qrArea, coordsQR, w, h);
        } else if (qrArea) {
            qrArea.style.display = 'none';
        }

        if (coordsLogo && logoArea) {
            let logoUrl = `./content/social/${plat}.png`;
            $(`#preview-social-logo-img-${i}`).attr('src', logoUrl);
            applyPerspectiveTransform(logoArea, coordsLogo, w, h);
        }
    });
};

$(document).ready(function() {
    $(document).on('click', '.social-icon-btn', function() {
        const target = $(this).closest('.social-icon-row').data('target');
        const plat = $(this).data('plat');
        $(this).siblings().removeClass('active');
        $(this).addClass('active');
        $(`#custom-social-platform-${target}`).val(plat);
        if(window.updateSocialPreview) window.updateSocialPreview();
    });

    $(document).on('input change', '#custom-social-link-1, #custom-social-link-2', function() {
        if(window.updateSocialPreview) window.updateSocialPreview();
    });
    
    $(document).on('change', '#custom-object-input', function() {
        if(window.updateSocialPreview) window.updateSocialPreview();
    });
    
    $(window).on('resize', function() {
        if(window.updateSocialPreview && $('#product-detail-page').hasClass('active')) {
            window.updateSocialPreview();
        }
    });
});

window.openProductDetail = function(id, pushHistory = true) {
    const p = products.find(x => x.id === id);
    if(!p) return;
    
    currentProduct = p;
    
    // Main Carousel
    const $carousel = $('#detail-main-carousel');
    $carousel.stop(true, true);
    $carousel.empty();
    
    // Thumbnails
    const $thumbs = $('#detail-thumbnails');
    $thumbs.empty();

    const slides = [], thumbs = [];
    if(p.images && p.images.length > 0) {
        p.images.forEach((imgObj, idx) => {
            slides.push(`
                <div style="position: relative; min-width: 100%; height: 100%; scroll-snap-align: start;">
                    <img src="${imgObj.src}" loading="${idx === 0 ? 'eager' : 'lazy'}" decoding="async" style="width: 100%; height: 100%; object-fit: cover;">
                </div>
            `);
            thumbs.push(`<img src="${imgObj.src}" class="product-thumb" data-idx="${idx}" loading="lazy" decoding="async" onclick="changeMainImage(${idx})" style="width: 70px; height: 70px; object-fit: cover; border-radius: 8px; cursor: pointer; border: 2px solid ${idx===0?'var(--accent)':'transparent'}; opacity: ${idx===0?'1':'0.6'}; transition: border-color .2s, opacity .2s;">`);
        });
        $carousel.html(slides.join(''));
        $thumbs.html(thumbs.join(''));
    } else {
        $carousel.append(`<img src="./content/default.jpg" style="min-width: 100%; height: 100%; object-fit: cover; scroll-snap-align: start;">`);
    }

    // Scroll senkronizasyonu — kare başına en fazla bir kez çalışır
    let carouselRaf = 0;
    $carousel.off('scroll').on('scroll', function() {
        if (carouselRaf) return;
        carouselRaf = requestAnimationFrame(() => { carouselRaf = 0; syncCarouselUi(); });
    });

    function syncCarouselUi() {
        const width = $carousel.width();
        if (!width || width <= 0) return;

        const scrollLeft = $carousel.scrollLeft();
        const maxScroll = $carousel[0].scrollWidth - width;
        const idx = Math.round(scrollLeft / width);
        $('.product-thumb').css({'border-color': 'transparent', 'opacity': '0.6'});
        $(`.product-thumb[data-idx="${idx}"]`).css({'border-color': 'var(--accent)', 'opacity': '1'});
        
        // Ok tuşlarının görünürlüğünü ayarla
        if (scrollLeft <= 2) {
            $('#carousel-prev').css({ 'opacity': '0.3', 'pointer-events': 'none' });
        } else {
            $('#carousel-prev').css({ 'opacity': '1', 'pointer-events': 'auto' });
        }
        
        // Çok küçük kayma (rounding) hatalarını önlemek için 2px tolerans
        if (scrollLeft >= maxScroll - 2) {
            $('#carousel-next').css({ 'opacity': '0.3', 'pointer-events': 'none' });
        } else {
            $('#carousel-next').css({ 'opacity': '1', 'pointer-events': 'auto' });
        }
    }

    // Fare (Mouse) ile Sürükleyip Kaydırma (Drag to scroll)
    $carousel.css({'cursor': 'grab', 'user-select': 'none'});
    
    // Carousel Ok Tuşları — .off() olmadan her ürün açılışında handler birikiyordu
    $('#carousel-prev').off('click.carousel').on('click.carousel', function() {
        const $carousel = $('#detail-main-carousel');
        const width = $carousel.width();
        const currentIdx = Math.round($carousel.scrollLeft() / width);
        if(currentIdx > 0) window.changeMainImage(currentIdx - 1);
    });
    $('#carousel-next').off('click.carousel').on('click.carousel', function() {
        const $carousel = $('#detail-main-carousel');
        const width = $carousel.width();
        const maxIdx = currentProduct.images.length - 1;
        const currentIdx = Math.round($carousel.scrollLeft() / width);
        if(currentIdx < maxIdx) window.changeMainImage(currentIdx + 1);
    });

    // Tarayıcının varsayılan görsel sürükleme (hayalet görsel) davranışını kapat
    $carousel.find('img').on('dragstart', function(e) { e.preventDefault(); });

    let isDown = false;
    let startX;
    let scrollLeftPos;

    $carousel.off('mousedown mouseleave mouseup mousemove');
    $carousel.on('mousedown', function(e) {
        isDown = true;
        $carousel.css('cursor', 'grabbing');
        startX = e.pageX - $carousel.offset().left;
        scrollLeftPos = $carousel.scrollLeft();
        // Sürüklerken snap ve CSS yumuşak kaydırmasını kapat (ağırlık hissini yaratan bu)
        $carousel.css({
            'scroll-snap-type': 'none',
            'scroll-behavior': 'auto'
        }); 
    });
    $carousel.on('mouseleave', function() {
        if (!isDown) return;
        isDown = false;
        $carousel.css({
            'cursor': 'grab',
            'scroll-snap-type': 'x mandatory',
            'scroll-behavior': 'smooth',
            'transform': 'translateX(0px)'
        });
        
        const scrollLeft = $carousel.scrollLeft();
        const width = $carousel.width();
        const nearestIdx = Math.round(scrollLeft / width);
        $carousel.animate({ scrollLeft: width * nearestIdx }, 200);
    });
    
    $carousel.on('mouseup', function() {
        if (!isDown) return;
        isDown = false;
        $carousel.css({
            'cursor': 'grab',
            'scroll-snap-type': 'x mandatory',
            'scroll-behavior': 'smooth',
            'transform': 'translateX(0px)'
        });
        
        const scrollLeft = $carousel.scrollLeft();
        const width = $carousel.width();
        const nearestIdx = Math.round(scrollLeft / width);
        $carousel.animate({ scrollLeft: width * nearestIdx }, 200);
    });
    
    $carousel.on('mousemove', function(e) {
        if(!isDown) return;
        e.preventDefault();
        const x = e.pageX - $carousel.offset().left;
        const walk = (x - startX) * 1.5; 
        const currentScroll = $carousel.scrollLeft();
        const maxScroll = $carousel[0].scrollWidth - $carousel.width();
        const nextScroll = currentScroll - walk;

        if (nextScroll < 0) {
            // Sola dayandı
            $carousel.css('transform', `translateX(${-nextScroll / 3}px)`);
            $carousel.scrollLeft(0);
        } else if (nextScroll > maxScroll) {
            // Sağa dayandı
            const over = nextScroll - maxScroll;
            $carousel.css('transform', `translateX(${-over / 3}px)`);
            $carousel.scrollLeft(maxScroll);
        } else {
            $carousel.css('transform', `translateX(0px)`);
            $carousel.scrollLeft(nextScroll);
        }
        startX = x;
    });

    $('#detail-title, #mobile-detail-title').text(p.name);
    $('#detail-desc, #mobile-detail-desc').text(p.desc);
    $('#detail-price').text(`₺${p.price.toFixed(2)}`);

    // Ürün özelleştirme alanlarını yönetme
    if (p.isCustomObject) {
        $('#customization-object-group').show();
        const $objTabs = $('#custom-object-tabs');
        const $objInput = $('#custom-object-input');
        $objTabs.empty();
        p.isCustomObject.forEach((obj, idx) => {
            const isActive = idx === 0;
            const bg = isActive ? 'var(--primary)' : '#fff';
            const color = isActive ? '#fff' : 'var(--text-main)';
            const border = isActive ? 'var(--primary)' : 'var(--border)';
            
            const tabHtml = `
                <div class="custom-object-tab" data-value="${idx}" 
                     style="padding: 10px 15px; border-radius: 8px; border: 1px solid ${border}; 
                            cursor: pointer; font-size: 0.9rem; font-weight: 600; text-align: center; 
                            flex: 1; min-width: max-content; transition: all 0.2s; 
                            background: ${bg}; color: ${color};">
                    ${obj.objectName}
                </div>
            `;
            $objTabs.append(tabHtml);
        });

        // Initialize hidden input
        $objInput.val(0);

        // Tab click event
        $objTabs.find('.custom-object-tab').on('click', function() {
            const val = $(this).data('value');
            $objInput.val(val);
            
            // Update visual states
            $objTabs.find('.custom-object-tab').css({
                'background': '#fff',
                'color': 'var(--text-main)',
                'border-color': 'var(--border)'
            });
            $(this).css({
                'background': 'var(--primary)',
                'color': '#fff',
                'border-color': 'var(--primary)'
            });
            
            // Trigger change for preview update
            $objInput.trigger('change');
        });
        
        $('#customization-text-group').hide();
        if (p.allowLogo) $('#customization-logo-group').show();
        else $('#customization-logo-group').hide();
        
        if (p.isCustomObject && p.isCustomObject[0] && p.isCustomObject[0].previewSocialLogo1) {
            $('#customization-social-group').show();
            $('#custom-social-platform-1').val('instagram');
            $('#custom-social-link-1').val('');
            $('#custom-social-platform-2').val('twitter');
            $('#custom-social-link-2').val('');
            $('.social-icon-row[data-target="1"] .social-icon-btn').removeClass('active');
            $('.social-icon-row[data-target="1"] .social-icon-btn[data-plat="instagram"]').addClass('active');
            $('.social-icon-row[data-target="2"] .social-icon-btn').removeClass('active');
            $('.social-icon-row[data-target="2"] .social-icon-btn[data-plat="twitter"]').addClass('active');
        } else {
            $('#customization-social-group').hide();
        }
    } else if (p.disableTextInput) {
        $('#customization-object-group').hide();
        $('#customization-text-group').hide();
        $('#customization-logo-group').hide();
        $('#customization-social-group').hide();
    } else if (p.isCustomText === false) {
        $('#customization-object-group').hide();
        $('#customization-social-group').hide();
        // isCustomText: false — yazı girişini gizle
        $('#customization-text-group').hide();
        if (p.allowLogo) {
            $('#customization-logo-group').show();
        } else {
            $('#customization-logo-group').hide();
        }
        // 2D önizlemede yazıyı gizle
        $('.preview-dynamic-text').text('');
    } else {
        $('#customization-social-group').hide();
        $('#customization-object-group').hide();
        $('#customization-text-group').show();

        if (p.allowLogo) {
            $('#customization-logo-group').show();
        } else {
            $('#customization-logo-group').hide();
        }
        
        $('#custom-text-label').text(p.customTextLabel || 'Ürün Üzerine Yazılacak Metin');
        $('#custom-text-input').attr('placeholder', p.customTextPlaceholder || 'Örn: ENGRARE');
        
        const $textInput = $('#custom-text-input');
        $textInput.off('input.format'); // Yalnızca format handler'ını temizle, preview handler'ına dokunma
        
        if (p.isPhoneNumber || (p.name && p.name.toLowerCase().includes('numaratör'))) {
            $textInput.attr('type', 'tel');
            $textInput.attr('maxlength', '14'); // 11 digits + 3 spaces
            $textInput.on('input.format', function() {
                const formatted = window.formatTurkishPhoneNumber ? window.formatTurkishPhoneNumber(this.value) : this.value;
                if (this.value !== formatted) {
                    this.value = formatted;
                    $(this).trigger('input.preview');
                }
            });
        } else {
            $textInput.attr('type', 'text');
            // Sunucu da metni 100 karakterle sınırlıyor
            $textInput.attr('maxlength', p.maxlength || 100);
        }
    }
    
    // Formu ve galeri pozisyonunu temizle
    $('#custom-text-input').val('');
    $('#quantity-input').val(1);
    $('.preview-dynamic-text').css('font-family', "'AGENCYB', sans-serif");

    $('#custom-text-color').val('#FBC02D');
    $('#custom-obj-color').val('#222222');
    
    // Temizle Logo (Varsayılan yüklemesi aşağıda yapılacak)
    // Dosya girişi sıfırlandığı için yüklenen logo balonu ve seçili logo da sıfırlanmalı;
    // aksi halde sepete dosya yerine megabaytlarca base64 veri yazılıyordu.
    $('#custom-logo-input').val('');
    $('#custom-uploaded-bubble').hide().removeAttr('data-src').removeClass('active');
    $('#custom-uploaded-img').attr('src', '');
    $('.logo-bubble').css('border-color', 'var(--border)').removeClass('active');
    $('.default-logo-bubble').first().css('border-color', 'var(--primary)').addClass('active');
    $('.preview-dynamic-logo').attr('data-active-logo', './content/engrare_logo_elegant.svg');
    
    
    // 2D Preview Box Reset
    if (p.disableTextInput || p.isCustomText === false) {
        $('.advanced-2d-preview-container').hide();
    } else {
        $('.advanced-2d-preview-container').show();
        const defaultText = p.isCustomObject ? '' : (p.customTextPlaceholderPreview || 'ENGRARE');
        const defaultSize = p.fixedTextSize || 51;
        $('.preview-dynamic-text').text(defaultText).css({
            'color': '#FBC02D',
            'font-size': defaultSize + 'px',
            'text-align': 'center'
        });
        // Auto scale
        
        const textArea = p.previewTextArea || { top: '15%', left: '10%', width: '80%', height: '70%' };
        $('.preview-printable-area').css({
            'top': textArea.top,
            'left': textArea.left,
            'width': textArea.width,
            'height': textArea.height,
            'justify-content': 'center',
            'border': (p.isDashedLine === true) ? '2px dashed rgba(0, 0, 0, 0.5)' : 'none'
        });
        
        if (p.allowLogo) {
            const logoArea = p.previewLogoArea || { top: '15%', left: '10%', width: '80%', height: '70%' };
            $('.preview-logo-area').css({
                'display': 'flex',
                'top': logoArea.top,
                'left': logoArea.left,
                'width': logoArea.width,
                'height': logoArea.height,
                'border': (p.isDashedLine === true) ? '2px dashed rgba(0, 0, 0, 0.5)' : 'none'
            });
            
            // Varsayılan logoyu yükle
            const defaultLogo = './content/engrare_logo_elegant.svg';
            $('.preview-dynamic-logo').css({
                'mask-image': `url(${defaultLogo})`,
                '-webkit-mask-image': `url(${defaultLogo})`,
                'mask-size': 'contain',
                '-webkit-mask-size': 'contain',
                'mask-repeat': 'no-repeat',
                '-webkit-mask-repeat': 'no-repeat',
                'mask-size': 'contain', '-webkit-mask-size': 'contain', 'mask-position': 'center',
                '-webkit-mask-position': 'center',
                'background-color': '#FBC02D'
            }).show();
            
        } else {
            $('.preview-logo-area').hide();
            $('.preview-dynamic-logo').hide().css('mask-image', 'none').css('-webkit-mask-image', 'none');
        }
        
        // Boyutlandırma tetiklemesini containerlar görünür olduktan SONRA yap ki tarayıcı mask-size'ı doğru hesaplasın.
        setTimeout(() => { if(typeof window.fitTextToContainer === 'function') window.fitTextToContainer(); }, 10);
        
        const initialC1 = (p.colors && p.colors[0]) ? p.colors[0].color1 : '#FBC02D';
        const initialC2 = (p.colors && p.colors[0] && p.colors[0].color2) ? p.colors[0].color2 : initialC1;
        
        $('#custom-text-color').val(initialC1);
        $('#custom-obj-color').val(initialC2);
        $('.preview-object-color-layer').css('background-color', initialC2);

        if (p.isCustomObject) {
            const objObj = p.isCustomObject[0] || {};
            const objSrc = objObj.src ? objObj.src : null;
            if (window.applyFilterToPreview) {
                window.applyFilterToPreview(p.id, initialC1, objSrc);
            } else if (objSrc) {
                $('.preview-overlay-img').attr('src', objSrc).show();
            }
            if(objObj.previewSocialLogo1) {
                setTimeout(() => { if(typeof window.updateSocialPreview === 'function') window.updateSocialPreview(); }, 100);
            } else {
                $('.preview-social-qr-area, .preview-social-logo-area').hide();
            }
        } else {
            $('.preview-social-qr-area, .preview-social-logo-area').hide();
            if (window.applyFilterToPreview) {
                window.applyFilterToPreview(p.id, initialC1);
            } else {
                $('.preview-overlay-img').attr('src', `./content/products/${p.id}/preview.png`).show();
            }
        }
    }
    
    // Ok tuşlarının ilk durumunu ayarla (başta en soldayız)
    $('#carousel-prev').css({ 'opacity': '0.3', 'pointer-events': 'none' });
    if(p.images && p.images.length > 1) {
        $('#carousel-next').css({ 'opacity': '1', 'pointer-events': 'auto' });
    } else {
        $('#carousel-next').css({ 'opacity': '0.3', 'pointer-events': 'none' });
    }

    // Call our new color generation logic
    if (typeof renderColorCombinations === 'function') {
        renderColorCombinations(p);
    }

    switchPage('#product-detail-page', false);
    
    if (pushHistory) {
        const slug = slugify(p.name);
        window.history.pushState({ page: '#product-detail-page', productId: p.id }, "", window.location.pathname + '?detail=' + slug);
    }
};

window.changeMainImage = function(idx) {
    const $carousel = $('#detail-main-carousel');
    if (!$carousel.length) return;
    const width = $carousel.width();
    
    $('.product-thumb').css({'border-color': 'transparent', 'opacity': '0.6'});
    $(`.product-thumb[data-idx="${idx}"]`).css({'border-color': 'var(--accent)', 'opacity': '1'});
    
    if (width > 0) {
        $carousel.scrollLeft(width * idx);
    }
};

async function addToCart() {
    if(!currentProduct) return;

    const text = $('#custom-text-input').val().trim();
    const qty = clampQty($('#quantity-input').val());
    const font = "'AGENCYB', sans-serif";
    const textColor = $('#custom-text-color').val();
    const objColor = $('#custom-obj-color').val();
    const textSize = 'Auto';
    const textAlign = 'center';
    
    const selectedObjectIdx = currentProduct.isCustomObject ? $('#custom-object-input').val() : null;
    const selectedObjectName = selectedObjectIdx !== null && currentProduct.isCustomObject[selectedObjectIdx] 
        ? currentProduct.isCustomObject[selectedObjectIdx].objectName 
        : null;
    
    const logoFile = $('#custom-logo-input').length > 0 ? $('#custom-logo-input')[0].files[0] : null;
    const isLogoVisible = $('#preview-dynamic-logo').is(':visible');
    
    const isPhoneProduct = currentProduct.isPhoneNumber || (currentProduct.name && currentProduct.name.toLowerCase().includes('numaratör'));
    if (isPhoneProduct) {
        let cleanDigits = text.replace(/\D/g, '');
        if (cleanDigits.length > 0 && !cleanDigits.startsWith('0')) {
            cleanDigits = '0' + cleanDigits;
        }
        
        if (cleanDigits.length === 0) {
            showToast("Lütfen araç içinde görünecek telefon numaranızı giriniz.", "error");
            return;
        }
        
        if (cleanDigits.length < 11 || !cleanDigits.startsWith('0')) {
            showToast("Lütfen 11 haneli geçerli bir telefon numarası giriniz (Örn: 05XX XXX XX XX veya 0212 XXX XX XX).", "error");
            return;
        }
    }

    const textRequired = !currentProduct.isCustomObject && !currentProduct.disableTextInput && currentProduct.isCustomText !== false;
    if(textRequired && text === "" && !isLogoVisible) {
        showToast("Lütfen yazılacak metni giriniz veya logo yükleyiniz.", "error");
        return;
    }

    const item = {
        id: Date.now(),
        productId: currentProduct.id,
        name: currentProduct.name,
        price: currentProduct.price,
        image: currentProduct.images[0],
        customText: text,
        font: font,
        textColor: textColor,
        objColor: objColor,
        quantity: qty,
        textSize: textSize,
        textAlign: textAlign,
        selectedObject: selectedObjectName,
        socialPlatform1: $('#customization-social-group').is(':visible') ? $('#custom-social-platform-1').val() : null,
        socialLink1: $('#customization-social-group').is(':visible') ? $('#custom-social-link-1').val().trim() : null,
        socialPlatform2: $('#customization-social-group').is(':visible') ? $('#custom-social-platform-2').val() : null,
        socialLink2: $('#customization-social-group').is(':visible') ? $('#custom-social-link-2').val().trim() : null
    };
    
    const activeLogoSrc = $('#preview-dynamic-logo').attr('data-active-logo');
    if (isLogoVisible && activeLogoSrc) {
        if ($('#custom-uploaded-bubble').hasClass('active') && logoFile) {
            showToast("Logo yükleniyor...", "info");
            const $btn = $('#add-to-cart');
            $btn.prop('disabled', true).css('opacity', '0.7');
            try {
                // Storage kuralları oturum ister: giriş yoksa misafir (anonim) oturum aç
                let user = await authReady();
                if (!user) user = (await signInAnonymously(auth)).user;
                const ext = (logoFile.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
                const fileName = `logos/cart_${item.id}_${Math.random().toString(36).substring(2)}.${ext}`;
                const sRef = storageRef(storage, fileName);
                await uploadBytes(sRef, logoFile, { customMetadata: { owner: user.uid } });
                item.logoUrl = await getDownloadURL(sRef);
                item.logoStoragePath = fileName;
            } catch (error) {
                showToast("Logo yükleme hatası", "error");
                $btn.prop('disabled', false).css('opacity', '1');
                return;
            }
            $btn.prop('disabled', false).css('opacity', '1');
        } else {
            item.logoUrl = activeLogoSrc;
        }
    }    cart.push(item);
    saveCart();
    renderCart();
    showToast("Sepete Eklendi!", "success");
}

function saveCart() {
    try {
        localStorage.setItem('engrare_cart', JSON.stringify(cart));
    } catch (e) {
        console.error("Sepet kaydedilemedi:", e);
        showToast("Sepet kaydedilemedi. Tarayıcı depolama alanı dolu olabilir.", "error");
    }
    $('#cart-badge').text(cart.length);
    $('#mobile-cart-badge').text(cart.length);
}

function loadCart() {
    let stored = null;
    try {
        stored = JSON.parse(localStorage.getItem('engrare_cart') || 'null');
    } catch (e) {
        // Bozuk sepet verisi tüm sayfayı çökertmesin
        console.error("Sepet verisi okunamadı, sıfırlanıyor:", e);
    }
    cart = Array.isArray(stored) ? stored.filter(item => item && typeof item === 'object') : [];
    $('#cart-badge').text(cart.length);
    $('#mobile-cart-badge').text(cart.length);
    renderCart();
}

/* Sepet ve sipariş detayındaki 2D kutunun en-boy oranı (iki yerde aynıydı) */
function previewAspectFor(p, item) {
    if (!p) return 1.71;
    if (p.id === 1) return 3.594;
    if (p.id === 2) return 1.710;
    if (p.isCustomObject) {
        const sel = (item.selectedObject || "").toLowerCase();
        if (sel.includes("fenerbahçe") || sel.includes("fb")) return 0.894;
        if (sel.includes("galatasaray") || sel.includes("gs")) return 0.653;
        if (sel.includes("trabzon")) return 0.678;
        if (sel.includes("beşiktaş") || sel.includes("bjk")) return 0.699;
        return 0.75;
    }
    return 1.71;
}

/* Kutu içi ölçüler */
function previewBoxSize(aspect, maxBox, minSide) {
    return aspect >= 1
        ? { w: maxBox, h: Math.max(minSide, Math.round(maxBox / aspect)) }
        : { w: Math.max(minSide, Math.round(maxBox * aspect)), h: maxBox };
}

/* Sipariş durumu rozetleri — her sipariş satırında yeniden kurulmasın diye modül düzeyinde */
const ORDER_STATUS_MAP = {
    'pending_payment': { text: 'Ödeme Bekliyor', icon: 'fa-solid fa-circle-exclamation', color: '#EF4444', bg: '#FEE2E2' },
    'Ödeme Bekliyor': { text: 'Ödeme Bekliyor', icon: 'fa-solid fa-circle-exclamation', color: '#EF4444', bg: '#FEE2E2' },
    'paid': { text: 'Ödendi', icon: 'fa-solid fa-sack-dollar', color: '#166534', bg: '#DCFCE7' },
    'payment_review': { text: 'Ödeme İnceleniyor', icon: 'fa-solid fa-magnifying-glass-dollar', color: '#92400E', bg: '#FEF3C7' },
    'Ödendi': { text: 'Ödendi', icon: 'fa-solid fa-sack-dollar', color: '#166534', bg: '#DCFCE7' },
    'Hazirlaniyor': { text: 'Hazırlanıyor', icon: 'fa-solid fa-clock', color: '#92400E', bg: '#FEF3C7' },
    'Hazırlanıyor': { text: 'Hazırlanıyor', icon: 'fa-solid fa-clock', color: '#92400E', bg: '#FEF3C7' },
    'Kargolandi': { text: 'Kargolandı', icon: 'fa-solid fa-truck', color: '#1E40AF', bg: '#DBEAFE' },
    'Kargolandı': { text: 'Kargolandı', icon: 'fa-solid fa-truck', color: '#1E40AF', bg: '#DBEAFE' },
    'Teslim Edildi': { text: 'Teslim Edildi', icon: 'fa-solid fa-box-open', color: '#7E22CE', bg: '#F3E8FF' },
    'Iptal': { text: 'İptal Edildi', icon: 'fa-solid fa-ban', color: '#EF4444', bg: '#FEE2E2' },
    'İptal': { text: 'İptal Edildi', icon: 'fa-solid fa-ban', color: '#EF4444', bg: '#FEE2E2' },
    'Iptal Edildi': { text: 'İptal Edildi', icon: 'fa-solid fa-ban', color: '#EF4444', bg: '#FEE2E2' },
    'İptal Edildi': { text: 'İptal Edildi', icon: 'fa-solid fa-ban', color: '#EF4444', bg: '#FEE2E2' },
    'cancelled': { text: 'İptal Edildi', icon: 'fa-solid fa-ban', color: '#EF4444', bg: '#FEE2E2' }
};
function orderStatus(raw) {
    return ORDER_STATUS_MAP[raw] || { text: raw || 'Hazırlanıyor', icon: 'fa-solid fa-circle-question', color: '#475569', bg: '#F1F5F9' };
}

/* Sipariş tarihini biçimlendir */
function orderDateText(order) {
    const createdAt = order.createdAt || order.timestamp || order.date || order.serverTimestamp || order.paidAt;
    if (!createdAt) return 'Bilinmiyor';
    if (typeof createdAt === 'object' && createdAt._seconds) {
        return new Date(createdAt._seconds * 1000).toLocaleString('tr-TR');
    }
    return new Date(createdAt).toLocaleString('tr-TR');
}

function renderCart() {
    const $area = $('#cart-items-area');
    $area.empty();
    
    if(cart.length === 0) {
        $area.html('<div style="text-align:center; padding:35px 20px; color:var(--text-muted); background: white; border-radius: 14px; border: 1px solid var(--border); font-size: 1rem;"><i class="fa-solid fa-cart-shopping" style="font-size: 2rem; color: #cbd5e1; margin-bottom: 12px; display: block;"></i>Sepetinizde ürün bulunmuyor.</div>');
        $('#val-subtotal').text("₺0.00");
        $('#shipping-display').text("₺0.00");
        $('#val-total').text("₺0.00");
        $('#free-shipping-progress-container').empty();
        return;
    }

    let sub = 0;
    const rows = [];
    cart.forEach((item, index) => {
        const p = products.find(prod => prod.id === item.productId);
        // Fiyat her zaman güncel katalogdan; eski/değiştirilmiş sepet verisine güvenilmez
        if (p) { item.price = p.price; item.name = p.name; }
        item.quantity = clampQty(item.quantity);
        sub += (Number(item.price) || 0) * item.quantity;

        const textColor = safeColor(item.textColor, '#FBC02D');
        const objColor = safeColor(item.objColor, textColor);
        const logoUrl = safeUrl(item.logoUrl);
        const itemName = escapeHtml(item.name);
        const customText = escapeHtml(item.customText || '');

        const { w: innerW, h: innerH } = previewBoxSize(previewAspectFor(p, item), 112, 26);

        const textArea = (p && p.previewTextArea) ? p.previewTextArea : { top: '15%', left: '10%', width: '80%', height: '70%' };
        const logoArea = (p && p.previewLogoArea) ? p.previewLogoArea : { top: '15%', left: '10%', width: '80%', height: '70%' };
        const isCustomObj = p && p.isCustomObject;

        let colorDropdownHtml = '';
        if (p && p.colors && p.colors.length > 0) {
            let swatches = '';
            p.colors.forEach(c => {
                const color1 = c.color1;
                const color2 = c.color2 || c.color1;
                const isSingle = !c.color2 || c.color1 === c.color2;
                const bg = isSingle ? color1 : `linear-gradient(135deg, ${color1} 50%, ${color2} 50%)`;
                const titleText = isSingle ? (c.label1 || 'Renk') : `${c.label1 || 'Yazı'} / ${c.label2 || 'Zemin'}`;
                swatches += `<div class="pla-swatch dual-swatch" data-color1="${color1}" data-color2="${color2}" data-cart-index="${index}" style="background: ${bg}; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--border);" title="${titleText}"></div>`;
            });
            const isCurrentSingle = textColor === objColor;
            const currentBg = isCurrentSingle ? objColor : `linear-gradient(135deg, ${textColor} 50%, ${objColor} 50%)`;
            colorDropdownHtml = `
                <div style="position: relative;">
                    <div class="pla-color-select" data-target="cart-dropdown-color-${index}" style="width: 28px; height: 28px; border-radius: 50%; background: ${currentBg}; border: 2px solid var(--border); cursor: pointer;" title="Renk Değiştir"></div>
                    <div class="pla-options-dropdown" id="cart-dropdown-color-${index}" style="padding: 10px; gap: 8px; width: 140px; bottom: calc(100% + 10px);">
                        <div style="text-align:center; font-size:0.72rem; font-weight:700; color:var(--text-muted); grid-column: span 4; margin-bottom: 4px;">RENK SEÇİMİ</div>
                        ${swatches}
                    </div>
                </div>
            `;
        }

        rows.push(`
            <div class="cart-item">
                <div style="display:flex; align-items:center; gap: 16px; width: 100%;">
                    <!-- Büyütülmüş 2D Canlı Önizleme Kutusu -->
                    <div class="cart-2d-box">
                        <div class="cart-preview-inner" id="cart-preview-inner-${index}" style="position: relative; overflow: hidden; border-radius: 4px; width: ${innerW}px; height: ${innerH}px; background: #ffffff;">
                            <!-- Zemin Renk Katmanı -->
                            <div class="cart-obj-layer" id="cart-obj-layer-${index}" style="position: absolute; inset: 0; background-color: ${objColor}; z-index: 1;"></div>
                            
                            <!-- Kırpılmış PNG Görseli -->
                            <img class="cart-overlay-img" id="cart-overlay-img-${index}" src="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; z-index: 2; display: none;">
                            
                            <!-- Canlı Metin Alanı -->
                            ${isCustomObj ? '' : `
                            <div class="cart-printable-area" id="cart-print-area-${index}" style="position: absolute; top: ${textArea.top}; left: ${textArea.left}; width: ${textArea.width}; height: ${textArea.height}; z-index: 3; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                                <span class="cart-dynamic-text" id="cart-dynamic-text-${index}" style="color: ${textColor}; font-family: 'AGENCYB', sans-serif; font-size: 14px; text-align: center; width: auto; word-break: break-word; display: inline-block; line-height: 1;">${customText}</span>
                            </div>
                            `}

                            <!-- Canlı Logo Alanı -->
                            ${(logoUrl && !isCustomObj) ? `
                            <div class="cart-logo-area" id="cart-logo-area-${index}" style="position: absolute; top: ${logoArea.top}; left: ${logoArea.left}; width: ${logoArea.width}; height: ${logoArea.height}; z-index: 3; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                                <div class="cart-dynamic-logo" id="cart-dynamic-logo-${index}" style="width: 100%; height: 100%; mask-image: url(${logoUrl}); -webkit-mask-image: url(${logoUrl}); mask-size: contain; -webkit-mask-size: contain; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; mask-position: center; -webkit-mask-position: center; background-color: ${textColor};"></div>
                            </div>
                            ` : ''}
                            
                            <!-- Canlı Sosyal Medya QR ve Logo Alanı 1 -->
                            ${(isCustomObj && item.socialPlatform1) ? `
                            <div class="cart-social-qr-area" id="cart-social-qr-area-1-${index}" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; display: none; transform-origin: 0 0;">
                                <img id="cart-social-qr-img-1-${index}" src="" style="width:100%; height:100%; object-fit:fill;">
                            </div>
                            <div class="cart-social-logo-area" id="cart-social-logo-area-1-${index}" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; display: none; transform-origin: 0 0;">
                                <img id="cart-social-logo-img-1-${index}" src="" style="width:100%; height:100%; object-fit:contain;" onerror="this.style.visibility='hidden'" onload="this.style.visibility='visible'">
                            </div>
                            ` : ''}
                            
                            <!-- Canlı Sosyal Medya QR ve Logo Alanı 2 -->
                            ${(isCustomObj && item.socialPlatform2) ? `
                            <div class="cart-social-qr-area" id="cart-social-qr-area-2-${index}" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; display: none; transform-origin: 0 0;">
                                <img id="cart-social-qr-img-2-${index}" src="" style="width:100%; height:100%; object-fit:fill;">
                            </div>
                            <div class="cart-social-logo-area" id="cart-social-logo-area-2-${index}" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; display: none; transform-origin: 0 0;">
                                <img id="cart-social-logo-img-2-${index}" src="" style="width:100%; height:100%; object-fit:contain;" onerror="this.style.visibility='hidden'" onload="this.style.visibility='visible'">
                            </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Ürün Bilgileri ve 3 Satırlı Kontrol Düzeni -->
                    <div class="info" style="flex:1; display:flex; flex-direction:column; justify-content: space-between; min-width: 0; min-height: 110px; gap: 8px;">
                        <!-- Üst Satır: Başlık & Fiyat -->
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                            <div>
                                <div style="font-weight:700; font-size: 1.02rem; color: var(--primary); line-height: 1.3;">${itemName}</div>
                                ${item.socialPlatform1 ? `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;">1. Platform: <span style="font-weight: 600; color: var(--text-main); text-transform: capitalize;">${escapeHtml(item.socialPlatform1)}</span> (${escapeHtml(item.socialLink1 || '')})</div>` : ''}
                                ${item.socialPlatform2 ? `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">2. Platform: <span style="font-weight: 600; color: var(--text-main); text-transform: capitalize;">${escapeHtml(item.socialPlatform2)}</span> (${escapeHtml(item.socialLink2 || '')})</div>` : ''}
                            </div>
                            <span style="font-weight:800; font-size: 1.15rem; color:var(--primary); white-space: nowrap;">₺${(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                        
                        <!-- Orta Satır: Obje Seçimi VEYA Metin Girişi -->
                        ${isCustomObj ? `
                        <div style="width: 100%;">
                            <div style="position: relative; width: 100%;">
                                <i class="fa-solid fa-shapes" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 0.82rem; pointer-events: none;"></i>
                                <select class="cart-object-select" data-index="${index}" style="width: 100%; padding: 7px 28px 7px 30px; font-size: 0.88rem; font-weight: 600; border: 1px solid var(--border); border-radius: 8px; background: #F8FAFC; color: var(--text-main); outline: none; transition: 0.2s; box-sizing: border-box; cursor: pointer; -webkit-appearance: none; -moz-appearance: none; appearance: none; background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2364748B%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E'); background-repeat: no-repeat; background-position: right 10px top 50%; background-size: 10px auto;" onfocus="this.style.borderColor='var(--accent)'; this.style.background='#fff';" onblur="this.style.borderColor='var(--border)'; this.style.background='#F8FAFC';">
                                    ${p.isCustomObject.map(obj => `
                                        <option value="${obj.objectName}" ${obj.objectName === (item.selectedObject || p.isCustomObject[0].objectName) ? 'selected' : ''}>${obj.objectName}</option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>
                        ` : `
                        <div style="width: 100%;">
                            <div style="position: relative; width: 100%;">
                                <i class="fa-solid fa-pen-clip" style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 0.8rem;"></i>
                                <input type="text" class="cart-text-input" data-index="${index}" value="${customText}" maxlength="100" placeholder="Ürün üzerine yazılacak metin..." style="font-family: 'AGENCYB', sans-serif; width: 100%; padding: 7px 10px 7px 30px; font-size: 0.88rem; border: 1px solid var(--border); border-radius: 8px; background: #F8FAFC; color: var(--text-main); outline: none; transition: 0.2s; box-sizing: border-box;" onfocus="this.style.borderColor='var(--accent)'; this.style.background='#fff';" onblur="this.style.borderColor='var(--border)'; this.style.background='#F8FAFC';">
                            </div>
                        </div>
                        `}

                        <!-- Alt Kontrol Satırı: Renk Seçici & Miktar Kontrolü (Sağa Hizalı) -->
                        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 2px;">
                            ${colorDropdownHtml}

                            <!-- Miktar / Kaldır Seçici -->
                            <div style="display:flex; align-items:center; background: #F8FAFC; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; height: 34px;">
                                <button type="button" class="qty-btn minus" onclick="updateCartQty(${index}, -1)" style="width: 32px; height: 100%; background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 0.9rem; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='${item.quantity === 1 ? 'rgba(239, 68, 68, 0.15)' : '#E2E8F0'}';" onmouseout="this.style.background='none';" title="${item.quantity === 1 ? 'Sepetten Kaldır' : 'Adet Azalt'}">
                                    ${item.quantity === 1 
                                        ? '<i class="fa-solid fa-trash-can" style="color: #ef4444; font-size: 0.85rem;"></i>' 
                                        : '<i class="fa-solid fa-minus" style="font-size: 0.75rem;"></i>'}
                                </button>
                                <input type="text" class="cart-qty-input" data-index="${index}" value="${item.quantity}" style="width: 36px; height: 100%; padding: 0; margin: 0; text-align: center; border: none; background: transparent; font-size: 0.92rem; font-weight: 700; color: var(--primary); outline: none;">
                                <button type="button" class="qty-btn plus" onclick="updateCartQty(${index}, 1)" style="width: 32px; height: 100%; background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 0.9rem; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='#E2E8F0';" onmouseout="this.style.background='none';" title="Adet Artır">
                                    <i class="fa-solid fa-plus" style="font-size: 0.75rem;"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `);
    });

    // Tüm satırları tek seferde DOM'a yaz, sonra 2D önizlemeleri çiz
    $area.html(rows.join(''));
    for (let i = 0; i < cart.length; i++) window.renderCartItemPreview(i);

    const remaining = 500 - sub;
    const progressPercent = Math.min((sub / 500) * 100, 100);
    
    let progressHtml = `
        <div style="margin-bottom: 22px; background: #FFFFFF; border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
            <div style="display:flex; justify-content:space-between; align-items: center; margin-bottom: 10px; font-size: 0.9rem; font-weight: 700;">
                <span>
                    ${remaining > 0 
                        ? `<i class="fa-solid fa-truck-fast" style="margin-right: 6px; color: #16a34a;"></i> Ücretsiz kargoya <span style="color: #16a34a; font-weight: 800; background: #dcfce7; padding: 2px 8px; border-radius: 6px; font-size: 0.95rem;">₺${remaining.toFixed(2)}</span> kaldı!` 
                        : '<i class="fa-solid fa-circle-check" style="margin-right: 6px; color: #16a34a;"></i> <span style="color: #16a34a; font-weight: 800;">Tebrikler! Kargo Ücretsiz.</span>'}
                </span>
            </div>
            <div style="width: 100%; height: 8px; background: #F1F5F9; border-radius: 10px; overflow: hidden; position: relative;">
                <div style="height: 100%; background: #16a34a; width: ${progressPercent}%; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1); border-radius: 10px;"></div>
            </div>
        </div>
    `;
    $('#free-shipping-progress-container').html(progressHtml);

    const shipping = sub === 0 ? 0 : (sub >= 500 ? 0 : 50.00);
    if (sub === 0) {
        $('#free-shipping-progress-container').hide();
        $('#shipping-display').closest('.price-row').hide();
    } else {
        $('#free-shipping-progress-container').show();
        $('#shipping-display').closest('.price-row').show();
    }
    $('#shipping-display').text(shipping === 0 ? "Ücretsiz" : `₺${shipping.toFixed(2)}`);
    $('#val-subtotal').text(`₺${sub.toFixed(2)}`);
    $('#val-total').text(`₺${(sub + shipping).toFixed(2)}`);
}

window.fitCartItemText = function(index) {
    const $container = $(`#cart-print-area-${index}`);
    const $text = $(`#cart-dynamic-text-${index}`);
    if (!$container.length || !$text.length) return;

    const textVal = $text.text().trim();
    if (!textVal) return;

    const containerW = $container.width();
    const containerH = $container.height();
    if (containerW <= 0 || containerH <= 0) return;

    let fontSize = containerH * 0.95;
    $text.css({
        'font-size': fontSize + 'px',
        'white-space': 'nowrap',
        'display': 'inline-block'
    });

    const textW = $text.outerWidth(true);
    if (textW > containerW && textW > 0) {
        const scale = containerW / textW;
        fontSize = fontSize * scale;
        $text.css('font-size', fontSize + 'px');
    }
};

window.renderCartItemPreview = function(index) {
    const item = cart[index];
    if (!item) return;
    const p = products.find(prod => prod.id === item.productId);
    if (!p) return;

    let src = `./content/products/${item.productId}/preview.png`;
    let isCustom = false;
    let customObj = null;
    if (p.isCustomObject) {
        customObj = p.isCustomObject.find(o => o.objectName === item.selectedObject) || p.isCustomObject[0];
        if (customObj) src = customObj.src;
        isCustom = true;
    }

    getPreviewImage(src, window.hexToRgb(item.textColor || '#FBC02D'), function(url, aspect, status) {
        // Görsel hazırlanırken sepet değiştiyse (silme/yeniden çizim) yanlış satıra yazma
        if (cart[index] !== item) return;
        $(`#cart-overlay-img-${index}`).attr('src', status === 'ok' ? url : src).show();
        if (status !== 'error') {
            setTimeout(() => {
                if (cart[index] !== item) return;
                if (typeof window.fitCartItemText === 'function') window.fitCartItemText(index);

                // Add social perspective updates if it's a social item
                if (isCustom && (item.socialPlatform1 || item.socialPlatform2) && customObj) {
                    const box = document.getElementById(`cart-preview-inner-${index}`);
                    if (!box) return;
                    const w = box.offsetWidth;
                    const h = box.offsetHeight;
                    
                    [1, 2].forEach(i => {
                        const plat = item[`socialPlatform${i}`];
                        const link = item[`socialLink${i}`];
                        const coordsQR = customObj[`previewSocialQR${i}`];
                        const coordsLogo = customObj[`previewSocialLogo${i}`];
                        
                        if (link && coordsQR && typeof QRious !== 'undefined') {
                            const qr = new QRious({
                                value: link,
                                size: 150,
                                foreground: item.textColor || '#000000',
                                background: 'transparent'
                            });
                            $(`#cart-social-qr-img-${i}-${index}`).attr('src', qr.toDataURL());
                            applyPerspectiveTransform(document.getElementById(`cart-social-qr-area-${i}-${index}`), coordsQR, w, h);
                        }
                        
                        if (plat && coordsLogo) {
                            const logoUrl = `./content/social/${plat}.png`;
                            $(`#cart-social-logo-img-${i}-${index}`).attr('src', logoUrl);
                            applyPerspectiveTransform(document.getElementById(`cart-social-logo-area-${i}-${index}`), coordsLogo, w, h);
                        }
                    });
                }
            }, 30);
        }
    });
};

window.updateCartQty = function(index, change) {
    if (!cart[index]) return;
    let newQty = cart[index].quantity + change;
    if (newQty <= 0) {
        const itemToRemove = cart[index];
        if (itemToRemove && itemToRemove.logoStoragePath) {
            deleteCartLogo(itemToRemove.logoStoragePath);
        }
        cart.splice(index, 1);
        saveCart();
        renderCart();
        showToast("Ürün sepetten kaldırıldı.", "info");
        return;
    }
    cart[index].quantity = newQty;
    saveCart();
    renderCart();
};

function showToast(message, type = "info") {
    const $container = $('#toast-container');
    const id = Date.now();
    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
    const $toast = $(`<div id="toast-${id}" class="toast ${type}"><i class="fa-solid ${icon} toast-icon"></i><span class="toast-message"></span></div>`);
    $toast.find('.toast-message').text(message);
    $container.append($toast);
    setTimeout(() => {
        $toast.addClass('hiding');
        setTimeout(() => $toast.remove(), 300);
    }, 2000);
}

/* Oturum değiştiğinde (çıkış / başka hesapla giriş) eski canlı dinleyiciler
   kapatılmazsa önceki kullanıcının siparişleri ve adresleri ekranda kalıyordu. */
let userDataUnsubscribers = [];
function stopUserDataListeners() {
    userDataUnsubscribers.forEach(unsubscribe => unsubscribe());
    userDataUnsubscribers = [];
    window.userOrders = {};
    window.userAddresses = {};
    $('#orders-list').html('Siparişler yükleniyor...');
    $('#addresses-list').empty();
    $('#dash-user-name').text('Kullanıcı');
    $('#dash-user-email').text('');
}

$(document).on('click', '.order-card[data-order-id]', function() {
    window.openOrderDetail(String($(this).attr('data-order-id')));
});

function loadUserOrders(userId) {
    if (!userId) return;
    const ordersRef = ref(db, `users/${userId}/orders`);

    userDataUnsubscribers.push(onValue(ordersRef, (snapshot) => {
        const data = snapshot.val();
        const $list = $('#orders-list');
        $list.empty();
        window.userOrders = data || {};

        if (data) {
            // Siparişleri tarihe göre yeniden eskiye sırala
            const orders = Object.entries(data).map(([id, val]) => ({ id, ...val }))
                .sort((a, b) => {
                    const tA = a.createdAt || a.timestamp || a.date || a.serverTimestamp || a.paidAt || 0;
                    const tB = b.createdAt || b.timestamp || b.date || b.serverTimestamp || b.paidAt || 0;
                    return tB - tA;
                });

            const cards = [];
            orders.forEach((order) => {
                const dateStr = orderDateText(order);
                const total = Number(order.totalAmount || order.total || 0);
                const status = orderStatus(order.status);

                let itemsArray = [];
                if (order.items) {
                    itemsArray = (Array.isArray(order.items) ? order.items : Object.values(order.items)).filter(Boolean);
                }

                let orderItemsHtml = "";
                if (itemsArray.length > 0) {
                    orderItemsHtml = itemsArray.map(item => `
                        <div style="margin-bottom: 6px;">
                            <div style="font-weight: 600; color: var(--primary); font-size: 0.9rem;">${escapeHtml(item.name)} <span style="font-size: 0.8rem; color: var(--text-muted);">x${escapeHtml(item.quantity || 1)}</span></div>
                            ${item.selectedObject ? `<div style="font-size: 0.8rem; color: #6b7280; margin-top: 2px;">Takım/Obje: ${escapeHtml(item.selectedObject)}</div>` : ''}
                            ${item.customText ? `<div style="font-size: 0.8rem; color: #6b7280; margin-top: 2px;">Yazı: ${escapeHtml(item.customText)}</div>` : ''}
                        </div>
                    `).join('');
                } else if (order.itemsSummary) {
                    orderItemsHtml = `<div style="font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(order.itemsSummary)}</div>`;
                }

                // Siparişin ürün görsellerini arka arkaya yuvarlak şekilde listeleme
                let imagesHtml = '';
                if (itemsArray.length > 0) {
                    imagesHtml += `<div class="order-avatar-group" style="display: flex; align-items: center; justify-content: center; width: 110px; margin-right: 20px; flex-shrink: 0;">`;
                    let imageList = [];
                    itemsArray.forEach(item => {
                        const qty = Math.min(parseInt(item.quantity) || 1, 4); // en fazla 3 görsel + "+X" gösteriliyor
                        let img = item.image;
                        if (typeof img === 'object' && img !== null) img = img.src;
                        img = safeUrl(img) || "./content/engrare_logo_elegant.png";
                        for (let i = 0; i < qty; i++) imageList.push(img);
                    });
                    const totalPieces = itemsArray.reduce((sum, item) => sum + (parseInt(item.quantity) || 1), 0);
                    
                    if (imageList.length > 3) {
                        // 3'ten fazla ürün varsa: 2 tanesi görsel, 3.sü kalan miktar (+X şeklinde)
                        for (let i = 0; i < 2; i++) {
                            imagesHtml += `<img src="${imageList[i]}" loading="lazy" decoding="async" style="width: 45px; height: 45px; border-radius: 50%; border: 2.5px solid white; object-fit: cover; box-shadow: var(--shadow-sm); margin-left: ${i === 0 ? '0' : '-15px'}; z-index: ${5 - i};">`;
                        }
                        const extra = totalPieces - 2;
                        imagesHtml += `<div style="width: 45px; height: 45px; border-radius: 50%; border: 2.5px solid white; background: #E2E8F0; color: #475569; font-size: 0.85rem; font-weight: 700; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm); margin-left: -15px; z-index: 3;">+${extra}</div>`;
                    } else {
                        // 3 ve daha az ise hepsini görsel olarak bas
                        for (let i = 0; i < imageList.length; i++) {
                            imagesHtml += `<img src="${imageList[i]}" loading="lazy" decoding="async" style="width: 45px; height: 45px; border-radius: 50%; border: 2.5px solid white; object-fit: cover; box-shadow: var(--shadow-sm); margin-left: ${i === 0 ? '0' : '-15px'}; z-index: ${5 - i};">`;
                        }
                    }
                    imagesHtml += `</div>`;
                }

                cards.push(`
                    <div class="order-card" data-order-id="${escapeHtml(order.id)}" style="padding: 20px; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 15px; background: white; cursor: pointer;">
                        <div class="order-card-inner">
                            <div class="order-card-left" style="display: flex; align-items: center; gap: 15px;">
                                ${imagesHtml}
                                <div>
                                    <h4 style="font-size: 1rem; color: var(--primary); margin-bottom: 5px;">Sipariş #${escapeHtml(order.id.substring(0, 8).toUpperCase())}</h4>
                                    <div style="margin-bottom: 8px;">${orderItemsHtml}</div>
                                    <span style="font-size: 0.8rem; color: var(--text-light);"><i class="fa-regular fa-calendar" style="margin-right: 5px;"></i>${escapeHtml(dateStr)}</span>
                                </div>
                            </div>
                            <div class="order-card-right" style="text-align: right; flex-shrink: 0;">
                                <div style="font-weight: 700; color: var(--primary); margin-bottom: 8px;">₺${(total || 0).toFixed(2)}</div>
                                <span class="order-status-pill" style="background: ${status.bg}; color: ${status.color}; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 700;"><i class="${status.icon}" style="margin-right: 4px;"></i>${escapeHtml(status.text)}</span>
                            </div>
                        </div>
                    </div>
                `);
            });
            $list.html(cards.join(''));
        } else {
            $list.html('<div style="text-align:center; padding:40px; color:var(--text-muted); font-size:0.98rem;">Henüz bir siparişiniz bulunmuyor.</div>');
        }
    }));
}

window.fitOrderDetailText = function(index) {
    const $container = $(`#order-detail-print-area-${index}`);
    const $text = $(`#order-detail-dynamic-text-${index}`);
    if (!$container.length || !$text.length) return;

    const textVal = $text.text().trim();
    if (!textVal) return;

    const containerW = $container.width();
    const containerH = $container.height();
    if (containerW <= 0 || containerH <= 0) return;

    let fontSize = containerH * 0.95;
    $text.css({
        'font-size': fontSize + 'px',
        'white-space': 'nowrap',
        'display': 'inline-block'
    });

    const textW = $text.outerWidth(true);
    if (textW > containerW && textW > 0) {
        const scale = containerW / textW;
        fontSize = fontSize * scale;
        $text.css('font-size', fontSize + 'px');
    }
};

window.renderOrderDetailPreview = function(item, index) {
    if (!item) return;
    const p = products.find(prod => prod.id === item.productId || prod.id === parseInt(item.productId));
    if (!p) return;

    let src = `./content/products/${item.productId}/preview.png`;
    let isCustom = false;
    let customObj = null;
    if (p.isCustomObject) {
        const sel = (item.selectedObject || "").toLowerCase();
        customObj = p.isCustomObject.find(o => {
            const oName = (o.objectName || "").toLowerCase();
            return oName === sel || oName.includes(sel) || sel.includes(oName);
        }) || p.isCustomObject[0];
        if (customObj) src = customObj.src;
        isCustom = true;
    }

    getPreviewImage(src, window.hexToRgb(item.textColor || '#FBC02D'), function(url, aspect, status) {
        $(`#order-detail-overlay-img-${index}`).attr('src', status === 'ok' ? url : src).show();
        if (status !== 'error') {
            setTimeout(() => {
                if (typeof window.fitOrderDetailText === 'function') window.fitOrderDetailText(index);
                
                // Add social perspective updates if it's a social item
                if (isCustom && (item.socialPlatform1 || item.socialPlatform2) && customObj) {
                    const box = document.getElementById(`order-detail-preview-inner-${index}`);
                    if (!box) return;
                    const w = box.offsetWidth;
                    const h = box.offsetHeight;
                    
                    [1, 2].forEach(i => {
                        const plat = item[`socialPlatform${i}`];
                        const link = item[`socialLink${i}`];
                        const coordsQR = customObj[`previewSocialQR${i}`];
                        const coordsLogo = customObj[`previewSocialLogo${i}`];
                        
                        if (link && coordsQR && typeof QRious !== 'undefined') {
                            const qr = new QRious({
                                value: link,
                                size: 150,
                                foreground: item.textColor || '#000000',
                                background: 'transparent'
                            });
                            $(`#order-detail-social-qr-img-${i}-${index}`).attr('src', qr.toDataURL());
                            applyPerspectiveTransform(document.getElementById(`order-detail-social-qr-area-${i}-${index}`), coordsQR, w, h);
                        }
                        
                        if (plat && coordsLogo) {
                            const logoUrl = `./content/social/${plat}.png`;
                            $(`#order-detail-social-logo-img-${i}-${index}`).attr('src', logoUrl);
                            applyPerspectiveTransform(document.getElementById(`order-detail-social-logo-area-${i}-${index}`), coordsLogo, w, h);
                        }
                    });
                }
            }, 30);
        }
    });
};

window.openOrderDetail = function(orderId) {
    const order = window.userOrders && window.userOrders[orderId];
    if (!order) return;
    const orderNo = escapeHtml(String(order.id || orderId).substring(0, 8).toUpperCase());

    let itemsArray = [];
    if (order.items) {
        itemsArray = (Array.isArray(order.items) ? order.items : Object.values(order.items)).filter(Boolean);
    }
    let itemsHtml = '';
    if (itemsArray.length > 0) {
        itemsHtml = itemsArray.map((item, index) => {
            const p = products.find(prod => prod.id === item.productId || prod.id === parseInt(item.productId));

            const { w: innerW, h: innerH } = previewBoxSize(previewAspectFor(p, item), 56, 16);

            const textArea = (p && p.previewTextArea) ? p.previewTextArea : { top: '15%', left: '10%', width: '80%', height: '70%' };
            const logoArea = (p && p.previewLogoArea) ? p.previewLogoArea : { top: '15%', left: '10%', width: '80%', height: '70%' };
            const isCustomObj = p && p.isCustomObject;
            const textColor = safeColor(item.textColor, '#FBC02D');
            const objColor = safeColor(item.objColor, textColor);
            const logoUrl = safeUrl(item.logoUrl);

            // Renk Swatch'ı: Çift renkli ise ortadan 45 derece ayırmalı (diagonal split), tek renkli ise solid
            let swatchBg = '';
            if (textColor === objColor) {
                swatchBg = textColor;
            } else {
                swatchBg = `linear-gradient(135deg, ${textColor} 50%, ${objColor} 50%)`;
            }

            return `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 12px; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0;">
                    <!-- 2D Canlı Önizleme Kutusu -->
                    <div class="order-detail-2d-box" style="width: 64px; height: 64px; background: #ffffff; border-radius: 10px; border: 1px solid var(--border); overflow: hidden; display: flex; align-items: center; justify-content: center; position: relative; flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
                        <div class="order-detail-preview-inner" id="order-detail-preview-inner-${index}" style="position: relative; overflow: hidden; border-radius: 3px; width: ${innerW}px; height: ${innerH}px; background: #ffffff;">
                            <!-- Zemin Renk Katmanı -->
                            <div class="order-detail-obj-layer" id="order-detail-obj-layer-${index}" style="position: absolute; inset: 0; background-color: ${objColor}; z-index: 1;"></div>
                            
                            <!-- Kırpılmış PNG Görseli -->
                            <img class="order-detail-overlay-img" id="order-detail-overlay-img-${index}" src="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; z-index: 2; display: none;">
                            
                            <!-- Canlı Metin Alanı -->
                            ${isCustomObj ? '' : `
                            <div class="order-detail-printable-area" id="order-detail-print-area-${index}" style="position: absolute; top: ${textArea.top}; left: ${textArea.left}; width: ${textArea.width}; height: ${textArea.height}; z-index: 3; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                                <span class="order-detail-dynamic-text" id="order-detail-dynamic-text-${index}" style="color: ${textColor}; font-family: 'AGENCYB', sans-serif; font-size: 9px; font-weight: 700; text-align: center; width: auto; word-break: break-word; display: inline-block; line-height: 1;">${escapeHtml(item.customText || '')}</span>
                            </div>
                            `}

                            <!-- Canlı Logo Alanı -->
                            ${(logoUrl && !isCustomObj) ? `
                            <div class="order-detail-logo-area" id="order-detail-logo-area-${index}" style="position: absolute; top: ${logoArea.top}; left: ${logoArea.left}; width: ${logoArea.width}; height: ${logoArea.height}; z-index: 3; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                                <div class="order-detail-dynamic-logo" id="order-detail-dynamic-logo-${index}" style="width: 100%; height: 100%; mask-image: url(${logoUrl}); -webkit-mask-image: url(${logoUrl}); mask-size: contain; -webkit-mask-size: contain; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; mask-position: center; -webkit-mask-position: center; background-color: ${textColor};"></div>
                            </div>
                            ` : ''}
                            
                              <!-- Canlı Sosyal Medya QR ve Logo Alanı 1 -->
                              ${(isCustomObj && item.socialPlatform1) ? `
                              <div class="order-detail-social-qr-area" id="order-detail-social-qr-area-1-${index}" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; display: none; transform-origin: 0 0;">
                                  <img id="order-detail-social-qr-img-1-${index}" src="" style="width:100%; height:100%; object-fit:fill;">
                              </div>
                              <div class="order-detail-social-logo-area" id="order-detail-social-logo-area-1-${index}" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; display: none; transform-origin: 0 0;">
                                  <img id="order-detail-social-logo-img-1-${index}" src="" style="width:100%; height:100%; object-fit:contain;" onerror="this.style.visibility='hidden'" onload="this.style.visibility='visible'">
                              </div>
                              ` : ''}

                              <!-- Canlı Sosyal Medya QR ve Logo Alanı 2 -->
                              ${(isCustomObj && item.socialPlatform2) ? `
                              <div class="order-detail-social-qr-area" id="order-detail-social-qr-area-2-${index}" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; display: none; transform-origin: 0 0;">
                                  <img id="order-detail-social-qr-img-2-${index}" src="" style="width:100%; height:100%; object-fit:fill;">
                              </div>
                              <div class="order-detail-social-logo-area" id="order-detail-social-logo-area-2-${index}" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; display: none; transform-origin: 0 0;">
                                  <img id="order-detail-social-logo-img-2-${index}" src="" style="width:100%; height:100%; object-fit:contain;" onerror="this.style.visibility='hidden'" onload="this.style.visibility='visible'">
                              </div>
                              ` : ''}
                        </div>
                    </div>

                    <!-- Ürün Bilgileri -->
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 700; color: var(--primary); font-size: 0.95rem; margin-bottom: 2px;">${escapeHtml(item.name)}</div>
                        ${item.selectedObject ? `<div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 2px;">Takım/Obje: <span style="font-weight: 600; color: var(--primary);">${escapeHtml(item.selectedObject)}</span></div>` : ''}
                        ${item.socialPlatform1 ? `<div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 2px;">1. Platform: <span style="font-weight: 600; color: var(--primary); text-transform: capitalize;">${escapeHtml(item.socialPlatform1)}</span> (${escapeHtml(item.socialLink1 || '')})</div>` : ''}
                        ${item.socialPlatform2 ? `<div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 2px;">2. Platform: <span style="font-weight: 600; color: var(--primary); text-transform: capitalize;">${escapeHtml(item.socialPlatform2)}</span> (${escapeHtml(item.socialLink2 || '')})</div>` : ''}
                        ${(item.customText && !isCustomObj) ? `<div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 2px;">Yazı: <span style="font-weight: 600; color: var(--primary);">"${escapeHtml(item.customText)}"</span></div>` : ''}
                        ${item.socialPlatform ? `<div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 2px;">Platform: <span style="font-weight: 600; color: var(--primary); text-transform: capitalize;">${escapeHtml(item.socialPlatform)}</span></div>` : ''}
                        ${item.socialLink ? `<div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 2px;">Link/Kullanıcı Adı: <span style="font-weight: 600; color: var(--primary);">${escapeHtml(item.socialLink)}</span></div>` : ''}
                        <div style="font-size: 0.82rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
                            <span>Renk:</span>
                            <div style="width: 16px; height: 16px; border-radius: 50%; background: ${swatchBg}; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.08); flex-shrink: 0;" title="Yazı: ${textColor} / Zemin: ${objColor}"></div>
                        </div>
                        <div style="font-size: 0.82rem; color: var(--text-muted);">Adet: <span style="font-weight: 600; color: var(--text-main);">${escapeHtml(item.quantity || 1)}</span></div>
                    </div>
                </div>
                <div style="font-weight: 800; font-size: 1.05rem; color: var(--primary); white-space: nowrap;">₺${((Number(item.price) || 0) * (Number(item.quantity) || 1)).toFixed(2)}</div>
            </div>
        `}).join('');
    } else if (order.itemsSummary) {
        itemsHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px;">
                <div style="font-weight: 600;">${escapeHtml(order.itemsSummary)}</div>
                <div style="font-weight: 600;">₺${(Number(order.totalAmount || order.total) || 0).toFixed(2)}</div>
            </div>
        `;
    }

    const dateStr = escapeHtml(orderDateText(order));
    const total = Number(order.totalAmount || order.total) || 0;
    const statusObj = orderStatus(order.status);
    const statusBadge = `<span style="background: ${statusObj.bg}; color: ${statusObj.color}; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; white-space: nowrap;"><i class="${statusObj.icon}" style="margin-right: 4px;"></i>${escapeHtml(statusObj.text)}</span>`;

    let ibanWarningHtml = '';
    if ((order.paymentMethod === 'havale' || order.paymentMethod === 'iban') && 
        (!order.status || order.status === 'pending_payment' || order.status === 'Hazirlaniyor')) {
        ibanWarningHtml = `
            <div style="margin-top: 10px; margin-bottom: 25px; padding: 15px; background-color: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 8px; color: #991B1B;">
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                    <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.2rem; margin-right: 10px; color: #DC2626;"></i>
                    <strong style="font-size: 1.1rem;">Ödeme Bekleniyor (Havale/EFT)</strong>
                </div>
                <p style="margin-bottom: 10px; font-size: 0.98rem;">
                    Siparişinizin onaylanması için ödemenizin banka hesaplarımıza ulaşması gerekmektedir. 
                    Lütfen ödemenizi yaparken açıklama kısmına <strong>${orderNo}</strong> sipariş numaranızı yazmayı unutmayınız.
                </p>
                <div style="background-color: white; padding: 10px; border-radius: 6px; border: 1px solid #FECACA; font-family: monospace; font-size: 1rem; margin-bottom: 10px; text-align: center;">
                    <strong>Alıcı:</strong> Kaya Sertel<br>
                    <strong>IBAN:</strong> TR41 0006 4000 0011 4560 4302 15
                </div>
                <p style="font-size: 0.85rem; color: #7F1D1D; margin-top: 10px;">
                    <i class="fa-solid fa-circle-info" style="margin-right: 5px;"></i> Ödemenizi havale olarak yaptıysanız ve 1 iş günü beklediyseniz, lütfen <strong>destek@engrare.com</strong> adresine mail atınız.
                </p>
            </div>
        `;
    }

    $('#order-modal-content').html(`
        <div style="margin-bottom: 15px; line-height: 1.5; display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
                <strong>Sipariş No:</strong> #${orderNo}<br>
                <strong>Tarih:</strong> ${dateStr}
            </div>
            <div>
                ${statusBadge}
            </div>
        </div>
        ${ibanWarningHtml}
        <div style="margin-bottom: 15px;">
            <h4 style="margin-bottom: 10px; color: var(--primary);">Ürünler</h4>
            ${itemsHtml}
        </div>
        <div style="text-align: right; font-size: 1.2rem; font-weight: 700; color: var(--primary);">
            Toplam: ₺${total.toFixed(2)}
        </div>
    `);
    
    // 2D Canlı Önizlemeleri Çizdir
    if (itemsArray.length > 0) {
        itemsArray.forEach((item, index) => {
            window.renderOrderDetailPreview(item, index);
        });
    }

    $('#order-detail-modal').addClass('open');
    $('body').addClass('no-scroll');
};

/* Sepetteki bir ürünün Storage'daki logosunu siler (Firebase SDK tembel yüklenir) */
function deleteCartLogo(path) {
    if (!path) return;
    fbReady().then(() => {
        deleteObject(storageRef(storage, path))
            .catch(err => console.error("Logo silinemedi:", err));
    });
}

// --- KONTROL PANELİ: ADRESLERİ DETAYLI YÜKLEME VE DÜZENLEME ---
function loadUserAddresses(userId) {
    if (!userId) return;
    const addrRef = ref(db, `users/${userId}/addresses`);

    userDataUnsubscribers.push(onValue(addrRef, (snapshot) => {
        const data = snapshot.val();
        window.userAddresses = data || {};
        const $list = $('#addresses-list');
        $list.empty();

        if (data) {
            const cards = [];
            Object.entries(data).forEach(([id, addr]) => {
                if (!addr || typeof addr !== 'object') return;
                // Ödeme sayfasından kaydedilen adresler ad/soyad ve "address" alanlarını kullanıyor
                const fullname = addr.fullname || [addr.name, addr.surname].filter(Boolean).join(' ') || 'İsimsiz';
                const details = addr.details || addr.address || 'Adres detayı belirtilmemiş';
                const location = addr.district ? `${addr.district} / ${addr.city || ''}` : (addr.city || '');
                const phone = addr.phone ? `<br><i class="fa-solid fa-phone" style="font-size:0.75rem;"></i> ${escapeHtml(addr.phone)}` : '';

                cards.push(`
                    <div class="address-card">
                        <div style="font-weight: 700; color: var(--primary); margin-bottom: 6px; font-size: 1.05rem;">
                            <i class="fa-solid fa-location-dot" style="color: var(--accent);"></i> ${escapeHtml(addr.title || 'Adres')}
                        </div>
                        <div style="font-size: 0.9rem; color: var(--text-main); font-weight: 600; margin-bottom: 4px;">${escapeHtml(fullname)}</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.5;">
                            ${escapeHtml(details)}<br><strong>${escapeHtml(location)}</strong>${phone}
                        </div>
                        <div class="address-card-actions">
                            <button class="btn-sm edit-addr-btn" data-id="${escapeHtml(id)}" style="padding: 6px 12px; font-size: 0.8rem;"><i class="fa-solid fa-pen-to-square"></i> Düzenle</button>
                            <button class="btn-sm delete-addr-btn" data-id="${escapeHtml(id)}" style="padding: 6px 12px; font-size: 0.8rem; color: #EF4444; border-color: #FCA5A5;"><i class="fa-solid fa-trash"></i> Sil</button>
                        </div>
                    </div>
                `);
            });
            $list.html(cards.join(''));
        } else {
            $list.html('<div style="text-align:center; padding:40px; color:var(--text-muted);">Kayıtlı adresiniz bulunmuyor.</div>');
        }
    }));
}

// --- DYNAMIC IMAGE FILTERING ---

window.hexToRgb = function(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
};

window.applyFilterToPreview = function(productId, textColorHex, customSrc) {
    if (!productId && !customSrc) return;

    const imgUrl = customSrc || `./content/products/${productId}/preview.png`;
    const activeTextColor = textColorHex || (typeof $('#custom-text-color') !== 'undefined' ? $('#custom-text-color').val() : null) || '#FBC02D';
    const recolor = activeTextColor ? window.hexToRgb(activeTextColor) : null;

    getPreviewImage(imgUrl, recolor, function(url, aspect, status) {
        if (status === 'error') { $('.preview-overlay-img').hide(); return; }

        $('.preview-overlay-img').attr('src', status === 'ok' ? url : imgUrl).show();

        if (aspect && typeof window.updatePreviewBoxDimensions === 'function') {
            window.updatePreviewBoxDimensions(aspect);
        }
        setTimeout(() => {
            if (typeof window.fitTextToContainer === 'function') window.fitTextToContainer();
        }, 30);
    });
};

window.updatePreviewBoxDimensions = function(aspect) {
    if (!aspect && window.currentPreviewAspect) {
        aspect = window.currentPreviewAspect;
    }
    if (!aspect) return;
    window.currentPreviewAspect = aspect;
    
    const $container = $('#advanced-2d-preview-container');
    const containerWidth = $container.width() || $('#product-detail-page .product-images').width() || 340;
    const isMobile = window.innerWidth <= 768;
    const maxHeight = isMobile ? 195 : 220;
    
    let boxWidth, boxHeight;
    if (containerWidth / aspect <= maxHeight) {
        boxWidth = Math.floor(containerWidth);
        boxHeight = Math.floor(containerWidth / aspect);
    } else {
        boxHeight = maxHeight;
        boxWidth = Math.floor(maxHeight * aspect);
    }
    
    $('#advanced-2d-preview-box').css({
        'width': boxWidth + 'px',
        'height': boxHeight + 'px',
        'aspect-ratio': `${aspect}`,
        'margin': '0 auto'
    });
    
    if (typeof window.fitTextToContainer === 'function') {
        window.fitTextToContainer();
    }
};

/* Tek, rAF ile kısıtlanmış resize işleyicisi.
   Önceden iki ayrı ve kısıtlanmamış resize handler vardı; mobilde adres
   çubuğu her açılıp kapandığında art arda yerleşim hesabı tetikliyorlardı. */
let _resizeRaf = 0;
$(window).on('resize', function() {
    if (_resizeRaf) return;
    _resizeRaf = requestAnimationFrame(function() {
        _resizeRaf = 0;
        if (window.currentPreviewAspect && typeof window.updatePreviewBoxDimensions === 'function') {
            window.updatePreviewBoxDimensions();      // içinde fitTextToContainer da çağırır
        } else if (typeof window.fitTextToContainer === 'function') {
            window.fitTextToContainer();
        }
        const activeId = $('.page.active').attr('id');
        updateMobileHeader(activeId ? '#' + activeId : '#products-page');
    });
});

// --- DIAGONAL COLOR COMBINATIONS ---
function renderColorCombinations(p) {
    const $colorContainer = $('#color-combinations-container');
    $colorContainer.empty();

    if (p.colors && Array.isArray(p.colors)) {
        p.colors.forEach((c, index) => {
            const color1 = c.color1;
            const color2 = c.color2;
            const hasColor2 = Boolean(color2 && color2 !== color1);
            const label1 = c.label1 || (hasColor2 ? 'Yazı' : 'Renk');
            const label2 = c.label2 || (hasColor2 ? 'Zemin' : '');

            let btnHtml = '';
            let tooltipHtml = '';

            if (!hasColor2) {
                btnHtml = `<div class="diagonal-color-btn ${index === 0 ? 'active' : ''}" data-color1="${color1}" data-color2="${color1}" style="background: ${color1};">`;
                tooltipHtml = `<div class="elegant-tooltip"><div class="tooltip-row"><div class="tooltip-swatch" style="background: ${color1};"></div><span>${label1}</span></div></div>`;
            } else {
                btnHtml = `<div class="diagonal-color-btn ${index === 0 ? 'active' : ''}" data-color1="${color1}" data-color2="${color2}" style="background: linear-gradient(135deg, ${color1} 50%, ${color2} 50%);">`;
                tooltipHtml = `<div class="elegant-tooltip"><div class="tooltip-row"><div class="tooltip-swatch" style="background: ${color1};"></div><span>${label1}</span></div><div class="tooltip-row"><div class="tooltip-swatch" style="background: ${color2};"></div><span>${label2}</span></div></div>`;
            }

            $colorContainer.append($(btnHtml + tooltipHtml + `</div>`));

            if (index === 0) {
                $('#custom-text-color').val(color1);
                $('#custom-obj-color').val(color2 || color1);
                $('.preview-object-color-layer').css('background-color', color2 || color1);
            }
        });
    }
}

$(document).on('click', '.diagonal-color-btn', function() {
    $('.diagonal-color-btn').removeClass('active');
    $(this).addClass('active');
    const c1 = $(this).data('color1');
    const c2 = $(this).data('color2');
    $('#custom-text-color').val(c1);
    $('#custom-obj-color').val(c2);

    // Update previews
    $('.preview-dynamic-text').css('color', c1);
    $('.preview-dynamic-logo').css('background-color', c1);
    if(window.updateSocialPreview) window.updateSocialPreview();
    $('.preview-object-color-layer').css('background-color', c2);
    if (typeof currentProduct !== 'undefined' && currentProduct) {
        // Transparan kısımlar arka plan rengine (c2) dönüşmeli
        $('.preview-object-color-layer').css('background-color', c2 || c1);
        
        // Siyah kısımlar yazı rengine (c1) dönüşmeli
        let customSrc = null;
        if (currentProduct.isCustomObject) {
            const idx = $('#custom-object-input').val() || 0;
            const obj = currentProduct.isCustomObject[idx] || currentProduct.isCustomObject[0];
            if (obj) customSrc = obj.src;
        }
        if (window.applyFilterToPreview) {
            window.applyFilterToPreview(currentProduct.id, c1, customSrc);
        }
    }
});


