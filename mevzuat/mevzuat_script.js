import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBM7oB0EkTjGJiOHdo67ByXA6qxVcvPS8Y",
    authDomain: "engrar3d.firebaseapp.com",
    databaseURL: "https://engrar3d-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "engrar3d",
    storageBucket: "engrar3d.firebasestorage.app",
    messagingSenderId: "68298863793",
    appId: "1:68298863793:web:ba7ec7ded3424b4c779e90"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

$(document).ready(function() {
    // Load Cart Count
    function updateCartBadge() {
        const cartData = localStorage.getItem('engrare_cart');
        if (cartData) {
            try {
                const cart = JSON.parse(cartData);
                $('#cart-badge').text(cart.length);
            } catch (e) {
                console.error("Error parsing cart data", e);
            }
        }
    }
    updateCartBadge();

    // Firebase Auth İzleyici
    onAuthStateChanged(auth, (user) => {
        if (user && !user.isAnonymous) {
            $('#nav-login-btn').hide();
            $('#nav-user-profile').css('display', 'flex');
            $('#nav-logout-container').css('display', 'flex');
        } else {
            $('#nav-login-btn').css('display', 'flex');
            $('#nav-user-profile').hide();
            $('#nav-logout-container').hide();
        }
    });

    // Çıkış Yap
    $('#action-logout').click(() => {
        signOut(auth).then(() => {
            window.location.href = "../../?products";
        });
    });
});
