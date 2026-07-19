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
        images: ["./content/products/1/1.jpg"]
    },
    {
        id: 2,
        name: "Duvara Yapışmalı Özel Ad Plakası",
        desc: "Kapı veya duvarlar için tasarlanmış isimlik.",
        price: 180,
        images: ["./content/products/2/1.jpg"]
    },
    {
        id: 3,
        name: "Özel Tasarım Kalemlik",
        desc: "Üzerine isim yazdırılabilen dekoratif kalemlik.",
        price: 180,
        images: ["./content/products/3/1.jpg"]
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
        'dashboard': '#dashboard-page'
    };
    if (path && map[path]) {
        switchPage(map[path], false); 
    }

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
                $('#nav-login-btn').show();
                $('#nav-user-profile').hide();
            } else {
                $('#nav-login-btn').hide();
                $('#nav-user-profile').css('display', 'flex');
                $('#dash-user-name').text(user.displayName || "Kullanıcı");
                $('#dash-user-email').text(user.email);
            }
            loadUserOrders(user.uid);
            loadUserAddresses(user.uid);
        } else {
            $('#nav-login-btn').show();
            $('#nav-user-profile').hide();
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

    $('.modal-close, .modal-overlay').click(function(e) {
        if ($(e.target).hasClass('modal-close') || $(e.target).hasClass('modal-overlay')) {
            $('.modal-overlay').removeClass('open');
        }
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
});

// --- FONKSİYONLAR ---

function switchPage(targetId, pushState = true) {
    $('.nav-menu li').removeClass('active');
    $(`.nav-menu li[data-target="${targetId}"]`).addClass('active');
    $('.page').removeClass('active');
    $(targetId).addClass('active');
    window.scrollTo(0, 0);

    if (pushState) {
        const map = { '#products-page': 'products', '#checkout-page': 'checkout', '#login-page': 'login', '#dashboard-page': 'dashboard' };
        window.history.pushState({ page: targetId }, "", window.location.pathname + '?' + (map[targetId] || 'products'));
    }
}

function renderProducts() {
    const $grid = $('#products-grid-container');
    $grid.empty();
    products.forEach(p => {
        const img = p.images[0] || "./content/default.jpg";
        $grid.append(`
            <div class="model-card" onclick="openProductDetail(${p.id})">
                <div class="card-image"><img src="${img}" alt="${p.name}"/></div>
                <div class="model-info">
                    <div class="model-title">${p.name}</div>
                    <div class="model-desc">${p.desc}</div>
                    <div class="card-meta">
                        <span class="price-tag">₺${p.price.toFixed(2)}</span>
                        <button class="btn-sm primary">Seç</button>
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
    $('#detail-main-img').attr('src', p.images[0] || "./content/default.jpg");
    $('#detail-title').text(p.name);
    $('#detail-desc').text(p.desc);
    $('#detail-price').text(`₺${p.price.toFixed(2)}`);
    
    // Formu temizle
    $('#custom-text-input').val('');
    $('#quantity-input').val(1);

    switchPage('#product-detail-page');
};

function addToCart() {
    if(!currentProduct) return;
    
    const text = $('#custom-text-input').val().trim();
    const qty = parseInt($('#quantity-input').val()) || 1;
    
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
        $('#val-total').text("₺50.00"); 
        return;
    }

    let sub = 0;
    cart.forEach((item, index) => {
        sub += item.price * item.quantity;
        $area.append(`
            <div class="cart-item">
                <div style="display:flex; align-items:center; gap: 15px;">
                    <img src="${item.image}" style="width: 80px; height: 80px; object-fit: cover; border-radius: 8px;">
                    <div class="info">
                        <div style="font-weight:600">${item.name}</div>
                        <div style="font-size:0.85rem; color:#666; font-style:italic;">Yazı: "${item.customText}"</div>
                        <div style="font-size:0.8rem; color:#999; margin-top:4px;">Miktar: ${item.quantity}</div>
                    </div>
                </div>
                <div class="price-action">
                    <span style="font-weight:500; margin-right:15px">₺${(item.price * item.quantity).toFixed(2)}</span>
                    <button class="remove-btn" data-index="${index}" style="color:red; background:none; border:none; cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `);
    });

    const shipping = 50.00;
    $('#val-subtotal').text(`₺${sub.toFixed(2)}`);
    $('#val-total').text(`₺${(sub + shipping).toFixed(2)}`);
}

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
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            orders.forEach((order) => {
                const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleString('tr-TR') : 'Bilinmiyor';
                const total = order.totalAmount || order.total || 0;
                
                // Sadeleştirilmiş durum haritası
                const statusMap = {
                    'pending_payment': { text: 'Ödeme Bekliyor', color: '#F59E0B', bg: '#FEF3C7' },
                    'paid': { text: 'Ödendi / Hazırlanıyor', color: '#10B981', bg: '#D1FAE5' },
                    'shipped': { text: 'Kargoya Verildi', color: '#3B82F6', bg: '#DBEAFE' },
                    'cancelled': { text: 'İptal Edildi', color: '#EF4444', bg: '#FEE2E2' }
                };
                const status = statusMap[order.status] || { text: 'Hazırlanıyor', color: '#10B981', bg: '#D1FAE5' };
                
                let orderItemsText = "";
                if (order.items && order.items.length > 0) {
                    orderItemsText = order.items.map(item => `${item.name} (${item.customText})`).join(', ');
                }

                $list.append(`
                    <div class="order-card" onclick="openOrderDetail('${order.id}')" style="padding: 20px; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; background: white; cursor: pointer;">
                        <div>
                            <h4 style="font-size: 1rem; color: var(--primary); margin-bottom: 5px;">Sipariş #${order.id.substring(0, 8).toUpperCase()}</h4>
                            <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 4px;">${orderItemsText}</p>
                            <span style="font-size: 0.8rem; color: var(--text-light);"><i class="fa-regular fa-calendar"></i> ${dateStr}</span>
                        </div>
                        <div style="text-align: right;">
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
    
    let itemsHtml = '';
    if (order.items && order.items.length > 0) {
        itemsHtml = order.items.map(item => `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 10px;">
                <div>
                    <div style="font-weight: 600;">${item.name}</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">Yazı: "${item.customText || '-'}"</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted);">Adet: ${item.quantity}</div>
                </div>
                <div style="font-weight: 600;">₺${(item.price * item.quantity).toFixed(2)}</div>
            </div>
        `).join('');
    }

    const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleString('tr-TR') : 'Bilinmiyor';
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