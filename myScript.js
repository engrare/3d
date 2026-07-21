import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, set, push, onValue, remove, get } from "firebase/database";
import { getStorage } from "firebase/storage";

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

let cart = [];
let currentProduct = null;

// --- BASİTLEŞTİRİLMİŞ ÜRÜN DATASI ---
const products = [
    {
        id: 1,
        name: "Dik Duran Kişiye Özel Ad Plakası",
        desc: "Masanızda şık duracak, isim veya unvan yazdırabileceğiniz özel plaka.",
        price: 180,
        images: [
            { src: "./content/products/1/1.jpg", mockup: { top: "42%", left: "55%", width: "70%", height: "40%", transform: "translate(-50%, -50%) rotateZ(-17deg)", faceColor: "#E0E0E0", extrusionColor: "#4a4a4a", depth: 7, angle: -120 } },
            { src: "./content/products/1/2.jpg", mockup: { top: "60%", left: "70%", width: "35%", height: "12%", transform: "translate(-50%, -50%) rotateZ(10deg)", faceColor: "#f5f5f5", extrusionColor: "#222222", depth: 10, angle: 45 } },
            { src: "./content/products/1/3.jpg", mockup: { top: "20%", left: "50%", width: "55%", height: "18%", transform: "translate(-50%, -50%)", faceColor: "#FFFFFF", extrusionColor: "#666666", depth: 25, angle: 90 } },
            { src: "./content/products/1/4.jpg", mockup: { top: "80%", left: "20%", width: "25%", height: "8%", transform: "translate(-50%, -50%) rotateZ(-15deg)", faceColor: "#cccccc", extrusionColor: "#111111", depth: 5, angle: -45 } }
        ]
    },
    {
        id: 2,
        name: "Duvara Yapışmalı Özel Ad Plakası",
        desc: "Kapı veya duvarlar için tasarlanmış isimlik.",
        price: 180,
        images: [
            { src: "./content/products/2/1.jpg", mockup: { top: "50%", left: "50%", width: "60%", height: "15%", transform: "translate(-50%, -50%) rotateZ(2deg)", faceColor: "#FFD700", extrusionColor: "#B8860B", depth: 12, angle: 120 } },
            { src: "./content/products/2/2.jpg", mockup: { top: "30%", left: "40%", width: "45%", height: "10%", transform: "translate(-50%, -50%) rotateZ(-8deg)", faceColor: "#FFFFFF", extrusionColor: "#555555", depth: 8, angle: 160 } },
            { src: "./content/products/2/3.jpg", mockup: { top: "70%", left: "60%", width: "35%", height: "12%", transform: "translate(-50%, -50%) rotateZ(5deg)", faceColor: "#E0E0E0", extrusionColor: "#333333", depth: 18, angle: 30 } },
            { src: "./content/products/2/4.jpg", mockup: { top: "45%", left: "80%", width: "30%", height: "14%", transform: "translate(-50%, -50%) rotateZ(-20deg)", faceColor: "#F8F8FF", extrusionColor: "#A9A9A9", depth: 20, angle: -120 } }
        ]
    },
    {
        id: 3,
        name: "Özel Tasarım Kalemlik",
        desc: "Üzerine isim yazdırılabilen dekoratif kalemlik.",
        price: 180,
        images: [
            { src: "./content/products/3/1.jpg", mockup: { top: "70%", left: "50%", width: "40%", height: "10%", transform: "translate(-50%, -50%)", faceColor: "#FFFFFF", extrusionColor: "#000000", depth: 15, angle: 45 } },
            { src: "./content/products/3/2.jpg", mockup: { top: "50%", left: "20%", width: "30%", height: "8%", transform: "translate(-50%, -50%) rotateZ(15deg)", faceColor: "#EEEEEE", extrusionColor: "#444444", depth: 6, angle: 90 } },
            { src: "./content/products/3/3.jpg", mockup: { top: "80%", left: "70%", width: "28%", height: "12%", transform: "translate(-50%, -50%) rotateZ(-10deg)", faceColor: "#F5F5DC", extrusionColor: "#8B4513", depth: 12, angle: 135 } },
            { src: "./content/products/3/4.jpg", mockup: { top: "40%", left: "80%", width: "35%", height: "15%", transform: "translate(-50%, -50%) rotateZ(-25deg)", faceColor: "#FFFFFF", extrusionColor: "#2F4F4F", depth: 22, angle: -45 } }
        ]
    }
];

// --- DOM READY ---
$(document).ready(function() {
    loadCart();
    renderProducts();

    // Initial Routing
    const path = window.location.search.replace('?', '');
    const map = {
        'products': '#products-page',
        'checkout': '#checkout-page',
        'login': '#login-page',
        'dashboard': '#dashboard-page',
        'detail': '#product-detail-page'
    };
    
    // Save initial state if it doesn't exist
    if (!window.history.state) {
        window.history.replaceState({ page: map[path] || '#products-page' }, "", window.location.href);
    }
    
    if (path && map[path]) {
        switchPage(map[path], false); 
    }

    // Tarayıcı Geri/İleri Tuşları İçin Popstate Dinleyicisi
    window.addEventListener('popstate', function(event) {
        if (event.state && event.state.page) {
            switchPage(event.state.page, false);
        } else {
            switchPage('#products-page', false);
        }
    });

    // Navigasyon
    $('.nav-menu li, .nav-trigger, .dropdown-item').click(function(e) {
        e.stopPropagation();
        const target = $(this).data('target');
        if (target) switchPage(target);
    });

    // Sepete Ekle
    $('#add-to-cart').click(addToCart);

    // Firebase Auth İzleyici
    onAuthStateChanged(auth, (user) => {
        if (user) {
            if (user.isAnonymous) {
                $('#nav-login-btn').css('display', 'flex');
                $('#nav-user-profile').hide();
                $('#nav-logout-container').hide();
            } else {
                $('#nav-login-btn').hide();
                $('#nav-user-profile').css('display', 'flex');
                $('#nav-logout-container').css('display', 'flex');
                $('#dash-user-name').text(user.displayName || "Kullanıcı");
                $('#dash-user-email').text(user.email);
            }
            loadUserOrders(user.uid);
            loadUserAddresses(user.uid);
        } else {
            $('#nav-login-btn').css('display', 'flex');
            $('#nav-user-profile').hide();
            $('#nav-logout-container').hide();
        }
    });

    // Çıkış Yap
    $('#action-logout').click(() => {
        signOut(auth).then(() => {
            switchPage('#products-page');
            showToast("Çıkış yapıldı.", "success");
        });
    });

    // Checkout Modal Devam
    $('#btn-checkout-start').click(function() {
        if(cart.length === 0) return showToast("Sepetiniz boş.", "error");
        if (auth.currentUser && !auth.currentUser.isAnonymous) {
            window.location.href = "./payment";
        } else {
            $('#auth-decision-modal').addClass('open');
        }
    });

    $('#modal-btn-login').click(() => {
        $('#auth-decision-modal').removeClass('open');
        switchPage('#login-page');
    });

    $('#modal-btn-guest').click(async () => {
        if (!auth.currentUser) await signInAnonymously(auth);
        window.location.href = "./payment";
    });

    // Modal Kapatma Mantığı (Dışa Tıklama / Tıklayıp Sürükleyip Bırakınca Yanlışlıkla Kapanmama)
    let mousedownTarget = null;
    $(document).on('mousedown', function(e) {
        mousedownTarget = e.target;
    });
    
    $(document).on('mouseup', function(e) {
        // Tıklama dışarıda başladıysa ve dışarıda bittiyse ve overlay ise kapat
        if (mousedownTarget === e.target && $(e.target).hasClass('modal-overlay')) {
            $(e.target).removeClass('open');
        }
    });

    $(document).on('click', '.modal-close', function() {
        $(this).closest('.modal-overlay').removeClass('open');
    });

    // --- ÖZEL RENK SEÇİCİ (PLA 10 Renk) ---
    $('.pla-color-select').click(function(e) {
        e.stopPropagation();
        const targetId = $(this).data('target');
        $('.pla-options-dropdown').not('#' + targetId).removeClass('open');
        $('#' + targetId).toggleClass('open');
    });

    $('.pla-swatch').click(function(e) {
        e.stopPropagation();
        const color = $(this).data('color');
        const inputId = $(this).data('input');
        $('#' + inputId).val(color);
        $('#' + inputId + '-btn').css('background-color', color);
        $(this).closest('.pla-options-dropdown').removeClass('open');
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
        cart.splice($(this).data('index'), 1);
        saveCart();
        renderCart();
    });

    // Sepet İçi Düzenleme (Adet / Yazı)
    $(document).on('change', '.cart-qty-input', function() {
        const index = $(this).data('index');
        let newQty = parseInt($(this).val());
        if(newQty < 1 || isNaN(newQty)) newQty = 1;
        cart[index].quantity = newQty;
        saveCart();
        renderCart();
    });

    $(document).on('change', '.cart-text-input', function() {
        const index = $(this).data('index');
        cart[index].customText = $(this).val();
        saveCart();
        renderCart();
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
        if (!auth.currentUser) return;
        
        const userId = auth.currentUser.uid;
        const addrId = $('#addr-id').val() || Date.now().toString();
        
        const addrData = {
            title: $('#addr-title').val().trim(),
            fullname: $('#addr-fullname').val().trim(),
            phone: $('#addr-phone').val().trim(),
            city: $('#addr-city').val().trim(),
            district: $('#addr-district').val().trim(),
            details: $('#addr-details').val().trim()
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
        if (!auth.currentUser) return;
        const addrId = $(this).data('id');
        
        const addr = window.userAddresses && window.userAddresses[addrId];
        if (!addr) return;
        
        $('#address-modal-title').text('Adresi Düzenle');
        $('#addr-id').val(addrId);
        $('#addr-title').val(addr.title || '');
        $('#addr-fullname').val(addr.fullname || '');
        $('#addr-phone').val(addr.phone || '');
        $('#addr-city').val(addr.city || '');
        $('#addr-district').val(addr.district || '');
        $('#addr-details').val(addr.details || addr.address || '');
        
        $('#address-modal').addClass('open');
    });

    // Dinamik Mockup Canlı Önizleme
    $('#custom-text-input').on('input', function() {
        const text = $(this).val().trim();
        $('.mockup-svg-text').text(text);
    });

    // Font Değişimi
    $('#custom-font-input').on('change', function() {
        const font = $(this).val();
        $('.mockup-svg-text').attr('font-family', font);
    });

    // Detay Sayfası Miktar Artırma/Azaltma
    $('#detail-qty-minus').click(function() {
        let val = parseInt($('#quantity-input').val()) || 1;
        if (val > 1) $('#quantity-input').val(val - 1);
    });
    $('#detail-qty-plus').click(function() {
        let val = parseInt($('#quantity-input').val()) || 1;
        $('#quantity-input').val(val + 1);
    });
});

// --- FONKSİYONLAR ---

function switchPage(targetId, pushState = true) {
    $('.nav-menu li').removeClass('active');
    $(`.nav-menu li[data-target="${targetId}"]`).addClass('active');
    $('.page').removeClass('active');
    $(targetId).addClass('active');
    window.scrollTo(0, 0);

    if (pushState) {
        const map = { '#products-page': 'products', '#checkout-page': 'checkout', '#login-page': 'login', '#dashboard-page': 'dashboard', '#product-detail-page': 'detail' };
        window.history.pushState({ page: targetId }, "", window.location.pathname + '?' + (map[targetId] || 'products'));
    }
}

function renderProducts() {
    const $grid = $('#products-grid-container');
    $grid.empty();
    products.forEach(p => {
        const imgObj = p.images[0] || { src: "./content/default.jpg" };
        const imgSrc = imgObj.src;
        $grid.append(`
            <div class="model-card" onclick="openProductDetail(${p.id})">
                <div class="card-image"><img src="${imgSrc}" alt="${p.name}"/></div>
                <div class="model-info">
                    <div class="model-title">${p.name}</div>
                    <div class="model-desc">${p.desc}</div>
                    <div class="card-meta">
                        <span class="price-tag" style="margin: auto 0;">₺${p.price.toFixed(2)}</span>
                    </div>
                </div>
            </div>
        `);
    });
}

window.openProductDetail = function(id) {
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
    
    if(p.images && p.images.length > 0) {
        p.images.forEach((imgObj, idx) => {
            $carousel.append(`
                <div style="position: relative; min-width: 100%; height: 100%; scroll-snap-align: start;">
                    <img src="${imgObj.src}" style="width: 100%; height: 100%; object-fit: cover;">
                </div>
            `);
            $thumbs.append(`<img src="${imgObj.src}" class="product-thumb" data-idx="${idx}" onclick="changeMainImage(${idx})" style="width: 70px; height: 70px; object-fit: cover; border-radius: 8px; cursor: pointer; border: 2px solid ${idx===0?'var(--accent)':'transparent'}; opacity: ${idx===0?'1':'0.6'}; transition: 0.2s;">`);
        });
    } else {
        $carousel.append(`<img src="./content/default.jpg" style="min-width: 100%; height: 100%; object-fit: cover; scroll-snap-align: start;">`);
    }

    // Scroll senkronizasyonu
    $carousel.off('scroll').on('scroll', function() {
        const scrollLeft = $(this).scrollLeft();
        const width = $(this).width();
        const maxScroll = $carousel[0].scrollWidth - width;
        const idx = Math.round(scrollLeft / width);
        $('.product-thumb').css({'border-color': 'transparent', 'opacity': '0.6'});
        $(`.product-thumb[data-idx="${idx}"]`).css({'border-color': 'var(--accent)', 'opacity': '1'});
        
        // Ok tuşlarının görünürlüğünü ayarla
        if (scrollLeft <= 0) {
            $('#carousel-prev').css({ 'opacity': '0.3', 'pointer-events': 'none' });
        } else {
            $('#carousel-prev').css({ 'opacity': '1', 'pointer-events': 'auto' });
        }
        
        // Çok küçük kayma (rounding) hatalarını önlemek için 1px tolerans
        if (scrollLeft >= maxScroll - 1) {
            $('#carousel-next').css({ 'opacity': '0.3', 'pointer-events': 'none' });
        } else {
            $('#carousel-next').css({ 'opacity': '1', 'pointer-events': 'auto' });
        }
    });

    // Fare (Mouse) ile Sürükleyip Kaydırma (Drag to scroll)
    $carousel.css({'cursor': 'grab', 'user-select': 'none'});
    
    // Carousel Ok Tuşları
    $('#carousel-prev').click(function() {
        const $carousel = $('#detail-main-carousel');
        const width = $carousel.width();
        const currentIdx = Math.round($carousel.scrollLeft() / width);
        if(currentIdx > 0) window.changeMainImage(currentIdx - 1);
    });
    $('#carousel-next').click(function() {
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

    $('#detail-title').text(p.name);
    $('#detail-desc').text(p.desc);
    $('#detail-price').text(`₺${p.price.toFixed(2)}`);
    
    // Formu ve galeri pozisyonunu temizle
    $('#custom-text-input').val('');
    $('#quantity-input').val(1);
    $('#custom-font-input').val("'Plus Jakarta Sans', sans-serif").trigger('change');
    $('#custom-text-color').val('#FBC02D');
    $('#custom-text-color-btn').css('background-color', '#FBC02D');
    $('#custom-obj-color').val('#222222');
    $('#custom-obj-color-btn').css('background-color', '#222222');
    
    // Ok tuşlarının ilk durumunu ayarla (başta en soldayız)
    $('#carousel-prev').css({ 'opacity': '0.3', 'pointer-events': 'none' });
    if(p.images && p.images.length > 1) {
        $('#carousel-next').css({ 'opacity': '1', 'pointer-events': 'auto' });
    } else {
        $('#carousel-next').css({ 'opacity': '0.3', 'pointer-events': 'none' });
    }

    setTimeout(() => {
        $carousel.css('scroll-behavior', 'auto');
        $carousel.scrollLeft(0);
        $carousel.css('scroll-behavior', 'smooth');
    }, 10);

    switchPage('#product-detail-page');
};

window.changeMainImage = function(idx) {
    const $carousel = $('#detail-main-carousel');
    const width = $carousel.width();
    
    // jQuery .animate() ve CSS scroll-behavior: smooth çakışmasını engellemek için doğrudan tarayıcı API'sine bırakıyoruz.
    $carousel.scrollLeft(width * idx);
};

function addToCart() {
    if(!currentProduct) return;
    
    const text = $('#custom-text-input').val().trim();
    const qty = parseInt($('#quantity-input').val()) || 1;
    const font = $('#custom-font-input').val();
    const textColor = $('#custom-text-color').val();
    const objColor = $('#custom-obj-color').val();
    
    if(text === "") {
        showToast("Lütfen yazılacak metni giriniz.", "error");
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
        quantity: qty
    };

    cart.push(item);
    saveCart();
    renderCart();
    showToast("Sepete Eklendi!", "success");
}

function saveCart() {
    localStorage.setItem('engrare_cart', JSON.stringify(cart));
    $('#cart-badge').text(cart.length);
}

function loadCart() {
    const stored = localStorage.getItem('engrare_cart');
    if (stored) {
        cart = JSON.parse(stored);
        $('#cart-badge').text(cart.length);
        renderCart();
    }
}

function renderCart() {
    const $area = $('#cart-items-area');
    $area.empty();
    
    if(cart.length === 0) {
        $area.html('<div style="text-align:center; padding:20px; color:#999">Sepet boş.</div>');
        $('#val-subtotal').text("₺0.00");
        $('#shipping-display').text("₺50.00");
        $('#val-total').text("₺50.00"); 
        $('#free-shipping-progress-container').empty();
        return;
    }

    let sub = 0;
    cart.forEach((item, index) => {
        sub += item.price * item.quantity;
        
        let img = item.image;
        if (typeof img === 'object' && img !== null) img = img.src;
        img = img || "./content/product2.jpeg";
        
        $area.append(`
            <div class="cart-item">
                <div style="display:flex; align-items:flex-start; gap: 20px; width: 100%;">
                    <img src="${img}" style="width: 90px; height: 90px; object-fit: cover; border-radius: 12px; flex-shrink: 0; border: 1px solid var(--border);">
                    
                    <div class="info" style="flex:1; display:flex; flex-direction:column; justify-content: space-between; min-height: 90px;">
                        <div style="font-weight:700; font-size: 1rem; color: var(--primary); margin-bottom: 8px;">${item.name}</div>
                        
                        <div style="display:flex; align-items:center; gap: 15px; margin-top: auto; flex-wrap: wrap;">
                            <div style="position: relative; width: 100%; max-width: 220px;">
                                <i class="fa-solid fa-pen-clip" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-muted); font-size: 0.85rem;"></i>
                                <input type="text" class="cart-text-input" data-index="${index}" value="${item.customText}" placeholder="Yazı girin..." style="font-family: ${item.font || 'inherit'}; width: 100%; padding: 8px 12px 8px 32px; font-size: 0.85rem; border: 1px solid var(--border); border-radius: 8px; background: #F8FAFC; color: var(--text-main); outline: none; transition: 0.2s; box-sizing: border-box;" onfocus="this.style.borderColor='var(--accent)'; this.style.background='#fff';" onblur="this.style.borderColor='var(--border)'; this.style.background='#F8FAFC';">
                            </div>
                            
                            <div style="display: flex; gap: 8px;">
                                <div style="width: 20px; height: 20px; border-radius: 50%; background: ${item.textColor || '#fff'}; border: 1px solid var(--border);" title="Yazı Rengi"></div>
                                <div style="width: 20px; height: 20px; border-radius: 50%; background: ${item.objColor || '#333'}; border: 1px solid var(--border);" title="Obje Rengi"></div>
                            </div>

                            <div style="display:flex; align-items:center; background: #F8FAFC; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; height: 35px;">
                                <button type="button" class="qty-btn minus" onclick="updateCartQty(${index}, -1)" style="width: 30px; height: 100%; background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 1rem; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='#E2E8F0';" onmouseout="this.style.background='none';"><i class="fa-solid fa-minus" style="font-size: 0.75rem;"></i></button>
                                <input type="text" class="cart-qty-input" data-index="${index}" value="${item.quantity}" style="width: 40px; height: 100%; padding: 0; margin: 0; text-align: center; border: none; background: transparent; font-size: 0.9rem; font-weight: 600; color: var(--primary); outline: none; pointer-events: auto;">
                                <button type="button" class="qty-btn plus" onclick="updateCartQty(${index}, 1)" style="width: 30px; height: 100%; background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 1rem; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='#E2E8F0';" onmouseout="this.style.background='none';"><i class="fa-solid fa-plus" style="font-size: 0.75rem;"></i></button>
                            </div>
                        </div>
                    </div>
                    
                    <div class="price-action" style="display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; min-height: 90px; min-width: 90px;">
                        <span style="font-weight:800; font-size: 1.1rem; color:var(--primary);">₺${(item.price * item.quantity).toFixed(2)}</span>
                        <button class="remove-btn" data-index="${index}" style="color: #EF4444; background: rgba(239, 68, 68, 0.1); border:none; cursor:pointer; font-size:0.8rem; font-weight: 600; padding: 6px 10px; border-radius: 6px; transition: 0.2s; display: flex; align-items: center; gap: 5px;" onmouseover="this.style.background='rgba(239, 68, 68, 0.2)';" onmouseout="this.style.background='rgba(239, 68, 68, 0.1)';"><i class="fa-solid fa-trash-can"></i> Kaldır</button>
                    </div>
                </div>
            </div>
        `);
    });

    const remaining = 500 - sub;
    const progressPercent = Math.min((sub / 500) * 100, 100);
    
    let progressHtml = `
        <div style="margin-bottom: 25px; background: #FFFFFF; border: 1px solid var(--border); border-radius: 12px; padding: 18px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
            <div style="display:flex; justify-content:space-between; margin-bottom: 12px; font-size: 0.9rem; font-weight: 700;">
                <span style="color: ${remaining > 0 ? 'var(--primary)' : '#10B981'};">
                    ${remaining > 0 ? `<i class="fa-solid fa-truck" style="margin-right: 5px; color: var(--text-muted);"></i> Kargo bedavaya <span style="color:var(--accent);">₺${remaining.toFixed(2)}</span> kaldı!` : '<i class="fa-solid fa-check-circle" style="margin-right: 5px;"></i> Harika! Kargonuz ücretsiz.'}
                </span>
            </div>
            <div style="width: 100%; height: 8px; background: #F1F5F9; border-radius: 10px; overflow: hidden; position: relative;">
                <div style="height: 100%; background: ${remaining > 0 ? 'var(--accent)' : '#10B981'}; width: ${progressPercent}%; transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1); border-radius: 10px;"></div>
            </div>
        </div>
    `;
    $('#free-shipping-progress-container').html(progressHtml);

    const shipping = sub >= 500 ? 0 : 50.00;
    $('#shipping-display').text(shipping === 0 ? "Ücretsiz" : `₺${shipping.toFixed(2)}`);
    $('#val-subtotal').text(`₺${sub.toFixed(2)}`);
    $('#val-total').text(`₺${(sub + shipping).toFixed(2)}`);
}

window.updateCartQty = function(index, change) {
    let newQty = cart[index].quantity + change;
    if (newQty < 1) newQty = 1;
    cart[index].quantity = newQty;
    saveCart();
    renderCart();
};

function showToast(message, type = "info") {
    const $container = $('#toast-container');
    const id = Date.now();
    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
    const $toast = $(`<div id="toast-${id}" class="toast ${type}"><i class="fa-solid ${icon} toast-icon"></i><span class="toast-message">${message}</span></div>`);
    $container.append($toast);
    setTimeout(() => {
        $toast.addClass('hiding');
        setTimeout(() => $toast.remove(), 300);
    }, 3000);
}

// Giriş Yap İşlemi
    $('#btn-signin').click(async () => {
        const email = $('#signin-email').val().trim();
        const pass = $('#signin-password').val().trim();
        
        if(!email || !pass) return showToast("Lütfen e-posta ve şifrenizi girin.", "error");

        const $btn = $('#btn-signin');
        $btn.prop('disabled', true).text('Giriş Yapılıyor...');

        try {
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

    // Kayıt Ol İşlemi
    $('#btn-signup').click(async () => {
        const fullname = $('#signup-fullname').val().trim();
        const email = $('#signup-email').val().trim();
        const pass = $('#signup-password').val().trim();
        const isKvkk = $('#signup-kvkk').is(':checked');

        if (!fullname || !email || !pass) return showToast("Lütfen tüm alanları doldurun.", "error");
        if (!isKvkk) return showToast("Lütfen KVKK metnini onaylayın.", "error");

        const $btn = $('#btn-signup');
        $btn.prop('disabled', true).text('Hesap Oluşturuluyor...');

        try {
            const userCred = await createUserWithEmailAndPassword(auth, email, pass);
            await updateProfile(userCred.user, { displayName: fullname });
            showToast("Hesap başarıyla oluşturuldu!", "success");
            switchPage('#products-page');
            // Formu temizle
            $('#signup-fullname').val('');
            $('#signup-email').val('');
            $('#signup-password').val('');
            $('#signup-kvkk').prop('checked', false);
        } catch (error) {
            showToast("Kayıt Hatası: " + error.message, "error");
        } finally {
            $btn.prop('disabled', false).text('Kaydol');
        }
    });
	





function loadUserOrders(userId) {
    if (!userId) return;
    const ordersRef = ref(db, `users/${userId}/orders`);
    
    onValue(ordersRef, (snapshot) => {
        const data = snapshot.val();
        const $list = $('#orders-list');
        $list.empty();
        
        if (data) {
            window.userOrders = data;
            // Siparişleri tarihe göre yeniden eskiye sırala
            const orders = Object.entries(data).map(([id, val]) => ({ id, ...val }))
                .sort((a, b) => {
                    const tA = a.createdAt || a.timestamp || a.date || a.serverTimestamp || a.paidAt || 0;
                    const tB = b.createdAt || b.timestamp || b.date || b.serverTimestamp || b.paidAt || 0;
                    return tB - tA;
                });

            orders.forEach((order) => {
                const createdAt = order.createdAt || order.timestamp || order.date || order.serverTimestamp || order.paidAt;
                let dateStr = 'Bilinmiyor';
                if (createdAt) {
                    if (typeof createdAt === 'object' && createdAt._seconds) {
                        dateStr = new Date(createdAt._seconds * 1000).toLocaleString('tr-TR');
                    } else {
                        dateStr = new Date(createdAt).toLocaleString('tr-TR');
                    }
                }
                const total = order.totalAmount || order.total || 0;
                
                // Sadeleştirilmiş durum haritası
                const statusMap = {
                    'pending_payment': { text: 'Ödeme Bekliyor', color: '#F59E0B', bg: '#FEF3C7' },
                    'paid': { text: 'Ödendi / Hazırlanıyor', color: '#10B981', bg: '#D1FAE5' },
                    'shipped': { text: 'Kargoya Verildi', color: '#3B82F6', bg: '#DBEAFE' },
                    'cancelled': { text: 'İptal Edildi', color: '#EF4444', bg: '#FEE2E2' }
                };
                const status = statusMap[order.status] || { text: 'Hazırlanıyor', color: '#10B981', bg: '#D1FAE5' };
                
                let itemsArray = [];
                if (order.items) {
                    itemsArray = Array.isArray(order.items) ? order.items : Object.values(order.items);
                }
                
                let orderItemsText = "";
                if (itemsArray.length > 0) {
                    orderItemsText = itemsArray.map(item => `${item.name} (${item.customText || '-'})`).join(', ');
                } else if (order.itemsSummary) {
                    orderItemsText = order.itemsSummary;
                }

                // Siparişin ürün görsellerini arka arkaya yuvarlak şekilde listeleme
                let imagesHtml = '';
                if (itemsArray.length > 0) {
                    imagesHtml += `<div class="order-avatar-group" style="display: flex; align-items: center; justify-content: center; width: 110px; margin-right: 20px; flex-shrink: 0;">`;
                    let imageList = [];
                    itemsArray.forEach(item => {
                        const qty = parseInt(item.quantity) || 1;
                        for (let i = 0; i < qty; i++) {
                            let img = item.image;
                            if (typeof img === 'object' && img !== null) img = img.src;
                            imageList.push(img || "./content/default.jpg");
                        }
                    });
                    
                    if (imageList.length > 3) {
                        // 3'ten fazla ürün varsa: 2 tanesi görsel, 3.sü kalan miktar (+X şeklinde)
                        for (let i = 0; i < 2; i++) {
                            imagesHtml += `<img src="${imageList[i]}" style="width: 45px; height: 45px; border-radius: 50%; border: 2.5px solid white; object-fit: cover; box-shadow: var(--shadow-sm); margin-left: ${i === 0 ? '0' : '-15px'}; z-index: ${5 - i};">`;
                        }
                        const extra = imageList.length - 2;
                        imagesHtml += `<div style="width: 45px; height: 45px; border-radius: 50%; border: 2.5px solid white; background: #E2E8F0; color: #475569; font-size: 0.85rem; font-weight: 700; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm); margin-left: -15px; z-index: 3;">+${extra}</div>`;
                    } else {
                        // 3 ve daha az ise hepsini görsel olarak bas
                        for (let i = 0; i < imageList.length; i++) {
                            imagesHtml += `<img src="${imageList[i]}" style="width: 45px; height: 45px; border-radius: 50%; border: 2.5px solid white; object-fit: cover; box-shadow: var(--shadow-sm); margin-left: ${i === 0 ? '0' : '-15px'}; z-index: ${5 - i};">`;
                        }
                    }
                    imagesHtml += `</div>`;
                }

                $list.append(`
                    <div class="order-card" onclick="openOrderDetail('${order.id}')" style="padding: 20px; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; background: white; cursor: pointer;">
                        <div style="display: flex; align-items: center;">
                            ${imagesHtml}
                            <div>
                                <h4 style="font-size: 1rem; color: var(--primary); margin-bottom: 5px;">Sipariş #${order.id.substring(0, 8).toUpperCase()}</h4>
                                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">${orderItemsText}</p>
                                <span style="font-size: 0.8rem; color: var(--text-light);"><i class="fa-regular fa-calendar"></i> ${dateStr}</span>
                            </div>
                        </div>
                        <div style="text-align: right; flex-shrink: 0; margin-left: 15px;">
                            <div style="font-weight: 700; color: var(--primary); margin-bottom: 8px;">₺${total.toFixed(2)}</div>
                            <span class="order-status-pill" style="background: ${status.bg}; color: ${status.color}; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 700;">${status.text}</span>
                        </div>
                    </div>
                `);
            });
        } else {
            $list.html('<div style="text-align:center; padding:40px; color:var(--text-muted); font-size:0.95rem;">Henüz bir siparişiniz bulunmuyor.</div>');
        }
    });
}

window.openOrderDetail = function(orderId) {
    const order = window.userOrders[orderId];
    if (!order) return;
    
    let itemsArray = [];
    if (order.items) {
        itemsArray = Array.isArray(order.items) ? order.items : Object.values(order.items);
    }
    let itemsHtml = '';
    if (itemsArray.length > 0) {
        itemsHtml = itemsArray.map(item => {
            let img = item.image;
            if (typeof img === 'object' && img !== null) img = img.src;
            return `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 15px;">
                    ${img ? `<img src="${img}" style="width: 50px; height: 50px; border-radius: 8px; object-fit: cover;">` : ''}
                    <div>
                        <div style="font-weight: 600;">${item.name}</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">Yazı: "${item.customText || '-'}"</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                            Renkler: 
                            <div style="width: 14px; height: 14px; border-radius: 50%; background: ${item.textColor || '#fff'}; border: 1px solid var(--border);" title="Yazı Rengi"></div>
                            <div style="width: 14px; height: 14px; border-radius: 50%; background: ${item.objColor || '#333'}; border: 1px solid var(--border);" title="Obje Rengi"></div>
                        </div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">Adet: ${item.quantity}</div>
                    </div>
                </div>
                <div style="font-weight: 600;">₺${(item.price * item.quantity).toFixed(2)}</div>
            </div>
        `}).join('');
    } else if (order.itemsSummary) {
        itemsHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px;">
                <div style="font-weight: 600;">${order.itemsSummary}</div>
                <div style="font-weight: 600;">₺${(order.totalAmount || order.total || 0).toFixed(2)}</div>
            </div>
        `;
    }

    const createdAt = order.createdAt || order.timestamp || order.date || order.serverTimestamp || order.paidAt;
    let dateStr = 'Bilinmiyor';
    if (createdAt) {
        if (typeof createdAt === 'object' && createdAt._seconds) {
            dateStr = new Date(createdAt._seconds * 1000).toLocaleString('tr-TR');
        } else {
            dateStr = new Date(createdAt).toLocaleString('tr-TR');
        }
    }
    const total = order.totalAmount || order.total || 0;

    $('#order-modal-content').html(`
        <div style="margin-bottom: 15px; line-height: 1.5;">
            <strong>Sipariş No:</strong> #${order.id.substring(0, 8).toUpperCase()}<br>
            <strong>Tarih:</strong> ${dateStr}
        </div>
        <div style="margin-bottom: 15px;">
            <h4 style="margin-bottom: 10px; color: var(--primary);">Ürünler</h4>
            ${itemsHtml}
        </div>
        <div style="text-align: right; font-size: 1.2rem; font-weight: 700; color: var(--primary);">
            Toplam: ₺${total.toFixed(2)}
        </div>
    `);
    
    $('#order-detail-modal').addClass('open');
};

// --- KONTROL PANELİ: ADRESLERİ DETAYLI YÜKLEME VE DÜZENLEME ---
function loadUserAddresses(userId) {
    if (!userId) return;
    const addrRef = ref(db, `users/${userId}/addresses`);
    
    onValue(addrRef, (snapshot) => {
        const data = snapshot.val();
        window.userAddresses = data || {};
        const $list = $('#addresses-list');
        $list.empty();
        
        if (data) {
            Object.entries(data).forEach(([id, addr]) => {
                const fullname = addr.fullname || 'İsimsiz';
                const details = addr.details || addr.address || 'Adres detayı belirtilmemiş';
                const location = addr.district ? `${addr.district} / ${addr.city}` : (addr.city || '');
                const phone = addr.phone ? `<br><i class="fa-solid fa-phone" style="font-size:0.75rem;"></i> ${addr.phone}` : '';

                $list.append(`
                    <div class="address-card">
                        <div style="font-weight: 700; color: var(--primary); margin-bottom: 6px; font-size: 1.05rem;">
                            <i class="fa-solid fa-location-dot" style="color: var(--accent);"></i> ${addr.title || 'Adres'}
                        </div>
                        <div style="font-size: 0.9rem; color: var(--text-main); font-weight: 600; margin-bottom: 4px;">${fullname}</div>
                        <div style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.5;">
                            ${details}<br><strong>${location}</strong>${phone}
                        </div>
                        <div class="address-card-actions">
                            <button class="btn-sm edit-addr-btn" data-id="${id}" style="padding: 6px 12px; font-size: 0.8rem;"><i class="fa-solid fa-pen-to-square"></i> Düzenle</button>
                            <button class="btn-sm delete-addr-btn" data-id="${id}" style="padding: 6px 12px; font-size: 0.8rem; color: #EF4444; border-color: #FCA5A5;"><i class="fa-solid fa-trash"></i> Sil</button>
                        </div>
                    </div>
                `);
            });
        } else {
            $list.html('<div style="text-align:center; padding:40px; color:var(--text-muted);">Kayıtlı adresiniz bulunmuyor.</div>');
        }
    });
}