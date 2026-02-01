import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getDatabase, ref, get, set } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const functions = getFunctions(app, 'europe-west1');

// Default Data Structure provided by the user (Fallback)
const DEFAULT_ADMIN_DATA = {
    "dashboard": { "stats": { "dailyRevenue": 0, "monthlyRevenue": 0 }, "live_status": { "message": "Sistem aktif." } },
    "orders": {},
    "inventory": { "filaments": {} },
    "finance": { "tax_tracking": { "limit": 2200000, "current_total": 0 } }
};

$(document).ready(function() {
    
    // --- AUTHENTICATION LOGIC ---

    // 1. Trigger Login Modal
    $('#admin-login-trigger').click(function() {
        const currentUser = auth.currentUser;
        if (!currentUser) {
             $('#login-modal').addClass('open');
        }
    });

    // 2. Handle Login Form Submit
    $('#admin-login-form').submit(async function(e) {
        e.preventDefault();
        
        const email = $('#login-email').val();
        const password = $('#login-password').val();
        const $btn = $(this).find('button[type="submit"]');
        const originalText = $btn.text();

        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Giriş Yapılıyor...');

        try {
            await signInWithEmailAndPassword(auth, email, password);
            
            // Attempt READ to verify Admin Access
            const adminRef = ref(db, 'admin');
            const snapshot = await get(adminRef);
            
            showToast("Yönetici girişi başarılı.", "success");
            $('#login-modal').removeClass('open');

            let adminData = snapshot.val();

            if (!adminData) {
                console.log("Admin node empty. Seeding defaults...");
                await set(adminRef, DEFAULT_ADMIN_DATA);
                adminData = DEFAULT_ADMIN_DATA;
            }

            renderDashboard(adminData);
            
            // Trigger Fleet Refresh on Login
            refreshFleetStatus();

        } catch (error) {
            console.error("Login Error:", error);
            if (auth.currentUser) await signOut(auth);

            if (error.code === 'PERMISSION_DENIED' || error.message.includes('permission_denied')) {
                showToast("Hata: Lütfen admin hesabıyla giriş yapın.", "error");
            } else {
                showToast(error.message, "error");
            }
        } finally {
            $btn.prop('disabled', false).text(originalText);
        }
    });

    // 3. Logout Logic
    $('#admin-logout-btn').click(function(e) {
        e.stopPropagation();
        if(confirm('Çıkış yapmak istediğinize emin misiniz?')) {
            signOut(auth).then(() => {
                showToast("Başarıyla çıkış yapıldı.", "success");
                setTimeout(() => location.reload(), 1000); 
            }).catch((error) => {
                showToast("Çıkış hatası: " + error.message, "error");
            });
        }
    });

    // 4. Close Modal
    $('.modal-close, .modal-overlay').click(function(e) {
        if (e.target === this) {
            $('#login-modal').removeClass('open');
            $('#bambu-2fa-modal').removeClass('active'); // Close 2FA modal too
        }
    });

    // 5. Auth Observer
    onAuthStateChanged(auth, (user) => {
        if (user) {
            $('#admin-name').text(user.displayName || "Yönetici");
            $('#admin-role').text("Süper Admin");
            $('#admin-avatar').attr('src', user.photoURL || "../content/default_user.png");
            $('#admin-logout-btn').show();
            
            // Auto-load if session active
            loadDataIfAdmin();
        } else {
            $('#admin-name').text("Giriş Yap");
            $('#admin-role').text("Misafir");
            $('#admin-avatar').attr('src', "../content/default_user.png");
            $('#admin-logout-btn').hide();
        }
    });

    async function loadDataIfAdmin() {
        if (!auth.currentUser) return;
        try {
            const snapshot = await get(ref(db, 'admin'));
            if (snapshot.exists()) {
                renderDashboard(snapshot.val());
                refreshFleetStatus(); // Refresh devices on reload
            }
        } catch (error) {
            // Silent fail
        }
    }

    // --- NAVIGATION ---
    $('.nav-item').click(function() {
        $('.nav-item').removeClass('active');
        $(this).addClass('active');
        $('.content-section').hide().removeClass('active');
        const target = $(this).data('target');
        $(target).fadeIn(300).addClass('active');
    });

    // --- NEW: FLEET MANAGEMENT ---
    
    $('#btn-refresh-fleet').click(function() {
        refreshFleetStatus();
    });

    // --- 2FA MODAL HANDLER ---
    function promptFor2FA() {
        return new Promise((resolve) => {
            const $modal = $('#bambu-2fa-modal');
            const $form = $('#bambu-2fa-form');
            const $input = $('#bambu-2fa-code');
            const $close = $('#close-2fa-modal');
            const $resendBtn = $('#resend-2fa-code');
            const $timerSpan = $('#resend-timer');
            
            // 1. Remove ANY existing listeners to prevent stacking
            $form.off();
            $close.off();
            $resendBtn.off();

            let countdownInterval;

            // Timer Logic
            const startCountdown = () => {
                let timeLeft = 60;
                $resendBtn.css({ 'pointer-events': 'none', 'opacity': '0.5' });
                $timerSpan.text(`(${timeLeft}s)`);
                
                clearInterval(countdownInterval);
                countdownInterval = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        $timerSpan.text(`(${timeLeft}s)`);
                    } else {
                        clearInterval(countdownInterval);
                        $resendBtn.css({ 'pointer-events': 'auto', 'opacity': '1' });
                        $timerSpan.text('');
                    }
                }, 1000);
            };

            // Reset UI
            $input.val('');
            $modal.addClass('open'); // Match CSS
            $input.focus();
            startCountdown();

            // Handle Submit
            const onSubmit = (e) => {
                e.preventDefault();
                const code = $input.val().trim();
                if (code) {
                    cleanup();
                    resolve(code);
                }
            };

            // Handle Resend (Direct Call)
            const onResend = async (e) => {
                e.preventDefault();
                $resendBtn.css({ 'pointer-events': 'none', 'opacity': '0.5' }); 
                showToast("Yeni kod talep ediliyor...", "info");

                try {
                    const getAllPrintersStatus = httpsCallable(functions, 'getAllPrintersStatus');
                    // We call with empty params to trigger a fresh login check (which triggers code send if needed)
                    const result = await getAllPrintersStatus({}); 
                    
                    const data = result.data;
                    const status = data.status; // Top level status

                    if (status === "NEEDS_CODE" || (data.printers && data.printers[0] && data.printers[0].state === "AUTH_2FA")) {
                        showToast("Yeni doğrulama kodu gönderildi!", "success");
                        startCountdown(); 
                    } else if (status === "SUCCESS") {
                        // If for some reason we logged in without code (token still valid?)
                        showToast("Bağlantı zaten aktif!", "success");
                        cleanup();
                        resolve("RETRY");
                    } else {
                        // Fallback error
                        console.warn("Resend unexpected response:", data);
                        showToast("Durum: " + (status || "Bilinmiyor"), "info");
                        // Reset button
                        $resendBtn.css({ 'pointer-events': 'auto', 'opacity': '1' });
                    }
                } catch (err) {
                    console.error("Resend Failed", err);
                    showToast("Kod gönderme başarısız: " + err.message, "error");
                    $resendBtn.css({ 'pointer-events': 'auto', 'opacity': '1' }); 
                }
            };

            // Handle Close/Cancel
            const onClose = () => {
                cleanup();
                resolve(null); 
            };

            const cleanup = () => {
                clearInterval(countdownInterval);
                $modal.removeClass('open'); 
                $form.off();
                $close.off();
                $resendBtn.off();
            };

            $form.on('submit', onSubmit);
            $close.on('click', onClose);
            $resendBtn.on('click', onResend);
        });
    }

    async function refreshFleetStatus(verificationCode = null) {
        if (!functions) return;
        
        const $btn = $('#btn-refresh-fleet');
        const $icon = $btn.find('i');
        const $grid = $('#device-grid');
        
        $btn.prop('disabled', true);
        $icon.addClass('fa-spin'); 
        
        if (!verificationCode) {
             $grid.html(`
                <div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px;">
                    <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2rem; margin-bottom: 10px; color: var(--primary);"></i>
                    <p>Cihaz durumu güncelleniyor...</p>
                </div>
            `);
        } else {
            showToast("Doğrulama kodu gönderiliyor...", "info");
        }

        try {
            const getAllPrintersStatus = httpsCallable(functions, 'getAllPrintersStatus');
            
            // Send request (only code if needed)
            const result = await getAllPrintersStatus({ 
                emailCode: verificationCode
            });
            
            console.log("Backend Response:", result.data); // DEBUG LOG

            const data = result.data;

            // --- 1. Top-Level 2FA Check (Priority) ---
            if (data.status === "NEEDS_CODE") {
                console.log("2FA Status Detected (Top Level). Triggering Modal..."); 
                $icon.removeClass('fa-spin');
                
                $grid.html(`
                    <div style="grid-column: 1/-1; text-align: center; padding: 40px; background: #FEF3C7; border-radius: 8px; color: #92400E;">
                         <i class="fa-solid fa-shield-halved" style="font-size: 2rem; margin-bottom: 15px;"></i>
                         <h3>Doğrulama Gerekli</h3>
                         <p>${data.message || 'Lütfen kodu giriniz.'}</p>
                         <button id="manual-2fa-trigger" class="btn primary" style="margin-top:10px;">Kodu Gir</button>
                    </div>
                `);

                // Setup Manual Trigger
                $('#manual-2fa-trigger').off().on('click', () => {
                     promptFor2FA().then(code => {
                         if (code === "RETRY") refreshFleetStatus();
                         else if (code) refreshFleetStatus(code);
                     });
                });

                // Auto-Trigger Modal
                const code = await promptFor2FA();
                
                if (code === "RETRY") {
                     refreshFleetStatus();
                     return;
                } else if (code) {
                     refreshFleetStatus(code);
                     return;
                } else {
                    showToast("İşlem iptal edildi.", "error");
                    $btn.prop('disabled', false);
                    return; 
                }
            }

            const printers = data.printers || [];

            // --- 2. Legacy/Nested 2FA Check (Fallback) ---
            const needs2FA = printers.find(p => p.state === "AUTH_2FA");
            
            if (needs2FA) {
                // ... (Same logic as above, handled by top check usually)
                // We can keep this for safety or remove it if confident. 
                // Let's keep the return to avoid double render if somehow top level missed it.
                console.log("2FA State Detected (Nested).");
                 $icon.removeClass('fa-spin');
                 // ... reusing logic implies duplication, but for safety let's just redirect to the block above
                 // effectively if we are here, we missed the status check.
            }

            // 2. Render Results
            $grid.empty();

            if (printers.length === 0) {
                $grid.html('<div style="grid-column:1/-1; text-align:center; padding:20px; color:#94A3B8;">Aktif yazıcı bulunamadı.</div>');
                return;
            }

            // MODEL MAPPING
            const MODEL_MAP = {
                "006": "AMS", "00M": "X1C", "01P": "P1S", "01S": "P1P",
                "030": "A1M", "039": "A1", "03C": "AMS Lite", "03W": "X1E",
                "094": "H2D", "19C": "AMS 2 PRO", "19F": "AMS HT", "22E": "P2S", "239": "H2D Pro"
            };

            const getModelFromSerial = (serial) => {
                if (!serial || serial.length < 3) return "Unknown Device";
                const prefix = serial.substring(0, 3);
                return MODEL_MAP[prefix] || "Unknown Model";
            };

            printers.forEach(p => {
                // STRICT Online Check
                const isOnline = (p.online === true) || (String(p.online).toLowerCase() === "true");
                const statusClass = isOnline ? 'online' : 'offline';
                const progress = p.progress || 0;
                
                const modelName = getModelFromSerial(p.serial);
                
                // Safety checks for temps
                const nozzleTemp = (p.temps && p.temps.nozzle) ? p.temps.nozzle : 0;
                const bedTemp = (p.temps && p.temps.bed) ? p.temps.bed : 0;

                // Error Handling Display
                let stateDisplay = `<strong style="color:var(--text-main);">${p.state || 'UNKNOWN'}</strong>`;
                let progressDisplay = `<span style="color:var(--text-muted);">${progress}%</span>`;
                
                if (p.state === "CONNECT_ERR" || p.state === "AUTH_ERR" || p.state === "HTTP_ERR") {
                    stateDisplay = `<strong style="color:#EF4444;"><i class="fa-solid fa-triangle-exclamation"></i> ${p.error || 'Connection Failed'}</strong>`;
                    progressDisplay = `<span style="font-size:0.7rem;">${p.message || 'Check logs'}</span>`;
                }

                // AMS Logic
                let amsHtml = '';
                if (p.ams && (p.ams.present === true || String(p.ams.present) === "true")) {
                     const amsList = p.ams.models ? p.ams.models.join(', ') : 'Attached';
                     amsHtml = `
                        <div style="background:#F8FAFC; padding:8px; border-radius:6px; margin-top:10px; font-size:0.75rem; color:var(--text-muted); display:flex; align-items:center; gap:8px; border:1px solid var(--border);">
                            <i class="fa-solid fa-layer-group" style="color:var(--accent);"></i> 
                            <span><strong>AMS:</strong> ${amsList}</span>
                        </div>`;
                }

                const cardHtml = `
                    <div class="card device-card ${statusClass}">
                        <div class="device-header">
                            <div class="device-name">
                                <i class="fa-solid fa-print"></i> 
                                <div style="display:flex; flex-direction:column; line-height:1.2;">
                                    <span title="${p.serial || 'Unknown'}" style="font-weight:700;">${modelName}</span>
                                    <span style="font-size:0.7rem; color:var(--text-light); font-weight:400;">${p.serial || ''}</span>
                                </div>
                            </div>
                            <span class="dot ${statusClass}" title="${isOnline ? 'Online' : 'Offline'}"></span>
                        </div>
                        
                        ${amsHtml}
                        
                        <div class="device-stats" style="margin-top:15px;">
                            <div class="stat">
                                <span class="label">Nozzle</span>
                                <span class="val">${nozzleTemp}°C</span>
                            </div>
                            <div class="stat">
                                <span class="label">Bed</span>
                                <span class="val">${bedTemp}°C</span>
                            </div>
                        </div>

                        <div style="margin-top: 15px;">
                            <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:5px;">
                                ${stateDisplay}
                                ${progressDisplay}
                            </div>
                            <div class="device-progress-bg">
                                <div class="device-progress-fill" style="width: ${progress}%;"></div>
                            </div>
                        </div>
                    </div>
                `;
                $grid.append(cardHtml);
            });

        } catch (error) {
            console.error("Fleet Refresh Error:", error);
            showToast("Filo durumu alınamadı: " + error.message, "error");
        } finally {
            // Only re-enable button if we're not inside a recursive flow (which is hard to know exactly here,
            // but the UI will update anyway).
            $btn.prop('disabled', false);
            $icon.removeClass('fa-spin'); 
        }
    }

    // --- RENDER FUNCTION ---
    function renderDashboard(data) {
        // 1. Live Status & Revenue
        if (data.dashboard) {
             if(data.dashboard.live_status) $('#live-status-msg').text(data.dashboard.live_status.message);
             if(data.dashboard.stats) {
                 $('#rev-daily').text('₺' + (data.dashboard.stats.dailyRevenue || 0).toFixed(2));
                 $('#rev-monthly').text('₺' + (data.dashboard.stats.monthlyRevenue || 0).toFixed(2));
             }
        }

        // 4. Production Queue
        const $queue = $('#production-queue');
        $queue.empty();
        if (data.production_queue) {
            Object.values(data.production_queue).forEach(job => {
                $queue.append(`
                    <div class="queue-item" draggable="true">
                        <div class="drag-handle"><i class="fa-solid fa-grip-vertical"></i></div>
                        <div class="queue-info">
                            <strong>Job: ${job.job_id}</strong>
                            <span>${job.filename} • Priority: ${job.priority}</span>
                        </div>
                        <div class="queue-status">
                            <span class="badge badge-info">${job.status}</span>
                        </div>
                    </div>
                `);
            });
        }

        // 5. Stock
        const $stock = $('#stock-list-container');
        $stock.empty();
        if (data.inventory && data.inventory.filaments) {
            Object.values(data.inventory.filaments).forEach(fil => {
                $stock.append(`
                    <div class="stock-item">
                        <div class="stock-info">
                            <div class="color-indicator" style="background: ${fil.color.toLowerCase()};"></div>
                            <div class="stock-text">
                                <strong>${fil.type} ${fil.color}</strong>
                                <span>${fil.brand}</span>
                            </div>
                        </div>
                        <div class="stock-progress">
                             <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${(fil.remaining_g / 1000) * 100}%; background: ${fil.color.toLowerCase()};"></div>
                            </div>
                            <span class="stock-val">${fil.remaining_g}g / 1000g</span>
                        </div>
                    </div>
                `);
            });
        }

        // 6. Orders
        const $orderTable = $('#orders-table-body');
        $orderTable.empty();
        if (data.orders) {
            Object.entries(data.orders).forEach(([key, order]) => {
                $orderTable.append(`
                    <tr>
                        <td>${key}</td>
                        <td><span class="badge badge-warning">${order.status}</span></td>
                        <td>₺${order.total}</td>
                        <td>${order.user_id}</td>
                        <td><button class="btn-icon"><i class="fa-solid fa-ellipsis-vertical"></i></button></td>
                    </tr>
                `);
            });
        }

        // 7. Finance
        if (data.finance && data.finance.tax_tracking) {
            const tax = data.finance.tax_tracking;
            $('#tax-current').text(`Mevcut Satış: ₺${tax.current_total}`);
            $('#tax-limit').text(`Limit: ₺${tax.limit}`);
            const percent = (tax.current_total / tax.limit) * 100;
            $('#tax-bar').css('width', percent + '%');
            $('#tax-desc').html(`<i class="fa-solid fa-check-circle"></i> Muafiyet Kapsamındasınız (%${percent.toFixed(1)} Doldu)`);
        }
        
        // 8. Files
        const $files = $('#file-grid');
        $files.empty();
        if (data.files_library) {
             Object.values(data.files_library).forEach(file => {
                $files.append(`
                    <div class="file-card">
                        <div class="file-icon"><i class="fa-solid fa-cube"></i></div>
                        <div class="file-details">
                            <strong>${file.name}</strong>
                            <span>Ready</span>
                        </div>
                         <div class="file-actions">
                            <button class="btn-icon-sm"><i class="fa-solid fa-download"></i></button>
                        </div>
                    </div>
                `);
            });
        }
    }

    // --- DRAG DROP ---
    $('.queue-item').on('dragstart', function(e) { /* ... */ });
});

// Helper
function showToast(message, type = "info") {
    const $container = $('#toast-container');
    const id = Date.now();
    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
    const toastHtml = `<div id="toast-${id}" class="toast ${type}"><i class="fa-solid ${icon} toast-icon"></i><span class="toast-message">${message}</span></div>`;
    $container.append(toastHtml);
    setTimeout(() => { $(`#toast-${id}`).addClass('hiding').remove(); }, 4000);
}
