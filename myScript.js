import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// --- STATE ---
let scene, camera, renderer, mesh, controls;
let cart = [];
const BASE_PRICE = 0.50;

// --- DOM READY ---
$(document).ready(function() {
    
    // NAVIGATION
    $('.nav-menu li, .nav-trigger').click(function() {
        const target = $(this).data('target');
        
        // 1. Update UI Tabs
        $('.nav-menu li').removeClass('active');
        $(`.nav-menu li[data-target="${target}"]`).addClass('active');
        
        // 2. Switch Pages
        $('.page').removeClass('active');
        $(target).addClass('active');

        // 3. CRITICAL FIX: Handle 3D Viewer Resize
        if (target === '#upload-page') {
            // We wait 10ms to ensure the CSS 'display: block' has applied
            setTimeout(() => {
                if (!renderer) {
                    init3D();
                } else {
                    onWindowResize(); // Force resize now that div is visible
                }
            }, 10);
        }
        
        if (target === '#checkout-page') renderCart();
    });

    // UPLOAD LOGIC
    $('#upload-btn').click(() => $('#real-file-input').click());
    
    $('#real-file-input').change(function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        $('#file-name-display').text(file.name);
        
        const reader = new FileReader();
        reader.onload = function(ev) {
            loadSTL(ev.target.result);
        };
        reader.readAsArrayBuffer(file);
    });

    $('#material-select').change(calculatePrice);

    $('#add-to-cart').click(addToCart);
});

// --- THREE.JS LOGIC ---
function init3D() {
    const container = document.getElementById('3d-viewer');
    
    // Get actual dimensions
    const width = container.clientWidth;
    const height = container.clientHeight;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8f9fa); // Matches --bg-alt
    
    // Lighting
    const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 100, 50);
    scene.add(dirLight);

    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 50, 100);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    
    // Append canvas
    container.innerHTML = ''; // Clear existing if any
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    animate();
    window.addEventListener('resize', onWindowResize);
}

function animate() {
    requestAnimationFrame(animate);
    if(controls) controls.update();
    if(renderer && scene && camera) renderer.render(scene, camera);
}

function onWindowResize() {
    const container = document.getElementById('3d-viewer');
    if (!container || !camera || !renderer) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Only resize if container has size
    if (width > 0 && height > 0) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
    }
}

function loadSTL(data) {
    const loader = new STLLoader();
    try {
        const geometry = loader.parse(data);
        const material = new THREE.MeshPhongMaterial({ 
            color: 0x2563eb, // Tech Blue
            specular: 0x111111,
            shininess: 200 
        });

        if (mesh) scene.remove(mesh);
        mesh = new THREE.Mesh(geometry, material);

        geometry.computeBoundingBox();
        geometry.center();
        
        // Fit camera to object
        const box = geometry.boundingBox;
        const maxDim = Math.max(
            box.max.x - box.min.x,
            box.max.y - box.min.y,
            box.max.z - box.min.z
        );
        camera.position.set(0, maxDim * 1.5, maxDim * 2.5);
        mesh.rotation.x = -Math.PI / 2;
        
        scene.add(mesh);

        // Stats
        const vol = getVolume(geometry) / 1000; // cm3
        $('#model-vol').data('raw', vol).text(vol.toFixed(2) + ' cm³');
        
        // Dimensions
        const sizeX = (box.max.x - box.min.x).toFixed(1);
        const sizeY = (box.max.y - box.min.y).toFixed(1);
        const sizeZ = (box.max.z - box.min.z).toFixed(1);
        $('#model-dims').text(`${sizeX} x ${sizeY} x ${sizeZ} mm`);

        calculatePrice();
        $('#add-to-cart').prop('disabled', false);

    } catch (e) {
        console.error(e);
        alert("Error: Please use a standard Binary STL file.");
    }
}

function getVolume(geometry) {
    // Simple signed volume
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

function calculatePrice() {
    const vol = $('#model-vol').data('raw');
    if(!vol) return;
    const multiplier = parseFloat($('#material-select').val());
    const price = Math.max(5, vol * BASE_PRICE * multiplier);
    
    $('#price-display').text('$' + price.toFixed(2));
}

function addToCart() {
    const priceText = $('#price-display').text();
    const price = parseFloat(priceText.replace('$', ''));
    const name = $('#file-name-display').text();
    
    cart.push({ name, price });
    $('#cart-badge').text(cart.length);
    alert('Added to Cart');
    
    // Reset
    if(mesh) { scene.remove(mesh); mesh=null; }
    $('#price-display').text('$0.00');
    $('#add-to-cart').prop('disabled', true);
    $('#file-name-display').text('No file selected');
}

function renderCart() {
    const $area = $('#cart-items-area');
    $area.empty();
    
    if(cart.length === 0) {
        $area.html('<div class="empty-state">Your cart is currently empty.</div>');
        $('#val-subtotal').text('$0.00');
        $('#val-total').text('$5.00');
        return;
    }

    let sub = 0;
    cart.forEach(item => {
        sub += item.price;
        $area.append(`
            <div class="cart-item">
                <span style="font-weight:500">${item.name}</span>
                <span>$${item.price.toFixed(2)}</span>
            </div>
        `);
    });

    $('#val-subtotal').text('$' + sub.toFixed(2));
    $('#val-total').text('$' + (sub + 5.00).toFixed(2));
}
