import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, set, push, onValue, get } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";

// Reuse Config
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
    
    // Auth State
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            if (user.isAnonymous) {
                // GUEST MODE
                $('#guest-info-section').show();
                $('#user-address-section').hide();
                $('#user-profile-header').hide();
            } else {
                // REGISTERED USER MODE
                $('#guest-info-section').hide();
                $('#user-address-section').show();
                
                // Load Profile Info
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
                    // Fallback to Auth Data if no DB profile
                    $('#checkout-user-name').text(user.displayName || "Kullanıcı");
                    $('#checkout-user-email').text(user.email);
                    $('#user-profile-header').css('display', 'flex');
                }

                loadUserAddresses(user.uid);
            }
        } else {
            // Should usually be signed in anonymously by main page, but safety fallback
            signInAnonymously(auth);
        }
    });

    // Shipping Toggle
    $('input[name="shipping-method"]').change(function() {
        shippingCost = parseFloat($(this).data('price'));
        $('.delivery-option').removeClass('active');
        $(this).closest('.delivery-option').addClass('active');
        updateTotals();
    });

    // Payment Tabs
    $('.pay-tab').click(function() {
        $('.pay-tab').removeClass('active');
        $(this).addClass('active');
        const method = $(this).data('method');
        $('.payment-content').hide();
        $(`#pay-${method}`).fadeIn();
    });

    // Address Actions
    $('#btn-add-address').click(() => $('#new-address-form').slideToggle());
    
    $('#btn-save-address').click(async () => {
        const user = auth.currentUser;
        if(!user) return;
        
        const addr = {
            title: $('#new-addr-title').val(),
            name: $('#new-addr-name').val(),
            surname: $('#new-addr-surname').val(),
            address: $('#new-addr-full').val(),
            city: $('#new-addr-city').val(),
            phone: $('#new-addr-phone').val()
        };

        if(!addr.title || !addr.address) {
            showToast("Lütfen zorunlu alanları doldurun.", "error");
            return;
        }

        const newRef = push(ref(db, `users/${user.uid}/addresses`));
        await set(newRef, addr);
        $('#new-address-form').slideUp();
        $('#new-address-form input').val(''); // Clear
        showToast("Adres kaydedildi.", "success");
    });

    // Address Select
    $('#saved-address-select').change(function() {
        const val = $(this).val();
        if(val) selectedAddress = JSON.parse(decodeURIComponent(val));
    });

    // Discount Button
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
                
                // UI Updates for Success
                $('#discount-input-container').hide();
                $('#discount-applied-container').css('display', 'flex'); // Flex for alignment
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

    // Remove Discount Button
    $('#btn-remove-discount').click(function() {
        appliedDiscount = null;
        $('#discount-code-input').val('');
        $('#discount-applied-container').hide();
        $('#discount-input-container').show();
        $('#discount-message').text('');
        updateTotals();
        showToast("İndirim kaldırıldı.", "success");
    });

    // Pay Button
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
        subtotal += item.price;
        // Use snapshot or placeholder
        const img = item.image || "../content/product2.jpeg";
        const color = (item.configuration && item.configuration.colorName) ? item.configuration.colorName : "Standart";

        $list.append(`
            <div class="summary-item">
                <img src="${img}" class="item-img">
                <div class="item-info" style="flex:1">
                    <div class="item-name">${item.name}</div>
                    <div class="item-meta">Renk: ${color}</div>
                    <div class="item-meta">Adet: ${item.configuration?.quantity || 1}</div>
                </div>
                <div class="item-price">₺${item.price.toLocaleString('tr-TR')}</div>
            </div>
        `);
    });

    // Update Totals
    $('#summ-subtotal').text(formatTL(subtotal));
    updateTotals();
}

function updateTotals() {
    let subtotal = 0;
    cart.forEach(i => subtotal += i.price);
    
    let discountAmount = 0;
    if (appliedDiscount) {
        if (appliedDiscount.type === 'percent') {
            discountAmount = subtotal * (appliedDiscount.value / 100);
        } else if (appliedDiscount.type === 'fixed') {
            discountAmount = appliedDiscount.value;
        }
        // Cap discount at subtotal
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
            // Auto open new form if no addresses
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

    const shippingMethod = $('input[name="shipping-method"]:checked').val();
    const paymentMethod = $('.pay-tab.active').data('method');
    let shippingInfo = {};

    // Validate Address
    if (user.isAnonymous) {
        // Collect from Guest Form
        shippingInfo = {
            email: $('#contact-email').val(),
            name: $('#ship-name').val(),
            surname: $('#ship-surname').val(),
            address: $('#ship-address').val(),
            city: $('#ship-city').val(),
            phone: $('#ship-phone').val()
        };
        
        if (!shippingInfo.email || !shippingInfo.address || !shippingInfo.phone) {
            showToast("Lütfen tüm teslimat bilgilerini doldurun.", "error");
            return;
        }
    } else {
        // Use Selected Saved Address
        if (!selectedAddress) {
            showToast("Lütfen bir teslimat adresi seçin veya yeni ekleyin.", "error");
            return;
        }
        shippingInfo = selectedAddress;
        shippingInfo.email = user.email; // Ensure email is captured
    }

    // Prepare Order Data
    // Recalculate totals for data
    const subtotal = cart.reduce((a, b) => a + b.price, 0);
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
        status: "pending_payment", 
        createdAt: Date.now()
    };
    
    // Disable button to prevent double click
    const $btn = $('#btn-complete-order');
    $btn.prop('disabled', true).text('İşleniyor...');

    try {
        // Use Backend Function instead of direct DB write
        const createOrder = httpsCallable(functions, 'createOrder');
        const result = await createOrder({
            orderData: orderData,
            discountCode: appliedDiscount ? appliedDiscount.code : null
        });

        const response = result.data;
        if (response.success) {
            const orderId = response.orderId;
            
            // Clear Cart
            localStorage.removeItem('engrare_cart');

            if (paymentMethod === 'iban') {
                // Show Success Section, Hide Form
                $('.checkout-form-section > :not(#payment-success-container)').hide();
                $('.checkout-summary').hide(); // Optional: Hide summary to focus on success
                $('.checkout-wrapper').css('grid-template-columns', '1fr'); // Center content
                
                $('#success-order-id').text(orderId);
                $('#success-order-ref').text(orderId.substring(1)); // Simplified ref if needed
                
                $('#payment-success-container').fadeIn();
                
                // Scroll to top
                window.scrollTo(0, 0);
            } else {
                alert("Ödeme sayfasına yönlendiriliyorsunuz... (Simülasyon)");
                window.location.href = "../index.html";
            }
        } else {
             throw new Error("Sipariş oluşturulamadı.");
        }

    } catch (e) {
        console.error(e);
        let msg = "Sipariş oluşturulurken hata oluştu.";
        if (e.message && e.message.includes('Limit')) msg = "İndirim kodu limiti dolmuş.";
        showToast(msg, "error");
        $btn.prop('disabled', false).html('<span id="final-price-btn">' + formatTL(totalAmount) + '</span> Öde');
    }
}

function showToast(msg, type) {
    const color = type === 'error' ? 'red' : 'green';
    const div = document.createElement('div');
    div.style.cssText = `position:fixed; bottom:20px; right:20px; background:white; padding:15px 25px; border-left:4px solid ${color}; box-shadow:0 5px 15px rgba(0,0,0,0.1); border-radius:8px; z-index:99999; animation: slideIn 0.3s;`;
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}