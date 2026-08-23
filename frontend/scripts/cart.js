

// ==================== CONFIGURATION ====================
const CART_CONFIG = {
    EXPIRY_DAYS: 7,
    MAX_QUANTITY: 99,
    MIN_QUANTITY: 1,
    UNDO_TIMEOUT: 5000, // 5 seconds
    SAVE_FOR_LATER_KEY: 'savedForLater',
    GUEST_CART_KEY: 'guestCart',
    CART_EXPIRY_KEY: 'cartExpiry'
};

// ==================== STATE ====================
let cart = [];
let selectedItems = new Set();
let savedForLater = [];
let undoAction = null;
let isLoading = false;

(() => {
const elements = {
    cartContainer: document.getElementById("cart-items"),
    subtotalElement: document.getElementById("subtotal"),
    taxElement: document.getElementById("tax"),
    totalElement: document.getElementById("total"),
    shippingElement: document.getElementById("shipping"),
    freeShippingProgress: document.getElementById("free-shipping-progress"),
    discountElement: document.getElementById("discount"),
    checkoutBtn: document.getElementById("checkout-btn"),
    emptyCartBtn: document.getElementById("empty-cart-btn"),
    couponForm: document.getElementById("coupon-form"),
    couponCode: document.getElementById("coupon-code"),
    couponMessage: document.getElementById("coupon-message"),
    // Selection, bulk actions, saved-for-later and the expiry notice. Every one
    // of these resolved to null until #1584 added the markup to cart.html: the
    // code behind them shipped, the elements it needed did not.
    bulkActions: document.getElementById("bulk-actions"),
    bulkRemoveBtn: document.getElementById("bulk-remove-btn"),
    bulkSaveLaterBtn: document.getElementById("bulk-save-later-btn"),
    selectAll: document.getElementById("select-all"),
    selectedCount: document.getElementById("selected-count"),
    cartItemCount: document.getElementById("cart-item-count"),
    savedForLaterContainer: document.getElementById("saved-for-later-container"),
    cartExpiryWarning: document.getElementById("cart-expiry-warning")
};

let appliedCoupon = AppUtils.getJSON("appliedCoupon", "");
cart = AppUtils.getCart();

// ==================== LOAD SAVED FOR LATER ====================
function loadSavedForLater() {
    try {
        const saved = localStorage.getItem(CART_CONFIG.SAVE_FOR_LATER_KEY);
        if (saved) {
            savedForLater = JSON.parse(saved);
        }
    } catch (error) {
        console.error('Load saved for later error:', error);
    }
}

function saveSavedForLater() {
    try {
        localStorage.setItem(CART_CONFIG.SAVE_FOR_LATER_KEY, JSON.stringify(savedForLater));
    } catch (error) {
        console.error('Save saved for later error:', error);
    }
}

// ==================== CART EXPIRY ====================
function checkCartExpiry() {
    const expiry = localStorage.getItem(CART_CONFIG.CART_EXPIRY_KEY);
    if (expiry && new Date(expiry) < new Date()) {
        // Cart expired
        if (cart.length > 0) {
            AppUtils.notify('Your cart has expired. Items have been removed.', 'warning');
            cart = [];
            AppUtils.saveCart(cart);
            localStorage.removeItem(CART_CONFIG.CART_EXPIRY_KEY);
            renderCart();
        }
        return true;
    }
    return false;
}

function setCartExpiry() {
    const expiryDate = new Date(Date.now() + CART_CONFIG.EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    localStorage.setItem(CART_CONFIG.CART_EXPIRY_KEY, expiryDate.toISOString());
}

function getDaysUntilExpiry() {
    const expiry = localStorage.getItem(CART_CONFIG.CART_EXPIRY_KEY);
    if (!expiry) return null;
    const diff = new Date(expiry) - new Date();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Show the undo toast for a destructive action.
//
// Called from three places -- single-item remove, empty cart, and the bulk
// remove this change wires up -- and declared in none of them. It was dropped
// by the same merge that recommented the `decreaseBtn` declaration (#1535), and
// went unnoticed because that ReferenceError fires first on the two paths that
// already existed. `bulkRemove` cannot work without it, so it comes back here,
// as it stood in 49e3b64.
//
// The contract the three call sites rely on: `onConfirm` runs when the window
// closes (timeout, or the shopper dismissing the toast) and `onUndo` runs if
// they take it back, with only one of the two ever running.
//
// @param {string} message
// @param {Function} onUndo
// @param {Function} onConfirm
function showUndoToast(message, onUndo, onConfirm) {
    const toast = document.getElementById('undo-toast');
    if (!toast) {
        createUndoToast();
        return showUndoToast(message, onUndo, onConfirm);
    }

    toast.querySelector('.toast-message').textContent = message;
    toast.classList.add('show');

    // A second action while one is pending: settle the first rather than
    // leaving its timeout to fire against a cart that has moved on.
    if (undoAction) {
        clearTimeout(undoAction.timeout);
        if (undoAction.onConfirm) {
            undoAction.onConfirm();
        }
    }

    undoAction = {
        onUndo,
        onConfirm,
        timeout: setTimeout(() => {
            if (onConfirm) {
                onConfirm();
            }
            hideUndoToast();
            undoAction = null;
        }, CART_CONFIG.UNDO_TIMEOUT)
    };

    const undoBtn = toast.querySelector('.undo-btn');
    undoBtn.onclick = () => {
        if (!undoAction) return;

        clearTimeout(undoAction.timeout);
        if (undoAction.onUndo) {
            undoAction.onUndo();
        }
        hideUndoToast();
        undoAction = null;
        AppUtils.notify('Action undone', 'success');
    };
}

function createUndoToast() {
    const toast = document.createElement('div');
    toast.id = 'undo-toast';
    toast.className = 'undo-toast';
    toast.innerHTML = `
        <span class="toast-message"></span>
        <button class="undo-btn">Undo</button>
        <button class="close-toast-btn">&times;</button>
    `;
    document.body.appendChild(toast);
    
    toast.querySelector('.close-toast-btn').onclick = () => {
        hideUndoToast();
        if (undoAction) {
            clearTimeout(undoAction.timeout);
            if (undoAction.onConfirm) {
                undoAction.onConfirm();
            }
            undoAction = null;
        }
    };
}

function hideUndoToast() {
    const toast = document.getElementById('undo-toast');
    if (toast) {
        toast.classList.remove('show');
    }
}

// ==================== LOADING STATES ====================
function showLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.add('loading');
        const spinner = element.querySelector('.spinner');
        if (!spinner) {
            const spinnerEl = document.createElement('div');
            spinnerEl.className = 'spinner';
            element.prepend(spinnerEl);
        }
        element.disabled = true;
    }
    isLoading = true;
}

function hideLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.remove('loading');
        const spinner = element.querySelector('.spinner');
        if (spinner) {
            spinner.remove();
        }
        element.disabled = false;
    }
    isLoading = false;
}

function setCouponMessage(message = "", type = "") {
    if (!elements.couponMessage) return;
    elements.couponMessage.textContent = message;
    elements.couponMessage.className = `coupon-message ${type}`.trim();
}

function syncSharedCartUI() {
    if (typeof updateCartCount === "function") {
        updateCartCount();
    }
    if (typeof renderCartDrawer === "function") {
        renderCartDrawer();
    }
}

function saveAndRender(nextCart) {
    cart = AppUtils.saveCart(nextCart);
    setCartExpiry();
    renderCart();
    syncSharedCartUI();
}

// ==================== UPDATE BUTTON STATES ====================
function updateButtonStates() {
    document.querySelectorAll('.cart-item').forEach((itemEl) => {
        const qtySpan = itemEl.querySelector('.cart-qty-controls span') || itemEl.querySelector('.qty-input');
        const decreaseBtn = itemEl.querySelector('.decrease-qty');
        if (!qtySpan || !decreaseBtn) return;
        const qty = parseInt(qtySpan.value || qtySpan.textContent, 10);
        decreaseBtn.disabled = (qty <= 1);
        if (qty <= 1) {
            decreaseBtn.style.opacity = '0.5';
            decreaseBtn.style.cursor = 'not-allowed';
            decreaseBtn.title = 'Minimum quantity is 1';
        } else {
            decreaseBtn.style.opacity = '1';
            decreaseBtn.style.cursor = 'pointer';
            decreaseBtn.title = '';
        }
    });
}

// ==================== UPDATE CART TOTALS ====================
async function updateCartTotals() {
    // Server-priced, so the cart and the checkout page cannot show different
    // numbers for the same basket. Falls back to the local calculation when the
    // quote cannot be fetched.
    const totals = await AppUtils.fetchCartQuote(cart, appliedCoupon);

    // The breakdown states the currency it was priced in; render in that rather
    // than in a local constant.
    const currency = totals.currency;

    AppUtils.setJSON("shippingCost", totals.shipping);
    AppUtils.setJSON("cartTotals", totals);

    if (elements.subtotalElement) {
        elements.subtotalElement.innerText = AppUtils.formatPrice(totals.subtotal, currency);
    }
    if (elements.taxElement) {
        elements.taxElement.innerText = AppUtils.formatPrice(totals.tax, currency);
    }
    if (elements.shippingElement) {
        elements.shippingElement.innerText = totals.shipping === 0 ? "Free" : AppUtils.formatPrice(totals.shipping, currency);
    }
    if (elements.freeShippingProgress) {
        // The cart is where this matters most: it is the last screen where
        // adding another item is still the obvious thing to do.
        elements.freeShippingProgress.innerText =
            AppUtils.formatFreeShippingProgress(totals.freeShipping, currency);
    }
    if (elements.discountElement) {
        elements.discountElement.innerText = `-${AppUtils.formatPrice(totals.discount > 0 ? totals.discount : 0, currency)}`;
    }
    if (elements.totalElement) {
        elements.totalElement.innerText = AppUtils.formatPrice(totals.total, currency);
    }
    
    // Update cart item count. The element is cached with the rest rather than
    // looked up again on every totals refresh; #cart-item-count was not in
    // cart.html at all, so this had never written anywhere (#1584).
    const itemCount = cart.reduce((sum, item) => sum + (item.qty || 1), 0);
    if (elements.cartItemCount) {
        elements.cartItemCount.textContent =
            `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
    }
    
    // Update expiry warning
    updateExpiryWarning();
}

// ==================== EXPIRY WARNING ====================
function updateExpiryWarning() {
    const warningElement = elements.cartExpiryWarning;
    if (!warningElement) return;
    
    const daysLeft = getDaysUntilExpiry();
    if (daysLeft === null || cart.length === 0) {
        warningElement.style.display = 'none';
        return;
    }
    
    if (daysLeft <= 2) {
        warningElement.style.display = 'block';
        warningElement.innerHTML = `
            <i class="fas fa-clock"></i>
            Your cart will expire in ${daysLeft} day${daysLeft > 1 ? 's' : ''}. 
            <a href="/checkout">Checkout now</a> to save your items.
        `;
        warningElement.className = 'cart-expiry-warning urgent';
    } else if (daysLeft <= 5) {
        warningElement.style.display = 'block';
        warningElement.innerHTML = `
            <i class="fas fa-clock"></i>
            Your cart will expire in ${daysLeft} days.
        `;
        warningElement.className = 'cart-expiry-warning warning';
    } else {
        warningElement.style.display = 'none';
    }
}

// ==================== SAVE FOR LATER ====================
function saveForLater(index) {
    const item = cart[index];
    if (!item) return;
    
    // Check if already saved
    const exists = savedForLater.some(
        saved => String(saved.id) === String(item.id) && 
                saved.color === item.color && 
                saved.size === item.size
    );
    
    if (exists) {
        AppUtils.notify('Item already saved for later', 'warning');
        return;
    }
    
    // Remove from cart
    const removedItem = cart.splice(index, 1)[0];
    
    // Add to saved for later
    savedForLater.push({
        ...removedItem,
        savedAt: new Date().toISOString()
    });
    saveSavedForLater();
    
    saveAndRender(cart);
    AppUtils.notify('Saved for later', 'success');
}

async function moveToCart(index) {
    const item = savedForLater[index];
    if (!item) return;

    const countBefore = AppUtils.getCartCount();

    // Adding goes through the shared helper so the line is reserved and the
    // account has the final say on it.
    cart = await AppUtils.addCartItem(item);

    // A refused add has already told the shopper why; the item stays in saved
    // items so nothing is lost.
    if (AppUtils.getCartCount(cart) <= countBefore) {
        renderCart();
        return;
    }

    savedForLater.splice(index, 1);
    saveSavedForLater();

    setCartExpiry();
    renderCart();
    syncSharedCartUI();
    AppUtils.notify('Moved to cart', 'success');
}

function removeSavedItem(index) {
    savedForLater.splice(index, 1);
    saveSavedForLater();
    renderCart();
    AppUtils.notify('Removed from saved items', 'success');
}

// ==================== BULK OPERATIONS ====================
const itemKey = (value) => String(value);

/** Is this cart line currently selected? */
function isSelected(item) {
    return selectedItems.has(itemKey(item?.id));
}

/**
 * Drop anything from the selection that is no longer in the cart.
 */
function pruneSelection() {
    const present = new Set(cart.map((item) => itemKey(item.id)));

    for (const key of [...selectedItems]) {
        if (!present.has(key)) selectedItems.delete(key);
    }
}

function toggleSelectAll() {
    const selectAll = elements.selectAll;
    if (!selectAll) return;

    const isChecked = selectAll.checked;

    document.querySelectorAll('.cart-item-select').forEach(checkbox => {
        checkbox.checked = isChecked;
        const key = itemKey(checkbox.dataset.itemId);

        if (isChecked) {
            selectedItems.add(key);
        } else {
            selectedItems.delete(key);
        }
    });

    updateBulkActions();
}

function toggleSelectItem(itemId) {
    const key = itemKey(itemId);

    if (selectedItems.has(key)) {
        selectedItems.delete(key);
    } else {
        selectedItems.add(key);
    }

    updateBulkActions();
}

/**
 * Reflect the selection in the toolbar.
 */
function updateBulkActions() {
    const bulkActions = elements.bulkActions;
    const selectedCount = elements.selectedCount;
    const selectAll = elements.selectAll;
    const total = cart.length;
    const selected = selectedItems.size;

    if (bulkActions && selectedCount) {
        if (selected > 0) {
            bulkActions.style.display = 'flex';
            selectedCount.textContent =
                `${selected} ${selected === 1 ? 'item' : 'items'} selected`;
        } else {
            bulkActions.style.display = 'none';
        }
    }

    if (selectAll) {
        selectAll.checked = total > 0 && selected === total;
        selectAll.indeterminate = selected > 0 && selected < total;
        selectAll.disabled = total === 0;
    }
}

function bulkRemove() {
    if (selectedItems.size === 0) return;

    const removedItems = cart.filter(isSelected);
    const count = removedItems.length;
    const noun = count === 1 ? 'item' : 'items';

    cart = cart.filter((item) => !isSelected(item));
    selectedItems.clear();
    saveAndRender(cart);

    showUndoToast(
        `Removing ${count} ${noun} from cart`,
        () => {
            saveAndRender([...cart, ...removedItems]);
        },
        () => {
            AppUtils.notify(`Removed ${count} ${noun} from cart`, 'success');
        }
    );
}

function bulkSaveForLater() {
    if (selectedItems.size === 0) return;

    const itemsToSave = cart.filter(isSelected);
    const count = itemsToSave.length;

    cart = cart.filter((item) => !isSelected(item));

    itemsToSave.forEach((item) => {
        const alreadySaved = savedForLater.some(
            (saved) =>
                String(saved.id) === String(item.id)
                && saved.color === item.color
                && saved.size === item.size
        );

        if (alreadySaved) return;

        savedForLater.push({
            ...item,
            savedAt: new Date().toISOString()
        });
    });
    saveSavedForLater();

    selectedItems.clear();
    saveAndRender(cart);
    AppUtils.notify(
        `Saved ${count} ${count === 1 ? 'item' : 'items'} for later`,
        'success'
    );
}

// ==================== ESTIMATED DELIVERY ====================
function calculateEstimatedDelivery() {
    const today = new Date();
    const deliveryDate = new Date(today);
    
    let daysToAdd = 3;
    if (today.getDay() >= 4) { // Thursday or later
        daysToAdd = 5;
    }
    
    deliveryDate.setDate(deliveryDate.getDate() + daysToAdd);
    
    return deliveryDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

// ==================== RENDER CART ====================
function renderCart() {
    if (!elements.cartContainer) return;

    cart = AppUtils.getCart();
    loadSavedForLater();
    checkCartExpiry();

    pruneSelection();

    if (!cart.length && !savedForLater.length) {
        renderEmptyCart();
        return;
    }

    if (elements.checkoutBtn) {
        elements.checkoutBtn.disabled = false;
    }
    if (elements.emptyCartBtn) {
        elements.emptyCartBtn.disabled = false;
    }

    const fragment = document.createDocumentFragment();
    const deliveryEstimate = calculateEstimatedDelivery();

    // Cart items
    cart.forEach((item, index) => {
        const qty = Math.max(1, AppUtils.safeInteger(item.qty, 1));
        const price = AppUtils.safeNumber(item.price, 0);
        const selected = isSelected(item);

        const cartItem = document.createElement("div");
        cartItem.classList.add("cart-item");
        cartItem.dataset.index = index;

        cartItem.innerHTML = `
            <div class="cart-item-select-wrapper">
                <input type="checkbox" class="cart-item-select"
                    data-item-id="${AppUtils.escapeHTML(String(item.id))}"
                    aria-label="Select ${AppUtils.escapeHTML(item.name || "Product")}"
                    ${selected ? 'checked' : ''}></div>
            <img src="${AppUtils.escapeHTML(AppUtils.defaultImage(item.img || item.image))}"
                alt="${AppUtils.escapeHTML(item.name || "Product")}"
                loading="lazy">
            <div class="cart-item-info">
                <h3>${AppUtils.escapeHTML(item.name || "Product")}</h3>
                <p>Price: ${AppUtils.formatPrice(price)}</p>
                ${item.color ? `<p>Color: ${AppUtils.escapeHTML(item.color)}</p>` : ""}
                ${item.size ? `<p>Size: ${AppUtils.escapeHTML(item.size)}</p>` : ""}
                
                ${item.note ? `<p class="item-note">Note: ${AppUtils.escapeHTML(item.note)}</p>` : ""}
                
                <div class="item-notes">
                    <input type="text" class="note-input"
                        placeholder="Add a note..."
                        value="${AppUtils.escapeHTML(item.note || '')}"
                        data-index="${index}">
                </div>
                
                <div class="cart-qty-controls" aria-label="Quantity controls">
                    <button type="button" data-index="${index}" class="decrease-qty" 
                            aria-label="Decrease quantity" ${qty <= 1 ? "disabled" : ""}>
                        -
                    </button>
                    <input type="number" class="qty-input"
                        value="${qty}" min="${CART_CONFIG.MIN_QUANTITY}" max="${CART_CONFIG.MAX_QUANTITY}"
                        aria-label="Quantity"
                        data-index="${index}">
                    <button type="button" data-index="${index}" class="increase-qty" 
                            aria-label="Increase quantity">
                        +
                    </button>
                </div>
                
                <div class="delivery-estimate">
                    <small>🚚 Estimated delivery: ${deliveryEstimate}</small>
                </div>
            </div>
            <div class="cart-item-actions">
                <strong>${AppUtils.formatPrice(price * qty)}</strong>
                <button type="button" class="save-later-btn" data-index="${index}">
                    <i class="far fa-clock"></i> Save for later
                </button>
                <button type="button" class="move-wishlist-btn" data-index="${index}">
                    Move to Wishlist
                </button>
                <button type="button" class="remove-btn" data-index="${index}">
                    Remove
                </button>
            </div>
        `;

        fragment.appendChild(cartItem);
    });

    // Saved for later section
    if (savedForLater.length > 0) {
        const savedSection = document.createElement("div");
        savedSection.id = "saved-for-later-section";
        savedSection.innerHTML = `
            <h3>Saved for Later (${savedForLater.length})</h3>
            <div class="saved-items-container">
                ${savedForLater.map((item, idx) => `
                    <div class="saved-item" data-saved-index="${idx}">
                        <img src="${AppUtils.escapeHTML(AppUtils.defaultImage(item.img || item.image))}" 
                            alt="${AppUtils.escapeHTML(item.name)}">
                        <div class="saved-item-info">
                            <h4>${AppUtils.escapeHTML(item.name)}</h4>
                            <p>${AppUtils.formatPrice(item.price)}</p>
                            <small>Saved on ${new Date(item.savedAt).toLocaleDateString()}</small>
                        </div>
                        <div class="saved-item-actions">
                            <button class="move-to-cart-btn" data-saved-index="${idx}">
                                <i class="fas fa-shopping-cart"></i> Move to cart
                            </button>
                            <button class="remove-saved-btn" data-saved-index="${idx}">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        if (elements.savedForLaterContainer) {
            elements.savedForLaterContainer.replaceChildren(savedSection);
        } else {
            fragment.appendChild(savedSection);
        }
    } else if (elements.savedForLaterContainer) {
        elements.savedForLaterContainer.replaceChildren();
    }

    elements.cartContainer.replaceChildren(fragment);

    updateButtonStates();
    updateBulkActions();
    updateCartTotals();
}

// ==================== EMPTY CART ====================
function renderEmptyCart() {
    if (elements.cartContainer) {
        elements.cartContainer.innerHTML = `
            <div class="empty-cart">
                <i class="fas fa-shopping-cart empty-cart-icon"></i>
                <h2>Your cart is empty</h2>
                <p>Looks like you haven't added any items to your cart yet.</p>
                <p class="empty-cart-sub">Start shopping to fill your cart with amazing products!</p>
                <button id="continue-shopping-btn" class="continue-shopping-btn">
                    <i class="fas fa-arrow-left"></i> Continue Shopping
                </button>
            </div>
        `;
        const continueBtn = document.getElementById('continue-shopping-btn');
        if (continueBtn) {
            continueBtn.addEventListener('click', function(e) {
                e.preventDefault();
                window.location.href = 'shop.html';
            });
        }
    }
    if (elements.checkoutBtn) {
        elements.checkoutBtn.disabled = true;
    }
    if (elements.emptyCartBtn) {
        elements.emptyCartBtn.disabled = true;
    }

    selectedItems.clear();
    updateBulkActions();

    updateCartTotals(0);
}

// ==================== QUANTITY UPDATE ====================
function updateQuantity(index, newQty) {
    if (!cart[index]) return;
    
    const qty = Math.max(CART_CONFIG.MIN_QUANTITY, Math.min(CART_CONFIG.MAX_QUANTITY, newQty));
    cart[index].qty = qty;
    saveAndRender(cart);
}

// ==================== ITEM NOTE UPDATE ====================
function updateItemNote(index, note) {
    if (!cart[index]) return;
    cart[index].note = note;
    AppUtils.saveCart(cart);
    updateCartTotals();
}

// ==================== EVENT LISTENERS ====================
document.addEventListener("click", (event) => {
    const increaseBtn = event.target.closest(".increase-qty");
    const decreaseBtn = event.target.closest(".decrease-qty");
    const removeBtn = event.target.closest(".remove-btn");
    const wishlistBtn = event.target.closest(".move-wishlist-btn");
    const saveLaterBtn = event.target.closest(".save-later-btn");
    const moveToCartBtn = event.target.closest(".move-to-cart-btn");
    const removeSavedBtn = event.target.closest(".remove-saved-btn");

    // Increase quantity
    if (increaseBtn) {
        const index = Number(increaseBtn.dataset.index);
        if (!cart[index]) return;
        cart[index].qty = Math.min(CART_CONFIG.MAX_QUANTITY, (AppUtils.safeInteger(cart[index].qty, 1) + 1));
        saveAndRender(cart);
        return;
    }

    // Decrease quantity
    if (decreaseBtn) {
        const index = Number(decreaseBtn.dataset.index);
        if (!cart[index]) return;
        const currentQty = AppUtils.safeInteger(cart[index].qty, 1);
        if (currentQty <= 1) {
            AppUtils.notify("Minimum quantity is 1", "warning");
            decreaseBtn.disabled = true;
            decreaseBtn.style.opacity = '0.5';
            decreaseBtn.style.cursor = 'not-allowed';
            return;
        }
        cart[index].qty = currentQty - 1;
        saveAndRender(cart);
        return;
    }

    // Remove from cart with undo
    if (removeBtn) {
        const index = Number(removeBtn.dataset.index);
        if (!cart[index]) return;
        const itemName = cart[index].name || "Item";
        const removedItem = cart[index];
        
        showUndoToast(
            `Removed ${itemName} from cart`,
            () => {
                cart.splice(index, 0, removedItem);
                saveAndRender(cart);
            },
            () => {
                cart.splice(index, 1);
                saveAndRender(cart);
                AppUtils.notify("Item removed from cart", "success");
            }
        );
        
        cart.splice(index, 1);
        renderCart();
        updateCartTotals();
        return;
    }

    // Move to wishlist
    if (wishlistBtn) {
        const index = Number(wishlistBtn.dataset.index);
        if (!cart[index]) return;
        const wishlist = AppUtils.getWishlist();
        const exists = wishlist.some(
            (item) => String(item.id) === String(cart[index].id) &&
                    item.color === cart[index].color &&
                    item.size === cart[index].size
        );
        if (!exists) {
            wishlist.push(cart[index]);
            AppUtils.saveWishlist(wishlist);
        }
        const itemName = cart[index].name || "Item";
        cart.splice(index, 1);
        saveAndRender(cart);
        AppUtils.notify(`Moved ${itemName} to wishlist`, "success");
        return;
    }

    // Save for later
    if (saveLaterBtn) {
        const index = Number(saveLaterBtn.dataset.index);
        saveForLater(index);
        return;
    }

    // Move to cart from saved
    if (moveToCartBtn) {
        const index = Number(moveToCartBtn.dataset.savedIndex);
        moveToCart(index);
        return;
    }

    // Remove saved item
    if (removeSavedBtn) {
        const index = Number(removeSavedBtn.dataset.savedIndex);
        removeSavedItem(index);
        return;
    }
});

// ==================== INPUT & CHANGE LISTENERS ====================
document.addEventListener("change", (event) => {
    if (event.target.classList.contains("qty-input")) {
        const index = Number(event.target.dataset.index);
        const newQty = parseInt(event.target.value, 10);
        if (!isNaN(newQty)) {
            updateQuantity(index, newQty);
        }
    }

    if (event.target.classList.contains("cart-item-select")) {
        const itemId = event.target.dataset.itemId;
        toggleSelectItem(itemId);
        updateBulkActions();
    }

    if (event.target.id === "select-all") {
        toggleSelectAll();
    }
});

document.addEventListener("input", (event) => {
    if (event.target.classList.contains("note-input")) {
        const index = Number(event.target.dataset.index);
        updateItemNote(index, event.target.value);
    }
});

// ==================== INITIALIZATION ====================
if (elements.couponForm) {
    elements.couponForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const code = elements.couponCode.value.trim();
        if (!code) return;

        showLoading("coupon-form");
        try {
            const result = await AppUtils.applyCoupon(code);
            if (result.success) {
                appliedCoupon = code;
                AppUtils.setJSON("appliedCoupon", code);
                setCouponMessage("Coupon applied successfully!", "success");
                updateCartTotals();
            } else {
                setCouponMessage(result.message || "Invalid coupon code", "error");
            }
        } catch (error) {
            setCouponMessage("Failed to apply coupon", "error");
        } finally {
            hideLoading("coupon-form");
        }
    });
}

if (elements.emptyCartBtn) {
    elements.emptyCartBtn.addEventListener("click", () => {
        if (cart.length === 0) return;
        
        const previousCart = [...cart];
        showUndoToast(
            "Cart emptied",
            () => {
                cart = previousCart;
                saveAndRender(cart);
            },
            () => {
                cart = [];
                saveAndRender(cart);
                AppUtils.notify("Cart emptied", "success");
            }
        );
        cart = [];
        renderEmptyCart();
    });
}

if (elements.bulkRemoveBtn) {
    elements.bulkRemoveBtn.addEventListener("click", bulkRemove);
}

if (elements.bulkSaveLaterBtn) {
    elements.bulkSaveLaterBtn.addEventListener("click", bulkSaveForLater);
}

loadSavedForLater();
checkCartExpiry();
renderCart();
})();
