import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// Global variables for 3D
let scene, camera, renderer, mesh;
let cart = [];
const BASE_PRICE_PER_CM3 = 0.50; // $0.50 per cubic cm

$(document).ready(function() {
    
    // --- NAVIGATION LOGIC (jQuery) ---

    function switchPage(pageId) {
        $('.page-section').hide(); // Hide all sections
        $(pageId).fadeIn(); // Show target section
        
        // Update Active Nav Link
        $('.nav-links a').removeClass('active');
        if(pageId === '#home-page') $('#nav-home').addClass('active');
        if(pageId === '#upload-page') $('#nav-upload').addClass('active');
        if(pageId === '#checkout-page') $('#nav-checkout').addClass('active');

        // Resize 3D canvas if opening upload page
        if(pageId === '#upload-page' && renderer) {
            onWindowResize();
        }
    }

    $('#nav-home').click(() => switchPage('#home-page'));
    $('#nav-upload, #cta-upload').click(() => {
        switchPage('#upload-page');
        if(!renderer) init3D(); // Initialize 3D only when needed
    });
    $('#nav-checkout').click(() => {
        updateCheckoutPage();
        switchPage('#checkout-page');
    });

    // --- UPLOAD & PRICING LOGIC ---

    // File Input Change Listener
    $('#file-input').on('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        // Use FileReader to read the file
        const reader = new FileReader();
        reader.onload = function(event) {
            const data = event.target.result;
            loadSTL(data);
        };
        
        // Read as ArrayBuffer for Three.js Loader
        reader.readAsArrayBuffer(file);
    });

    // Material Change Listener
    $('#material-select').on('change', calculatePrice);

    // Add to Cart Logic
    $('#add-to-cart-btn').click(function() {
        const price = parseFloat($('#calculated-price').text().replace('$', ''));
        const fileName = $('#file-input').val().split('\\').pop();
        
        cart.push({ name: fileName, price: price });
        
        // Update Cart Count
        $('#cart-count').text(`(${cart.length})`);
        
        alert("Item added to checkout!");
        $('#file-input').val(''); // Clear input
        if(mesh) {
            scene.remove(mesh); // Clear viewer
            mesh = null;
        }
        $('#add-to-cart-btn').prop('disabled', true);
        $('#calculated-price').text("$0.00");
    });

    // --- 3D VIEWER FUNCTIONS (Three.js) ---

    function init3D() {
        const container = document.getElementById('3d-viewer');
        
        // 1. Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xe0e0e0);

        // 2. Camera
        camera = new THREE.PerspectiveCamera(45, container.offsetWidth / container.offsetHeight, 0.1, 1000);
        camera.position.set(0, 100, 150);

        // 3. Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(container.offsetWidth, container.offsetHeight);
        container.appendChild(renderer.domElement);

        // 4. Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(50, 50, 50);
        scene.add(dirLight);

        // 5. Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        // Animation Loop
        function animate() {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        animate();

        // Handle resize
        window.addEventListener('resize', onWindowResize);
    }

    function loadSTL(data) {
        const loader = new STLLoader();
        const geometry = loader.parse(data); // Parse ArrayBuffer

        // Setup Material
        const material = new THREE.MeshPhongMaterial({ 
            color: 0x3498db, 
            specular: 0x111111, 
            shininess: 200 
        });

        // Remove old mesh if exists
        if (mesh) scene.remove(mesh);

        mesh = new THREE.Mesh(geometry, material);
        
        // Center the geometry
        geometry.computeBoundingBox();
        geometry.center();

        // Fit camera to object (Simplification)
        mesh.rotation.x = -Math.PI / 2; // STL usually needs rotation
        scene.add(mesh);

        // Calculate Volume for Price
        const volume = getVolume(geometry);
        const volumeCm3 = volume / 1000; // Assuming input is mm, convert to cm3
        
        // Store volume in data attribute for recalculation
        $('#model-vol').data('vol', volumeCm3);
        $('#model-vol').text(volumeCm3.toFixed(2) + " cm³");

        calculatePrice();
        $('#add-to-cart-btn').prop('disabled', false);
    }

    function getVolume(geometry) {
        // Simple volume calculation for triangle mesh (Signed volume)
        // Note: Geometry must be non-indexed for this simple loop or handled differently
        if(geometry.index) geometry = geometry.toNonIndexed();
        
        let position = geometry.attributes.position;
        let volume = 0;
        let p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), p3 = new THREE.Vector3();

        for (let i = 0; i < position.count; i += 3) {
            p1.fromBufferAttribute(position, i);
            p2.fromBufferAttribute(position, i + 1);
            p3.fromBufferAttribute(position, i + 2);
            volume += p1.dot(p2.cross(p3)) / 6.0;
        }
        return Math.abs(volume);
    }

    function calculatePrice() {
        const vol = $('#model-vol').data('vol');
        if(!vol) return;

        const materialFactor = parseFloat($('#material-select').val());
        const finalPrice = vol * BASE_PRICE_PER_CM3 * materialFactor;

        // Minimum price $5
        const displayPrice = finalPrice < 5 ? 5.00 : finalPrice;
        
        $('#calculated-price').text("$" + displayPrice.toFixed(2));
    }

    function onWindowResize() {
        if (!camera || !renderer) return;
        const container = document.getElementById('3d-viewer');
        camera.aspect = container.offsetWidth / container.offsetHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.offsetWidth, container.offsetHeight);
    }

    // --- CHECKOUT LOGIC ---

    function updateCheckoutPage() {
        const $list = $('#cart-list');
        $list.empty();

        let subtotal = 0;

        if (cart.length === 0) {
            $list.html('<p class="empty-msg">Your cart is empty.</p>');
        } else {
            cart.forEach((item, index) => {
                subtotal += item.price;
                $list.append(`
                    <div class="cart-item">
                        <span>${item.name}</span>
                        <span>$${item.price.toFixed(2)}</span>
                    </div>
                `);
            });
        }

        $('#cart-subtotal').text("$" + subtotal.toFixed(2));
        const total = subtotal + 5.00; // + Shipping
        $('#cart-total').text("$" + total.toFixed(2));
    }
});
