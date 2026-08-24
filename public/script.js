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

function setupCarousel() {
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

window.addEventListener('DOMContentLoaded', () => {
    setupMobileNav();
    updateCartCount();
    setupCartActions();
    setupCarousel();
    renderCartPage();
    renderCheckoutPage();
    if (window.orderPlaced) {
        clearCart();
    }
});
