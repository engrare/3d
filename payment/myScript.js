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
                $('#guest-info-section').show();
                $('#user-address-section').hide();
                $('#user-profile-header').hide();
            } else {
                // REGISTERED USER MODE
                $('#guest-info-section').hide();
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

    // Kargo Seçimi Değişimi
    $('input[name="shipping-method"]').change(function() {
        shippingCost = parseFloat($(this).data('price'));
        $('.delivery-option').removeClass('active');
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
    $('#btn-add-address').click(() => $('#new-address-form').slideToggle());
        
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

        const newRef = push(ref(db, `users/${user.uid}/addresses`));
        await set(newRef, addr);
        $('#new-address-form').slideUp();
        $('#new-address-form input').val(''); // Temizle
        showToast("Adres kaydedildi.", "success");
    });

    // Adres Seçimi Değişimi
    $('#saved-address-select').change(function() {
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

        const img = item.image || "../content/product2.jpeg";
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
        const $select = $('#saved-address-select');
        $select.empty();
        $select.append('<option value="" disabled selected>Kayıtlı Adresinizi Seçin</option>');
                
        if (snapshot.exists()) {
            const data = snapshot.val();
            Object.values(data).forEach(addr => {
                const val = encodeURIComponent(JSON.stringify(addr));
                $select.append(`<option value="${val}">${addr.title} - ${addr.address}</option>`);
            });
        } else {
            $('#new-address-form').show();
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
    let shippingInfo = {};

    if (user.isAnonymous) {
        shippingInfo = {
            email: $('#contact-email').val().trim(),
            name: $('#ship-name').val().trim(),
            surname: $('#ship-surname').val().trim(),
            address: $('#ship-address').val().trim(),
            city: $('#ship-city').val().trim(),
            phone: $('#ship-phone').val().trim()
        };
        
        if (!shippingInfo.email || !shippingInfo.address || !shippingInfo.phone || !shippingInfo.name || !shippingInfo.surname) {
            showToast("Lütfen tüm teslimat bilgilerini doldurun.", "error");
            return;
        }
    } else {
        if (!selectedAddress) {
            showToast("Lütfen bir teslimat adresi seçin veya yeni ekleyin.", "error");
            return;
        }
        shippingInfo = {
            name: selectedAddress.name || '',
            surname: selectedAddress.surname || '',
            address: selectedAddress.address || '',
            city: selectedAddress.city || '',
            phone: selectedAddress.phone || '',
            email: user.email
        };
    }

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
        status: "pending_payment"
    };
        
    const $btn = $('#btn-complete-order');
    $btn.prop('disabled', true).text('İşleniyor...');

    try {
        const createOrder = httpsCallable(functions, 'createOrder');
        const orderResult = await createOrder({
            orderData: orderData,
            discountCode: appliedDiscount ? appliedDiscount.code : null
        });

        const orderResponse = orderResult.data;
        if (orderResponse && orderResponse.success) {
            const orderId = orderResponse.orderId;

            if (paymentMethod === 'iban' || totalAmount === 0) {
                localStorage.removeItem('engrare_cart');

                $('.checkout-form-section > :not(#payment-success-container)').hide();
                $('.checkout-summary').hide();
                $('.checkout-wrapper').css('grid-template-columns', '1fr');
                
                $('#success-order-id').text('#' + orderId);
                $('#success-order-ref').text(orderId);
                
                if (totalAmount === 0) {
                    $('.iban-box').html('<h3 style="color:#10B981; margin-top:20px;">Ödeme Tamamlandı</h3><p>Siparişiniz ücretsiz olarak başarıyla oluşturuldu.</p>');
                } else {
                    window.location.href = `paywithiban.html?orderId=${orderId}`;
                    return;
                }
                $('#payment-success-container').fadeIn();
                window.scrollTo(0, 0);
                return;
            }

            if (paymentMethod === 'iyzico') {
                $btn.text('Ödeme Sayfası Hazırlanıyor...');
                
                const createIyzicoPayment = httpsCallable(functions, 'createIyzicoPayment');
                const payResult = await createIyzicoPayment({ 
                    orderId: orderId,
                    origin: window.location.origin
                });
                
                if (payResult.data && payResult.data.status === 'success' && payResult.data.paymentPageUrl) {
                    localStorage.removeItem('engrare_cart');
                    showToast("Ödeme sayfasına aktarılıyorsunuz...", "success");
                    window.location.href = payResult.data.paymentPageUrl;
                } else {
                    throw new Error("Ödeme linki oluşturulamadı.");
                }
            }
        } else {
             throw new Error("Sipariş kaydı veritabanına ulaştırılamadı.");
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
    div.style.cssText = `position:fixed; bottom:20px; right:20px; background:white; padding:15px 25px; border-left:4px solid ${color}; box-shadow:0 5px 15px rgba(0,0,0,0.1); border-radius:8px; z-index:99999;`;
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}