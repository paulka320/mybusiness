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
    const badge = document.getElementById('cart-count');

    if (badge) {
        badge.textContent = count;
    }
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
    alert(`Added ${product.title} to the cart.`);
}

function renderCartPage() {
    const container = document.getElementById('cart-items');
    if (!container) {
        return;
    }

    const cart = getCart();
    container.innerHTML = '';

    if (cart.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>Your cart is empty.</h3><p>Add products from the marketplace to see them here.</p></div>';
        return;
    }

    let total = 0;

    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;

        const row = document.createElement('div');
        row.className = 'cart-item';
        row.innerHTML = `
            <img src="uploads/${item.image}" alt="${item.title}">
            <div class="cart-item-meta">
                <h3>${item.title}</h3>
                <p>UGX ${Number(item.price).toLocaleString()}</p>
                <p>Quantity: ${item.quantity}</p>
            </div>
            <button class="remove-cart-item" data-id="${item.id}">Remove</button>
        `;

        container.appendChild(row);
    });

    const summary = document.createElement('div');
    summary.className = 'cart-summary';
    summary.innerHTML = `<strong>Total: UGX ${Number(total).toLocaleString()}</strong>`;
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
        container.innerHTML = '<div class="empty-state"><h3>Your cart is empty.</h3><p>Add products to your cart before checking out.</p></div>';
        document.getElementById('checkout-submit')?.setAttribute('disabled', 'true');
        document.getElementById('cart_data')?.setAttribute('value', JSON.stringify([]));
        return;
    }

    let total = 0;
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;

        const row = document.createElement('div');
        row.className = 'cart-item';
        row.innerHTML = `
            <img src="uploads/${item.image}" alt="${item.title}">
            <div class="cart-item-meta">
                <h3>${item.title}</h3>
                <p>UGX ${Number(item.price).toLocaleString()}</p>
                <p>Quantity: ${item.quantity}</p>
            </div>
            <div class="cart-item-meta">
                <p><strong>Subtotal:</strong> UGX ${Number(itemTotal).toLocaleString()}</p>
            </div>
        `;
        container.appendChild(row);
    });

    const summary = document.createElement('div');
    summary.className = 'cart-summary';
    summary.innerHTML = `<strong>Total: UGX ${Number(total).toLocaleString()}</strong>`;
    container.appendChild(summary);

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

        prevBtn.addEventListener('click', () => {
            currentIndex = (currentIndex > 0) ? currentIndex - 1 : images.length - 1;
            updateCarousel();
        });

        nextBtn.addEventListener('click', () => {
            currentIndex = (currentIndex < images.length - 1) ? currentIndex + 1 : 0;
            updateCarousel();
        });

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

        const removeButton = event.target.closest('.remove-cart-item');
        if (removeButton) {
            removeFromCart(Number(removeButton.dataset.id));
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
    updateCartCount();
    setupCartActions();
    setupCarousel();
    renderCartPage();
    renderCheckoutPage();
    if (window.orderPlaced) {
        clearCart();
    }
});