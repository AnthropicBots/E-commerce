// admin auth
const user =
    AppUtils.getUser();

// auth state
let currentAdmin =
    null;

// pagination state
let currentProductPage =
    1;

let currentOrderPage =
    1;

const PAGE_LIMIT =
    10;

// app state
let products = [];

let orders = [];

// require authentication
if (
    !user
) {

    redirectUnauthorized();
}

// secure admin verification
async function verifyAdminAccess() {

    try {

        const response =
            await AppUtils.apiRequest(
                "/auth/me"
            );

        if (
            !response.success
            ||
            !response.user
            ||
            response.user.role !== "admin"
        ) {

            redirectUnauthorized();

            return false;
        }

        currentAdmin =
            response.user;

        return true;

    } catch (error) {

        console.error(
            "ADMIN VERIFY ERROR:",
            error
        );

        redirectUnauthorized();

        return false;
    }
}

// unauthorized redirect
function redirectUnauthorized() {

    AppUtils.notify(
        "Admin access required",
        "error"
    );

    AppUtils.clearAuthData();

    setTimeout(
        () => {

            window.location.href =
                "signin.html";

        },
        1000
    );
}

// escape html
function escapeHTML(
    value
) {

    return String(
        value || ""
    )

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );
}

// elements
const elements = {

    productForm:
        document.getElementById(
            "product-form"
        ),

    productTableBody:
        document.getElementById(
            "product-table-body"
        ),

    ordersTableBody:
        document.getElementById(
            "orders-table-body"
        ),

    totalOrders:
        document.getElementById(
            "total-orders"
        ),

    totalProducts:
        document.getElementById(
            "total-products"
        ),

    totalUsers:
        document.getElementById(
            "total-users"
        ),

    totalRevenue:
        document.getElementById(
            "total-revenue"
        ),

    productName:
        document.getElementById(
            "product-name"
        ),

    productCategory:
        document.getElementById(
            "product-category"
        ),

    productPrice:
        document.getElementById(
            "product-price"
        ),

    productDescription:
        document.getElementById(
            "product-description"
        ),

    productImage:
        document.getElementById(
            "product-image"
        ),

    productStock:
        document.getElementById(
            "product-stock"
        ),

    featuredProduct:
        document.getElementById(
            "featured-product"
        )
};

// loading state
function renderLoadingState() {

    if (
        elements.productTableBody
    ) {

        elements.productTableBody.innerHTML =
            `
                <tr>
                    <td colspan="6">
                        Loading products...
                    </td>
                </tr>
            `;
    }
}

// load initial data
async function loadInitialData() {

    renderLoadingState();

    try {

        const productsRes =
            await AppUtils.apiRequest(
                `/products?page=${currentProductPage}&limit=${PAGE_LIMIT}`
            );

        if (
            productsRes.success
        ) {

            products =
                AppUtils.safeArray(
                    productsRes.products
                );
        }

        const ordersRes =
            await AppUtils.apiRequest(
                `/orders?page=${currentOrderPage}&limit=${PAGE_LIMIT}`
            );

        if (
            ordersRes.success
        ) {

            orders =
                AppUtils.safeArray(
                    ordersRes.orders
                );
        }

        renderProducts();

        renderOrders();

        renderStats();

    } catch (error) {

        console.error(
            "ADMIN LOAD ERROR:",
            error
        );

        if (
            elements.productTableBody
        ) {

            elements.productTableBody.innerHTML =
                `
                    <tr>
                        <td colspan="6">
                            Failed to load products
                        </td>
                    </tr>
                `;
        }
    }
}

// render stats
function renderStats() {

    if (
        elements.totalOrders
    ) {

        elements.totalOrders.innerText =
            orders.length;
    }

    if (
        elements.totalProducts
    ) {

        elements.totalProducts.innerText =
            products.length;
    }

    if (
        elements.totalUsers
    ) {

        elements.totalUsers.innerText =
            localStorage.getItem(
                "visits"
            ) || 0;
    }

    const revenue =
        orders.reduce(
            (
                sum,
                order
            ) => {

                return (
                    sum +
                    (
                        parseFloat(
                            order.total
                        ) || 0
                    )
                );

            },
            0
        );

    if (
        elements.totalRevenue
    ) {

        elements.totalRevenue.innerText =
            AppUtils.formatPrice(
                revenue
            );
    }
}

// validate product
function validateProduct(
    product
) {

    if (
        !product.name.trim()
        ||
        !product.category.trim()
    ) {

        AppUtils.notify(
            "Product name and category are required.",
            "error"
        );

        return false;
    }

    if (
        product.price < 0
        ||
        product.stock < 0
    ) {

        AppUtils.notify(
            "Invalid price or stock.",
            "error"
        );

        return false;
    }

    return true;
}

// product payload
function getProductPayload() {

    return {

        name:
            elements.productName.value.trim(),

        category:
            elements.productCategory.value.trim(),

        price:
            parseFloat(
                elements.productPrice.value
            ) || 0,

        description:
            elements.productDescription.value.trim(),

        image:
            elements.productImage.value.trim(),

        stock:
            parseInt(
                elements.productStock.value,
                10
            ) || 0,

        featured:
            elements.featuredProduct.checked
    };
}

// add product
if (
    elements.productForm
) {

    elements.productForm.addEventListener(
        "submit",
        async (
            event
        ) => {

            event.preventDefault();

            const productData =
                getProductPayload();

            if (
                !validateProduct(
                    productData
                )
            ) {

                return;
            }

            try {

                const response =
                    await AppUtils.apiRequest(
                        "/products",
                        {

                            method:
                                "POST",

                            body:
                                JSON.stringify(
                                    productData
                                )
                        }
                    );

                if (
                    response.success
                ) {

                    AppUtils.notify(
                        "Product added successfully!",
                        "success"
                    );

                    elements.productForm.reset();

                    await loadInitialData();

                } else {

                    AppUtils.notify(
                        response.message
                        ||
                        "Failed to add product.",
                        "error"
                    );
                }

            } catch (error) {

                console.error(
                    "ADD PRODUCT ERROR:",
                    error
                );

                AppUtils.notify(
                    "Failed to add product.",
                    "error"
                );
            }
        }
    );
}

// render products
function renderProducts() {

    if (
        !elements.productTableBody
    ) {

        return;
    }

    elements.productTableBody.innerHTML =
        "";

    if (
        !products.length
    ) {

        elements.productTableBody.innerHTML =
            `
                <tr>
                    <td colspan="6">
                        No products found
                    </td>
                </tr>
            `;

        return;
    }

    const fragment =
        document.createDocumentFragment();

    AppUtils.safeArray(
        products
    ).forEach(
        (
            product
        ) => {

            if (
                !product
                ||
                !product.id
            ) {

                return;
            }

            const row =
                document.createElement(
                    "tr"
                );

            row.innerHTML =
                `
                    <td>
                        ${escapeHTML(product.name || "Product")}
                    </td>

                    <td>
                        ${escapeHTML(product.category || "Category")}
                    </td>

                    <td>
                        ${AppUtils.formatPrice(product.price || 0)}
                    </td>

                    <td>
                        ${product.stock || 0}
                    </td>

                    <td>
                        ${
                            product.featured
                                ? "Featured"
                                : "—"
                        }
                    </td>

                    <td>
                        <button
                            type="button"
                            class="action-btn edit-btn"
                        >
                            Edit
                        </button>

                        <button
                            type="button"
                            class="action-btn delete-btn"
                        >
                            Delete
                        </button>
                    </td>
                `;

            row.querySelector(
                ".edit-btn"
            )?.addEventListener(
                "click",
                () => {

                    editProduct(
                        product.id
                    );
                }
            );

            row.querySelector(
                ".delete-btn"
            )?.addEventListener(
                "click",
                () => {

                    deleteProduct(
                        product.id
                    );
                }
            );

            fragment.appendChild(
                row
            );
        }
    );

    elements.productTableBody.appendChild(
        fragment
    );
}

// delete product
async function deleteProduct(
    id
) {

    const confirmed =
        confirm(
            "Delete this product permanently?"
        );

    if (
        !confirmed
    ) {

        return;
    }

    try {

        const response =
            await AppUtils.apiRequest(
                `/products/${id}`,
                {
                    method:
                        "DELETE"
                }
            );

        if (
            response.success
        ) {

            products =
                products.filter(
                    (
                        product
                    ) => {

                        return (
                            product.id !== id
                        );
                    }
                );

            renderProducts();

            renderStats();

            AppUtils.notify(
                "Product deleted successfully!",
                "success"
            );

        } else {

            AppUtils.notify(
                response.message
                ||
                "Failed to delete product.",
                "error"
            );
        }

    } catch (error) {

        console.error(
            "DELETE PRODUCT ERROR:",
            error
        );

        AppUtils.notify(
            "Failed to delete product.",
            "error"
        );
    }
}

// edit product
function editProduct(id) {
    const product = products.find(p => p.id === id);
    if (!product) return;

    // Populate modal
    document.getElementById("edit-product-id").value = product.id;
    document.getElementById("edit-product-name").value = product.name || "";
    document.getElementById("edit-product-price").value = product.price || 0;
    
    // Set Category
    const categorySelect = document.getElementById("edit-product-category");
    if (product.category) {
        for(let i=0; i<categorySelect.options.length; i++) {
            if (categorySelect.options[i].value.toLowerCase() === product.category.toLowerCase()) {
                categorySelect.selectedIndex = i;
                break;
            }
        }
    }
    
    document.getElementById("edit-product-stock").value = product.stock || 0;
    document.getElementById("edit-product-status").value = (product.stock > 0) ? "In Stock" : "Out Of Stock";
    document.getElementById("edit-product-description").value = product.description || "";
    document.getElementById("edit-product-image").value = product.image || "";
    document.getElementById("edit-featured-product").checked = !!product.featured;

    // Show modal
    document.getElementById("edit-product-modal").style.display = "flex";
}

// render orders
function renderOrders() {

    if (
        !elements.ordersTableBody
    ) {

        return;
    }

    elements.ordersTableBody.innerHTML =
        "";

    if (
        !orders.length
    ) {

        elements.ordersTableBody.innerHTML =
            `
                <tr>
                    <td colspan="3">
                        No orders found
                    </td>
                </tr>
            `;

        return;
    }

    const fragment =
        document.createDocumentFragment();

    AppUtils.safeArray(
        orders
    ).forEach(
        (
            order
        ) => {

            if (
                !order
            ) {

                return;
            }

            const row =
                document.createElement(
                    "tr"
                );

            row.innerHTML =
                `
                    <td>
                        ${escapeHTML(order.id || "-")}
                    </td>

                    <td>
                        ${escapeHTML(order.created_at || "-")}
                    </td>

                    <td>
                        ${AppUtils.formatPrice(order.total || 0)}
                    </td>
                `;

            fragment.appendChild(
                row
            );
        }
    );

    elements.ordersTableBody.appendChild(
        fragment
    );
}

// init
document.addEventListener(
    "DOMContentLoaded",
    async () => {

        const hasAccess =
            await verifyAdminAccess();

        if (
            !hasAccess
        ) {

            return;
        }

        await loadInitialData();
    }
);

// Tab Switching
document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active-admin-tab'));
        tab.classList.add('active-admin-tab');
        
        const target = tab.getAttribute('data-tab');
        document.querySelectorAll('.admin-section').forEach(sec => sec.style.display = 'none');
        document.querySelector('.admin-stats').style.display = 'none';
        
        if (target === 'dashboard') {
            document.querySelector('.admin-stats').style.display = 'grid';
            document.getElementById('section-dashboard').style.display = 'grid';
            loadAdminDashboard();
        } else if (target === 'users') {
            document.getElementById('section-users').style.display = 'block';
            loadAdminUsers(1);
        } else if (target === 'products') {
            document.getElementById('section-products-form').style.display = 'block';
            document.getElementById('section-products-list').style.display = 'block';
        } else if (target === 'orders') {
            document.getElementById('section-orders').style.display = 'block';
        } else if (target === 'support') {
            document.getElementById('section-support').style.display = 'block';
            initAdminChat();
        }
    });
});

// Admin Chat Logic
let adminChatSocket = null;
let currentAdminConversation = null;

function initAdminChat() {
    if (adminChatSocket) return; // already initialized
    
    const token = AppUtils.getToken();
    if (!token) return;

    adminChatSocket = io(CONFIG.API_BASE.replace('/api', ''), { auth: { token } });
    
    adminChatSocket.on('connect', () => {
        adminChatSocket.emit('join_admin_room');
        loadAdminConversations();
    });

    adminChatSocket.on('conversation_updated', () => {
        loadAdminConversations();
    });

    adminChatSocket.on('message_received', (msg) => {
        if (currentAdminConversation && msg.conversation_id === currentAdminConversation) {
            renderAdminMessage(msg);
        } else {
            loadAdminConversations(); // Update previews
        }
    });

    document.getElementById('admin-chat-send').addEventListener('click', sendAdminMessage);
    const input = document.getElementById('admin-chat-input');
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendAdminMessage();
        }
    });

    document.getElementById('admin-chat-search').addEventListener('input', AppUtils.debounce(loadAdminConversations, 500));
    document.getElementById('admin-chat-filter').addEventListener('change', loadAdminConversations);
}

async function loadAdminConversations() {
    const search = document.getElementById('admin-chat-search').value;
    const filter = document.getElementById('admin-chat-filter').value;
    
    // Convert filter to API params
    let status = filter !== 'unassigned' ? filter : '';
    let assigned_to = filter === 'unassigned' ? 'unassigned' : '';

    try {
        const res = await AppUtils.apiRequest(`/chat/conversations?search=${search}&status=${status}&assigned_to=${assigned_to}`);
        if (res.success) {
            const list = document.getElementById('admin-conversations-list');
            list.innerHTML = '';
            res.conversations.forEach(c => {
                const div = document.createElement('div');
                div.style.padding = '15px';
                div.style.borderBottom = '1px solid #eee';
                div.style.cursor = 'pointer';
                div.style.background = (currentAdminConversation === c.id) ? '#e6f2f1' : '#fff';
                div.innerHTML = `
                    <div style="font-weight: bold;">${AppUtils.escapeHTML(c.customer_name)}</div>
                    <div style="font-size: 12px; color: #888; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${c.last_message ? AppUtils.escapeHTML(c.last_message) : '<i>New Conversation</i>'}
                    </div>
                `;
                div.addEventListener('click', () => openAdminConversation(c));
                list.appendChild(div);
            });
        }
    } catch(e) {}
}

async function openAdminConversation(c) {
    currentAdminConversation = c.id;
    adminChatSocket.emit('join_conversation', { conversationId: c.id });
    
    // Update UI
    document.getElementById('admin-chat-customer-name').innerText = c.customer_name;
    document.getElementById('admin-chat-customer-status').innerText = `Status: ${c.status} | Priority: ${c.priority}`;
    document.getElementById('admin-chat-actions').style.display = 'block';
    
    document.getElementById('admin-chat-input').disabled = false;
    document.getElementById('admin-chat-send').disabled = false;

    // Load info
    document.getElementById('admin-chat-info-content').innerHTML = `
        <p><strong>Email:</strong> ${AppUtils.escapeHTML(c.customer_email)}</p>
        <p><strong>Created:</strong> ${new Date(c.created_at).toLocaleDateString()}</p>
        <p><strong>Status:</strong> <span class="badge" style="background:#088178; color:white;">${c.status}</span></p>
    `;

    // Load messages
    try {
        const res = await AppUtils.apiRequest(`/chat/conversations/${c.id}`);
        if (res.success) {
            const msgList = document.getElementById('admin-chat-messages');
            msgList.innerHTML = '';
            res.messages.forEach(renderAdminMessage);
        }
    } catch(e) {}
    
    // Bind buttons
    document.getElementById('admin-chat-assign-btn').onclick = async () => {
        await AppUtils.apiRequest(`/chat/conversations/${c.id}/assign`, { method: 'PATCH' });
        loadAdminConversations();
        openAdminConversation({...c, assigned_admin_id: currentAdmin.id});
    };
    
    document.getElementById('admin-chat-close-btn').onclick = async () => {
        await AppUtils.apiRequest(`/chat/conversations/${c.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) });
        loadAdminConversations();
        openAdminConversation({...c, status: 'closed'});
    };
    
    loadAdminConversations(); // highlight active
}

function renderAdminMessage(msg) {
    const list = document.getElementById('admin-chat-messages');
    const isAdmin = msg.sender_type === 'admin';
    const div = document.createElement('div');
    div.style.maxWidth = '80%';
    div.style.padding = '10px 14px';
    div.style.borderRadius = '18px';
    div.style.fontSize = '14px';
    div.style.alignSelf = isAdmin ? 'flex-end' : 'flex-start';
    div.style.background = isAdmin ? '#088178' : '#e6f2f1';
    div.style.color = isAdmin ? '#fff' : '#333';
    
    if (isAdmin) {
        div.style.borderBottomRightRadius = '4px';
    } else {
        div.style.borderBottomLeftRadius = '4px';
    }
    
    div.innerHTML = `
        ${AppUtils.escapeHTML(msg.message)}
        <div style="font-size:10px; opacity:0.8; margin-top:4px; text-align:${isAdmin ? 'right' : 'left'}">
            ${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </div>
    `;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
}

function sendAdminMessage() {
    const input = document.getElementById('admin-chat-input');
    const text = input.value.trim();
    if (!text || !currentAdminConversation) return;

    input.value = '';
    adminChatSocket.emit('send_message', { conversationId: currentAdminConversation, message: text }, () => {
        // Callback can handle failures
    });
}

let revenueChartInstance = null;
let orderStatusChartInstance = null;

window.loadAdminDashboard = async function() {
    try {
        const response = await AppUtils.apiRequest("/admin/dashboard");
        if (!response.success) return;
        
        const data = response.data;
        // Update stats
        if (elements.totalOrders) elements.totalOrders.innerText = data.stats.totalOrders;
        if (elements.totalRevenue) elements.totalRevenue.innerText = AppUtils.formatPrice(data.stats.totalRevenue);
        if (elements.totalUsers) elements.totalUsers.innerText = data.stats.totalUsers;
        if (elements.totalProducts) elements.totalProducts.innerText = data.stats.totalProducts;

        // Render Charts
        const revCtx = document.getElementById('revenueChart');
        if (revCtx) {
            if (revenueChartInstance) revenueChartInstance.destroy();
            revenueChartInstance = new Chart(revCtx, {
                type: 'line',
                data: {
                    labels: data.charts.revenue.map(r => r.date.split('T')[0]),
                    datasets: [{
                        label: 'Revenue (₹)',
                        data: data.charts.revenue.map(r => r.revenue),
                        borderColor: '#088178',
                        tension: 0.1,
                        fill: true,
                        backgroundColor: 'rgba(8, 129, 120, 0.1)'
                    }]
                }
            });
        }

        const statusCtx = document.getElementById('orderStatusChart');
        if (statusCtx) {
            if (orderStatusChartInstance) orderStatusChartInstance.destroy();
            orderStatusChartInstance = new Chart(statusCtx, {
                type: 'doughnut',
                data: {
                    labels: data.charts.orderStatus.map(s => s.status),
                    datasets: [{
                        data: data.charts.orderStatus.map(s => s.count),
                        backgroundColor: ['#28a745', '#ffc107', '#dc3545', '#17a2b8', '#6c757d']
                    }]
                }
            });
        }
    } catch (e) {
        console.error("Dashboard Load Error", e);
    }
};

let currentUsersPage = 1;
window.loadAdminUsers = async function(page = 1) {
    currentUsersPage = page;
    const search = document.getElementById('user-search').value;
    const status = document.getElementById('user-status-filter').value;
    
    try {
        const response = await AppUtils.apiRequest(`/admin/users?page=${page}&limit=20&search=${search}&status=${status}`);
        if (!response.success) return;
        
        const tbody = document.getElementById('users-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        
        response.users.forEach(u => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="checkbox" class="user-select-cb" value="${u.id}"></td>
                <td>${escapeHTML(u.name)}</td>
                <td>${escapeHTML(u.email)}</td>
                <td><span class="badge">${u.role}</span></td>
                <td><span class="badge ${u.is_active ? 'active' : 'blocked'}">${u.is_active ? 'Active' : 'Blocked'}</span></td>
                <td>${new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                    ${u.role !== 'admin' ? `
                    <button class="normal" style="padding:4px 8px; font-size:12px; border:none; border-radius:4px; cursor:pointer; background: ${u.is_active ? '#dc3545' : '#28a745'}; color: white;" 
                            onclick="toggleUserStatus(${u.id}, '${u.is_active ? 'blocked' : 'active'}')">
                        ${u.is_active ? 'Block' : 'Unblock'}
                    </button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
        
    } catch (e) {
        console.error("Users Load Error", e);
    }
};

window.toggleUserStatus = async function(id, newStatus) {
    if (!confirm(`Are you sure you want to ${newStatus} this user?`)) return;
    try {
        const res = await AppUtils.apiRequest(`/admin/users/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
        });
        if (res.success) {
            AppUtils.notify(res.message, 'success');
            loadAdminUsers(currentUsersPage);
        } else {
            AppUtils.notify(res.message, 'error');
        }
    } catch (e) {}
};

const userSearch = document.getElementById('user-search');
if (userSearch) userSearch.addEventListener('input', AppUtils.debounce(() => loadAdminUsers(1), 500));

const userStatusFilter = document.getElementById('user-status-filter');
if (userStatusFilter) userStatusFilter.addEventListener('change', () => loadAdminUsers(1));

window.bulkUserAction = async function(newStatus) {
    const selected = Array.from(document.querySelectorAll('.user-select-cb:checked')).map(cb => cb.value);
    if (!selected.length) {
        AppUtils.notify("Select at least one user", 'error');
        return;
    }
    if (!confirm(`Are you sure you want to ${newStatus} ${selected.length} user(s)?`)) return;
    
    try {
        const res = await AppUtils.apiRequest('/admin/users/bulk-status', {
            method: 'POST',
            body: JSON.stringify({ userIds: selected, status: newStatus })
        });
        if (res.success) {
            AppUtils.notify(res.message, 'success');
            loadAdminUsers(currentUsersPage);
            document.getElementById('user-select-all').checked = false;
        } else {
            AppUtils.notify(res.message, 'error');
        }
    } catch (e) {}
};

const bulkBlockBtn = document.getElementById('user-bulk-block');
if (bulkBlockBtn) bulkBlockBtn.addEventListener('click', () => bulkUserAction('blocked'));

const bulkUnblockBtn = document.getElementById('user-bulk-unblock');
if (bulkUnblockBtn) bulkUnblockBtn.addEventListener('click', () => bulkUserAction('active'));

const selectAllCb = document.getElementById('user-select-all');
if (selectAllCb) {
    selectAllCb.addEventListener('change', (e) => {
        document.querySelectorAll('.user-select-cb').forEach(cb => cb.checked = e.target.checked);
    });
}

// Ensure the dashboard loads its data on init
setTimeout(() => {
    loadAdminDashboard();
}, 500);


// Initialize Edit Modal Events
document.addEventListener("DOMContentLoaded", () => {
    const editModal = document.getElementById("edit-product-modal");
    const editForm = document.getElementById("edit-product-form");
    const cancelBtn = document.getElementById("edit-cancel-btn");

    if (cancelBtn && editModal) {
        cancelBtn.addEventListener("click", () => {
            editModal.style.display = "none";
        });
    }

    if (editForm) {
        editForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const id = document.getElementById("edit-product-id").value;
            const product = products.find(p => String(p.id) === String(id));
            if (!product) return;

            const updatedData = {
                name: document.getElementById("edit-product-name").value.trim(),
                description: document.getElementById("edit-product-description").value.trim(),
                price: parseFloat(document.getElementById("edit-product-price").value) || 0,
                image: document.getElementById("edit-product-image").value.trim(),
                category: document.getElementById("edit-product-category").value,
                stock: parseInt(document.getElementById("edit-product-stock").value, 10) || 0,
                featured: document.getElementById("edit-featured-product").checked
            };

            try {
                const response = await AppUtils.apiRequest(`/products/${id}`, {
                    method: "PUT",
                    body: JSON.stringify(updatedData)
                });

                if (response.success) {
                    Object.assign(product, updatedData);
                    renderProducts();
                    renderStats();
                    AppUtils.notify("Product updated successfully!", "success");
                    editModal.style.display = "none";
                } else {
                    AppUtils.notify(response.message || "Failed to update product.", "error");
                }
            } catch (error) {
                console.error("EDIT PRODUCT ERROR:", error);
                AppUtils.notify("Failed to update product.", "error");
            }
        });
    }
});

