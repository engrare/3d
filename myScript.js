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
const BUILD_VOLUME_Z = 256;

// --- DOM READY ---
$(document).ready(function() {
    
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

    // 4. Upload Button
    $('#upload-btn').click(() => $('#real-file-input').click());
    $('#real-file-input').change(handleFileUpload);

    // 5. Mode Switcher (Fixed Selector)
    $('.tab-btn').click(function() {
        $('.tab-btn').removeClass('active');
        $(this).addClass('active');
        const mode = $(this).data('mode'); // 'basic' or 'advanced'
        $('.config-panel').hide();
        $(`#panel-${mode}`).fadeIn(200);
    });

    // 6. Color Selection (Fixed Logic & 3D Sync)
    $('.color-option').click(function() { 
        // UI Update
        $('.color-option').removeClass('selected'); 
        $(this).addClass('selected');
        
        // Text Update
        const colorName = $(this).data('color');
        const hexColor = $(this).data('hex'); // We need the HEX code for 3D
        $('#selected-color-name').text(colorName);

        // 3D Model Update
        if (mesh && mesh.material) {
            mesh.material.color.set(hexColor);
        }
    });

    // 7. Price Calculation
    $('#material-select, #infill-select, #quality-select, #quantity-input, input[name="delivery"]').on('input change', calculatePrice);
    
    // 8. Add to Cart (Fixed Double Click Issue)
    $('#add-to-cart').off('click').on('click', addToCart);

    // 9. FAQ Logic
    $('.faq-question').click(function() {
        const answer = $(this).next('.faq-answer');
        const toggle = $(this).find('.toggle');
        $('.faq-answer').not(answer).slideUp();
        $('.toggle').not(toggle).text('+');
        answer.slideToggle();
        setTimeout(() => { toggle.text(answer.is(':visible') ? '-' : '+'); }, 10);
    });

    // 10. Remove Cart Item
    $(document).on('click', '.remove-btn', function() {
        const index = $(this).data('index');
        cart.splice(index, 1);
        $('#cart-badge').text(cart.length);
        renderCart();
    });
});

function switchPage(targetId) {
    $('.nav-menu li').removeClass('active');
    $(`.nav-menu li[data-target="${targetId}"]`).addClass('active');
    $('.page').removeClass('active');
    $(targetId).addClass('active');
    
    if (targetId === '#upload-page') {
        setTimeout(updateDimensions, 100);
    }
    if (targetId === '#checkout-page') renderCart();
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
    camera.position.set(0, 200, 300); // High angle view

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    
    // FIX 4: Disable controls initially so user can scroll the page
    controls.enabled = false; 

    // FIX 6: Add Bambu Lab Style Bed
    createBed();

    animate();
    const resizeObserver = new ResizeObserver(() => updateDimensions());
    resizeObserver.observe(container);
}

function createBed() {
    // 1. Bed Base (Dark Grey)
    const geometry = new THREE.PlaneGeometry(BUILD_VOLUME_X, BUILD_VOLUME_Y);
    const material = new THREE.MeshPhongMaterial({ 
        color: 0x222222, 
        side: THREE.DoubleSide,
        shininess: 10
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.x = -Math.PI / 2;
    plane.receiveShadow = true;
    scene.add(plane);

    // 2. Grid Helper (256mm, 20mm divisions)
    // Size, Divisions, CenterLineColor, GridColor
    const gridHelper = new THREE.GridHelper(BUILD_VOLUME_X, 12, 0x444444, 0x555555);
    gridHelper.position.y = 0.1; // Slightly above plane to prevent z-fighting
    scene.add(gridHelper);

    // 3. Bed Label (Optional text)
    // For simplicity, we stick to the visual grid which is the standard indicator
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
    if (!file) return;
    $('#file-name-display').text(file.name);
    const reader = new FileReader();
    reader.onload = function(ev) { loadSTL(ev.target.result); };
    reader.readAsArrayBuffer(file);
}

function loadLibrarySTL(url) {
    fetch(url)
        .then(res => { if(!res.ok) throw new Error("Missing File"); return res.arrayBuffer(); })
        .then(data => loadSTL(data))
        .catch(err => alert("File not found in assets folder."));
}

function loadSTL(data) {
    const loader = new STLLoader();
    try {
        const geometry = loader.parse(data);
        
        // Default Color: Dark Grey/Black (like Carbon Fiber PLA)
        const initialColor = $('.color-option.selected').data('hex') || 0x333333;
        const material = new THREE.MeshPhongMaterial({ 
            color: initialColor, 
            specular: 0x111111, 
            shininess: 30 
        });

        if (mesh) scene.remove(mesh);
        mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        
        // Center and Position on Bed
        geometry.computeBoundingBox();
        const center = new THREE.Vector3();
        geometry.boundingBox.getCenter(center);
        geometry.center(); // Center geometry at 0,0,0
        
        // Move up so it sits ON the bed (y=0), not cutting through it
        const box = geometry.boundingBox;
        const height = box.max.y - box.min.y;
        mesh.position.y = height / 2;
        
        // Rotate -90 if it came in flat (common with STL)
        mesh.rotation.x = -Math.PI / 2; 

        scene.add(mesh);

        // FIX 5: Calculate and Show Dimensions
        const sizeX = (box.max.x - box.min.x).toFixed(1);
        const sizeY = (box.max.y - box.min.y).toFixed(1);
        const sizeZ = (box.max.z - box.min.z).toFixed(1);
        
        $('#dim-x').text(sizeX + ' mm');
        $('#dim-y').text(sizeY + ' mm');
        $('#dim-z').text(sizeZ + ' mm');
        $('.dimensions-box').fadeIn();

        // FIX 4: Enable Controls Now
        controls.enabled = true;

        // Auto Zoom
        const maxDim = Math.max(parseFloat(sizeX), parseFloat(sizeY), parseFloat(sizeZ));
        camera.position.set(maxDim * 2, maxDim * 2, maxDim * 2);
        camera.lookAt(0,0,0);

        // Price Calc
        const vol = getVolume(geometry) / 1000; 
        $('#model-vol').data('raw', vol);
        calculatePrice();
        $('#add-to-cart').prop('disabled', false);

    } catch (e) {
        console.error(e);
        alert("Error parsing STL.");
    }
}

function getVolume(geometry) {
    // Simple volume calc for triangle meshes
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
    return price.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
}

function calculatePrice() {
    const vol = $('#model-vol').data('raw');
    if(!vol) return;

    const materialFactor = parseFloat($('#material-select').val());
    const infillFactor = parseFloat($('#infill-select').val()) / 20; 
    const deliveryFactor = parseFloat($('input[name="delivery"]:checked').val());
    const quantity = parseInt($('#quantity-input').val()) || 1;

    let unitPrice = vol * BASE_PRICE_PER_CM3 * materialFactor * infillFactor;
    unitPrice = Math.max(100, unitPrice); // Minimum 100 TL
    
    let totalPrice = unitPrice * quantity * deliveryFactor;
    $('#price-display').text(formatTL(totalPrice));
}

function addToCart() {
    // Disable button to prevent double clicks
    const $btn = $('#add-to-cart');
    $btn.prop('disabled', true).text('Added!');

    const priceText = $('#price-display').text();
    const numericPrice = parseFloat(priceText.replace('₺', '').replace('.', '').replace(',', '.').trim());
    const name = $('#file-name-display').text();
    const mode = $('.tab-btn.active').text();
    
    cart.push({ name, price: numericPrice, mode, formattedPrice: priceText });
    $('#cart-badge').text(cart.length);
    
    // Re-enable after 1 second
    setTimeout(() => {
        $btn.prop('disabled', false).text('Add to Cart');
    }, 1000);
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