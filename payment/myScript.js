import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, set, push, onValue, get } from "firebase/database";

// Reuse Config (Ideally this should be in a shared config file, but for now duplicating)
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

let cart = [];
let selectedAddress = null;
let shippingCost = 50.00;

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
                    <div class="item-meta">Adet: ${item.configuration?.quantity || 1}</div> <!-- Assuming quantity is stored/handled -->
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
    
    $('#summ-shipping').text(formatTL(shippingCost));
    const total = subtotal + shippingCost;
    
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
    const orderData = {
        userId: user.uid,
        isGuest: user.isAnonymous,
        items: cart,
        shippingInfo: shippingInfo,
        shippingMethod: shippingMethod,
        shippingCost: shippingCost,
        paymentMethod: paymentMethod,
        totalAmount: cart.reduce((a, b) => a + b.price, 0) + shippingCost,
        status: "pending_payment", // Initial status
        createdAt: Date.now()
    };

    try {
        const orderRef = push(ref(db, `orders`)); // Global orders
        const orderId = orderRef.key;
        orderData.id = orderId;
        
        await set(orderRef, orderData);
        // Also save to user history
        await set(ref(db, `users/${user.uid}/orders/${orderId}`), orderData);

        if (paymentMethod === 'iban') {
            // Show Order ID for Reference
            $('#order-ref-num').text(orderId.substring(1)); // Show simplified ID
            alert("Siparişiniz Alındı! Lütfen IBAN'a ödeme yaparken sipariş numarasını belirtin.");
            // Clear Cart
            localStorage.removeItem('engrare_cart');
            window.location.href = "../index.html";
        } else {
            // Iyzico (Simulation)
            alert("Ödeme sayfasına yönlendiriliyorsunuz... (Simülasyon)");
            localStorage.removeItem('engrare_cart');
            window.location.href = "../index.html";
        }

    } catch (e) {
        console.error(e);
        showToast("Sipariş oluşturulurken hata oluştu.", "error");
    }
}

// Re-implement simplified Toast for this page (or import)
function showToast(msg, type) {
    const color = type === 'error' ? 'red' : 'green';
    // Simple fallback for payment page
    const div = document.createElement('div');
    div.style.cssText = `position:fixed; bottom:20px; right:20px; background:white; padding:15px 25px; border-left:4px solid ${color}; box-shadow:0 5px 15px rgba(0,0,0,0.1); border-radius:8px; z-index:99999; animation: slideIn 0.3s;`;
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}
