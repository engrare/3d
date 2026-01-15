import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// --- STATE ---
let scene, camera, renderer, mesh, controls;
let cart = [];
const BASE_PRICE = 0.50;

// --- DOM READY ---
$(document).ready(function() {
    
    // Initialize 3D immediately but hidden, so it's ready when tab opens
    init3D();

    // NAVIGATION
    $('.nav-menu li, .nav-trigger').click(function() {
        const target = $(this).data('target');
        
        // UI Updates
        $('.nav-menu li').removeClass('active');
        $(`.nav-menu li[data-target="${target}"]`).addClass('active');
        
        $('.page').removeClass('active');
        $(target).addClass('active');

        // Check checkout
        if (target === '#checkout-page') renderCart();
    });

    // UPLOAD BUTTONS
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
    
    // 1. Setup Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8f9fa); 
    
    const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 100, 50);
    scene.add(dirLight);

    // 2. Setup Camera (Aspect ratio 1 temporarily)
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 50, 100);

    // 3. Setup Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    // Don't set size here, let ResizeObserver handle it
    renderer.setPixelRatio(window.devicePixelRatio);
    
    container.innerHTML = ''; 
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // 4. ANIMATION LOOP
    function animate() {
        requestAnimationFrame(animate);
        if(controls) controls.update();
        renderer.render(scene, camera);
    }
    animate();

    // 5. RESIZE OBSERVER (THE FIX)
    // This watches the container. When it appears or resizes, it updates Three.js automatically.
    const resizeObserver = new ResizeObserver(() => {
        updateDimensions();
    });
    resizeObserver.observe(container);
}

function updateDimensions() {
    const container = document.getElementById('3d-viewer');
    if (!container || !renderer || !camera) return;

    // Get the computed size of the container
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (width === 0 || height === 0) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false); // false prevents resizing the canvas style, only internal buffer
}

function loadSTL(data) {
    const loader = new STLLoader();
    try {
        const geometry = loader.parse(data);
        const material = new THREE.MeshPhongMaterial({ 
            color: 0x2563eb, 
            specular: 0x111111, 
            shininess: 200 
        });

        if (mesh) scene.remove(mesh);
        mesh = new THREE.Mesh(geometry, material);

        geometry.computeBoundingBox();
        geometry.center();
        
        // Auto-fit camera
        const box = geometry.boundingBox;
        const maxDim = Math.max(
            box.max.x - box.min.x,
            box.max.y - box.min.y,
            box.max.z - box.min.z
        );
        
        // Reset camera position based on object size
        camera.position.set(0, maxDim * 1.5, maxDim * 2.5);
        camera.lookAt(0,0,0);
        
        mesh.rotation.x = -Math.PI / 2;
        scene.add(mesh);

        // Calculate Volume
        const vol = getVolume(geometry) / 1000;
        $('#model-vol').data('raw', vol).text(vol.toFixed(2) + ' cm³');
        
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
