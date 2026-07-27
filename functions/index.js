const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Iyzipay = require('iyzipay');

admin.initializeApp();
const db = admin.database();

// --- CONFIGURATION ---
const DISCOUNT_CODES = {
    "ENGRARE10": { type: "percent", value: 10 },
    "YUZDE100": { type: "percent", value: 100 },
    "INDIRIM50": { type: "fixed", value: 50 },
    "FREE100": { type: "percent", value: 100 },
    "TEST10": { type: "fixed", value: 10 }
};

// --- 1. ORDER CREATION & PRICE CHECK ---
exports.createOrder = functions.region("europe-west1").https.onCall(async (data, context) => {
    try {
        const { orderData, discountCode } = data;
        const userId = (context.auth && context.auth.uid) || (orderData && orderData.userId);

        if (!userId) {
            throw new functions.https.HttpsError('unauthenticated', 'User ID required.');
        }

        if (!orderData || !orderData.items || orderData.items.length === 0) {
            throw new functions.https.HttpsError('invalid-argument', 'Sepet boş olamaz.');
        }

        // SERVER-SIDE PRICE RECALCULATION
        let calculatedSubtotal = 0;
        orderData.items.forEach(item => {
            const qty = parseInt(item.quantity || item.configuration?.quantity || 1);
            const price = parseFloat(item.price);
            if (isNaN(price) || price < 0) throw new functions.https.HttpsError('invalid-argument', 'Hatalı ürün fiyatı.');
            calculatedSubtotal += price * qty; 
        });

        // Shipping Cost
        let shippingCost = 0;
        if (orderData.shippingMethod === 'express') {
            shippingCost = calculatedSubtotal >= 500 ? 70.00 : 120.00;
        } else {
            shippingCost = calculatedSubtotal >= 500 ? 0.00 : 50.00;
        }
        let discountAmount = 0;

        // DISCOUNT VERIFICATION
        if (discountCode && DISCOUNT_CODES[discountCode]) {
            const disc = DISCOUNT_CODES[discountCode];
            if (disc.type === 'percent') {
                discountAmount = calculatedSubtotal * (disc.value / 100);
            } else if (disc.type === 'fixed') {
                discountAmount = disc.value;
            }
            
            if (discountAmount > calculatedSubtotal) discountAmount = calculatedSubtotal;
        }

        const calculatedTotal = Math.max(0, calculatedSubtotal + shippingCost - discountAmount);

        // GENERATE SEQUENTIAL ORDER ID
        const counterRef = db.ref('config/orderCounter');
        let orderId;
        
        try {
            const transactionResult = await counterRef.transaction((currentValue) => {
                return (currentValue || 0) + 1;
            });
            
            if (!transactionResult.committed) {
                throw new Error("Counter transaction not committed.");
            }
            
            const orderNumber = transactionResult.snapshot.val();
            orderId = `${orderNumber}`;
        } catch (txError) {
            console.error("Order counter transaction failed:", txError);
            orderId = `ORD-${Date.now()}`;
        }
// DURUM ATAMASI: Sadece iban ise pending_payment, ücretsizse paid, kart ise geçici statü
        let initialStatus = "incomplete_attempt";
        if (calculatedTotal === 0) {
            initialStatus = "paid";
        } else if (orderData.paymentMethod === 'iban') {
            initialStatus = "pending_payment";
        }

        const finalOrder = {
            ...orderData,
            id: orderId, 
            userId: userId,
            subtotal: calculatedSubtotal,
            discountAmount: discountAmount,
            shippingCost: shippingCost,
            totalAmount: calculatedTotal,
            status: initialStatus, // Artık dinamik!
            serverTimestamp: admin.database.ServerValue.TIMESTAMP
        };

        // WRITE TO DB
        await db.ref(`users/${userId}/orders/${orderId}`).set(finalOrder);

        return { success: true, orderId: orderId, totalAmount: calculatedTotal };

    } catch (error) {
        console.error("createOrder Error:", error);
        if (error.code && error.details) throw error;
        throw new functions.https.HttpsError('internal', error.message || 'Sipariş oluşturulamadı.');
    }
});

exports.createIyzicoPayment = functions.region("europe-west1").https.onCall(async (data, context) => {
    try {
        const { orderData, origin } = data; // Sipariş verisi artık doğrudan parametre olarak geliyor
        const userId = (context.auth && context.auth.uid) || data.userId;
        
        if (!userId || !orderData) throw new functions.https.HttpsError('invalid-argument', 'Eksik sipariş verisi.');

        // Iyzico Sandbox Keys
        const apiKey = 'sandbox-ZamvrauhDeAsvxodQYHnVbYDgrvwGITd';
        const secretKey = 'sandbox-UdTaICHeunHZrgYAMbdFEwEEilfvlvpX';

        const iyzipay = new Iyzipay({
            apiKey: apiKey,
            secretKey: secretKey,
            uri: 'https://sandbox-api.iyzipay.com'
        });

        const userIp = context.rawRequest ? (context.rawRequest.headers['x-forwarded-for'] || context.rawRequest.ip || '127.0.0.1') : '127.0.0.1';

        // Sepet Kalemlerini Hazırla
        const basketItems = orderData.items.map((item, index) => {
            const qty = parseInt(item.quantity || item.configuration?.quantity || 1);
            return {
                id: item.id || `BI-${index}-${Date.now()}`,
                name: item.name.substring(0, 50),
                category1: 'General',
                itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
                price: parseFloat(item.price * qty).toFixed(2)
            };
        });

        if (orderData.shippingCost > 0) {
            basketItems.push({
                id: 'SHIPPING',
                name: 'Kargo Ücreti',
                category1: 'Shipping',
                itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
                price: parseFloat(orderData.shippingCost).toFixed(2)
            });
        }

        const sumOfItems = basketItems.reduce((sum, item) => sum + parseFloat(item.price), 0);
        const returnOrigin = origin || 'https://3d.engrare.com';

        const fullname = orderData.shippingInfo?.fullname || `${orderData.shippingInfo?.name || 'Kaya'} ${orderData.shippingInfo?.surname || 'Sertel'}`;
        const buyerName = fullname.split(' ')[0] || "Misafir";
        const buyerSurname = fullname.split(' ').slice(1).join(' ') || "Kullanici";

        // Geçici bir işlem ID'si üretiyoruz (Veritabanına henüz dokunmadık!)
        const tempTransactionId = `TX-${userId.substring(0,5)}-${Date.now()}`;

        // Asıl sipariş verilerini (ürünler, görseller, vs.) geçici olarak kaydediyoruz
        await db.ref(`temp_iyzico_orders/${tempTransactionId}`).set({
            ...orderData,
            userId: userId
        });

        const request = {
            locale: Iyzipay.LOCALE.TR,
            conversationId: tempTransactionId, // iyzico'ya geçici takip numarası veriyoruz
            price: sumOfItems.toFixed(2),
            paidPrice: orderData.totalAmount.toFixed(2),
            currency: Iyzipay.CURRENCY.TRY,
            basketId: tempTransactionId,
            paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
            callbackUrl: `https://europe-west1-engrar3d.cloudfunctions.net/iyzicoCallback?origin=${encodeURIComponent(returnOrigin)}`,
            enabledInstallments: [2, 3, 6, 9],
            buyer: {
                id: userId,
                name: buyerName,
                surname: buyerSurname,
                gsmNumber: orderData.shippingInfo?.phone || '+905555555555',
                email: orderData.shippingInfo?.email || 'email@email.com',
                identityNumber: '11111111111',
                lastLoginDate: '2026-01-01 12:00:00',
                registrationAddress: orderData.shippingInfo?.address || 'Adres bilgisi yok',
                registrationDate: '2026-01-01 12:00:00',
                city: orderData.shippingInfo?.city || 'Istanbul',
                country: 'Turkey',
                zipCode: orderData.shippingInfo?.zip || '34000',
                ip: userIp
            },
            shippingAddress: {
                contactName: fullname,
                city: orderData.shippingInfo?.city || 'Istanbul',
                country: 'Turkey',
                address: orderData.shippingInfo?.address || 'Adres bilgisi yok',
                zipCode: orderData.shippingInfo?.zip || '34000'
            },
            billingAddress: {
                contactName: fullname,
                city: orderData.shippingInfo?.city || 'Istanbul',
                country: 'Turkey',
                address: orderData.shippingInfo?.address || 'Adres bilgisi yok',
                zipCode: orderData.shippingInfo?.zip || '34000'
            },
            basketItems: basketItems
        };

        return new Promise((resolve, reject) => {
            iyzipay.checkoutFormInitialize.create(request, (err, result) => {
                if (err) {
                    reject(new functions.https.HttpsError('internal', err.message));
                } else if (result.status === 'failure') {
                    reject(new functions.https.HttpsError('internal', result.errorMessage));
                } else {
                    resolve({ 
                        success: true,
                        status: 'success', 
                        paymentPageUrl: result.paymentPageUrl,
                        token: result.token
                    });
                }
            });
        });
    } catch (error) {
        console.error("Iyzico Payment Error:", error);
        if (error instanceof functions.https.HttpsError) throw error;
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// --- 3. OTOMATİK PROFİL OLUŞTURMA ---
exports.onUserCreated = functions.region("europe-west1").auth.user().onCreate(async (user) => {
    const { uid, email, displayName } = user;
    try {
        await db.ref(`users/${uid}/profile`).set({
            username: displayName || "Kullanıcı",
            email: email,
            createdAt: admin.database.ServerValue.TIMESTAMP
        });
        console.log(`User profile created for ${uid}`);
    } catch (error) {
        console.error("Error creating user profile:", error);
    }
});

// --- 4. VERIFY DISCOUNT HELPER ---
exports.verifyDiscount = functions.region("europe-west1").https.onCall(async (data, context) => {
    const { code } = data;
    if (!code) return { valid: false };
    
    const discount = DISCOUNT_CODES[code];
    if (discount) {
        return { valid: true, ...discount, code: code };
    }
    return { valid: false, message: "Geçersiz kod." };
});

// --- 5. ADMIN: GET ALL ORDERS ---
exports.getAllOrders = functions.region("europe-west1").https.onCall(async (data, context) => {
    try {
        const usersSnap = await db.ref('users').once('value');
        const users = usersSnap.val() || {};
        const allOrders = {};

        Object.keys(users).forEach(userId => {
            const user = users[userId];
            if (user.orders) {
                Object.entries(user.orders).forEach(([orderId, order]) => {
                    allOrders[orderId] = { 
                        ...order, 
                        userId: userId,
                        customerName: (order.shippingInfo && order.shippingInfo.name) 
                                      ? `${order.shippingInfo.name} ${order.shippingInfo.surname || ''}`
                                      : (user.profile ? user.profile.username : 'Bilinmeyen Kullanıcı'),
                         totalAmount: order.totalAmount || order.total || 0
                    };
                });
            }
        });

        return { orders: allOrders };
    } catch (error) {
        console.error("getAllOrders Error:", error);
        throw new functions.https.HttpsError('internal', 'Siparişler alınamadı.');
    }
});

// --- 6. IYZICO CALLBACK & VERIFICATION ---
exports.iyzicoCallback = functions.region("europe-west1").https.onRequest(async (req, res) => {
    try {
        const token = req.body.token;
        const origin = req.query.origin || 'https://3d.engrare.com';

        if (!token) {
            console.error("No token received in callback");
            return res.redirect(`${origin}/payment/result.html?error=no_token`);
        }
        return res.redirect(`${origin}/payment/result.html?token=${token}`);
    } catch (error) {
        console.error("Callback Error:", error);
        const origin = req.query.origin || 'https://3d.engrare.com';
        return res.redirect(`${origin}/payment/result.html?error=callback_failed`);
    }
});

exports.iyzicoVerifyPayment = functions.region("europe-west1").https.onCall(async (data, context) => {
    const { token } = data;
    if (!token) throw new functions.https.HttpsError('invalid-argument', 'Token required');

    const apiKey = 'sandbox-ZamvrauhDeAsvxodQYHnVbYDgrvwGITd';
    const secretKey = 'sandbox-UdTaICHeunHZrgYAMbdFEwEEilfvlvpX';

    const iyzipay = new Iyzipay({
        apiKey: apiKey,
        secretKey: secretKey,
        uri: 'https://sandbox-api.iyzipay.com'
    });

    return new Promise((resolve, reject) => {
        iyzipay.checkoutForm.retrieve({
            locale: Iyzipay.LOCALE.TR,
            token: token
        }, async (err, result) => {
            if (err) return reject(new functions.https.HttpsError('internal', err.message));

            if (result.status === 'success' && (result.paymentStatus === 'SUCCESS' || result.paymentStatus === 'INIT_THREEDS')) {
                
                try {
                    // Kaydedilen orijinal sipariş verilerini geri çek (içinde items, image vs var)
                    const tempTransactionId = result.basketId || result.conversationId;
                    let originalOrderData = null;
                    if (tempTransactionId) {
                        const tempOrderSnap = await db.ref(`temp_iyzico_orders/${tempTransactionId}`).once('value');
                        if (tempOrderSnap.exists()) {
                            originalOrderData = tempOrderSnap.val();
                            await db.ref(`temp_iyzico_orders/${tempTransactionId}`).remove(); // Temizlik
                        }
                    }

                    // Eğer veri yoksa (sayfa yenilenmiş veya daha önce işlenmişse), yeni sipariş oluşturma!
                    if (!originalOrderData) {
                        return resolve({ status: 'success', orderId: 'Önceden Onaylandı', cleanCart: true });
                    }

                    // Sıralı sipariş ID'sini güvenli havuzdan çekiyoruz
                    const counterRef = db.ref('config/orderCounter');
                    const transactionResult = await counterRef.transaction((current) => (current || 0) + 1);
                    const orderId = `${transactionResult.snapshot.val()}`;

                    // iyzico'dan dönen ham fiyatları ve asıl ürün detaylarını siparişe map ediyoruz
                    const finalOrder = {
                        ...originalOrderData, // Ürün görselleri, name, customText vs burdan gelecek
                        id: orderId,
                        userId: originalOrderData.userId || (context.auth ? context.auth.uid : "guest"),
                        totalAmount: parseFloat(result.paidPrice),
                        status: 'paid', // Direkt ödendi olarak veritabanına giriyor!
                        iyzicoPaymentId: result.paymentId,
                        paidAt: admin.database.ServerValue.TIMESTAMP,
                        // iyzico panelinden dönen temel detaylar
                        itemsSummary: result.basketItems?.map(i => i.name).join(', ') || '3D Baski Urunu'
                    };

                    // Siparişi veritabanına bas (Firebase asla gereksiz şişmeyecek!)
                    await admin.database().ref(`users/${finalOrder.userId}/orders/${orderId}`).set(finalOrder);
                    
                    resolve({ status: 'success', orderId: orderId, cleanCart: true });
                } catch (dbErr) {
                    resolve({ status: 'partial_success', message: 'Ödeme alındı fakat DB kaydı başarısız.' });
                }
            } else {
                resolve({ status: 'failure', errorMessage: result.errorMessage });
            }
        });
    });
});