import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail } from "firebase/auth";
import { getDatabase, ref, set, push, onValue } from "firebase/database";
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
const storage = getStorage(app); // Storage servisini başlat
let activeModelConfig = null;
let currentLibraryModel = null;
let scene, camera, renderer, mesh, controls;
let cart = [];
const BASE_PRICE_PER_CM3 = 15.00; 
const BUILD_VOLUME_X = 256;
const BUILD_VOLUME_Y = 256;

// --- MODEL DATABASE (Mock Data) ---
const initialMockData = [
    {
        id: 1,
        name: "Calibration Cube",
        desc: "The gold standard for calibrating 3D printers. Measure dimensions to ensure X, Y, and Z accuracy.",
        price: 150,
        img: "./content/product1.jpeg",
        stl: "./assets/cube.stl",
        isCustomizable: false,
        customConfig: null
    },
    {
        id: 2,
        name: "Modular Phone Stand",
        desc: "A sleek, adjustable stand for smartphones. Features a sturdy base.",
        price: 350,
        img: "./content/product2.jpeg",
        stl: "./assets/phone_stand.stl",
        isCustomizable: false,
        customConfig: null
    },
    {
        id: 3,
        name: "Planetary Gear Set",
        desc: "A fully functional mechanical assembly demonstrating high-torque gear reduction.",
        price: 600,
        img: "./content/product3.avif",
        stl: "./assets/gear.stl",
        isCustomizable: false,
        customConfig: null
    },
    {
        id: 7,
        name: "Custom Name Plate",
        desc: "Personalized desk plate with editable 3D text.",
        price: 180,
        img: "./content/product2.jpeg", 
        stl: "./content/desktop_writing_holder.STL",
        isCustomizable: true,
        customConfig: {
            // Virtual Scale (Only used if STL fails to load, creating a box)
            baseScale: { x: 5, y: 0.2, z: 2 }, 
            
            // --- TEXT SETTINGS ---
            text: {
                initialContent: "ENGRARE",
                fontUrl: 'https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json',
                
                // Text Dimensions
                fontSize: 10,       
                fontThickness: 4,   
                
                // Positioning (Relative to the model center)
                offsetY: 0,         // 0 = Surface, 1 = Floating, -1 = Embedded
                shiftX: 0,          // Left/Right
                shiftZ: 10,         // Forward/Backward (Positive = Closer to camera/bottom)
                
                color: "#FFFFFF"
            }
        }
    }
];

let allFirebaseModels = [];

// --- DOM READY ---
$(document).ready(function() {
    
    loadCart();
    init3D(); 
    renderModelsPage(); // NEW: Populate the models grid
// ... existing init code ...

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
            alert("Account created! Welcome " + name);
            switchPage('#home-page');
        } catch (error) {
            alert("Error: " + error.message);
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
            alert("Login Failed: " + error.message);
        }
    });

    // 3. Log Out
    $('#action-logout').click(() => {
        signOut(auth).then(() => {
            switchPage('#home-page');
            alert("Logged out successfully.");
        });
    });

    // 4. Password Reset
    $('#btn-reset').click(async () => {
        const email = $('#reset-email').val();
        try {
            await sendPasswordResetEmail(auth, email);
            alert("Password reset email sent!");
            $('#view-reset').hide();
            $('#view-signin').fadeIn();
        } catch (error) {
            alert("Error: " + error.message);
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
            $('#dash-user-name').text(user.displayName || "User");
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
            $('#dash-user-name').text("Guest");
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

// 3. Library Selection (Hem Home Hem Models Sayfası - HİBRİT ÇÖZÜM)
$(document).on('click', '.library-select-btn', function(e) {
    const modelsRef = ref(db, 'models');

    // 1. Listen to Firebase 'models' node
    onValue(modelsRef, (snapshot) => {
        const data = snapshot.val();
        
        if (!data) {
            // DATABASE IS EMPTY? Upload the Mock Data automatically!
            console.log("Database empty. Uploading initial data...");
            initialMockData.forEach(item => {
                // Use the ID as the key
                set(ref(db, 'models/' + item.id), item);
            });
        } else {
            // Data exists! Convert object to array
            allFirebaseModels = Object.values(data);
            renderModelsPage(allFirebaseModels); // Render everything initially
        }
    });

    // 2. Search Bar Listener
    $('#model-search-bar').on('input', function() {
        const query = $(this).val().toLowerCase();
        
        // Filter the array locally (Fastest & most flexible method)
        const filteredModels = allFirebaseModels.filter(model => 
            model.name.toLowerCase().includes(query) || 
            model.desc.toLowerCase().includes(query)
        );
        
        renderModelsPage(filteredModels);
    });
    // STOP THE CLICK HERE so it doesn't bubble up to the card
    e.stopPropagation(); 

    const id = $(this).data('id'); 
    let model = modelsData.find(m => m.id == id);

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

// YENİ: Yazı Rengi (Yuvarlak Butonlar) Dinleyicisi
    $('.text-color-option').click(function() { 
        // 1. Görsel Seçimi Güncelle
        $('.text-color-option').removeClass('selected'); 
        $(this).addClass('selected');
        
        // 2. Rengi Al ve Uygula
        const hexColor = $(this).data('hex'); 
        
        if (textMesh && textMesh.material) {
            textMesh.material.color.set(hexColor);
        }
        
        // 3. Config'e Kaydet
        if (activeModelConfig && activeModelConfig.text) {
            activeModelConfig.text.color = hexColor;
        }
    });
// NEW: Real-time Text Listener

    $('#custom-text-input').on('input', function() {
        const text = $(this).val();
        updateCustomText(text);
    });

    // YENİ: Yazı Rengi Değiştiğinde Tetiklenir
    $('#custom-text-color').on('input', function() {
        const color = $(this).val();
        if (textMesh && textMesh.material) {
            // Sadece materyalin rengini değiştir (Yeniden mesh yaratmaya gerek yok, performans artar)
            textMesh.material.color.set(color);
        }
        // Config'i güncelle ki yazı içeriği değişirse renk unutulmasın
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

    // --- NEW: MODAL LOGIC ---
    let currentModalStl = "";
    let currentModalName = "";
	let currentModalId = null; // YENİ: ID'yi tutmak için

    // Open Modal when Model Card clicked
$(document).on('click', '.model-card', function() {
        const id = $(this).data('id');
        const model = modelsData.find(m => m.id === id);
        
        if(model) {
            $('#modal-img').attr('src', model.img);
            $('#modal-title').text(model.name);
            $('#modal-desc').text(model.desc);
            $('#modal-price').text('₺' + model.price.toFixed(2));
            
            currentModalStl = model.stl;
            currentModalName = model.name;
            currentModalId = model.id; // YENİ: ID'yi hafızaya atıyoruz

            $('#model-modal').addClass('open');
        }
    });

    // Close Modal
    $('.modal-close, .modal-overlay').click(function(e) {
        if (e.target === this) {
            $('#model-modal').removeClass('open');
        }
    });

	// "Show in Studio" Button in Modal
	$('#modal-show-studio-btn').click(function() {
		$('#model-modal').removeClass('open');
		
		// CHANGED: Look in 'allFirebaseModels' instead of 'modelsData'
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

function renderModelsPage(modelsList) {
    // --- FIX: SAFETY CHECK ---
    // If modelsList is undefined or null, use an empty array []
    if (!modelsList) {
        modelsList = [];
    }
    // -------------------------

    const $grid = $('#models-grid-container');
    $grid.empty();
    
    if (modelsList.length === 0) {
        // Only show "No models found" if we actually have a search active or data loaded
        // You might want to hide this message if it's just the initial empty load
        if (allFirebaseModels && allFirebaseModels.length > 0) {
             $grid.html('<p style="grid-column: 1/-1; text-align: center; color: #94A3B8;">No models found matching your search.</p>');
        }
        return;
    }

    modelsList.forEach(model => {
        $grid.append(`
            <div class="model-card" data-id="${model.id}">
                <div class="card-image"><img src="${model.img}" alt="${model.name}"/></div>
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
                            Customize
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
            Object.values(data).forEach(order => {
                $list.append(`
                    <div class="cart-item">
                        <div class="info">
                            <div style="font-weight:600">Order #${order.id}</div>
                            <div style="font-size:0.8rem">${order.date}</div>
                        </div>
                        <div style="font-weight:500">₺${order.total}</div>
                        <div style="color: green; font-size: 0.85rem; font-weight: 600;">${order.status}</div>
                    </div>
                `);
            });
        } else {
            $list.html('<p>No past orders found.</p>');
        }
    });
}

function openInStudio(model) {
    // --- INPUT TEMİZLEME ---
    $('#real-file-input').val('');

    switchPage('#upload-page');
    $('#file-name-display').text(model.name);
    
	currentLibraryModel = model; // Store the full model data to reference later
    activeModelConfig = model.customConfig || null;

    if (model.isCustomizable) {
        $('#custom-text-group').fadeIn(); 
        const initialText = activeModelConfig ? activeModelConfig.text.initialContent : "ENGRARE";
        $('#custom-text-input').val(initialText);
        
        // Rengi Beyaza Sıfırla
        $('.text-color-option').removeClass('selected');
        $('.text-color-option[data-hex="#FFFFFF"]').addClass('selected');
        
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
    
    // NEW ADDITION HERE
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
    
    // CHANGED:
    // 1. color: 0x999999 (Grey)
    // 2. side: THREE.FrontSide (Bottom becomes invisible/transparent)
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
        alert("Only .STL and .3MF files are supported.");
        return;
    }
    
    // --- FIX IS HERE ---
    currentLibraryModel = null; 
    activeModelConfig = null; // <--- ADD THIS LINE (This stops loadSTL from re-adding text)
    // -------------------

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

// CHANGED: Added 'isCustom' parameter to the function definition
function loadSTL(data) {
    const loader = new STLLoader();
    let geometry = null;
    let isFileValid = false;

    // 1. Dosya Okuma
    try {
        if (data) {
            geometry = loader.parse(data);
            if (geometry && geometry.attributes.position && geometry.attributes.position.count > 0) {
                geometry.computeBoundingBox();
                if (isFinite(geometry.boundingBox.min.x)) isFileValid = true;
            }
        }
    } catch (e) { console.warn("Veri okunamadı."); }

    // 2. Dosya Yoksa: Sanal Kutu Yarat
    if (!isFileValid) {
        console.log("Dosya yüklenemedi, Sanal Kutu kullanılıyor.");
        // Standart küp
        geometry = new THREE.BoxGeometry(20, 20, 20);
    }

    // 3. Geometriyi Merkezle
    geometry.center(); 
    
    // --- 4. ÖLÇEKLENDİRME (DÜZELTME BURADA) ---
    // Eğer gerçek dosya yüklendiyse (isFileValid: true), ASLA 'baseScale' uygulama!
    // 'baseScale' sadece dosya bulunamadığında yaratılan küpü plakaya çevirmek içindir.
    
    if (!isFileValid && activeModelConfig && activeModelConfig.baseScale) {
        const s = activeModelConfig.baseScale;
        geometry.scale(s.x, s.y, s.z);
    }
    // ------------------------------------------

    // 5. Materyal
    const initialColor = $('.color-option.selected').data('hex') || 0x333333;
    const material = new THREE.MeshPhongMaterial({ 
        color: initialColor, 
        specular: 0x111111, 
        shininess: 30 
    });

    // Sahne Temizliği
    if (mesh) scene.remove(mesh);
    scene.children.forEach(child => {
        if (child.type === "BoxHelper" || child.type === "AxesHelper") scene.remove(child);
    });
    if (typeof textMesh !== 'undefined' && textMesh) {
         scene.remove(textMesh);
         textMesh = null;
    }

    // 6. Mesh Oluştur
    mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    
    // Konumlandırma
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);

    // Zemine Oturtma
    if (activeModelConfig) {
        // Custom modeller (Sanal veya Gerçek) için rotasyon kontrolü
        if (!isFileValid) {
            // Eğer sanal plakaysa yatıktır, döndürme
            mesh.rotation.x = 0;
            mesh.position.y = size.y / 2;
        } else {
            // Eğer gerçek STL dosyasıysa (Writing Holder gibi), genelde dik gelir.
            // Burayı dosyanızın durumuna göre ayarlayabilirsiniz.
            // Genelde -90 derece çevirmek gerekir:
            mesh.rotation.x = -Math.PI / 2; 
            
            // Döndürünce Z boyutu yükseklik olur
            mesh.position.y = size.z / 2;
        }
    } else {
        // Standart modeller
        mesh.rotation.x = -Math.PI / 2; 
        mesh.position.y = size.z / 2;
    }

    if (!isFinite(mesh.position.y)) mesh.position.y = 0;

    scene.add(mesh);

    // 7. Yazı Ekleme
    // Not: Gerçek dosya yüklenince yazı konumu kayabilir, JSON'dan 'position' ayarını güncellemeniz gerekebilir.
    if (activeModelConfig) {
        try { updateCustomText(activeModelConfig.text.initialContent); } catch(e){}
    }

    // 8. Panel Bilgileri
    const finalBox = new THREE.Box3().setFromObject(mesh);
    const finalSize = new THREE.Vector3();
    finalBox.getSize(finalSize);

    $('#dim-x').text(finalSize.x.toFixed(1));
    $('#dim-y').text(finalSize.y.toFixed(1));
    $('#dim-z').text(finalSize.z.toFixed(1));
    $('.dimensions-box').fadeIn();

    // 9. Kamera Odaklama (Auto-Focus)
    const maxDim = Math.max(finalSize.x, finalSize.y, finalSize.z);
    
    // Kamerayı objenin boyutuna göre ayarla (1.5 kat mesafe idealdir)
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

function updateCustomText(message) {
    if (!mesh || !activeModelConfig) return;
    
    // Mesaj boşsa sil
    if (message === "") {
        if (textMesh) mesh.remove(textMesh);
        textMesh = null; // Referansı temizle
        return;
    }

    const cfg = activeModelConfig.text;
    
    // Rengi al
    const selectedDiv = $('.text-color-option.selected');
    const currentColor = selectedDiv.length > 0 ? selectedDiv.data('hex') : (cfg.color || "#FFFFFF");

    const loader = new FontLoader();
    loader.load(cfg.fontUrl, function (font) {
        
        // Eski yazıyı temizle
        if (textMesh) {
            mesh.remove(textMesh);
            if(textMesh.geometry) textMesh.geometry.dispose();
        }

        const textGeo = new TextGeometry(message, {
            font: font,
            size: cfg.fontSize,           // Config'den geliyor
            height: cfg.fontThickness,    // Config'den geliyor
            curveSegments: 12,
            bevelEnabled: false
        });

        // Yazıyı kendi merkezine al (Ortalamak için şart)
        textGeo.center();

        const textMat = new THREE.MeshPhongMaterial({ color: currentColor });
        textMesh = new THREE.Mesh(textGeo, textMat);

        // --- AKILLI KONUMLANDIRMA ---
        // 1. Ana modelin (plakanın) sınırlarını ölç
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        
        // 2. En üst yüzeyi bul (box.max.y)
        // Eğer mesh döndürülmüşse (rotation.x = -90 gibi), dünya koordinatlarını kullanmalıyız.
        // Ancak bu senaryoda mesh'in içine child olarak eklediğimiz için local koordinat yeterli.
        
        // Yükseklik = (Modelin Tavanı) + (Config'deki Ekstra Pay)
        // Not: BoxGeometry merkezde olduğu için max.y modelin yarısıdır. 
        // Eğer scale işlemi loadSTL'de yapıldıysa geometry sınırları günceldir.
        
        let targetY = box.max.y + (cfg.offsetY || 0);

        // 3. Yazıyı Konumlandır
        // X: Merkez + Kaydırma
        // Y: Hesaplanan Tavan
        // Z: Merkez + Kaydırma
        textMesh.position.set(
            0 + (cfg.shiftX || 0), 
            targetY, 
            0 + (cfg.shiftZ || 0)
        );

        // Yazıyı yatır (Çünkü plaka yatık, yazı da ona paralel olmalı)
        textMesh.rotation.x = -Math.PI / 2; 

        mesh.add(textMesh);
    });
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
    
    // REMOVED: Login check and Firebase Upload
    
    $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Adding...');

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
        // If it is a user upload (currentLibraryModel is null), we do NOT save the configuration or ID.
        const cartItem = { 
            name: name, 
            price: numericPrice, 
            mode: mode, 
            formattedPrice: priceText,
            date: new Date().toLocaleString(),
            isLibrary: !!currentLibraryModel, // Flag for the save function
            // Only attach config and ID if it's a library model we want to restore later
            libraryId: currentLibraryModel ? currentLibraryModel.id : null,
            configuration: currentLibraryModel ? currentConfig : null
        };
        
        // 3. Add to Memory State
        cart.push(cartItem);
        
        saveCart(); 
        renderCart();
        
        $btn.text('Added!').css('background-color', '#10B981');
        setTimeout(() => {
            $btn.prop('disabled', false).text('Add to Cart').css('background-color', '');
        }, 1500);

    } catch (error) {
        console.error("Cart Error:", error);
        $btn.prop('disabled', false).text('Add to Cart');
    }
}

function saveCart() {
    // 1. Filter: Create a new list that ONLY contains Library models
    // We do NOT modify the main 'cart' variable, because we still want 
    // the user to see their uploaded item while they are on the page.
    const itemsToSave = cart.filter(item => item.isLibrary === true);

    // 2. Save only the filtered list to LocalStorage
    localStorage.setItem('engrare_cart', JSON.stringify(itemsToSave));

    // 3. Update the badge count based on the current session cart (shows everything)
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
        $area.html('<div style="text-align:center; padding:20px; color:#999">Cart is empty.</div>');
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