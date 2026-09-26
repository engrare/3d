import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import { getDatabase, ref, get, set, update, onValue } from "firebase/database";
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

let globalAdminData = null;
let adminDataUnsubscribe = null;
let mailStatsUnsubscribe = null;

/* Sipariş verisi müşteriden geldiği için (yazı, ad, adres...) HTML'e basılmadan
   önce mutlaka kaçışlanmalı; aksi halde yönetici panelinde script çalıştırılabilir. */
function esc(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeColor(value, fallback) {
    return /^#[0-9a-fA-F]{3,8}$/.test(value) || /^[a-zA-Z]{3,20}$/.test(value) ? value : fallback;
}

function safeUrl(value) {
    return (typeof value === 'string' && /^[A-Za-z0-9\-._~:/?#@!$&+,=%;]+$/.test(value)) ? value : '';
}

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
            
            showToast("Yönetici girişi başarılı.", "success");
            $('#login-modal').removeClass('open');
            
            // NOTE: The onAuthStateChanged listener will handle loading the data via onValue
            // but we can trigger an initial fleet refresh here.
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
            $('#admin-avatar').attr('src', user.photoURL || "../content/images/default_user.png");
            $('#admin-logout-btn').show();
            
            // Auto-load if session active
            loadDataIfAdmin();
        } else {
            $('#admin-name').text("Giriş Yap");
            $('#admin-role').text("Misafir");
            $('#admin-avatar').attr('src', "../content/images/default_user.png");
            $('#admin-logout-btn').hide();
            if (adminDataUnsubscribe) { adminDataUnsubscribe(); adminDataUnsubscribe = null; }
        }
    });

    function loadDataIfAdmin() {
        if (!auth.currentUser) return;

        // 1. Listen to Admin Data (Dashboard, Inventory, etc.)
        // Her oturum değişiminde yeni dinleyici eklenip birikmesin
        if (adminDataUnsubscribe) adminDataUnsubscribe();
        const adminRef = ref(db, 'admin');
        adminDataUnsubscribe = onValue(adminRef, (snapshot) => {
            if (snapshot.exists()) {
                const data = snapshot.val();
                // We will merge orders later, so just pass other data for now
                if(data.orders) delete data.orders; // Prevent stale admin orders from overwriting
                
                // If we haven't fetched users yet, we might render partial data
                // But better to merge in a single state object if possible.
                // For now, let's update the global object's non-order parts.
                if (!globalAdminData) globalAdminData = {};
                Object.assign(globalAdminData, data);
                
                renderDashboard(globalAdminData, false); // false = don't render orders yet
            } else {
                console.log("No admin data found, using defaults.");
                if (!globalAdminData) globalAdminData = DEFAULT_ADMIN_DATA;
                renderDashboard(globalAdminData, false);
            }
        }, (error) => {
            console.error("Data Load Error:", error);
        });

        // 2. Fetch Orders via Cloud Function (Bypass permission issues)
        const getAllOrders = httpsCallable(functions, 'getAllOrders');
        getAllOrders()
            .then((result) => {
                const allOrders = result.data.orders || {};
                
                if (!globalAdminData) globalAdminData = {};
                globalAdminData.orders = allOrders;

                renderOrders(allOrders);
                console.log("Orders loaded via Cloud Function:", Object.keys(allOrders).length);
            })
            .catch((error) => {
                console.error("Order Load Error:", error);
                if (error.code === 'functions/permission-denied') {
                    showToast("Bu hesabın yönetici yetkisi yok.", "error");
                } else {
                    showToast("Siparişler yüklenirken hata oluştu.", "error");
                }
            });
        
        // 3. E-posta gönderim sayaçları (grafik)
        if (mailStatsUnsubscribe) mailStatsUnsubscribe();
        mailStatsUnsubscribe = onValue(ref(db, 'stats/mail'), (snap) => renderMailStats(snap.val()),
            (error) => console.error("Mail Stats Error:", error));

        // Initial fleet refresh on load
        refreshFleetStatus();
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
                // ponytail: yazıcı (Bambu) bağlantısı kapalı; sunucuda getAllPrintersStatus fonksiyonu yok.
                // Filo modülü yeniden açılınca kod gönderme çağrısı buraya geri eklenecek.
                showToast("Yazıcı bağlantısı şu an kapalı.", "info");
                $resendBtn.css({ 'pointer-events': 'auto', 'opacity': '1' });
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
        const $btn = $('#btn-refresh-fleet');
        const $icon = $btn.find('i');
        const $grid = $('#device-grid');
        
        $grid.html('<div style="grid-column:1/-1; text-align:center; padding:20px; color:#94A3B8;">Filo durumu şu anlık kapalı.</div>');
        $btn.prop('disabled', false);
        $icon.removeClass('fa-spin'); 
        return;
    }

    // --- RENDER FUNCTION ---
    function renderDashboard(data, renderOrdersFlag = true) {
        // globalAdminData = data; // Already set in listener

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
                            <strong>Job: ${esc(job.job_id)}</strong>
                            <span>${esc(job.filename)} • Priority: ${esc(job.priority)}</span>
                        </div>
                        <div class="queue-status">
                            <span class="badge badge-info">${esc(job.status)}</span>
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
                const color = safeColor(String(fil.color || '').toLowerCase(), '#cbd5e1');
                const remaining = Number(fil.remaining_g) || 0;
                $stock.append(`
                    <div class="stock-item">
                        <div class="stock-info">
                            <div class="color-indicator" style="background: ${color};"></div>
                            <div class="stock-text">
                                <strong>${esc(fil.type)} ${esc(fil.color)}</strong>
                                <span>${esc(fil.brand)}</span>
                            </div>
                        </div>
                        <div class="stock-progress">
                             <div class="progress-bar-container">
                                <div class="progress-bar" style="width: ${Math.max(0, Math.min(100, (remaining / 1000) * 100))}%; background: ${color};"></div>
                            </div>
                            <span class="stock-val">${remaining}g / 1000g</span>
                        </div>
                    </div>
                `);
            });
        }

        // 6. Orders
        if (renderOrdersFlag) {
            renderOrders(data.orders || {});
        }

        // 7. Finance
        if (data.finance && data.finance.tax_tracking) {
            const tax = data.finance.tax_tracking;
            $('#tax-current').text(`Mevcut Satış: ₺${tax.current_total}`);
            $('#tax-limit').text(`Limit: ₺${tax.limit}`);
            const percent = Number(tax.limit) > 0 ? (Number(tax.current_total) || 0) / Number(tax.limit) * 100 : 0;
            $('#tax-bar').css('width', Math.min(100, percent) + '%');
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
                            <strong>${esc(file.name)}</strong>
                            <span>Ready</span>
                        </div>
                         <div class="file-actions">
                            <button class="btn-icon-sm"><i class="fa-solid fa-download"></i></button>
                        </div>
                    </div>
                `);
            });
        }

        // 9. Pricing Parameters (admin/pricing)
        if (data.pricing && typeof data.pricing === 'object') {
            applyPricingParamsToInputs(data.pricing);
            $('#pricing-sync-badge').text('Firebase Kayıtlı').attr('class', 'badge badge-success');
            updatePricingUI();
        }
    }

    // --- ORDER MANAGEMENT HELPERS ---

    function renderOrders(orders) {
        const $orderTable = $('#orders-table-body');
        $orderTable.empty();
        
        const searchTerm = ($('#order-search-input').val() || '').toLocaleLowerCase('tr').trim();
        const sortMode = $('#order-sort-select').val() || 'priority-desc';

        // Tablo başlığındaki aktif sıralama ikonunu güncelle
        $('.sortable-th').removeClass('active-sort').find('i').attr('class', 'fa-solid fa-sort');
        const [activeCol, activeDir] = sortMode.split('-');
        const $activeTh = $(`.sortable-th[data-sort-col="${activeCol}"]`);
        if ($activeTh.length) {
            $activeTh.addClass('active-sort');
            $activeTh.find('i').attr('class', activeDir === 'asc' ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down');
        }

        const isPriorityOrder = (order) => {
            const m = String(order.shippingMethod || 'standart').toLocaleLowerCase('tr');
            return m.includes('öncelikli') || m.includes('hızlı') || m.includes('priority') || m.includes('fast') || m.includes('express');
        };

        // Üretim durumu sıralaması: Ödendi (1) => Hazırlanıyor (2) => Kargolandı (3) => Ödeme Bekliyor (4) => Teslim Edildi (5) => İptal (6)
        const getStatusRank = (status) => {
            const s = String(status || '').toLocaleLowerCase('tr');
            if (s.includes('ödendi') || s.includes('paid')) return 1;
            if (s.includes('ödeme bekliyor') || s.includes('pending_payment') || s.includes('pending payment') || s.includes('payment_review')) return 4;
            if (s.includes('hazır') || s.includes('pending')) return 2;
            if (s.includes('kargo')) return 3;
            if (s.includes('teslim') || s.includes('tamam')) return 5;
            if (s.includes('iptal') || s.includes('cancel')) return 6;
            return 7;
        };
        
        // Helper for status badge
        const getStatusBadge = (status) => {
            let icon = 'fa-circle-question';
            let badgeClass = 'badge-muted';
            if (!status) status = 'Bilinmiyor';
            const s = String(status).toLocaleLowerCase('tr');
            
            if (s.includes('ödeme bekliyor') || s.includes('pending_payment') || s.includes('pending payment')) {
                icon = 'fa-circle-exclamation';
                badgeClass = 'badge-danger'; // Red/Warning style
                status = 'Ödeme Bekliyor';
            } else if (s.includes('payment_review')) {
                icon = 'fa-magnifying-glass-dollar';
                badgeClass = 'badge-warning';
                status = 'Ödeme İnceleniyor (iyzico)';
            } else if (s.includes('ödendi') || s.includes('paid')) {
                icon = 'fa-sack-dollar';
                badgeClass = 'badge-success'; // Green
                status = 'Ödendi';
            } else if (s.includes('hazır') || s.includes('pending')) {
                icon = 'fa-clock';
                badgeClass = 'badge-warning'; // Orange
                status = 'Hazırlanıyor';
            } else if (s.includes('kargo')) {
                icon = 'fa-truck';
                badgeClass = 'badge-info'; // Blue
                status = 'Kargolandı';
            } else if (s.includes('teslim') || s.includes('tamam')) {
                icon = 'fa-box-open';
                badgeClass = 'badge-purple'; // Purple (will add)
                status = 'Teslim Edildi';
            } else if (s.includes('iptal') || s.includes('cancel')) {
                icon = 'fa-ban';
                badgeClass = 'badge-danger'; // Red
                status = 'İptal Edildi';
            }
            
            return `<span class="badge ${badgeClass}"><i class="fa-solid ${icon}"></i> ${esc(status)}</span>`;
        };

        const sortedOrders = Object.entries(orders).sort((a, b) => {
            const keyA = a[0];
            const keyB = b[0];
            const orderA = a[1] || {};
            const orderB = b[1] || {};
            
            const idA = parseInt(keyA.replace(/\D/g, ''), 10) || 0;
            const idB = parseInt(keyB.replace(/\D/g, ''), 10) || 0;
            const prioA = isPriorityOrder(orderA);
            const prioB = isPriorityOrder(orderB);
            const priceA = parseFloat(orderA.totalAmount) || 0;
            const priceB = parseFloat(orderB.totalAmount) || 0;
            const statusA = getStatusRank(orderA.status);
            const statusB = getStatusRank(orderB.status);

            switch (sortMode) {
                case 'id-desc':
                    return idB - idA;
                case 'id-asc':
                    return idA - idB;
                case 'price-desc':
                    return (priceB - priceA) || (idA - idB);
                case 'price-asc':
                    return (priceA - priceB) || (idA - idB);
                case 'status-asc':
                    return (statusA - statusB) || (prioB - prioA) || (idA - idB);
                case 'status-desc':
                    return (statusB - statusA) || (prioB - prioA) || (idA - idB);
                case 'priority-asc':
                    // Sadece Öncelikli <-> Standart yer değiştirir (Standart üstte), durum ve ID sıralaması aynı kalır
                    if (prioA !== prioB) return prioA ? 1 : -1;
                    if (statusA !== statusB) return statusA - statusB;
                    return idA - idB;
                case 'priority-desc':
                default:
                    // Önce Öncelikli, sonra durum (Ödendi => Hazırlanıyor => Kargolandı => Ödeme Bekliyor => Teslim Edildi), en son düşük ID üstte
                    if (prioA !== prioB) return prioA ? -1 : 1;
                    if (statusA !== statusB) return statusA - statusB;
                    return idA - idB;
            }
        });

        sortedOrders.forEach(([key, order]) => {
            const isPriority = isPriorityOrder(order);
            const priorityKeywords = isPriority ? 'öncelikli hızlı express' : 'standart';
            const ship = order.shippingInfo || {};
            const customerName = ship.fullname || [ship.name, ship.surname].filter(Boolean).join(' ').trim() || order.customerName || '-';
            // Search Filter
            const searchString = `${key} ${customerName} ${ship.email || ''} ${ship.phone || ''} ${order.userId || ''} ${order.status || ''} ${priorityKeywords}`.toLocaleLowerCase('tr');
            if (searchTerm && !searchString.includes(searchTerm)) {
                return; // Skip if doesn't match
            }
            
            // Format Currency
            const total = (parseFloat(order.totalAmount) || 0).toFixed(2);
            const userId = esc(order.userId || '');
            const safeKey = esc(key);
            const customerDisplay = `<span style="font-weight: 600; color: var(--text-main);">${esc(customerName)}</span>`;
            const productionBadge = isPriority
                ? `<span class="badge badge-priority" title="Öncelikli Üretim (2-3 iş günü)"><i class="fa-solid fa-bolt"></i> Öncelikli</span>`
                : `<span class="badge badge-muted">Standart</span>`;

            $orderTable.append(`
                <tr class="${isPriority ? 'priority-order-row' : ''}">
                    <td><input type="checkbox" class="order-checkbox" value="${safeKey}" data-userid="${userId}"></td>
                    <td><span style="font-family: monospace; font-weight: 700;">#${safeKey}</span></td>
                    <td>${productionBadge}</td>
                    <td>${getStatusBadge(order.status)}</td>
                    <td style="font-weight: 600;">₺${total}</td>
                    <td>${customerDisplay}</td>
                    <td style="overflow: visible;">
                        <div class="action-dropdown">
                            <button class="btn-sm secondary view-details-btn" data-id="${safeKey}">
                                <i class="fa-solid fa-eye"></i> Detay
                            </button>
                            <button class="btn-icon action-trigger" data-id="${safeKey}"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                            <div class="dropdown-menu">
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="Ödeme Bekliyor" style="color: #EF4444;"><i class="fa-solid fa-circle-exclamation"></i> Ödeme Bekliyor</div>
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="Ödendi"><i class="fa-solid fa-money-bill"></i> Ödendi</div>
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="Hazırlanıyor"><i class="fa-solid fa-clock"></i> Hazırlanıyor</div>
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="Kargolandı"><i class="fa-solid fa-truck"></i> Kargolandı</div>
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="Teslim Edildi"><i class="fa-solid fa-check"></i> Teslim Edildi</div>
                                <div class="dropdown-item" data-id="${safeKey}" data-userid="${userId}" data-status="İptal" style="color: #EF4444;"><i class="fa-solid fa-ban"></i> İptal</div>
                            </div>
                        </div>
                    </td>
                </tr>
            `);
        });

        // Dropdown Trigger Listener
        $('.action-trigger').off('click').on('click', function(e) {
            e.stopPropagation();
            $('.dropdown-menu').not($(this).next('.dropdown-menu')).removeClass('show');
            $(this).next('.dropdown-menu').toggleClass('show');
        });

        // View Details Listener
        $('.view-details-btn').off('click').on('click', function(e) {
            e.stopPropagation();
            const orderId = $(this).data('id');
            const order = globalAdminData.orders[orderId];
            if (order) {
                openOrderDetailModal(order, orderId);
            }
        });

        // Status Change Listener
        $('.dropdown-item').off('click').on('click', async function(e) {
            e.stopPropagation();
            const orderId = $(this).data('id');
            const userId = $(this).data('userid');
            const newStatus = $(this).data('status');
            
            $('.dropdown-menu').removeClass('show');

            if(!orderId || !newStatus || !userId) {
                showToast("Hata: Kullanıcı veya sipariş bilgisi eksik.", "error");
                return;
            }
            
            showToast(`Durum güncelleniyor: ${newStatus}...`, "info");

            try {
                // Update in User's path
                await update(ref(db, `users/${userId}/orders/${orderId}`), {
                    status: newStatus
                });
                showToast("Durum başarıyla güncellendi.", "success");

                if (globalAdminData && globalAdminData.orders && globalAdminData.orders[orderId]) {
                    globalAdminData.orders[orderId].status = newStatus;
                    renderOrders(globalAdminData.orders);
                }
                await offerStatusMail([{ userId, orderId }], newStatus);
            } catch (error) {
                console.error("Status Update Error:", error);
                showToast("Hata: " + error.message, "error");
            }
        });
    }

    // --- MODAL LOGIC ---
    function formatOrderDateTime(order) {
        const raw = order.createdAt || order.serverTimestamp || order.paidAt || order.timestamp || order.date;
        if (!raw) return 'Bilinmiyor';
        const d = (typeof raw === 'object' && raw._seconds)
            ? new Date(raw._seconds * 1000)
            : new Date(raw);
        if (isNaN(d.getTime())) return String(raw);
        const datePart = d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
        const timePart = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        return `${datePart} · ${timePart}`;
    }

    function openOrderDetailModal(order, fallbackId = '') {
        // Populate Info
        const statusText = String(order.status || 'Bilinmiyor');
        const displayId = order.id || fallbackId || '';
        $('#modal-order-id').text(displayId ? '#' + String(displayId).replace(/^#/, '') : '');
        $('#modal-order-status').text(statusText).attr('class', 'badge').addClass(
            statusText === 'paid' || statusText.includes('Ödendi') || statusText.includes('Tamam') ? 'badge-success' : 'badge-warning'
        );

        // Date & Time
        const dateTimeStr = formatOrderDateTime(order);
        $('#modal-order-date').text(dateTimeStr);
        $('#modal-order-datetime').text(dateTimeStr);

        // Customer
        const ship = order.shippingInfo || {};
        const fullName = ship.fullname || [ship.name, ship.surname].filter(Boolean).join(' ').trim() || order.customerName || '-';
        $('#modal-customer-name').text(fullName);
        $('#modal-customer-email').text(ship.email || '-');
        $('#modal-customer-phone').text(ship.phone || '-');
        $('#modal-customer-id').text(order.userId || '-');

        // Shipping
        $('#modal-shipping-address').text(
            [ship.address || ship.details, ship.district, ship.city, ship.zip].filter(Boolean).join(' ')
        );
        $('#modal-shipping-method').text(order.shippingMethod || 'Standart');
        $('#modal-payment-method').text(order.paymentMethod || 'Kredi Kartı');

        // Items
        const $tbody = $('#modal-items-body');
        $tbody.empty();
        
        if (order.items) {
            const itemsArray = Array.isArray(order.items) ? order.items : Object.values(order.items);
            itemsArray.filter(Boolean).forEach(item => {
                let img = item.image || item.photo || item.imageUrl || '../content/images/engrare_logo_elegant.png';
                if (typeof img === 'object' && img !== null) img = img.src || '../content/images/engrare_logo_elegant.png';
                if (typeof img === 'string' && img.startsWith('./')) {
                    img = '.' + img; // converts ./content/ to ../content/
                }
                img = safeUrl(img) || '../content/images/engrare_logo_elegant.png';

                // Retroactive fix for old orders
                let textToShow = item.customText || '';
                if (!textToShow && typeof item.desc === 'string' && item.desc.includes('Yazı:')) {
                    textToShow = item.desc.replace('Yazı:', '').trim();
                }

                const fontToShow = item.font || 'Inter';
                const textColorToShow = safeColor(item.textColor, '#ffffff'); // Default white
                const objColorToShow = safeColor(item.objColor, '#333333'); // Default black

                let detailsHtml = '';
                if (textToShow) detailsHtml += `<span style="font-size: 0.8rem; color: var(--text-main);">Yazı: <strong>${esc(textToShow)}</strong></span><br>`;
                detailsHtml += `<span style="font-size: 0.75rem; color: var(--text-light);">Font: <strong>${esc(fontToShow)}</strong></span><br>`;
                if (item.selectedObject) detailsHtml += `<span style="font-size: 0.75rem; color: var(--text-light);">Seçenek: <strong>${esc(item.selectedObject)}</strong></span><br>`;
                [1, 2].forEach(i => {
                    if (item[`socialPlatform${i}`]) {
                        detailsHtml += `<span style="font-size: 0.75rem; color: var(--text-light);">${i}. Sosyal: <strong>${esc(item[`socialPlatform${i}`])}</strong> ${esc(item[`socialLink${i}`] || '')}</span><br>`;
                    }
                });
                const logoUrl = safeUrl(item.logoUrl);
                if (logoUrl && logoUrl.startsWith('https://')) {
                    detailsHtml += `<span style="font-size: 0.75rem;"><a href="${logoUrl}" target="_blank" rel="noopener noreferrer">Müşteri logosunu aç</a></span><br>`;
                }
                
                let colorsHtml = `<div style="display:flex; gap: 10px; margin-top: 4px;">
                    <div style="display:flex; align-items:center; gap: 4px; font-size: 0.7rem; color: var(--text-light);"><div style="width:14px; height:14px; border-radius:50%; background:${textColorToShow}; border:1px solid #ccc;" title="Yazı Rengi"></div>Yazı</div>
                    <div style="display:flex; align-items:center; gap: 4px; font-size: 0.7rem; color: var(--text-light);"><div style="width:14px; height:14px; border-radius:50%; background:${objColorToShow}; border:1px solid #ccc;" title="Obje Rengi"></div>Obje</div>
                </div>`;

                $tbody.append(`
                    <tr>
                        <td style="display: flex; align-items: center; gap: 15px;">
                            <img src="${img}" style="width: 60px; height: 60px; border-radius: 6px; object-fit: cover; border: 1px solid var(--border);">
                            <div>
                                <strong style="font-size: 0.95rem;">${esc(item.name || 'Ürün')}</strong>
                                <br>
                                ${detailsHtml}
                                ${colorsHtml}
                            </div>
                        </td>
                        <td>₺${(parseFloat(item.price) || 0).toFixed(2)}</td>
                        <td>${esc(item.quantity || 1)}</td>
                        <td style="font-weight: 600;">₺${((parseFloat(item.price) || 0) * (Number(item.quantity) || 1)).toFixed(2)}</td>
                    </tr>
                `);
            });
        }

        // Totals
        $('#modal-subtotal').text('₺' + parseFloat(order.subtotal || 0).toFixed(2));
        $('#modal-shipping-cost').text('₺' + parseFloat(order.shippingCost || 0).toFixed(2));
        $('#modal-discount').text('-₺' + parseFloat(order.discountAmount || 0).toFixed(2));
        $('#modal-total').text('₺' + parseFloat(order.totalAmount || 0).toFixed(2));

        // Open
        $('#order-detail-modal').addClass('open');
    }

    // Modal Close Events
    $('#close-order-modal').click(function() {
        $('#order-detail-modal').removeClass('open');
    });

    $(window).click(function(e) {
        if ($(e.target).is('#order-detail-modal')) {
            $('#order-detail-modal').removeClass('open');
        }
    });

    // Close Dropdowns on Click Outside
    $(document).on('click', function() {
        $('.dropdown-menu').removeClass('show');
    });

    // Search & Sort Listeners
    $('#order-search-input').on('input', function() {
        if (globalAdminData && globalAdminData.orders) {
            renderOrders(globalAdminData.orders);
        }
    });

    $('#order-sort-select').on('change', function() {
        if (globalAdminData && globalAdminData.orders) {
            renderOrders(globalAdminData.orders);
        }
    });

    $('.sortable-th').on('click', function() {
        const col = $(this).data('sort-col');
        if (!col) return;
        const current = $('#order-sort-select').val() || 'priority-desc';
        const [curCol, curDir] = current.split('-');
        const defaultDir = (col === 'status' || col === 'id') ? 'asc' : 'desc';
        const nextDir = (curCol === col) ? (curDir === 'desc' ? 'asc' : 'desc') : defaultDir;
        $('#order-sort-select').val(`${col}-${nextDir}`).trigger('change');
    });

    // Select All Listener
    $('#select-all-orders').change(function() {
        const isChecked = $(this).is(':checked');
        $('.order-checkbox').prop('checked', isChecked);
    });

    // Bulk Update Listener
    $('#btn-bulk-update').click(async function() {
        const selectedIds = [];
        const selectedUserIds = [];
        
        $('.order-checkbox:checked').each(function() {
            selectedIds.push($(this).val());
            selectedUserIds.push($(this).data('userid'));
        });

        const newStatus = $('#bulk-status-select').val();

        if (selectedIds.length === 0) {
            showToast("Lütfen en az bir sipariş seçin.", "error");
            return;
        }

        if (!newStatus) {
            showToast("Lütfen yeni bir durum seçin.", "error");
            return;
        }

        if (!confirm(`${selectedIds.length} siparişin durumu "${newStatus}" olarak güncellenecek. Onaylıyor musunuz?`)) {
            return;
        }

        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i>');

        try {
            const updates = {};
            selectedIds.forEach((orderId, index) => {
                const userId = selectedUserIds[index];
                if(userId) {
                    updates[`users/${userId}/orders/${orderId}/status`] = newStatus;
                    if (globalAdminData && globalAdminData.orders && globalAdminData.orders[orderId]) {
                        globalAdminData.orders[orderId].status = newStatus;
                    }
                }
            });

            await update(ref(db), updates);

            showToast(`${selectedIds.length} sipariş güncellendi.`, "success");
            await offerStatusMail(selectedIds.map((orderId, i) => ({ userId: selectedUserIds[i], orderId })).filter(o => o.userId), newStatus);
            
            // Uncheck select all
            $('#select-all-orders').prop('checked', false);
            
            renderOrders(globalAdminData.orders);
            
        } catch (error) {
            console.error("Bulk Update Error:", error);
            showToast("Güncelleme hatası: " + error.message, "error");
        } finally {
            $btn.prop('disabled', false).text('Güncelle');
        }
    });

    // --- DRAG DROP ---
    $('.queue-item').on('dragstart', function(e) { /* ... */ });

    // --- FİYATLANDIRMA HESAPLAYICI ---
    $('.pricing-calc-trigger').on('input change', function() {
        updatePricingUI();
    });

    // Varsayılan değerlerle ilk hesaplamayı çalıştır
    updatePricingUI();

    // Varsayılana Dön
    $('#btn-reset-pricing-params').on('click', function() {
        applyPricingParamsToInputs(DEFAULT_PRICING_PARAMS, true);
        updatePricingUI();
        showToast("Formül parametreleri varsayılan değerlere döndürüldü.", "info");
    });

    // Firebase'e Kaydet
    $('#btn-save-pricing-params').on('click', async function() {
        if (!auth.currentUser) {
            $('#login-modal').addClass('open');
            showToast("Parametreleri kaydetmek için lütfen yönetici girişi yapın.", "error");
            return;
        }

        const $btn = $(this);
        const originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Kaydediliyor...');

        const currentInputs = readPricingInputs();
        const payload = {
            G_saat: currentInputs.G_saat,
            t_hazirlik: currentInputs.t_hazirlik,
            F_kg: currentInputs.F_kg,
            P_makine: currentInputs.P_makine,
            E_kwh: currentInputs.E_kwh,
            A_saat: currentInputs.A_saat,
            M_ambalaj: currentInputs.M_ambalaj,
            r_fire: currentInputs.r_fire,
            k_kar: currentInputs.k_kar,
            c_oran: currentInputs.c_oran,
            c_sabit: currentInputs.c_sabit,
            v_devlet: currentInputs.v_devlet,
            t: currentInputs.t,
            updatedAt: Date.now()
        };

        try {
            await set(ref(db, 'admin/pricing'), payload);
            $('#pricing-sync-badge').text('Firebase Kayıtlı').attr('class', 'badge badge-success');
            showToast("Fiyatlandırma parametreleri Firebase'e kaydedildi.", "success");
        } catch (error) {
            console.error("Pricing Save Error:", error);
            showToast("Kaydetme hatası: " + error.message, "error");
        } finally {
            $btn.prop('disabled', false).html(originalHtml);
        }
    });

});

const DEFAULT_PRICING_PARAMS = {
    t: 1,
    G_saat: 35,       // Saatlik filament tüketimi (gram/saat)
    t_hazirlik: 10,   // İlk hazırlık süresi (dakika) - filament harcanmayan süre
    F_kg: 500,        // Filament kg fiyatı (TL) - PETG için 700
    P_makine: 0.15,   // Güç tüketimi (kW) - ~150W
    E_kwh: 3.24,      // Elektrik kWh fiyatı (TL)
    A_saat: 8.0,      // Saatlik amortisman (TL)
    M_ambalaj: 15.0,  // Ambalaj maliyeti (TL)
    r_fire: 0.10,     // Fire oranı (%10)
    k_kar: 1.8,       // Kâr çarpanı
    c_oran: 0.0449,   // iyzico komisyon oranı (%4.49)
    c_sabit: 0.25,    // iyzico sabit işlem ücreti (TL)
    v_devlet: 0.04    // Devlet vergi / stopaj oranı (%4 - iyzico'nun yatırdığı tutar üzerinden)
};

function parseNumInput(selector, fallback) {
    const raw = String($(selector).val() ?? '').replace(',', '.').trim();
    const num = parseFloat(raw);
    return Number.isFinite(num) ? num : fallback;
}

function readPricingInputs() {
    return {
        t: Math.max(0, parseNumInput('#pricing-t-input', 0)),
        G_saat: Math.max(0, parseNumInput('#param-G_saat', DEFAULT_PRICING_PARAMS.G_saat)),
        t_hazirlik: Math.max(0, parseNumInput('#param-t_hazirlik', DEFAULT_PRICING_PARAMS.t_hazirlik)),
        F_kg: Math.max(0, parseNumInput('#param-F_kg', DEFAULT_PRICING_PARAMS.F_kg)),
        P_makine: Math.max(0, parseNumInput('#param-P_makine', DEFAULT_PRICING_PARAMS.P_makine)),
        E_kwh: Math.max(0, parseNumInput('#param-E_kwh', DEFAULT_PRICING_PARAMS.E_kwh)),
        A_saat: Math.max(0, parseNumInput('#param-A_saat', DEFAULT_PRICING_PARAMS.A_saat)),
        M_ambalaj: Math.max(0, parseNumInput('#param-M_ambalaj', DEFAULT_PRICING_PARAMS.M_ambalaj)),
        r_fire: Math.max(0, parseNumInput('#param-r_fire', DEFAULT_PRICING_PARAMS.r_fire)),
        k_kar: Math.max(0, parseNumInput('#param-k_kar', DEFAULT_PRICING_PARAMS.k_kar)),
        c_oran: Math.min(0.99, Math.max(0, parseNumInput('#param-c_oran', DEFAULT_PRICING_PARAMS.c_oran))),
        c_sabit: Math.max(0, parseNumInput('#param-c_sabit', DEFAULT_PRICING_PARAMS.c_sabit)),
        v_devlet: Math.min(0.99, Math.max(0, parseNumInput('#param-v_devlet', DEFAULT_PRICING_PARAMS.v_devlet)))
    };
}

function applyPricingParamsToInputs(params, forceOverwrite = false) {
    if (!params || typeof params !== 'object') return;
    const setIfNotFocused = (selector, val) => {
        if (val === undefined || val === null || !Number.isFinite(Number(val))) return;
        const $el = $(selector);
        if (forceOverwrite || !$el.is(':focus')) {
            $el.val(Number(val));
        }
    };
    setIfNotFocused('#pricing-t-input', params.t);
    setIfNotFocused('#param-G_saat', params.G_saat);
    setIfNotFocused('#param-t_hazirlik', params.t_hazirlik);
    setIfNotFocused('#param-F_kg', params.F_kg);
    setIfNotFocused('#param-P_makine', params.P_makine);
    setIfNotFocused('#param-E_kwh', params.E_kwh);
    setIfNotFocused('#param-A_saat', params.A_saat);
    setIfNotFocused('#param-M_ambalaj', params.M_ambalaj);
    setIfNotFocused('#param-r_fire', params.r_fire);
    setIfNotFocused('#param-k_kar', params.k_kar);
    setIfNotFocused('#param-c_oran', params.c_oran);
    setIfNotFocused('#param-c_sabit', params.c_sabit);
    setIfNotFocused('#param-v_devlet', params.v_devlet);
}

function hesaplaSatisFiyati({
    t,                 // Baskı süresi (saat)
    G_saat = 35,       // Saatlik filament tüketimi (gram/saat)
    t_hazirlik = 10,   // İlk hazırlık süresi (dakika, filament harcanmayan süre)
    F_kg = 500,        // Filament kg fiyatı (TL) - PETG için 700
    P_makine = 0.15,   // Güç tüketimi (kW) - ~150W
    E_kwh = 3.24,      // Elektrik kWh fiyatı (TL)
    A_saat = 8.0,      // Saatlik amortisman (TL)
    M_ambalaj = 15.0,  // Ambalaj maliyeti (TL)
    r_fire = 0.10,     // Fire oranı (%10)
    k_kar = 1.8,       // Kâr çarpanı
    c_oran = 0.0449,   // iyzico komisyon oranı (%4.49)
    c_sabit = 0.25,    // iyzico sabit işlem ücreti (TL)
    v_devlet = 0.04    // Devlet vergi oranı (%4 - iyzico'nun yatırdığı tutar üzerinden kesilir)
}) {
    // 0. İlk hazırlık süresi (dakika -> saat) düşülerek harcanan filament gramajı (w)
    const netFilamentSuresi = Math.max(0, t - (t_hazirlik / 60));
    const w = netFilamentSuresi * G_saat;

    // 1. Birim maliyetler
    const malzemeMaliyeti = w * (F_kg / 1000);
    const makineMaliyeti = t * (P_makine * E_kwh + A_saat);

    // 2. Ham maliyet (fire dahil)
    const hamMaliyet = (malzemeMaliyeti + makineMaliyeti + M_ambalaj) * (1 + r_fire);

    // 3. Kâr eklenmiş net hedef tutar (devlet vergisi ve iyzico kesintisi sonrası elde kalması gereken)
    const hedefTutar = hamMaliyet * k_kar;

    // 4. Devlet %4 vergiyi iyzico'nun bankaya yatırdığı tutar üzerinden kestiği için iyzico'dan yatması gereken tutar:
    const iyzicoYatmasiGereken = hedefTutar / (1 - v_devlet);

    // 5. iyzico komisyonunu da kompanse eden nihai satış fiyatı:
    const satisFiyati = (iyzicoYatmasiGereken + c_sabit) / (1 - c_oran);

    return Number(satisFiyati.toFixed(2));
}

function updatePricingUI() {
    const p = readPricingInputs();
    const netFilamentSuresi = Math.max(0, p.t - (p.t_hazirlik / 60));
    const w = netFilamentSuresi * p.G_saat;
    const malzemeMaliyeti = w * (p.F_kg / 1000);
    const makineMaliyeti = p.t * (p.P_makine * p.E_kwh + p.A_saat);
    const hamMaliyet = (malzemeMaliyeti + makineMaliyeti + p.M_ambalaj) * (1 + p.r_fire);
    const hedefTutar = hamMaliyet * p.k_kar;
    const iyzicoYatmasiGereken = hedefTutar / (1 - p.v_devlet);
    const satisFiyati = hesaplaSatisFiyati(p);
    const yuvarlanmisSatis = Math.round(satisFiyati / 10) * 10;

    $('#pricing-cost-output').text(`₺${hamMaliyet.toFixed(2)}`);
    $('#pricing-cost-breakdown').text(
        `Filament: ${w.toFixed(1)}g (₺${malzemeMaliyeti.toFixed(2)}) · Makine: ₺${makineMaliyeti.toFixed(2)} · Ambalaj: ₺${p.M_ambalaj.toFixed(2)}`
    );
    $('#pricing-sale-output').text(`₺${yuvarlanmisSatis}`);
    $('#pricing-raw-sale-note').text(`Yuvarlama öncesi: ₺${satisFiyati.toFixed(2)} · Net hedef: ₺${hedefTutar.toFixed(2)}`);

    $('#step-gramaj').text(`${w.toFixed(2)} g`);
    $('#step-malzeme').text(`₺${malzemeMaliyeti.toFixed(2)}`);
    $('#step-makine').text(`₺${makineMaliyeti.toFixed(2)}`);
    $('#step-ham').text(`₺${hamMaliyet.toFixed(2)}`);
    $('#step-hedef').text(`₺${hedefTutar.toFixed(2)}`);
    $('#step-vergi').text(`₺${iyzicoYatmasiGereken.toFixed(2)}`);
    $('#step-satis').text(`₺${satisFiyati.toFixed(2)}`);
}

/* Durum değişince müşteriye e-posta: yalnızca bildirimi olan durumlarda sorulur (sunucu: notifyOrderStatus) */
const MAIL_STATUSES = ['Ödendi', 'Hazırlanıyor', 'Kargolandı', 'Teslim Edildi', 'İptal'];
async function offerStatusMail(targets, status) {
    if (!MAIL_STATUSES.includes(status) || !targets.length) return;
    const who = targets.length === 1 ? 'Müşteriye' : `${targets.length} müşteriye`;
    if (!confirm(`${who} "${status}" bildirimi e-postayla gönderilsin mi?`)) return;
    // Tek siparişte kargo takip numarası da sorulur (boş bırakılabilir); müşteri e-postada ve sipariş sorgulamada görür
    const trackingNumber = status === 'Kargolandı' && targets.length === 1 ? (prompt('Kargo takip numarası (isteğe bağlı):', '') || '') : '';
    const notify = httpsCallable(functions, 'notifyOrderStatus');
    let sent = 0;
    for (const t of targets) {
        // jQuery .data() sayısal id'leri Number'a çevirir; sunucu string bekliyor
        try { await notify({ userId: String(t.userId), orderId: String(t.orderId), trackingNumber }); sent++; }
        catch (err) { showToast(`#${t.orderId}: e-posta gönderilemedi (${err.message})`, 'error'); }
    }
    if (sent) showToast(`${sent} bildirim e-postası gönderildi.`, 'success');
}

/* Gönderilen e-posta grafiği: son 30 gün ve son 12 ay (Resend ücretsiz kota: 100/gün, 3000/ay).
   Çubuklar dönemin en yüksek değerine göre ölçeklenir; kotanın %80'ini geçen gün/ay kırmızı. */
const MAIL_QUOTA = { day: 100, month: 3000 };
function renderMailStats(stats) {
    const daily = (stats && stats.daily) || {}, monthly = (stats && stats.monthly) || {};
    const ist = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }); // YYYY-MM-DD
    const days = [...Array(30)].map((_, i) => ist(new Date(Date.now() - (29 - i) * 864e5)));
    const now = new Date();
    const months = [...Array(12)].map((_, i) => ist(new Date(now.getFullYear(), now.getMonth() - 11 + i, 15)).slice(0, 7));
    const bars = (keys, data, quota) => {
        const max = Math.max(1, ...keys.map(k => data[k] || 0));
        // Sol eksen: üst = en yüksek değer, orta, 0
        const yAxis = `<i style="bottom:100%">${max}</i>${max > 1 ? `<i style="bottom:50%">${Math.round(max / 2)}</i>` : ''}<i style="bottom:0">0</i>`;
        return yAxis + keys.map(k => {
            const n = data[k] || 0;
            return `<div class="${n >= quota * 0.8 ? 'warn' : ''}" style="height:${n / max * 100}%" title="${k}: ${n} e-posta"${n ? ` data-n="${n}"` : ''}></div>`;
        }).join('');
    };
    // Alt eksen: bugünden geriye her `every` çubukta bir etiket
    const axis = (keys, fmt, every) => keys.map((k, i) => `<span>${(keys.length - 1 - i) % every === 0 ? fmt(k) : ''}</span>`).join('');
    $('#mail-daily-bars').html(bars(days, daily, MAIL_QUOTA.day));
    $('#mail-monthly-bars').html(bars(months, monthly, MAIL_QUOTA.month));
    $('#mail-daily-axis').html(axis(days, k => `${k.slice(8)}.${k.slice(5, 7)}`, 7));
    $('#mail-monthly-axis').html(axis(months, k => new Date(`${k}-15`).toLocaleDateString('tr-TR', { month: 'short' }), 1));
    $('#mail-today').text(`${daily[days[29]] || 0} / ${MAIL_QUOTA.day}`);
    $('#mail-month').text(`${monthly[months[11]] || 0} / ${MAIL_QUOTA.month}`);
}

// Helper
function showToast(message, type = "info") {
    const $container = $('#toast-container');
    const id = Date.now();
    const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
    const toastHtml = `<div id="toast-${id}" class="toast ${type}"><i class="fa-solid ${icon} toast-icon"></i><span class="toast-message">${esc(message)}</span></div>`;
    $container.append(toastHtml);
    setTimeout(() => { $(`#toast-${id}`).addClass('hiding').remove(); }, 4000);
}
