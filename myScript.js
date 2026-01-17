import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// --- STATE ---
let scene, camera, renderer, mesh, controls;
let cart = [];
const BASE_PRICE_PER_CM3 = 15.00; 

// Bambu Lab Build Volume (256x256x256)
const BUILD_VOLUME_X = 256;
const BUILD_VOLUME_Y = 256;

// --- DOM READY ---
$(document).ready(function() {
    
    // Change 5: Restore Cart from LocalStorage
    loadCart();

    init3D(); 

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

    // 3. Library Selection
    $('.library-select-btn').click(function() {
        const stlPath = $(this).data('stl');
        const name = $(this).data('name');
        switchPage('#upload-page');
        $('#file-name-display').text(name);
        loadLibrarySTL(stlPath);
    });

    // Change 3: Quick Start Templates in Studio
    $('.template-btn').click(function() {
        const stlPath = $(this).data('stl');
        const name = $(this).data('name');
        $('#file-name-display').text(name);
        loadLibrarySTL(stlPath);
    });

    // 4. Upload Button
    $('#upload-btn').click(() => $('#real-file-input').click());
    $('#real-file-input').change(handleFileUpload);

    // Change 2: Fix Drag and Drop (Counter Method)
    const dropZone = document.querySelector('.viewer-container');
    const overlay = document.getElementById('drop-zone-overlay');
    let dragCounter = 0;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    dropZone.addEventListener('dragenter', (e) => {
        dragCounter++;
        overlay.style.display = 'flex';
    }, false);

    dropZone.addEventListener('dragleave', (e) => {
        dragCounter--;
        if (dragCounter === 0) {
            overlay.style.display = 'none';
        }
    }, false);

    dropZone.addEventListener('drop', (e) => {
        dragCounter = 0;
        overlay.style.display = 'none';
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) handleFile(files[0]);
    }, false);


    // 5. Mode Switcher
    $('.tab-btn').click(function() {
        $('.tab-btn').removeClass('active');
        $(this).addClass('active');
        const mode = $(this).data('mode'); 
        $('.config-panel').hide();
        $(`#panel-${mode}`).fadeIn(200);
    });

    // 6. Color Selection
    $('.color-option').click(function() { 
        $('.color-option').removeClass('selected'); 
        $(this).addClass('selected');
        
        const colorName = $(this).data('color');
        const hexColor = $(this).data('hex'); 
        $('#selected-color-name').text(colorName);

        if (mesh && mesh.material) {
            mesh.material.color.set(hexColor);
        }
    });

    // 7. Price Calculation & Sync
    $('#material-select, #infill-select, #quantity-input, input[name="delivery"]').on('input change', function() {
        calculatePrice();
        syncBasicToPro(); // Change 4: Sync
    });

    // Change 4: Pro Mode Sync listeners
    $('#pro-infill, #pro-layer-height').on('input change', function() {
        syncProToBasic();
        calculatePrice(); // Recalculate based on current form inputs
    });
    
    // 8. Add to Cart
    $('#add-to-cart').off('click').on('click', addToCart);

    // 10. Remove Cart Item
    $(document).on('click', '.remove-btn', function() {
        const index = $(this).data('index');
        cart.splice(index, 1);
        saveCart(); // Change 5: Save
        renderCart();
    });
});

// Change 4: Synchronization Logic
function syncBasicToPro() {
    // Basic Infill -> Pro Infill
    const basicInfill = $('#infill-select').val();
    $('#pro-infill').val(basicInfill);
}

function syncProToBasic() {
    // Pro Infill -> Basic Infill
    const proInfill = $('#pro-infill').val();
    // Try to match dropdown, if not exact, it remains as is conceptually or we could add a "Custom" option
    // For now, if user sets 20 manually, the dropdown stays at what it was unless it matches exactly
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
    
    // Lighting
    const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 150, 100);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Camera
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(200, 200, 200); 

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    
    container.appendChild(renderer.domElement);

    // Controls
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
             alert("Demo Mode: Ensure assets exist locally. Check console.");
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
    
    // Change 4: Use value from Pro Input (which is synced with Basic)
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
    saveCart(); // Change 5
    renderCart();
    
    setTimeout(() => {
        $btn.prop('disabled', false).text('Add to Cart');
    }, 1000);
}

// Change 5: LocalStorage Persistence
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