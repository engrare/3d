import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

// Global Vars
let scene, camera, renderer, mesh;
let cart = [];
const BASE_PRICE_PER_CM3 = 0.50; 

$(document).ready(function() {
    
    // --- UI INTERACTIONS ---

    // Page Switching with Fade Effect
    function switchPage(pageId) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        $('.page-section').hide().removeClass('fade-in');
        
        $(pageId).show().addClass('fade-in');
        
        $('.nav-links a').removeClass('active');
        if(pageId === '#home-page') $('#nav-home').addClass('active');
        if(pageId === '#upload-page') $('#nav-upload').addClass('active');
        if(pageId === '#checkout-page') $('#nav-checkout').addClass('active');

        if(pageId === '#upload-page' && !renderer) {
            // Delay init slightly to ensure container has dimensions
            setTimeout(init3D, 50); 
        } else if (pageId === '#upload-page' && renderer) {
            onWindowResize();
        }
    }

    // Nav Clicks
    $('#nav-home').click(() => switchPage('#home-page'));
    $('#nav-upload, #cta-upload').click(() => switchPage('#upload-page'));
    $('#nav-checkout').click(() => {
        updateCheckoutUI();
        switchPage('#checkout-page');
    });

    // Custom File Button Trigger
    $('#upload-trigger').click(() => $('#file-input').click());

    // File Input Change
    $('#file-input').on('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // Show loading state (simple text update)
        $('#upload-trigger').text('Processing...');

        const reader = new FileReader();
        reader.onload = function(event) {
            loadSTL(event.target.result);
            $('#upload-trigger').text('Change File');
        };
        reader.readAsArrayBuffer(file);
    });

    $('#material-select').on('change', calculatePrice);

    $('#add-to-cart-btn').click(function() {
        const price = parseFloat($('#calculated-price').text().replace('$', ''));
        const fileName = $('#file-input').val().split('\\').pop() || "Custom Model";
        
        cart.push({ name: fileName, price: price });
        $('#cart-pill').text(cart.length); // Update pill in nav
        
        // Visual feedback
        const originalText = $(this).text();
        $(this).text("Added!").css('background', '#28cd41');
        setTimeout(() => {
            $(this).text(originalText).css('background', '');
            $('#add-to-cart-btn').prop('disabled', true);
            
            // Clear viewer
            if(mesh) { scene.remove(mesh); mesh = null; }
            $('#calculated-price').text("$0.00");
            $('#model-vol').text("--");
        }, 1500);
    });

    // --- THREE.JS STUDIO SETUP ---

    function init3D() {
        const container = document.getElementById('3d-viewer');
        const width = container.offsetWidth;
        const height = container.offsetHeight;
        
        // 1. Scene - Light Gray studio background to match UI
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf5f5f7); 
        // Add subtle fog for depth
        scene.fog = new THREE.Fog(0xf5f5f7, 200, 1000);

        // 2. Camera
        camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
        camera.position.set(100, 100, 100);

        // 3. Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true; // Enable shadows
        container.appendChild(renderer.domElement);

        // 4. Lighting (Studio Setup)
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
        scene.add(hemiLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1);
        dirLight.position.set(50, 100, 50);
        dirLight.castShadow = true;
        scene.add(dirLight);

        // Grid helper for floor
        const grid = new THREE.GridHelper(500, 50, 0x000000, 0x000000);
        grid.material.opacity = 0.1;
        grid.material.transparent = true;
        scene.add(grid);

        // 5. Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.autoRotate = true; // Auto rotate slightly makes it look elegant
        controls.autoRotateSpeed = 2.0;

        function animate() {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        animate();

        window.addEventListener('resize', onWindowResize);
    }

function loadSTL(data) {
        const loader = new STLLoader();
        
        try {
            const geometry = loader.parse(data);
            
            // Create a "Premium" looking material
            const material = new THREE.MeshPhysicalMaterial({ 
                color: 0xffffff, 
                metalness: 0.1,
                roughness: 0.2,
                clearcoat: 1.0,
                clearcoatRoughness: 0.1
            });

            if (mesh) scene.remove(mesh);

            mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;

            // Center geometry
            geometry.computeBoundingBox();
            geometry.center();
            
            // Rotate: Most STLs are Z-up, Three.js is Y-up
            mesh.rotation.x = -Math.PI / 2; 

            scene.add(mesh);

            // Calculation
            const volume = getVolume(geometry);
            const volumeCm3 = volume / 1000; 
            
            $('#model-vol').data('vol', volumeCm3);
            $('#model-vol').text(volumeCm3.toFixed(2) + " cm³");

            calculatePrice();
            $('#add-to-cart-btn').prop('disabled', false);
            
            // Reset button text
            $('#upload-trigger').text('Change File');

        } catch (error) {
            console.error(error);
            alert("Error loading file: It might be corrupted or an unsupported ASCII format. Please try a standard Binary STL.");
            $('#upload-trigger').text('Try Again');
        }
    }

    function getVolume(geometry) {
        // ... (Same volume logic as before) ...
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
        const finalPrice = Math.max(5.00, vol * BASE_PRICE_PER_CM3 * materialFactor);
        
        // Animation for price change
        $({countNum: 0}).animate({countNum: finalPrice}, {
            duration: 500,
            easing:'linear',
            step: function() {
                $('#calculated-price').text("$" + this.countNum.toFixed(2));
            },
            complete: function() {
                $('#calculated-price').text("$" + this.countNum.toFixed(2));
            }
        });
    }

    function onWindowResize() {
        if (!camera || !renderer) return;
        const container = document.getElementById('3d-viewer');
        // Check if container is visible
        if(container.offsetWidth === 0) return;
        
        camera.aspect = container.offsetWidth / container.offsetHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.offsetWidth, container.offsetHeight);
    }

    // --- CHECKOUT UI ---

    function updateCheckoutUI() {
        const $list = $('#cart-list');
        $list.empty();
        let subtotal = 0;

        if (cart.length === 0) {
            $list.html('<div style="padding:40px; text-align:center; color:#86868b">Your bag is empty.</div>');
        } else {
            cart.forEach((item) => {
                subtotal += item.price;
                $list.append(`
                    <div class="cart-item">
                        <div style="font-weight:500">${item.name}</div>
                        <div>$${item.price.toFixed(2)}</div>
                    </div>
                `);
            });
        }

        $('#cart-subtotal').text("$" + subtotal.toFixed(2));
        $('#cart-total').text("$" + (subtotal + 5.00).toFixed(2));
    }
});
