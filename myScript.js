import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail } from "firebase/auth";
import { getDatabase, ref, set, push, onValue } from "firebase/database";
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// --- STATE ---

// --- FIREBASE CONFIG ---
// TODO: Replace with your specific Firebase Project Config Keys
const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let scene, camera, renderer, mesh, controls;
let cart = [];
const BASE_PRICE_PER_CM3 = 15.00; 
const BUILD_VOLUME_X = 256;
const BUILD_VOLUME_Y = 256;

// --- MODEL DATABASE (Mock Data) ---
const modelsData = [
    {
        id: 1,
        name: "Calibration Cube",
        desc: "The gold standard for calibrating 3D printers. Measure dimensions to ensure X, Y, and Z accuracy.",
        price: 150,
        img: "./content/product1.jpeg",
        stl: "./assets/cube.stl"
    },
    {
        id: 2,
        name: "Modular Phone Stand",
        desc: "A sleek, adjustable stand for smartphones. Features a sturdy base and variable viewing angles.",
        price: 350,
        img: "./content/product2.jpeg",
        stl: "./assets/phone_stand.stl"
    },
    {
        id: 3,
        name: "Planetary Gear Set",
        desc: "A fully functional mechanical assembly demonstrating high-torque gear reduction concepts.",
        price: 600,
        img: "./content/product3.avif",
        stl: "./assets/gear.stl"
    },
    {
        id: 4,
        name: "Vase Mode Container",
        desc: "Designed for spiralize outer contour mode. Perfect for aesthetic storage solutions.",
        price: 200,
        img: "https://images.unsplash.com/photo-1628194451659-335d5a782485?auto=format&fit=crop&q=80&w=600",
        stl: "./assets/cube.stl" // Using placeholder stl
    },
    {
        id: 5,
        name: "Drone Frame Arms",
        desc: "Lightweight and rigid arms for quadcopter builds. Optimized for strength-to-weight ratio.",
        price: 450,
        img: "https://images.unsplash.com/photo-1527977966376-1c8408f9f108?auto=format&fit=crop&q=80&w=600",
        stl: "./assets/phone_stand.stl" // Using placeholder stl
    },
    {
        id: 6,
        name: "Headphone Holder",
        desc: "Desk-mountable holder to keep your workspace clean and organized.",
        price: 280,
        img: "https://images.unsplash.com/photo-1612815154858-60aa4c59eaa6?auto=format&fit=crop&q=80&w=600",
        stl: "./assets/gear.stl" // Using placeholder stl
    }
];

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
    $('.nav-menu li, .nav-trigger').click(function() {
        const target = $(this).data('target');
        switchPage(target);
    });

    // 2. Scroll to Library
    $('.scroll-trigger').click(function() {
        const target = $(this).data('scroll');
        $('html, body').animate({
            scrollTop: $(target).offset().top - 80 
        }, 800);
    });

    // 3. Library Selection (Home Page)
    $('.library-select-btn').click(function() {
        const stlPath = $(this).data('stl');
        const name = $(this).data('name');
        openInStudio(name, stlPath);
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
        openInStudio(currentModalName, currentModalStl);
    });
});

// --- HELPER FUNCTIONS ---

function renderModelsPage() {
    const $grid = $('#models-grid-container');
    $grid.empty();
    modelsData.forEach(model => {
        $grid.append(`
            <div class="model-card" data-id="${model.id}">
                <div class="card-image"><img src="${model.img}" alt="${model.name}"/></div>
                <div class="model-info">
                    <div class="model-title">${model.name}</div>
                    <div class="model-desc">${model.desc.substring(0, 60)}...</div>
                    <div class="card-meta">
                        <span class="price-tag">₺${model.price.toFixed(2)}</span>
                        <button class="btn-sm">View Details</button>
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

function openInStudio(name, stlPath) {
    switchPage('#upload-page');
    $('#file-name-display').text(name);
    loadLibrarySTL(stlPath);
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
    const material = new THREE.MeshPhongMaterial({ color: 0x222222, side: THREE.DoubleSide, shininess: 10 });
    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    scene.add(plane);

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
             alert("Demo Mode: Ensure assets exist locally or update paths.");
        });
}

function loadSTL(data) {
    const loader = new STLLoader();
    try {
        const geometry = loader.parse(data);
        const initialColor = $('.color-option.selected').data('hex') || 0x333333;
        const material = new THREE.MeshPhongMaterial({ 
            color: initialColor, 
            specular: 0x111111, 
            shininess: 30 
        });

        if (mesh) scene.remove(mesh);
        mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const size = new THREE.Vector3();
        box.getSize(size);
        geometry.center(); 
        
        mesh.position.y = size.y / 2;
        mesh.rotation.x = -Math.PI / 2;
        
        // Fix rotation floor gap
        mesh.rotation.set(0,0,0);
        mesh.rotation.x = -Math.PI / 2; 
        const bbox2 = new THREE.Box3().setFromObject(mesh);
        const bottomWorld = bbox2.min.y;
        mesh.position.y -= bottomWorld; 

        scene.add(mesh);

        $('#dim-x').text(size.x.toFixed(1));
        $('#dim-y').text(size.y.toFixed(1));
        $('#dim-z').text(size.z.toFixed(1));
        $('.dimensions-box').fadeIn();

        controls.enabled = true;
        const maxDim = Math.max(size.x, size.y, size.z);
        camera.position.set(maxDim * 2, maxDim * 2, maxDim * 2);
        camera.lookAt(0,0,0);

        const vol = getVolume(geometry) / 1000; // cm3
        
        if (isNaN(vol) || vol <= 0) {
            $('#model-vol').data('raw', 10); 
        } else {
            $('#model-vol').data('raw', vol);
        }
        
        calculatePrice();
        $('#add-to-cart').prop('disabled', false);

    } catch (e) {
        console.error(e);
        alert("Error parsing STL.");
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

function addToCart() {
    const $btn = $('#add-to-cart');
    $btn.prop('disabled', true).text('Added!');

    const priceText = $('#price-display').text();
    const numericPrice = parseFloat(priceText.replace('₺', '').replace(/\./g, '').replace(',', '.').trim());
    const name = $('#file-name-display').text();
    const mode = $('.tab-btn.active').text();
    
    cart.push({ name, price: numericPrice, mode, formattedPrice: priceText });
    saveCart(); 
    renderCart();
    
    setTimeout(() => {
        $btn.prop('disabled', false).text('Add to Cart');
    }, 1000);
}

function saveCart() {
    localStorage.setItem('engrare_cart', JSON.stringify(cart));
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