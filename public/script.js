const CART_KEY = 'easyMarketCart';

function getCart() {
    const data = localStorage.getItem(CART_KEY);
    return data ? JSON.parse(data) : [];
}

function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCount();
}

function updateCartCount() {
    const cart = getCart();
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    const badgeDesktop = document.getElementById('cart-count');
    const badgeMobile = document.getElementById('cart-count-mobile');

    if (badgeDesktop) {
        badgeDesktop.textContent = count;
    }
    if (badgeMobile) {
        badgeMobile.textContent = count;
    }
}

function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span>${message}</span>
        <button type="button" class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-fade');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function addToCart(product) {
    const cart = getCart();
    const existing = cart.find(item => item.id === product.id);

    if (existing) {
        existing.quantity += (product.quantity || 1);
    } else {
        cart.push({ ...product, quantity: product.quantity || 1 });
    }

    saveCart(cart);
    showToast(`🛍️ Added "${product.title}" to your cart!`);
}

function setupMobileNav() {
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const mainNav = document.getElementById('site-main-nav');

    if (toggleBtn && mainNav) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = mainNav.classList.toggle('nav-open');
            toggleBtn.classList.toggle('is-active', isOpen);
            toggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!mainNav.contains(e.target) && !toggleBtn.contains(e.target) && mainNav.classList.contains('nav-open')) {
                mainNav.classList.remove('nav-open');
                toggleBtn.classList.remove('is-active');
                toggleBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }
}

function changeCartQuantity(id, delta) {
    const cart = getCart();
    const item = cart.find(i => i.id === id);
    if (!item) return;

    item.quantity += delta;
    if (item.quantity <= 0) {
        removeFromCart(id);
        return;
    }
    saveCart(cart);
    renderCartPage();
    renderCheckoutPage();
}

function renderCartPage() {
    const container = document.getElementById('cart-items');
    if (!container) {
        return;
    }

    const cart = getCart();
    container.innerHTML = '';

    const cartButtons = document.querySelector('.cart-buttons');

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🛒</div>
                <h3>Your shopping cart is empty</h3>
                <p>Browse our verified Ugandan marketplace and add genuine products to your cart.</p>
                <div class="empty-state-actions">
                    <a href="index.php" class="btn-primary">Browse Marketplace</a>
                </div>
            </div>
        `;
        if (cartButtons) {
            cartButtons.style.display = 'none';
        }
        return;
    }

    if (cartButtons) {
        cartButtons.style.display = 'flex';
    }

    let total = 0;
    const itemsList = document.createElement('div');
    itemsList.className = 'cart-items-list';

    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;

        const row = document.createElement('div');
        row.className = 'cart-item-card';
        row.innerHTML = `
            <img src="uploads/${item.image}" alt="${item.title}" class="cart-item-thumb">
            <div class="cart-item-details">
                <h3 class="cart-item-title">${item.title}</h3>
                <div class="cart-item-unit-price">UGX ${Number(item.price).toLocaleString()} each</div>
                <div class="cart-qty-controls">
                    <button type="button" class="btn-qty-adj" data-action="dec" data-id="${item.id}" aria-label="Decrease quantity">−</button>
                    <span class="qty-display">${item.quantity}</span>
                    <button type="button" class="btn-qty-adj" data-action="inc" data-id="${item.id}" aria-label="Increase quantity">+</button>
                </div>
            </div>
            <div class="cart-item-subtotal-box">
                <div class="subtotal-label">Subtotal</div>
                <div class="subtotal-val">UGX ${Number(itemTotal).toLocaleString()}</div>
                <button type="button" class="remove-cart-item-btn" data-id="${item.id}">🗑️ Remove</button>
            </div>
        `;

        itemsList.appendChild(row);
    });

    container.appendChild(itemsList);

    const summary = document.createElement('div');
    summary.className = 'cart-order-summary-box';
    summary.innerHTML = `
        <div class="summary-line">
            <span>Estimated Subtotal (${cart.reduce((s, i) => s + i.quantity, 0)} items)</span>
            <strong>UGX ${Number(total).toLocaleString()}</strong>
        </div>
        <div class="summary-line text-muted">
            <span>Delivery Verification</span>
            <span style="color: #16a34a; font-weight: 600;">Calculated at Checkout</span>
        </div>
        <div class="summary-total-line">
            <span>Total Payable</span>
            <span class="total-amount">UGX ${Number(total).toLocaleString()}</span>
        </div>
    `;
    container.appendChild(summary);
}

function renderCheckoutPage() {
    const container = document.getElementById('checkout-items');
    if (!container) {
        return;
    }

    const cart = getCart();
    container.innerHTML = '';

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🛒</div>
                <h3>Your cart is empty</h3>
                <p>Add products to your cart before proceeding to checkout.</p>
                <div class="empty-state-actions">
                    <a href="index.php" class="btn-primary">Browse Marketplace</a>
                </div>
            </div>
        `;
        document.getElementById('checkout-submit')?.setAttribute('disabled', 'true');
        document.getElementById('cart_data')?.setAttribute('value', JSON.stringify([]));
        return;
    }

    let total = 0;
    const table = document.createElement('div');
    table.className = 'checkout-items-summary';

    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;

        const row = document.createElement('div');
        row.className = 'checkout-item-row';
        row.innerHTML = `
            <img src="uploads/${item.image}" alt="${item.title}" class="checkout-item-thumb">
            <div class="checkout-item-info">
                <h4>${item.title}</h4>
                <p>Qty: <strong>${item.quantity}</strong> × UGX ${Number(item.price).toLocaleString()}</p>
            </div>
            <div class="checkout-item-subtotal">
                UGX ${Number(itemTotal).toLocaleString()}
            </div>
        `;
        table.appendChild(row);
    });

    const summary = document.createElement('div');
    summary.className = 'checkout-total-banner';
    summary.innerHTML = `
        <span>Order Total:</span>
        <strong class="total-price-large">UGX ${Number(total).toLocaleString()}</strong>
    `;
    table.appendChild(summary);

    container.appendChild(table);

    const cartInput = document.getElementById('cart_data');
    if (cartInput) {
        cartInput.value = JSON.stringify(cart);
    }
}

function removeFromCart(id) {
    const cart = getCart().filter(item => item.id !== id);
    saveCart(cart);
    renderCartPage();
    renderCheckoutPage();
}

function clearCart() {
    saveCart([]);
    renderCartPage();
    renderCheckoutPage();
}

function setupProductGallery() {
    const stage = document.getElementById('product-gallery-stage');
    if (!stage) return;

    const slides = stage.querySelectorAll('.gallery-slide-img');
    const prevBtn = document.getElementById('gallery-btn-prev');
    const nextBtn = document.getElementById('gallery-btn-next');
    const badgeSpan = document.querySelector('#gallery-angle-badge span');
    const thumbBtns = document.querySelectorAll('.gallery-thumb-btn');

    if (slides.length === 0) return;

    let currentIndex = 0;

    function goToIndex(index) {
        if (index < 0) {
            index = slides.length - 1;
        } else if (index >= slides.length) {
            index = 0;
        }
        currentIndex = index;

        slides.forEach((slide, idx) => {
            slide.classList.toggle('active', idx === currentIndex);
        });

        thumbBtns.forEach((btn, idx) => {
            const isActive = idx === currentIndex;
            btn.classList.toggle('active', isActive);
            if (isActive) {
                btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        });

        if (badgeSpan) {
            const activeThumb = document.querySelector(`.gallery-thumb-btn[data-index="${currentIndex}"]`);
            if (activeThumb && activeThumb.dataset.label) {
                badgeSpan.textContent = activeThumb.dataset.label;
            } else {
                badgeSpan.textContent = `Angle ${currentIndex + 1} of ${slides.length}`;
            }
        }
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            goToIndex(currentIndex - 1);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            goToIndex(currentIndex + 1);
        });
    }

    thumbBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const idx = parseInt(btn.dataset.index, 10);
            if (!isNaN(idx)) {
                goToIndex(idx);
            }
        });
    });

    // Keyboard Arrow navigation for desktop
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'ArrowLeft') {
            goToIndex(currentIndex - 1);
        } else if (e.key === 'ArrowRight') {
            goToIndex(currentIndex + 1);
        }
    });

    // Touch swipe support on mobile
    let touchStartX = 0;
    let touchEndX = 0;
    stage.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    stage.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diff = touchEndX - touchStartX;
        if (Math.abs(diff) > 40) {
            if (diff > 0) {
                goToIndex(currentIndex - 1);
            } else {
                goToIndex(currentIndex + 1);
            }
        }
    }, { passive: true });
}

function setupCarousel() {
    setupProductGallery();
    document.querySelectorAll('.image-carousel').forEach(carousel => {
        const images = carousel.querySelectorAll('.carousel-image');
        if (images.length <= 1) return;

        let currentIndex = 0;
        const prevBtn = carousel.parentElement.querySelector('.carousel-prev');
        const nextBtn = carousel.parentElement.querySelector('.carousel-next');
        const indicators = carousel.parentElement.querySelectorAll('.indicator');

        function updateCarousel() {
            carousel.style.transform = `translateX(-${currentIndex * 100}%)`;
            indicators.forEach((dot, index) => {
                dot.classList.toggle('active', index === currentIndex);
            });
        }

        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                currentIndex = (currentIndex > 0) ? currentIndex - 1 : images.length - 1;
                updateCarousel();
            });
        }

        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                currentIndex = (currentIndex < images.length - 1) ? currentIndex + 1 : 0;
                updateCarousel();
            });
        }

        indicators.forEach(dot => {
            dot.addEventListener('click', () => {
                currentIndex = Number(dot.dataset.index);
                updateCarousel();
            });
        });
    });
}

function setupCartActions() {
    document.addEventListener('submit', event => {
        const form = event.target.closest('.add-to-cart-form');
        if (form) {
            event.preventDefault();
            const button = form.querySelector('.cart-action');
            const quantityInput = form.querySelector('input[name="quantity"]');
            const quantity = parseInt(quantityInput.value) || 1;

            const product = {
                id: Number(button.dataset.id),
                title: button.dataset.title,
                price: Number(button.dataset.price),
                image: button.dataset.image || '',
                quantity: quantity
            };
            addToCart(product);
            return;
        }
    });

    document.addEventListener('click', event => {
        const addButton = event.target.closest('.cart-action');
        if (addButton && !addButton.closest('.add-to-cart-form')) {
            const product = {
                id: Number(addButton.dataset.id),
                title: addButton.dataset.title,
                price: Number(addButton.dataset.price),
                image: addButton.dataset.image || ''
            };
            addToCart(product);
            return;
        }

        const removeButton = event.target.closest('.remove-cart-item, .remove-cart-item-btn');
        if (removeButton) {
            removeFromCart(Number(removeButton.dataset.id));
            return;
        }

        const qtyBtn = event.target.closest('.btn-qty-adj');
        if (qtyBtn) {
            const id = Number(qtyBtn.dataset.id);
            const action = qtyBtn.dataset.action;
            changeCartQuantity(id, action === 'inc' ? 1 : -1);
            return;
        }

        if (event.target.matches('#clear-cart')) {
            clearCart();
        }
    });

    const checkoutForm = document.getElementById('checkout-form');
    if (checkoutForm) {
        checkoutForm.addEventListener('submit', () => {
            const cartInput = document.getElementById('cart_data');
            if (cartInput) {
                cartInput.value = JSON.stringify(getCart());
            }
        });
    }
}

// -------------------------------------------------------------
// WhatsApp Business Dispatcher (Destination: 0763480495)
// Connects client's registered account to 0763480495
// -------------------------------------------------------------
function cleanUgandaWhatsAppNumber(num) {
    if (!num) return '';
    let cleaned = num.toString().replace(/[^0-9]/g, '');
    if (cleaned.startsWith('00256')) cleaned = cleaned.substring(2);
    else if (cleaned.startsWith('0') && cleaned.length === 10) cleaned = '256' + cleaned.substring(1);
    else if (!cleaned.startsWith('256') && cleaned.length === 9) cleaned = '256' + cleaned;
    return cleaned;
}

function promptForUserWhatsApp(callback) {
    let savedNum = localStorage.getItem('user_whatsapp') || (window.EASY_MARKET_USER && window.EASY_MARKET_USER.whatsapp_number) || '';
    
    // Create interactive modal overlay
    let overlay = document.getElementById('wa-num-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'wa-num-modal';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(15, 23, 42, 0.7)';
        overlay.style.backdropFilter = 'blur(4px)';
        overlay.style.zIndex = '99999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.padding = '16px';
        overlay.style.boxSizing = 'border-box';

        overlay.innerHTML = `
            <div style="background: #ffffff; border-radius: 16px; max-width: 440px; width: 100%; padding: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.2); font-family: inherit; position: relative;">
                <button type="button" id="wa-modal-close" style="position: absolute; top: 14px; right: 14px; background: none; border: none; font-size: 22px; cursor: pointer; color: #94a3b8;">&times;</button>
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                    <span style="font-size: 28px;">💬</span>
                    <div>
                        <h3 style="margin: 0; font-size: 1.15rem; color: #0f172a; font-weight: 800;">Send via Your WhatsApp</h3>
                        <span style="font-size: 12px; color: #16a34a; font-weight: 700;">To EasyMarket Line: 0763480495</span>
                    </div>
                </div>
                <p style="font-size: 13px; color: #475569; line-height: 1.5; margin: 0 0 16px;">
                    Please provide or confirm your <strong>WhatsApp Phone Number</strong> so EasyMarket dispatch receives and verifies your message from your personal WhatsApp account.
                </p>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-size: 12.5px; font-weight: 700; color: #334155; margin-bottom: 6px;">Your WhatsApp Phone Number:</label>
                    <input type="tel" id="wa-modal-input" placeholder="e.g. 0763480495 or 0701234567" value="${savedNum}" style="width: 100%; box-sizing: border-box; padding: 12px 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 14px; font-weight: 600; color: #0f172a;">
                </div>
                <div style="display: flex; gap: 10px;">
                    <button type="button" id="wa-modal-submit" class="btn-whatsapp" style="flex: 1; padding: 12px; font-size: 14px; font-weight: 700; border-radius: 10px; justify-content: center; cursor: pointer;">
                        🚀 Open WhatsApp Account
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    } else {
        const input = document.getElementById('wa-modal-input');
        if (input && savedNum) input.value = savedNum;
        overlay.style.display = 'flex';
    }

    const closeBtn = document.getElementById('wa-modal-close');
    const submitBtn = document.getElementById('wa-modal-submit');
    const inputField = document.getElementById('wa-modal-input');

    const handleClose = () => {
        overlay.style.display = 'none';
    };

    closeBtn.onclick = handleClose;
    overlay.onclick = (e) => {
        if (e.target === overlay) handleClose();
    };

    submitBtn.onclick = () => {
        const entered = (inputField.value || '').trim();
        if (entered) {
            localStorage.setItem('user_whatsapp', entered);
            if (window.EASY_MARKET_USER) {
                window.EASY_MARKET_USER.whatsapp_number = entered;
            }
        }
        overlay.style.display = 'none';
        callback(entered || savedNum || 'Registered Client');
    };
}

function openWhatsAppChatToBusiness(originalUrl, customMessage) {
    const businessNumber = '256763480495';
    let savedNum = (window.EASY_MARKET_USER && window.EASY_MARKET_USER.whatsapp_number) || localStorage.getItem('user_whatsapp') || '';
    let savedName = (window.EASY_MARKET_USER && window.EASY_MARKET_USER.name) || localStorage.getItem('user_name') || 'Customer';

    const executeLaunch = (senderWhatsApp) => {
        let textToSend = '';
        if (customMessage) {
            textToSend = customMessage;
        } else if (originalUrl && originalUrl.includes('text=')) {
            try {
                const urlObj = new URL(originalUrl, window.location.origin);
                textToSend = decodeURIComponent(urlObj.searchParams.get('text') || '');
            } catch(e) {
                const parts = originalUrl.split('text=');
                if (parts[1]) textToSend = decodeURIComponent(parts[1]);
            }
        }

        if (!textToSend) {
            textToSend = `Hello EasyMarket! I am ${savedName} (messaging from my WhatsApp: ${senderWhatsApp}). I have an inquiry regarding marketplace items.`;
        }

        // Ensure the sender's WhatsApp is mentioned in the message if not already present
        if (senderWhatsApp && !textToSend.includes(senderWhatsApp)) {
            textToSend = `[Sender WhatsApp: ${senderWhatsApp} | Name: ${savedName}]\n` + textToSend;
        }

        const encoded = encodeURIComponent(textToSend);
        
        // Multi-tier universal launch sequence:
        // 1. Direct App Scheme (Opens native WhatsApp on mobile / desktop app)
        // 2. Official Web API (api.whatsapp.com)
        // 3. WhatsApp Web fallback (web.whatsapp.com)
        const appScheme = `whatsapp://send?phone=${businessNumber}&text=${encoded}`;
        const apiUrl = `https://api.whatsapp.com/send?phone=${businessNumber}&text=${encoded}`;
        const webUrl = `https://web.whatsapp.com/send?phone=${businessNumber}&text=${encoded}`;

        const isMobile = /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent);

        if (isMobile) {
            // Attempt to trigger native app
            window.location.href = appScheme;
            setTimeout(() => {
                window.open(apiUrl, '_blank');
            }, 800);
        } else {
            // Desktop browser: open official API which offers Desktop App + WhatsApp Web
            window.open(apiUrl, '_blank');
        }
    };

    if (!savedNum) {
        promptForUserWhatsApp(executeLaunch);
    } else {
        executeLaunch(savedNum);
    }
}

function setupWhatsAppButtonListeners() {
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-whatsapp, .btn-whatsapp-sm, #btn-chat-whatsapp');
        if (btn) {
            e.preventDefault();
            const href = btn.getAttribute('href') || '';
            openWhatsAppChatToBusiness(href);
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    setupMobileNav();
    updateCartCount();
    setupCartActions();
    setupCarousel();
    setupWhatsAppButtonListeners();
    renderCartPage();
    renderCheckoutPage();
    if (window.orderPlaced) {
        clearCart();
    }
});

