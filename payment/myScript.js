import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, set, push, onValue, get } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";

// Config Sabit Tutuldu
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

let cart = [];
let selectedAddress = null;
let shippingCost = 50.00;
let appliedDiscount = null;

$(document).ready(function() {
    loadCart();
        
    // Auth State Yönetimi
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            if (user.isAnonymous) {
                // GUEST (MİSAFİR) MODU
                $('#guest-contact-section').show();
                $('#guest-address-section').show();
                $('#user-address-section').hide();
                $('#user-profile-header').hide();
            } else {
                // REGISTERED USER MODE
                $('#guest-contact-section').hide();
                $('#guest-address-section').hide();
                $('#user-address-section').show();
                                
                // Profil Bilgilerini Yükle
                const profileRef = ref(db, `users/${user.uid}/profile`);
                const snapshot = await get(profileRef);
                if (snapshot.exists()) {
                    const profile = snapshot.val();
                    const displayName = profile.fullname || profile.username || user.displayName || "Kullanıcı";
                    $('#checkout-user-name').text(displayName);
                    $('#checkout-user-email').text(profile.email || user.email);
                    if (user.photoURL) {
                        $('#checkout-user-img').attr('src', user.photoURL);
                    }
                    $('#user-profile-header').css('display', 'flex');
                } else {
                    // Veritabanında profil yoksa Auth verisine dön
                    $('#checkout-user-name').text(user.displayName || "Kullanıcı");
                    $('#checkout-user-email').text(user.email);
                    $('#user-profile-header').css('display', 'flex');
                }

                loadUserAddresses(user.uid);
            }
        } else {
            signInAnonymously(auth);
        }
    });

    // Mobil/Desktop Özeti Taşıma Mantığı
    function handleSummaryPosition() {
        if ($(window).width() <= 900) {
            $('.checkout-summary').appendTo('#mobile-summary-placeholder');
        } else {
            $('.checkout-wrapper').append($('.checkout-summary'));
        }
    }
    handleSummaryPosition();
    $(window).resize(handleSummaryPosition);

    // Kargo Seçimi Değişimi
    $('input[name="shipping-method"]').change(function() {
        $('input[name="shipping-method"]').closest('.delivery-option').removeClass('active');
        $(this).closest('.delivery-option').addClass('active');
        updateTotals();
    });

    // Ödeme Sekmeleri Geçişleri
    $('.pay-tab').click(function() {
        $('.pay-tab').removeClass('active');
        $(this).addClass('active');
        const method = $(this).data('method');
        $('.payment-content').hide();
        $(`#pay-${method}`).fadeIn();
    });

    // Yeni Adres Ekleme Tetikleyici
    $('#btn-add-address').click(() => {
        $('#edit-addr-id').val('');
        $('#new-addr-title').val('');
        $('#new-addr-name').val('');
        $('#new-addr-surname').val('');
        $('#new-addr-full').val('');
        $('#new-addr-city').val('');
        $('#new-addr-phone').val('');
        $('#new-address-form').slideDown();
    });
        
    // Adres Kaydetme
    $('#btn-save-address').click(async () => {
        const user = auth.currentUser;
        if(!user) return;
                
        const addr = {
            title: $('#new-addr-title').val().trim(),
            name: $('#new-addr-name').val().trim(),
            surname: $('#new-addr-surname').val().trim(),
            address: $('#new-addr-full').val().trim(),
            city: $('#new-addr-city').val().trim(),
            phone: $('#new-addr-phone').val().trim()
        };

        if(!addr.title || !addr.address || !addr.name || !addr.surname) {
            showToast("Lütfen zorunlu alanları doldurun.", "error");
            return;
        }

        const editId = $('#edit-addr-id').val();
        
        if (editId) {
            const editRef = ref(db, `users/${user.uid}/addresses/${editId}`);
            window.lastSavedAddressId = editId;
            await set(editRef, addr);
            
            const $radio = $(`input[name="shipping-address"][data-id="${editId}"]`);
            if ($radio.length) $radio.prop('checked', true).trigger('change');
            
            showToast("Adres başarıyla güncellendi ve seçildi.", "success");
        } else {
            const newRef = push(ref(db, `users/${user.uid}/addresses`));
            window.lastSavedAddressId = newRef.key;
            await set(newRef, addr);
            showToast("Adres kaydedildi ve seçildi.", "success");
        }
        
        $('#new-address-form').slideUp();
        $('#new-address-form input').val(''); // Temizle
        $('#edit-addr-id').val('');
    });

    // Adres Düzenleme Butonu
    window.editAddress = function(id, encData) {
        const addr = JSON.parse(decodeURIComponent(encData));
        $('#edit-addr-id').val(id);
        $('#new-addr-title').val(addr.title || '');
        $('#new-addr-name').val(addr.name || addr.fullname || '');
        $('#new-addr-surname').val(addr.surname || '');
        $('#new-addr-full').val(addr.address || addr.details || '');
        $('#new-addr-city').val(addr.city || '');
        $('#new-addr-phone').val(addr.phone || '');
        $('#new-address-form').slideDown();
    };

    // Adres Seçimi Değişimi
    $(document).on('change', 'input[name="shipping-address"]', function() {
        $('.address-option').removeClass('active');
        $(this).closest('.address-option').addClass('active');
        window.currentSelectedAddressId = $(this).data('id');
        const val = $(this).val();
        if(val) selectedAddress = JSON.parse(decodeURIComponent(val));
    });

    // İndirim Kodu Uygulama Butonu
    $('#btn-apply-discount').click(async function() {
        const code = $('#discount-code-input').val().trim();
        const $msg = $('#discount-message');
        $msg.text('').removeClass('success error');
                
        if(!code) return;

        $(this).prop('disabled', true).text('Kontrol...');

        try {
            const verifyDiscount = httpsCallable(functions, 'verifyDiscount');
            const result = await verifyDiscount({ code: code });
            const data = result.data;

            if (data.valid) {
                appliedDiscount = data;
                                
                // Başarılı Arayüz Güncellemeleri
                $('#discount-input-container').hide();
                $('#discount-applied-container').css('display', 'flex'); 
                $('#applied-code-text').text(code);
                $msg.text(`İndirim uygulandı: ${code}`).addClass('success');
                                
                updateTotals();
                showToast("İndirim kodu uygulandı.", "success");
            } else {
                appliedDiscount = null;
                $msg.text(data.message || "Geçersiz kod.").addClass('error');
                updateTotals();
            }
        } catch (error) {
            console.error(error);
            $msg.text("Bir hata oluştu.").addClass('error');
        } finally {
            $('#btn-apply-discount').prop('disabled', false).text('Uygula');
        }
    });

    // İndirim Kodunu Kaldırma Butonu
    $('#btn-remove-discount').click(function() {
        appliedDiscount = null;
        $('#discount-code-input').val('');
        $('#discount-applied-container').hide();
        $('#discount-input-container').show();
        $('#discount-message').text('');
        updateTotals();
        showToast("İndirim kaldırıldı.", "success");
    });

    // Siparişi Tamamla Butonu Tetikleyicisi
    $('#btn-complete-order').click(processPayment);
});

function loadCart() {
    const stored = localStorage.getItem('engrare_cart');
    if (stored) {
        cart = JSON.parse(stored);
        renderCartSummary();
    }
}

function renderCartSummary() {
    const $list = $('#order-items-list');
    $list.empty();
    let subtotal = 0;

    cart.forEach(item => {
        const qty = parseInt(item.quantity || item.configuration?.quantity || 1);
        subtotal += item.price * qty;

        let img = item.image;
        if (typeof img === 'object' && img !== null) img = img.src;
        img = img || "../content/product2.jpeg";
        if (typeof img === 'string' && img.startsWith("./content/")) {
            img = "." + img;
        }
        const textDisplay = item.customText ? `Yazı: "${item.customText}"` : "Standart Baskı";

        $list.append(`
            <div class="summary-item">
                <img src="${img}" class="item-img">
                <div class="item-info" style="flex:1">
                    <div class="item-name">${item.name}</div>
                    <div class="item-meta">${textDisplay}</div>
                    <div class="item-meta">Adet: ${qty}</div>
                </div>
                <div class="item-price">₺${(item.price * qty).toLocaleString('tr-TR')}</div>
            </div>
        `);
    });

    $('#summ-subtotal').text(formatTL(subtotal));
    updateTotals();
}

function updateTotals() {
    let subtotal = 0;
    cart.forEach(i => {
        const qty = parseInt(i.quantity || i.configuration?.quantity || 1);
        subtotal += i.price * qty;
    });
        
    const standardCost = subtotal >= 500 ? 0 : 50;
    const expressCost = subtotal >= 500 ? 70 : 120;
    $('#standard-shipping-price').text(standardCost === 0 ? 'Ücretsiz' : formatTL(standardCost));
    $('#express-shipping-price').text(formatTL(expressCost));

    const selectedShipping = $('input[name="shipping-method"]:checked').val() || 'standard';
    shippingCost = selectedShipping === 'standard' ? standardCost : expressCost;
        
    let discountAmount = 0;
    if (appliedDiscount) {
        if (appliedDiscount.type === 'percent') {
            discountAmount = subtotal * (appliedDiscount.value / 100);
        } else if (appliedDiscount.type === 'fixed') {
            discountAmount = appliedDiscount.value;
        }
        if (discountAmount > subtotal) discountAmount = subtotal;
    }

    $('#summ-shipping').text(formatTL(shippingCost));
        
    if (discountAmount > 0) {
        $('#summ-discount-row').show();
        $('#summ-discount').text('-' + formatTL(discountAmount));
    } else {
        $('#summ-discount-row').hide();
    }

    const total = Math.max(0, subtotal + shippingCost - discountAmount);
        
    // Buton ve genel ara yüz fiyatlarını eşitle
    $('#summ-total').text(formatTL(total));
    $('#final-price-btn').text(formatTL(total));
}

function formatTL(price) {
    return price.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
}

function loadUserAddresses(uid) {
    onValue(ref(db, `users/${uid}/addresses`), (snapshot) => {
        const $container = $('#saved-addresses-container');
        $container.empty();
                
        if (snapshot.exists()) {
            const data = snapshot.val();
            
            let targetId = window.lastSavedAddressId || window.currentSelectedAddressId || Object.keys(data)[0];
            if (!data[targetId]) targetId = Object.keys(data)[0];
            
            window.currentSelectedAddressId = targetId;
            selectedAddress = data[targetId];
            window.lastSavedAddressId = null;

            Object.entries(data).forEach(([id, addr]) => {
                const val = encodeURIComponent(JSON.stringify(addr));
                const addressText = addr.address || addr.details || '';
                const titleText = addr.title || 'Adresim';
                const isChecked = (id === targetId);
                
                $container.append(`
                    <label class="delivery-option address-option ${isChecked ? 'active' : ''}">
                        <input type="radio" name="shipping-address" data-id="${id}" value="${val}" ${isChecked ? 'checked' : ''} style="display:none;">
                        <i class="fa-solid fa-circle-check check-icon"></i>
                        <div style="flex:1;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 10px;">
                                <div class="del-icon-wrapper" style="margin-bottom:0; width: 40px; height: 40px; font-size: 1.1rem;"><i class="fa-solid fa-location-dot"></i></div>
                                <button type="button" onclick="editAddress('${id}', '${val}'); return false;" class="btn-sm" style="background: none; border: 1px solid var(--border); color: var(--text-muted); font-size: 0.75rem; border-radius: 6px; padding: 4px 8px; transition: 0.2s;" onmouseover="this.style.color='var(--primary)'; this.style.borderColor='var(--primary)';" onmouseout="this.style.color='var(--text-muted)'; this.style.borderColor='var(--border)';"><i class="fa-solid fa-pen"></i> Düzenle</button>
                            </div>
                            <span class="del-title" style="font-weight:700; font-size:1.05rem; display:block; margin-bottom: 6px; color: var(--primary);">${titleText}</span>
                            <span class="del-desc" style="font-size:0.85rem; color:var(--text-muted); display:block; line-height: 1.4;">${addr.name} ${addr.surname}</span>
                            <span class="del-desc" style="font-size:0.85rem; color:var(--text-muted); display:block; line-height: 1.4; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${addressText}</span>
                            <span class="del-desc" style="font-size:0.85rem; color:var(--text-muted); display:block; line-height: 1.4; margin-top: 4px;">${addr.city}</span>
                        </div>
                    </label>
                `);
            });
            $('#new-address-form').hide();
        } else {
            $('#new-address-form').show();
            selectedAddress = null;
        }
    });
}

async function processPayment() {
    const user = auth.currentUser;
    if (!user) {
        showToast("Oturum hatası.", "error");
        return;
    }

    const shippingMethod = $('input[name="shipping-method"]:checked').val() || "standard";
    const paymentMethod = $('.pay-tab.active').data('method') || "iyzico";
    const $btn = $('#btn-complete-order');
    
    let shippingInfo = {};

    // Toplam Tutar Matematik Hesabı
    const subtotal = cart.reduce((sum, item) => sum + (item.price * parseInt(item.quantity || item.configuration?.quantity || 1)), 0);
    let discountAmount = 0;
    if (appliedDiscount) {
         if (appliedDiscount.type === 'percent') {
            discountAmount = subtotal * (appliedDiscount.value / 100);
        } else if (appliedDiscount.type === 'fixed') {
            discountAmount = appliedDiscount.value;
        }
        if (discountAmount > subtotal) discountAmount = subtotal;
    }
    const totalAmount = Math.max(0, subtotal + shippingCost - discountAmount);

    $btn.prop('disabled', true).text('İşleniyor...');

    // 🛡️ ADRES DOĞRULAMA VE VERİ TOPLAMA BLOĞU (HTML ID'lerine göre tam eşitleme sağlandı)
    if (user.isAnonymous) {
        shippingInfo = {
            email: ($('#contact-email').val() || '').trim(),
            phone: ($('#contact-phone').val() || '').trim(),
            name: ($('#ship-name').val() || '').trim(),
            surname: ($('#ship-surname').val() || '').trim(),
            address: ($('#ship-address').val() || '').trim(),
            city: ($('#ship-city').val() || '').trim(),
            zip: ($('#ship-zip').val() || '').trim()
        };
        
        if (!shippingInfo.email || !shippingInfo.phone || !shippingInfo.name || !shippingInfo.surname || !shippingInfo.address || !shippingInfo.city) {
            showToast("Lütfen tüm teslimat bilgilerini eksiksiz doldurun.", "error");
            $btn.prop('disabled', false).html('<span id="final-price-btn">' + formatTL(totalAmount) + '</span> Öde');
            return;
        }
    } else {
        if (!selectedAddress) {
            showToast("Lütfen bir teslimat adresi seçin veya yeni ekleyin.", "error");
            $btn.prop('disabled', false).html('<span id="final-price-btn">' + formatTL(totalAmount) + '</span> Öde');
            return;
        }
        let firstName = selectedAddress.name || '';
        let lastName = selectedAddress.surname || '';
        if (!firstName && !lastName && selectedAddress.fullname) {
            const parts = selectedAddress.fullname.split(' ');
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
        }
        
        shippingInfo = {
            name: firstName,
            surname: lastName,
            fullname: selectedAddress.fullname || (firstName + ' ' + lastName).trim(),
            address: selectedAddress.address || selectedAddress.details || '',
            city: selectedAddress.city || '',
            phone: selectedAddress.phone || '',
            email: user.email || '',
            zip: selectedAddress.zip || ''
        };
    }

    const orderData = {
        userId: user.uid,
        isGuest: user.isAnonymous,
        items: cart,
        shippingInfo: shippingInfo,
        shippingMethod: shippingMethod,
        shippingCost: shippingCost,
        paymentMethod: paymentMethod,
        subtotal: subtotal,
        discountAmount: discountAmount,
        totalAmount: totalAmount,
        status: paymentMethod === 'iban' ? "pending_payment" : "incomplete_attempt"
    };

    try {
        // --- 1. AŞAMA: HAVALE / IBAN VEYA ÜCRETSİZ SİPARİŞ AKIŞI ---
        if (paymentMethod === 'iban' || totalAmount === 0) {
            const createOrder = httpsCallable(functions, 'createOrder');
            const orderResult = await createOrder({
                orderData: orderData,
                discountCode: appliedDiscount ? appliedDiscount.code : null
            });

            const orderResponse = orderResult.data;
            if (orderResponse && orderResponse.success) {
                const orderId = orderResponse.orderId;
                localStorage.removeItem('engrare_cart');

                // Havale durumunda doğrudan sayfa içi başarı kutusunu gösteriyoruz
                $('.checkout-form-section > :not(#payment-success-container)').hide();
                $('.checkout-summary').hide();
                $('.checkout-wrapper').css('grid-template-columns', '1fr');
                
                $('#success-order-id').text('#' + orderId);
                $('#success-order-ref').text(orderId);
                
                if (totalAmount === 0) {
                    $('.iban-box').html('<h3 style="color:#10B981; margin-top:20px;">Ödeme Tamamlandı</h3><p>Siparişiniz ücretsiz olarak başarıyla oluşturuldu.</p>');
                }
                
                $('#payment-success-container').fadeIn();
                window.scrollTo(0, 0);
                return;
            }
        }

        // --- 2. AŞAMA: GERÇEK IYZICO KREDİ KARTI AKIŞI ---
        if (paymentMethod === 'iyzico') {
            $btn.text('Ödeme Sayfası Hazırlanıyor...');
            
            const createIyzicoPayment = httpsCallable(functions, 'createIyzicoPayment');
            const payResult = await createIyzicoPayment({ 
                orderData: orderData, 
                origin: window.location.origin
            });
            
            if (payResult.data && payResult.data.status === 'success' && payResult.data.paymentPageUrl) {
                showToast("Ödeme sayfasına aktarılıyorsunuz...", "success");
                window.location.href = payResult.data.paymentPageUrl;
            } else {
                throw new Error("Ödeme linki oluşturulamadı.");
            }
        }

    } catch (e) {
        console.error("Payment Process Error:", e);
        showToast("Sipariş işlenirken bir hata oluştu: " + (e.message || ""), "error");
        $btn.prop('disabled', false).html('<span id="final-price-btn">' + formatTL(totalAmount) + '</span> Öde');
    }
}

function showToast(msg, type) {
    const color = type === 'error' ? 'red' : 'green';
    const div = document.createElement('div');
    div.style.cssText = `position:fixed; bottom:20px; right:20px; background:white; padding:15px 25px; border-left:4px solid ${color}; box-shadow:0 5px 15px rgba(0,0,0,0.1); border-radius:8px; z-index:99999; color: #1e293b; font-weight: 500;`;
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}
window.copyToClipboard = function(selector) {
    const text = document.querySelector(selector).innerText.trim();
    navigator.clipboard.writeText(text).then(() => {
        showToast('Kopyalandı!', 'success');
    });
};
