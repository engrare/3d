const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();

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

exports.searchModels = functions.region("europe-west1").https.onCall(async (data, context) => {
    const query = data.query;
    
    if (!query || query.trim() === "") {
        return { results: [] };
    }
    
    const searchQuery = query.toLowerCase().trim();
    
    try {
        // Get all models from the database
        const snapshot = await db.ref("models").once("value");
        const dbData = snapshot.val();
        
        if (!dbData) {
            return { results: [] };
        }
        
        // Convert object to array
        const allModels = Object.values(dbData);
        
        // Filter models by searching in name and description
        const results = allModels.filter(model => {
            const name = (model.name || "").toLowerCase();
            const desc = (model.desc || "").toLowerCase();
            
            return name.includes(searchQuery) || desc.includes(searchQuery);
        });
        
        // Sort by relevance (name matches ranked higher)
        results.sort((a, b) => {
            const aNameMatch = a.name.toLowerCase().includes(searchQuery) ? 1 : 0;
            const bNameMatch = b.name.toLowerCase().includes(searchQuery) ? 1 : 0;
            return bNameMatch - aNameMatch;
        });
        
        return { results: results };
    } catch (error) {
        console.error("Search error:", error);
        throw new functions.https.HttpsError("internal", "Search failed");
    }
});

exports.verifyDiscount = functions.region("europe-west1").https.onCall(async (data, context) => {
    const code = data.code;
    if (!code) return { valid: false, message: "Kod girilmedi." };

    try {
        const snapshot = await db.ref(`discounts/${code}`).once('value');
        if (!snapshot.exists()) {
            return { valid: false, message: "Geçersiz indirim kodu." };
        }

        const discount = snapshot.val();
        const now = Date.now();

        if (discount.expiryDate && now > discount.expiryDate) {
            return { valid: false, message: "Bu kodun süresi dolmuş." };
        }

        if (discount.limit <= 0) {
            return { valid: false, message: "Bu kodun kullanım limiti dolmuş." };
        }

        return { 
            valid: true, 
            type: discount.type, // 'percent' or 'fixed'
            value: discount.value,
            code: code
        };
    } catch (error) {
        console.error("Discount verify error:", error);
        throw new functions.https.HttpsError("internal", "Doğrulama hatası.");
    }
});

exports.createOrder = functions.region("europe-west1").https.onCall(async (data, context) => {
    // data contains: orderData (items, total, etc.), discountCode (optional)
    const { orderData, discountCode } = data;
    
    // Basic validation
    if (!orderData) {
        throw new functions.https.HttpsError("invalid-argument", "Sipariş verisi eksik.");
    }

    try {
        let finalOrderData = { ...orderData };
        
        // Handle Discount
        if (discountCode) {
            const discountRef = db.ref(`discounts/${discountCode}`);
            
            // Transaction to safely decrement limit
            const result = await discountRef.transaction((current) => {
                if (current) {
                    if (current.limit > 0 && (!current.expiryDate || Date.now() <= current.expiryDate)) {
                        current.limit--;
                        return current;
                    } else {
                        // Abort if invalid
                        return; // returning undefined aborts transaction
                    }
                }
                return current;
            });

            if (!result.committed) {
                throw new functions.https.HttpsError("failed-precondition", "İndirim kodu artık geçerli değil (limit veya süre).");
            }
            
            // If we successfully decremented, we assume the discount is applied.
            // (The frontend should have already calculated the price, but backend *could* re-verify price here for security. 
            // For this prototype, we trust the calculated total or just apply the logic again if needed.
            // Let's mark it in the order.)
            finalOrderData.appliedDiscount = discountCode;
        }

        // Create Order in DB
        const newOrderRef = db.ref('orders').push();
        const orderId = newOrderRef.key;
        finalOrderData.id = orderId;
        finalOrderData.createdAt = admin.database.ServerValue.TIMESTAMP;

        await newOrderRef.set(finalOrderData);

        // Also save to user's history if authenticated
        if (finalOrderData.userId) {
            await db.ref(`users/${finalOrderData.userId}/orders/${orderId}`).set(finalOrderData);
        }

        return { success: true, orderId: orderId };

    } catch (error) {
        console.error("Order creation error:", error);
        throw new functions.https.HttpsError("internal", error.message || "Sipariş oluşturulamadı.");
    }
});
