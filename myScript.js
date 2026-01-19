import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail } from "firebase/auth";
import { getDatabase, ref, set, push, onValue } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

// --- STATE ---

// --- FIREBASE CONFIG ---
// TODO: Replace with your specific Firebase Project Config Keys
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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);
const functions = getFunctions(app, 'europe-west1');
let activeModelConfig = null;
let currentLibraryModel = null;
let scene, camera, renderer, mesh, controls;
let cart = [];
const BASE_PRICE_PER_CM3 = 15.00; 
const BUILD_VOLUME_X = 256;
const BUILD_VOLUME_Y = 256;

// --- LOCAL MODELS DATA ---
const allFirebaseModels = [
    {
        id: 1,
        name: "Özel Ad Plakası 1",
        desc: "Düzenlenebilir 3D metinli kişiselleştirilmiş masaüstü plakası.",
        price: 180,
        images: ["./content/product2.jpeg", "./content/product2_alt.jpeg"], 
        stl: "./content/desktop_writing_holder.STL",
        isCustomizable: true,
        customConfig: {
            baseScale: { x: 5, y: 0, z: 2 }, 
            text: {
                initialContent: "ENGRARE",
                fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
                fontSize: 10,       
                fontThickness: 4,   
                position: { x: 0, y: -22, z: 0 },
                rotation: { x: Math.PI / 2, y: 0, z: 0 },
                color: "#FFFFFF"
            },
            customizableParams: {
                textContent: true,
                textFont: true,
                textColor: true,
                textRotationX: false,
                textRotationY: false,
                textRotationZ: true,
                textPositionX: true,
                textPositionY: false,
                textPositionZ: true,
                modelColor: true,
                material: true,
                infill: true,
                quantity: true,
                delivery: true
            }
        }
    },
    {
        id: 2,
        name: "Özel Ad Plakası 2",
        desc: "Düzenlenebilir 3D metinli kişiselleştirilmiş masaüstü plakası.",
        price: 180,
        images: ["./content/product2.jpeg"], 
        stl: "./content/desktop_writing_holder.STL",
        isCustomizable: true,
        customConfig: {
            baseScale: { x: 5, y: 0.2, z: 2 }, 
            text: {
                initialContent: "ENGRARE",
                fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
                fontSize: 10,       
                fontThickness: 4,   
                position: { x: 0, y: 0, z: 10 },
                rotation: { x: 0, y: 0, z: 0 },
                color: "#FFFFFF"
            },
            customizableParams: {
                textContent: true,
                textFont: true,
                textColor: true,
                textRotationX: false,
                textRotationY: false,
                textRotationZ: false,
                textPositionX: false,
                textPositionY: false,
                textPositionZ: false,
                modelColor: true,
                material: true,
                infill: true,
                quantity: true,
                delivery: true
            }
        }
    },
    {
        id: 3,
        name: "Özel Ad Plakası 3",
        desc: "Düzenlenebilir 3D metinli kişiselleştirilmiş masaüstü plakası.",
        price: 180,
        images: ["./content/product2.jpeg", "./content/product2_alt.jpeg", "./content/product2_alt2.jpeg"], 
        stl: "./content/desktop_writing_holder.STL",
        isCustomizable: true,
        customConfig: {
            baseScale: { x: 5, y: 0.2, z: 2 }, 
            text: {
                initialContent: "ENGRARE",
                fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
                fontSize: 10,       
                fontThickness: 4,   
                position: { x: 0, y: 0, z: 10 },
                rotation: { x: 0, y: 0, z: 0 },
                color: "#FFFFFF"
            },
            customizableParams: {
                textContent: true,
                textFont: false,
                textColor: true,
                textRotationX: true,
                textRotationY: false,
                textRotationZ: true,
                textPositionX: true,
                textPositionY: true,
                textPositionZ: false,
                modelColor: false,
                material: true,
                infill: true,
                quantity: true,
                delivery: true
            }
        }
    },
    {
        id: 4,
        name: "Özel Ad Plakası 4",
        desc: "Düzenlenebilir 3D metinli kişiselleştirilmiş masaüstü plakası.",
        price: 180,
        images: ["./content/product2.jpeg"], 
        stl: "./content/desktop_writing_holder.STL",
        isCustomizable: true,
        customConfig: {
            baseScale: { x: 5, y: 0.2, z: 2 }, 
            text: {
                initialContent: "ENGRARE",
                fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
                fontSize: 10,       
                fontThickness: 4,   
                position: { x: 0, y: 0, z: 10 },
                rotation: { x: 0, y: 0, z: 0 },
                color: "#FFFFFF"
            },
            customizableParams: {
                textContent: true,
                textFont: true,
                textColor: true,
                textRotationX: true,
                textRotationY: true,
                textRotationZ: true,
                textPositionX: true,
                textPositionY: true,
                textPositionZ: true,
                modelColor: true,
                material: true,
                infill: true,
                quantity: true,
                delivery: true
            }
        }
    }
];

// --- MODAL VARIABLES ---
let currentModalStl = "";
let currentModalName = "";
let currentModalId = null;
let currentModalImages = [];
let currentImageIndex = 0;

// --- DOM READY ---
$(document).ready(function() {
    
    loadCart();
    init3D(); 
    renderModelsPage();

    // --- FIREBASE AUTH LISTENERS ---
    
    // 1. Sign Up
    $('#btn-signup').click(async () => {
        const email = $('#signup-email').val();
        const pass = $('#signup-password').val();
        const name = $('#signup-name').val();
        
        try {
            const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
            await updateProfile(userCredential.user, { displayName: name });
            // Save basic user data to Realtime DB
            set(ref(db, 'users/' + userCredential.user.uid), {
                username: name,
                email: email
            });
            alert("Hesap oluşturuldu! Hoş geldiniz " + name);
            switchPage('#home-page');
        } catch (error) {
            alert("Hata: " + error.message);
        }
    });

    // 2. Sign In
    $('#btn-signin').click(async () => {
        const email = $('#signin-email').val();
        const pass = $('#signin-password').val();
        try {
            await signInWithEmailAndPassword(auth, email, pass);
            // Alert removed for smoother UX, auth observer handles redirect
            switchPage('#home-page');
        } catch (error) {
            alert("Giriş Başarısız: " + error.message);
        }
    });

    // 3. Log Out
    $('#action-logout').click(() => {
        signOut(auth).then(() => {
            switchPage('#home-page');
            alert("Başarıyla çıkış yapıldı.");
        });
    });

    // 4. Password Reset
    $('#btn-reset').click(async () => {
        const email = $('#reset-email').val();
        try {
            await sendPasswordResetEmail(auth, email);
            alert("Şifre sıfırlama e-postası gönderildi!");
            $('#view-reset').hide();
            $('#view-signin').fadeIn();
        } catch (error) {
            alert("Hata: " + error.message);
        }
    });

    // 5. Dashboard Tabs
    $('.dash-menu li').click(function() {
        $('.dash-menu li').removeClass('active');
        $(this).addClass('active');
        const tab = $(this).data('tab');
        $('.dash-tab').hide();
        $(`#tab-${tab}`).fadeIn(200);
    });
    
    // --- MONITOR AUTH STATE ---
    onAuthStateChanged(auth, (user) => {
        if (user) {
            // User is signed in
            $('#nav-login-btn').hide();
            $('#nav-user-profile').css('display', 'flex');
            
            // Update Dashboard UI
            $('#dash-user-name').text(user.displayName || "Kullanıcı");
            $('#dash-user-email').text(user.email);
            if(user.photoURL) {
                $('#nav-user-img, #dash-user-img').attr('src', user.photoURL);
            }

            // Load Orders
            loadUserOrders(user.uid);
        } else {
            // User is signed out
            $('#nav-login-btn').show();
            $('#nav-user-profile').hide();
            $('#dash-user-name').text("Konuk");
        }
    });
    // 1. Navigation
	$('.nav-menu li, .nav-trigger, .dropdown-item').click(function(e) {
        e.stopPropagation(); // Prevents bubbling issues
        const target = $(this).data('target');
        if (target) switchPage(target);
    });

    // 2. Scroll to Library
    $('.scroll-trigger').click(function() {
        const target = $(this).data('scroll');
        $('html, body').animate({
            scrollTop: $(target).offset().top - 80 
        }, 800);
    });

    // 3. Search Bar Listener - LOCAL SEARCH
    $('#model-search-bar').on('input', function() {
        const query = $(this).val().trim();
        
        // If search is empty, show all models
        if (query === "") {
            renderModelsPage(allFirebaseModels);
            return;
        }
        
        // Perform local search
        const lowerQuery = query.toLowerCase();
        const results = allFirebaseModels.filter(model =>
            model.name.toLowerCase().includes(lowerQuery) ||
            model.desc.toLowerCase().includes(lowerQuery)
        );
        renderModelsPage(results);
    });

    // 4. Library Selection (Home & Models Page)
    $(document).on('click', '.library-select-btn', function(e) {
        e.stopPropagation(); // Stop the click here so it doesn't bubble up to the card
        
        const id = $(this).data('id'); 
        let model = allFirebaseModels.find(m => m.id == id);

        if (!model) {
            model = {
                id: null,
                name: $(this).data('name'),
                stl: $(this).data('stl'),
                isCustomizable: $(this).data('custom'), 
                customConfig: null
            };
        }
        openInStudio(model);
    });

    // Text Color (Round Buttons) Listener
    $('.text-color-option').click(function() { 
        // 1. Update visual selection
        $('.text-color-option').removeClass('selected'); 
        $(this).addClass('selected');
        
        // 2. Get and apply color
        const hexColor = $(this).data('hex'); 
        
        if (textMesh && textMesh.material) {
            textMesh.material.color.set(hexColor);
        }
        
        // 3. Save to config
        if (activeModelConfig && activeModelConfig.text) {
            activeModelConfig.text.color = hexColor;
        }
    });
    // NEW: Real-time Text Listener

    $('#custom-text-input').on('input', function() {
        const text = $(this).val();
        updateCustomText(text);
    });

    // Font Selection Listener
    $('#text-font-select').on('change', function() {
        const fontName = $(this).val();
        updateTextFont(fontName);
    });

    // Text Rotation Listeners - Updated for multiple axes
    $('#text-rotation-x').on('input', function() {
        const rotation = parseFloat($(this).val());
        $('#text-rotation-x-value').text(rotation + '°');
        updateTextRotation();
    });

    $('#text-rotation-y').on('input', function() {
        const rotation = parseFloat($(this).val());
        $('#text-rotation-y-value').text(rotation + '°');
        updateTextRotation();
    });

    $('#text-rotation-z').on('input', function() {
        const rotation = parseFloat($(this).val());
        $('#text-rotation-z-value').text(rotation + '°');
        updateTextRotation();
    });

    // Text Position X Listener
    $('#text-pos-x').on('input', function() {
        updateTextPosition();
    });

    // Text Position Y Listener
    $('#text-pos-y').on('input', function() {
        updateTextPosition();
    });

    // Text Position Z Listener
    $('#text-pos-z').on('input', function() {
        updateTextPosition();
    });

    // Text Color change trigger
    $('#custom-text-color').on('input', function() {
        const color = $(this).val();
        if (textMesh && textMesh.material) {
            // Only change material color (no need to recreate mesh, better performance)
            textMesh.material.color.set(color);
        }
        // Update config so text color is not forgotten when content changes
        if (activeModelConfig && activeModelConfig.text) {
            activeModelConfig.text.color = color;
        }
    });

    // 4. Upload Button
    $('#upload-btn').click(() => $('#real-file-input').click());
    $('#real-file-input').change(handleFileUpload);

    // 5. Drag and Drop
    setupDragDrop();

    // 6. Mode Switcher & Tabs
    $('.tab-btn').click(function() {
        $('.tab-btn').removeClass('active');
        $(this).addClass('active');
        const mode = $(this).data('mode'); 
        $('.config-panel').hide();
        $(`#panel-${mode}`).fadeIn(200);
    });

    // 7. Color Selection
    $('.color-option').click(function() { 
        $('.color-option').removeClass('selected'); 
        $(this).addClass('selected');
        const hexColor = $(this).data('hex'); 
        const colorName = $(this).data('color');
        $('#selected-color-name').text(colorName);

        if (mesh && mesh.material) {
            mesh.material.color.set(hexColor);
        }
    });

    // 8. Price Sync
    $('#material-select, #infill-select, #quantity-input, input[name="delivery"]').on('input change', function() {
        calculatePrice();
        syncBasicToPro();
    });

    $('#pro-infill, #pro-layer-height').on('input change', function() {
        syncProToBasic();
        calculatePrice();
    });
    
    // 9. Cart Actions
    $('#add-to-cart').off('click').on('click', addToCart);

    $(document).on('click', '.remove-btn', function() {
        const index = $(this).data('index');
        cart.splice(index, 1);
        saveCart();
        renderCart();
    });

    // Reset Custom Parameters Button - Using Event Delegation
    $(document).on('click', '#reset-custom-params', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        if (!activeModelConfig || !currentLibraryModel) {
            return;
        }

        const initialConfig = currentLibraryModel.customConfig;
        if (!initialConfig || !initialConfig.text) {
            return;
        }

        // Get initial values from the library model config
        const initialPos = initialConfig.text.position;
        const initialRot = initialConfig.text.rotation;

        // Update rotation UI (convert radians to degrees)
        const rotXDeg = (initialRot.x || 0) * (180 / Math.PI);
        const rotYDeg = (initialRot.y || 0) * (180 / Math.PI);
        const rotZDeg = (initialRot.z || 0) * (180 / Math.PI);

        // Step 1: Update 3D mesh position and rotation FIRST
        if (textMesh) {
            textMesh.position.set(
                initialPos.x !== undefined ? initialPos.x : 0,
                initialPos.y !== undefined ? initialPos.y : 0,
                initialPos.z !== undefined ? initialPos.z : 0
            );
            textMesh.rotation.set(
                initialRot.x !== undefined ? initialRot.x : 0,
                initialRot.y !== undefined ? initialRot.y : 0,
                initialRot.z !== undefined ? initialRot.z : 0
            );
        }

        // Step 2: Update config
        activeModelConfig.text.rotation = {
            x: initialRot.x !== undefined ? initialRot.x : 0,
            y: initialRot.y !== undefined ? initialRot.y : 0,
            z: initialRot.z !== undefined ? initialRot.z : 0
        };
        activeModelConfig.text.position = {
            x: initialPos.x !== undefined ? initialPos.x : 0,
            y: initialPos.y !== undefined ? initialPos.y : 0,
            z: initialPos.z !== undefined ? initialPos.z : 0
        };

        // Step 3: Temporarily remove listeners to prevent cascading updates
        $('#text-rotation-x').off('input');
        $('#text-rotation-y').off('input');
        $('#text-rotation-z').off('input');
        $('#text-pos-x').off('input');
        $('#text-pos-y').off('input');
        $('#text-pos-z').off('input');

        // Step 4: Update UI values
        const rotXVal = rotXDeg.toFixed(1);
        const rotYVal = rotYDeg.toFixed(1);
        const rotZVal = rotZDeg.toFixed(1);
        
        $('#text-rotation-x').val(rotXVal);
        $('#text-rotation-x-value').text(rotXDeg.toFixed(0) + '°');

        $('#text-rotation-y').val(rotYVal);
        $('#text-rotation-y-value').text(rotYDeg.toFixed(0) + '°');

        $('#text-rotation-z').val(rotZVal);
        $('#text-rotation-z-value').text(rotZDeg.toFixed(0) + '°');

        $('#text-pos-x').val((initialPos.x !== undefined ? initialPos.x : 0).toFixed(2));
        
        $('#text-pos-y').val((initialPos.y !== undefined ? initialPos.y : 0).toFixed(2));
        
        $('#text-pos-z').val((initialPos.z !== undefined ? initialPos.z : 0).toFixed(2));

        // Step 5: Re-attach listeners
        $('#text-rotation-x').on('input', function() {
            const rotation = parseFloat($(this).val());
            $('#text-rotation-x-value').text(rotation + '°');
            updateTextRotation();
        });

        $('#text-rotation-y').on('input', function() {
            const rotation = parseFloat($(this).val());
            $('#text-rotation-y-value').text(rotation + '°');
            updateTextRotation();
        });

        $('#text-rotation-z').on('input', function() {
            const rotation = parseFloat($(this).val());
            $('#text-rotation-z-value').text(rotation + '°');
            updateTextRotation();
        });

        $('#text-pos-x').on('input', function() {
            updateTextPosition();
        });

        $('#text-pos-y').on('input', function() {
            updateTextPosition();
        });

        $('#text-pos-z').on('input', function() {
            updateTextPosition();
        });
    });

    // Open Modal when Model Card clicked
    $(document).on('click', '.model-card', function() {
        const id = $(this).data('id');
        const model = allFirebaseModels.find(m => m.id === id);
        
        if(model) {
            currentModalImages = model.images || ["./content/product2.jpeg"];
            currentImageIndex = 0;
            updateModalImage();
            
            $('#modal-title').text(model.name);
            $('#modal-desc').text(model.desc);
            $('#modal-price').text('₺' + model.price.toFixed(2));
            
            currentModalStl = model.stl;
            currentModalName = model.name;
            currentModalId = model.id;

            // Show/hide carousel controls based on image count
            if (currentModalImages.length > 1) {
                $('.modal-carousel-controls').show();
            } else {
                $('.modal-carousel-controls').hide();
            }

            $('#model-modal').addClass('open');
        }
    });

    // Close Modal
    $('.modal-close, .modal-overlay').click(function(e) {
        if (e.target === this) {
            $('#model-modal').removeClass('open');
        }
    });

    // Image carousel navigation
    $('#modal-prev-btn').click(function() {
        currentImageIndex = (currentImageIndex - 1 + currentModalImages.length) % currentModalImages.length;
        updateModalImage();
    });

    $('#modal-next-btn').click(function() {
        currentImageIndex = (currentImageIndex + 1) % currentModalImages.length;
        updateModalImage();
    });

	// "Show in Studio" Button in Modal
	$('#modal-show-studio-btn').click(function() {
		$('#model-modal').removeClass('open');
		
		let model = allFirebaseModels.find(m => m.id == currentModalId);

		if (!model) {
			 model = {
				name: currentModalName,
				stl: currentModalStl,
				isCustomizable: false,
				customConfig: null
			 };
		}
		openInStudio(model);
	});
});

// --- HELPER FUNCTIONS ---

function updateModalImage() {
    if (currentModalImages.length > 0) {
        $('#modal-img').attr('src', currentModalImages[currentImageIndex]);
        $('#modal-image-counter').text((currentImageIndex + 1) + ' / ' + currentModalImages.length);
    }
}

function renderModelsPage(modelsList) {
    // Safety check
    if (!modelsList) {
        modelsList = [];
    }

    const $grid = $('#models-grid-container');
    $grid.empty();
    
    if (modelsList.length === 0) {
        if (allFirebaseModels && allFirebaseModels.length > 0) {
             $grid.html('<p style="grid-column: 1/-1; text-align: center; color: #94A3B8;">Aramanızla eşleşen model bulunamadı.</p>');
        }
        return;
    }

    modelsList.forEach(model => {
        const firstImage = (model.images && model.images.length > 0) ? model.images[0] : model.img || "./content/product2.jpeg";
        
        $grid.append(`
            <div class="model-card" data-id="${model.id}">
                <div class="card-image"><img src="${firstImage}" alt="${model.name}"/></div>
                <div class="model-info">
                    <div class="model-title">${model.name}</div>
                    <div class="model-desc">${model.desc.substring(0, 60)}...</div>
                    <div class="card-meta">
                        <span class="price-tag">₺${model.price.toFixed(2)}</span>
                        <button class="btn-sm library-select-btn" 
                            data-id="${model.id}" 
                            data-name="${model.name}" 
                            data-stl="${model.stl}" 
                            data-custom="${model.isCustomizable || false}">
                            Özelleştir
                        </button>
                    </div>
                </div>
            </div>
        `);
    });
}

function loadUserOrders(userId) {
    const ordersRef = ref(db, 'orders/' + userId);
    onValue(ordersRef, (snapshot) => {
        const data = snapshot.val();
        const $list = $('#orders-list');
        $list.empty();
        
        if (data) {
            Object.values(data).forEach((order) => {
                $list.append(`
                    <div class="cart-item">
                        <div class="info">
                            <div style="font-weight:600">Sipariş #${order.id}</div>
                            <div style="font-size:0.8rem">${order.date}</div>
                        </div>
                        <div style="font-weight:500">₺${order.total}</div>
                        <div style="color: green; font-size: 0.85rem; font-weight: 600;">${order.status}</div>
                    </div>
                `);
            });
        } else {
            $list.html('<p>Geçmiş sipariş bulunamadı.</p>');
        }
    });
}

function openInStudio(model) {
    // --- CLEAR INPUT ---
    $('#real-file-input').val('');

    switchPage('#upload-page');
    $('#file-name-display').text(model.name);
    
	currentLibraryModel = model; // Store the full model data to reference later
    // Deep copy the customConfig to prevent modifications from affecting the original
    activeModelConfig = model.customConfig ? JSON.parse(JSON.stringify(model.customConfig)) : null;

    if (model.isCustomizable) {
        $('#custom-text-group').fadeIn(); 
        const initialText = activeModelConfig ? activeModelConfig.text.initialContent : "ENGRARE";
        $('#custom-text-input').val(initialText);
        
        $('#text-font-select').val('helvetiker_bold');
        
        $('.text-color-option').removeClass('selected');
        $('.text-color-option[data-hex="#FFFFFF"]').addClass('selected');
        
        // Update rotation controls - CONVERT FROM RADIANS TO DEGREES
        const rotation = activeModelConfig ? activeModelConfig.text.rotation : { x: 0, y: 0, z: 0 };
        const rotXDeg = (rotation.x || 0) * (180 / Math.PI);
        const rotYDeg = (rotation.y || 0) * (180 / Math.PI);
        const rotZDeg = (rotation.z || 0) * (180 / Math.PI);
        
        // Show/hide rotation controls based on individual axis flags
        const canEditRotX = activeModelConfig?.customizableParams?.textRotationX || false;
        const canEditRotY = activeModelConfig?.customizableParams?.textRotationY || false;
        const canEditRotZ = activeModelConfig?.customizableParams?.textRotationZ || false;
        
        $('#text-rotation-x').closest('.form-group').toggle(canEditRotX);
        $('#text-rotation-x').val(rotXDeg);
        $('#text-rotation-x-value').text(rotXDeg.toFixed(0) + '°');
        
        $('#text-rotation-y').closest('.form-group').toggle(canEditRotY);
        $('#text-rotation-y').val(rotYDeg);
        $('#text-rotation-y-value').text(rotYDeg.toFixed(0) + '°');
        
        $('#text-rotation-z').closest('.form-group').toggle(canEditRotZ);
        $('#text-rotation-z').val(rotZDeg);
        $('#text-rotation-z-value').text(rotZDeg.toFixed(0) + '°');
        
        // Update position controls based on individual axis flags
        const canEditPosX = activeModelConfig?.customizableParams?.textPositionX || false;
        const canEditPosY = activeModelConfig?.customizableParams?.textPositionY || false;
        const canEditPosZ = activeModelConfig?.customizableParams?.textPositionZ || false;
        
        const position = activeModelConfig ? activeModelConfig.text.position : { x: 0, y: 0, z: 10 };
        
        $('#text-pos-x').closest('.form-group').toggle(canEditPosX);
        $('#text-pos-x').val(position.x || 0);
        
        $('#text-pos-y').closest('.form-group').toggle(canEditPosY);
        $('#text-pos-y').val(position.y || 0);
        
        $('#text-pos-z').closest('.form-group').toggle(canEditPosZ);
        $('#text-pos-z').val(position.z || 10);
        
    } else {
        $('#custom-text-group').hide();
    }

    loadLibrarySTL(model.stl);
}

function setupDragDrop() {
    const dropZone = document.querySelector('.viewer-container');
    const overlay = document.getElementById('drop-zone-overlay');
    let dragCounter = 0;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
        document.body.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });

    dropZone.addEventListener('dragenter', () => {
        dragCounter++;
        overlay.style.display = 'flex';
    });

    dropZone.addEventListener('dragleave', () => {
        dragCounter--;
        if (dragCounter === 0) overlay.style.display = 'none';
    });

    dropZone.addEventListener('drop', (e) => {
        dragCounter = 0;
        overlay.style.display = 'none';
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFile(files[0]);
    });
}

function syncBasicToPro() {
    const basicInfill = $('#infill-select').val();
    $('#pro-infill').val(basicInfill);
}

function syncProToBasic() {
    const proInfill = $('#pro-infill').val();
    $(`#infill-select option[value="${proInfill}"]`).prop('selected', true);
}

function switchPage(targetId) {
    $('.nav-menu li').removeClass('active');
    $(`.nav-menu li[data-target="${targetId}"]`).addClass('active');
    
    if (targetId === '#login-page' || targetId === '#dashboard-page') {
        $('#nav-user-container').addClass('active');
    }

    $('.page').removeClass('active');
    $(targetId).addClass('active');
    
    if (targetId === '#upload-page') {
        setTimeout(updateDimensions, 100);
    }
    window.scrollTo(0, 0);
}

// --- THREE.JS LOGIC ---
function init3D() {
    const container = document.getElementById('3d-viewer');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF8F9FB); 
    
    const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 150, 100);
    dirLight.castShadow = true;
    scene.add(dirLight);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(200, 200, 200); 

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enabled = false; 

    createBed();
    animate();
    const resizeObserver = new ResizeObserver(() => updateDimensions());
    resizeObserver.observe(container);
}

function createBed() {
    const geometry = new THREE.PlaneGeometry(BUILD_VOLUME_X, BUILD_VOLUME_Y);
    
    const material = new THREE.MeshPhongMaterial({ 
        color: 0x999999, 
        side: THREE.FrontSide, 
        shininess: 10 
    });

    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    scene.add(plane);

    // Grid remains visible
    const gridHelper = new THREE.GridHelper(BUILD_VOLUME_X, 12, 0x444444, 0x555555);
    gridHelper.position.y = 0.1; 
    scene.add(gridHelper);
}

function updateDimensions() {
    const container = document.getElementById('3d-viewer');
    if (!container || !renderer || !camera) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if(width === 0 || height === 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
}

function animate() {
    requestAnimationFrame(animate);
    if(controls) controls.update();
    renderer.render(scene, camera);
}

function handleFileUpload(e) {
    const file = e.target.files[0];
    handleFile(file);
}

function handleFile(file) {
    if (!file) return;
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.stl') && !fileName.endsWith('.3mf')) {
        alert("Sadece .STL ve .3MF dosyaları desteklenmektedir.");
        return;
    }
    
    // Clear library model reference and custom config
    currentLibraryModel = null; 
    activeModelConfig = null;

    $('#custom-text-group').hide();
    
    if (textMesh) {
         scene.remove(textMesh);
         textMesh = null;
    }

    $('#file-name-display').text(file.name);
    const reader = new FileReader();
    reader.onload = function(ev) { loadSTL(ev.target.result); };
    reader.readAsArrayBuffer(file);
}

function loadLibrarySTL(url) {
    fetch(url)
        .then(res => { if(!res.ok) throw new Error("Missing File"); return res.arrayBuffer(); })
        .then(data => loadSTL(data))
        .catch(err => {
             console.error(err);
             alert("Demo Mode: Ensure assets exist locally.");
        });
}

function loadSTL(data) {
    const loader = new STLLoader();
    let geometry = null;
    let isFileValid = false;

    // 1. Read File
    try {
        if (data) {
            geometry = loader.parse(data);
            if (geometry && geometry.attributes.position && geometry.attributes.position.count > 0) {
                geometry.computeBoundingBox();
                if (isFinite(geometry.boundingBox.min.x)) isFileValid = true;
            }
        }
    } catch (e) { console.warn("Could not read data."); }

    // 2. File not found: Create virtual box
    if (!isFileValid) {
        console.log("File could not be loaded, using Virtual Box.");
        geometry = new THREE.BoxGeometry(20, 20, 20);
    }

    // 3. Center geometry
    geometry.center(); 
    
    // 4. SCALING
    if (!isFileValid && activeModelConfig && activeModelConfig.baseScale) {
        const s = activeModelConfig.baseScale;
        geometry.scale(s.x, s.y, s.z);
    }

    // 5. Material
    const initialColor = $('.color-option.selected').data('hex') || 0x333333;
    const material = new THREE.MeshPhongMaterial({ 
        color: initialColor, 
        specular: 0x111111, 
        shininess: 30 
    });

    // Scene cleanup
    if (mesh) scene.remove(mesh);
    scene.children.forEach(child => {
        if (child.type === "BoxHelper" || child.type === "AxesHelper") scene.remove(child);
    });
    if (typeof textMesh !== 'undefined' && textMesh) {
         scene.remove(textMesh);
         textMesh = null;
    }

    // 6. Create mesh
    mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    
    // Positioning
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);

    // Rest on floor
    if (activeModelConfig) {
        if (!isFileValid) {
            mesh.rotation.x = 0;
            mesh.position.y = size.y / 2;
        } else {
            mesh.rotation.x = -Math.PI / 2; 
            mesh.position.y = size.z / 2;
        }
    } else {
        mesh.rotation.x = -Math.PI / 2; 
        mesh.position.y = size.z / 2;
    }

    if (!isFinite(mesh.position.y)) mesh.position.y = 0;

    scene.add(mesh);

    // 7. Add text
    if (activeModelConfig) {
        try { updateCustomText(activeModelConfig.text.initialContent); } catch(e){}
    }

    // 8. Panel Info
    const finalBox = new THREE.Box3().setFromObject(mesh);
    const finalSize = new THREE.Vector3();
    finalBox.getSize(finalSize);

    $('#dim-x').text(finalSize.x.toFixed(1));
    $('#dim-y').text(finalSize.y.toFixed(1));
    $('#dim-z').text(finalSize.z.toFixed(1));
    $('.dimensions-box').fadeIn();

    // 9. Auto-Focus camera
    const maxDim = Math.max(finalSize.x, finalSize.y, finalSize.z);
    let fitDistance = Math.max(maxDim * 1.5, 60);

    camera.position.set(fitDistance, fitDistance, fitDistance);
    
    const center = new THREE.Vector3();
    finalBox.getCenter(center);
    camera.lookAt(center);
    
    if(controls) {
        controls.target.copy(center);
        controls.enabled = true;
        controls.update();
    }

    const vol = getVolume(geometry) / 1000;
    $('#model-vol').data('raw', (isNaN(vol) || vol <= 0) ? 10 : vol);
    
    calculatePrice();
    $('#add-to-cart').prop('disabled', false);
}

let textMesh = null;
let isDraggingText = false;
let dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
let dragPoint = new THREE.Vector3();
let textDragListenerSetup = false;

function updateCustomText(message) {
    if (!mesh || !activeModelConfig) return;
    
    // If message is empty, delete
    if (message === "") {
        if (textMesh) mesh.remove(textMesh);
        textMesh = null;
        return;
    }

    const cfg = activeModelConfig.text;
    
    // Get color
    const selectedDiv = $('.text-color-option.selected');
    const currentColor = selectedDiv.length > 0 ? selectedDiv.data('hex') : (cfg.color || "#FFFFFF");

    const loader = new FontLoader();
    loader.load(cfg.fontUrl, function (font) {
        
        // Clean old text
        if (textMesh) {
            mesh.remove(textMesh);
            if(textMesh.geometry) textMesh.geometry.dispose();
        }

        const textGeo = new TextGeometry(message, {
            font: font,
            size: cfg.fontSize,
            height: cfg.fontThickness,
            curveSegments: 12,
            bevelEnabled: false
        });

        textGeo.center();

        const textMat = new THREE.MeshPhongMaterial({ color: currentColor });
        textMesh = new THREE.Mesh(textGeo, textMat);

        // Use position directly from config
        const pos = cfg.position || { x: 0, y: 0, z: 10 };
        textMesh.position.set(pos.x, pos.y, pos.z);

        // Apply rotation
        const rot = cfg.rotation || { x: 0, y: 0, z: 0 };
        textMesh.rotation.x = rot.x || 0;
        textMesh.rotation.y = rot.y || 0;
        textMesh.rotation.z = rot.z || 0;

        mesh.add(textMesh);
        
        // Setup drag listener only once
        if (!textDragListenerSetup) {
            setupTextDragListener();
            textDragListenerSetup = true;
        }
    });
}

function setupTextDragListener() {
    const canvas = renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let dragStartPos = new THREE.Vector3();
    let dragStartMouse = new THREE.Vector2();
    let dragStartScreenPos = new THREE.Vector2();

    canvas.addEventListener('mousedown', (event) => {
        if (!textMesh) return;

        // Calculate mouse position in normalized device coordinates
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects([textMesh]);

        if (intersects.length > 0) {
            isDraggingText = true;
            // Disable camera controls while dragging text
            if (controls) controls.enabled = false;
            
            dragStartPos.copy(textMesh.position);
            dragStartMouse.copy(mouse);
            dragStartScreenPos.set(event.clientX - rect.left, event.clientY - rect.top);
            event.preventDefault();
        }
    });

    canvas.addEventListener('mousemove', (event) => {
        if (!isDraggingText || !textMesh) return;

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        // Get axis lock settings
        const canEditPosX = activeModelConfig?.customizableParams?.textPositionX || false;
        const canEditPosY = activeModelConfig?.customizableParams?.textPositionY || false;
        const canEditPosZ = activeModelConfig?.customizableParams?.textPositionZ || false;

        // Get current screen position
        const currentScreenPos = new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top);
        const screenDelta = currentScreenPos.clone().sub(dragStartScreenPos);

        // For X and Y: Use camera view plane
        let worldDeltaXY = new THREE.Vector3(0, 0, 0);
        if (canEditPosX || canEditPosY) {
            const cameraDir = new THREE.Vector3();
            camera.getWorldDirection(cameraDir);
            const dragPlane = new THREE.Plane(cameraDir, 0);
            dragPlane.setFromNormalAndCoplanarPoint(cameraDir, dragStartPos);

            raycaster.setFromCamera(mouse, camera);
            const newWorldPos = new THREE.Vector3();
            raycaster.ray.intersectPlane(dragPlane, newWorldPos);
            worldDeltaXY = newWorldPos.clone().sub(dragStartPos);
        }

        // For Z: Use screen vertical movement (inverted)
        // Increased multiplier from 100 to 150 for faster Z movement
        const worldDeltaZ = canEditPosZ ? -(screenDelta.y / rect.height) * 150 : 0;

        // Build new position with axis locks
        const newPos = new THREE.Vector3(
            canEditPosX ? dragStartPos.x + worldDeltaXY.x : dragStartPos.x,
            canEditPosY ? dragStartPos.y + worldDeltaXY.y : dragStartPos.y,
            canEditPosZ ? dragStartPos.z + worldDeltaZ : dragStartPos.z
        );

        textMesh.position.copy(newPos);

        // Update UI inputs (only for unlocked axes)
        if (activeModelConfig && activeModelConfig.text) {
            activeModelConfig.text.position = {
                x: newPos.x,
                y: newPos.y,
                z: newPos.z
            };
            if (canEditPosX) $('#text-pos-x').val(newPos.x.toFixed(2));
            if (canEditPosY) $('#text-pos-y').val(newPos.y.toFixed(2));
            if (canEditPosZ) $('#text-pos-z').val(newPos.z.toFixed(2));
        }
        
        event.preventDefault();
    });

    canvas.addEventListener('mouseup', () => {
        if (isDraggingText) {
            isDraggingText = false;
            // Re-enable camera controls
            if (controls) controls.enabled = true;
        }
    });
}

// UPDATE TEXT FONT
function updateTextFont(fontName) {
    if (!textMesh || !mesh) return;

    // Font URLs mapping
    const fontUrls = {
        'helvetiker_bold': 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
        'helvetiker_regular': 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json',
        'optimer_bold': 'https://unpkg.com/three@0.160.0/examples/fonts/optimer_bold.typeface.json',
        'optimer_regular': 'https://unpkg.com/three@0.160.0/examples/fonts/optimer_regular.typeface.json',
        'droid_sans_bold': 'https://unpkg.com/three@0.160.0/examples/fonts/droid_sans_bold.typeface.json',
        'droid_sans_regular': 'https://unpkg.com/three@0.160.0/examples/fonts/droid_sans_regular.typeface.json'
    };

    const fontUrl = fontUrls[fontName] || fontUrls['helvetiker_bold'];
    const currentText = $('#custom-text-input').val();

    if (!currentText || currentText === "") return;

    const cfg = activeModelConfig.text;
    cfg.fontUrl = fontUrl;

    // Re-render text with new font
    updateCustomText(currentText);
}

// UPDATE TEXT ROTATION (in degrees)
function updateTextRotation() {
    if (!textMesh) return;

    // Convert degrees from UI to radians for Three.js
    const rotX = (parseFloat($('#text-rotation-x').val()) * Math.PI) / 180;
    const rotY = (parseFloat($('#text-rotation-y').val()) * Math.PI) / 180;
    const rotZ = (parseFloat($('#text-rotation-z').val()) * Math.PI) / 180;
    
    textMesh.rotation.x = rotX;
    textMesh.rotation.y = rotY;
    textMesh.rotation.z = rotZ;

    if (activeModelConfig && activeModelConfig.text) {
        // Store as RADIANS in config
        activeModelConfig.text.rotation = {
            x: rotX,
            y: rotY,
            z: rotZ
        };
    }
}

// UPDATE TEXT POSITION (World Coordinates)
function updateTextPosition() {
    if (!textMesh) return;

    const posX = parseFloat($('#text-pos-x').val()) || 0;
    const posY = parseFloat($('#text-pos-y').val()) || 0;
    const posZ = parseFloat($('#text-pos-z').val()) || 0;

    textMesh.position.set(posX, posY, posZ);

    if (activeModelConfig && activeModelConfig.text) {
        activeModelConfig.text.position = {
            x: posX,
            y: posY,
            z: posZ
        };
    }
}

function getVolume(geometry) {
    if(geometry.index) geometry = geometry.toNonIndexed();
    const pos = geometry.attributes.position;
    let vol = 0;
    const p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), p3 = new THREE.Vector3();
    for(let i=0; i<pos.count; i+=3){
        p1.fromBufferAttribute(pos, i);
        p2.fromBufferAttribute(pos, i+1);
        p3.fromBufferAttribute(pos, i+2);
        vol += p1.dot(p2.cross(p3)) / 6.0;
    }
    return Math.abs(vol);
}

function formatTL(price) {
    if (isNaN(price)) return "₺0.00";
    return price.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
}

function calculatePrice() {
    let vol = $('#model-vol').data('raw');
    if(vol === undefined || vol === null || isNaN(vol)) vol = 0;

    const materialFactor = parseFloat($('#material-select').val());
    const infillVal = parseFloat($('#pro-infill').val());
    const infillFactor = infillVal / 20; 
    const deliveryFactor = parseFloat($('input[name="delivery"]:checked').val());
    let quantity = parseInt($('#quantity-input').val());
    if (isNaN(quantity) || quantity < 1) quantity = 1;

    let unitPrice = vol * BASE_PRICE_PER_CM3 * materialFactor * infillFactor;
    
    if (vol > 0 && unitPrice < 50) unitPrice = 50; 
    if (vol === 0) unitPrice = 0;

    let totalPrice = unitPrice * quantity * deliveryFactor;
    $('#price-display').text(formatTL(totalPrice));
}

async function addToCart() {
    const $btn = $('#add-to-cart');
    
    $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Ekleniyor...');

    try {
        const priceText = $('#price-display').text();
        const numericPrice = parseFloat(priceText.replace('₺', '').replace(/\./g, '').replace(',', '.').trim());
        const name = $('#file-name-display').text();
        const mode = $('.tab-btn.active').text();

        // 1. Capture Config (Color, Text, etc.)
        const currentConfig = {
            colorHex: $('.color-option.selected').data('hex'),
            colorName: $('.color-option.selected').data('color'),
            material: $('#material-select').val(),
            infill: $('#infill-select').val(),
            customText: (activeModelConfig && $('#custom-text-input').val()) ? $('#custom-text-input').val() : null,
            customTextColor: (activeModelConfig) ? $('.text-color-option.selected').data('hex') : null
        };

        // 2. Create Cart Item
        const cartItem = { 
            name: name, 
            price: numericPrice, 
            mode: mode, 
            formattedPrice: priceText,
            date: new Date().toLocaleString('tr-TR'),
            isLibrary: !!currentLibraryModel,
            libraryId: currentLibraryModel ? currentLibraryModel.id : null,
            configuration: currentLibraryModel ? currentConfig : null
        };
        
        // 3. Add to Memory State
        cart.push(cartItem);
        
        saveCart(); 
        renderCart();
        
        $btn.text('Eklendi!').css('background-color', '#10B981');
        setTimeout(() => {
            $btn.prop('disabled', false).text('Sepete Ekle').css('background-color', '');
        }, 1500);

    } catch (error) {
        console.error("Cart Error:", error);
        $btn.prop('disabled', false).text('Sepete Ekle');
    }
}

function saveCart() {
    // 1. Filter: Create a new list that ONLY contains Library models
    const itemsToSave = cart.filter(item => item.isLibrary === true);

    // 2. Save only the filtered list to LocalStorage
    localStorage.setItem('engrare_cart', JSON.stringify(itemsToSave));

    // 3. Update the badge count
    $('#cart-badge').text(cart.length);
}

function loadCart() {
    const stored = localStorage.getItem('engrare_cart');
    if (stored) {
        try {
            cart = JSON.parse(stored);
            $('#cart-badge').text(cart.length);
            renderCart();
        } catch(e) {
            console.error("Cart load failed", e);
        }
    }
}

function renderCart() {
    const $area = $('#cart-items-area');
    $area.empty();
    
    if(cart.length === 0) {
        $area.html('<div style="text-align:center; padding:20px; color:#999">Sepet boş.</div>');
        $('#val-subtotal').text(formatTL(0));
        $('#val-total').text(formatTL(50)); 
        return;
    }

    let sub = 0;
    cart.forEach((item, index) => {
        sub += item.price;
        $area.append(`
            <div class="cart-item">
                <div class="info">
                    <div style="font-weight:600">${item.name}</div>
                    <div style="font-size:0.8rem; color:#666">${item.mode}</div>
                </div>
                <div class="price-action">
                    <span style="font-weight:500; margin-right:15px">${item.formattedPrice}</span>
                    <button class="remove-btn" data-index="${index}" style="color:red; background:none; border:none; cursor:pointer;">X</button>
                </div>
            </div>
        `);
    });

    const shipping = 50.00;
    $('#val-subtotal').text(formatTL(sub));
    $('#shipping-display').text(formatTL(shipping));
    $('#val-total').text(formatTL(sub + shipping));
}