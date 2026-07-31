// frontend/scripts/addresses.js
//
// Saved address book (#1347).
//
// One module serving two pages, because they need exactly the same thing and
// duplicating it is how the two drift:
//
//   * profile.html renders the full manager (add / edit / set default / remove)
//   * checkout.html renders a picker that prefills the existing manual form
//
// The manual form on checkout is deliberately left in place. Guest checkout has
// no account and therefore no address book, and a shopper with an account may
// still want to ship somewhere new without saving it.
//
// Classic <script> file, not a module: every page here loads plain <script>
// tags, so this exposes a single `AddressBook` global rather than exports.

(function () {
    "use strict";

    // The API returns camelCase; these are the ids the checkout form already
    // uses. Kept as an explicit map so a rename on either side is a one-line
    // change rather than a hunt through string concatenation.
    var CHECKOUT_FIELD_MAP = {
        "full-name": "recipientName",
        phone: "recipientPhone",
        city: "city",
        state: "state",
        zip: "postalCode"
    };

    var state = {
        addresses: [],
        loaded: false,
        selectedId: null
    };

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * Escape text bound for innerHTML.
     *
     * Addresses are user-supplied and rendered on a page that also holds the
     * checkout form, so this is the difference between a saved address and a
     * stored XSS. AppUtils.escapeHTML is used when available; the inline
     * fallback exists so this file is not silently unsafe if utils.js fails to
     * load, which is the exact failure mode #1276 was about.
     */
    function esc(value) {
        if (window.AppUtils && typeof AppUtils.escapeHTML === "function") {
            return AppUtils.escapeHTML(value == null ? "" : String(value));
        }

        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function notify(message, type) {
        if (window.AppUtils && typeof AppUtils.notify === "function") {
            AppUtils.notify(message, type || "info");
        }
    }

    function isSignedIn() {
        return Boolean(
            window.AppUtils &&
                typeof AppUtils.getToken === "function" &&
                AppUtils.getToken()
        );
    }

    /**
     * Call the address API.
     *
     * Errors are rethrown with the server's message when there is one, because
     * "You can save at most 20 addresses" is worth showing and
     * "Request failed" is not.
     */
    function api(path, options) {
        if (!window.AppUtils || typeof AppUtils.apiRequest !== "function") {
            return Promise.reject(new Error("API client unavailable"));
        }

        return AppUtils.apiRequest("/addresses" + (path || ""), options || {});
    }

    /**
     * Render one address as a single line, matching the server's formatting so
     * the picker and the order confirmation agree.
     */
    function formatLine(address) {
        return [
            address.addressLine1,
            address.addressLine2,
            address.landmark,
            address.city,
            address.state,
            address.postalCode,
            address.country
        ]
            .filter(Boolean)
            .join(", ");
    }

    // ------------------------------------------------------------------
    // Data
    // ------------------------------------------------------------------

    /**
     * Load the address book.
     *
     * A signed-out visitor gets an empty list rather than an error: checkout
     * must keep working for guests, and the picker simply does not render.
     */
    async function load(force) {
        if (!isSignedIn()) {
            state.addresses = [];
            state.loaded = true;
            return state.addresses;
        }

        if (state.loaded && !force) return state.addresses;

        try {
            var response = await api("");
            var payload = (response && response.data) || {};

            state.addresses = payload.addresses || [];
            state.loaded = true;

            if (!state.selectedId) {
                state.selectedId = payload.defaultAddressId || null;
            }
        } catch (error) {
            console.error("Load addresses failed:", error);
            state.addresses = [];
            state.loaded = true;
        }

        return state.addresses;
    }

    async function create(payload) {
        var response = await api("", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        await load(true);
        return response && response.data;
    }

    async function update(id, payload) {
        var response = await api("/" + encodeURIComponent(id), {
            method: "PUT",
            body: JSON.stringify(payload)
        });

        await load(true);
        return response && response.data;
    }

    async function setDefault(id) {
        var response = await api("/" + encodeURIComponent(id) + "/default", {
            method: "PATCH"
        });

        await load(true);
        return response && response.data;
    }

    async function remove(id) {
        var response = await api("/" + encodeURIComponent(id), {
            method: "DELETE"
        });

        // If the removed address was the one selected in the picker, fall back
        // to whatever the server promoted rather than leaving a dangling
        // selection that would post an id the backend will reject.
        if (state.selectedId === id) {
            state.selectedId = (response && response.data && response.data.newDefaultId) || null;
        }

        await load(true);
        return response && response.data;
    }

    // ------------------------------------------------------------------
    // Checkout picker
    // ------------------------------------------------------------------

    /**
     * Copy a saved address into the checkout form.
     *
     * The form stays the source of truth for what gets submitted, so a shopper
     * can pick an address and then edit a field before ordering — which is why
     * the backend merges explicit form values over the resolved address rather
     * than the other way round.
     */
    function fillCheckoutForm(address) {
        Object.keys(CHECKOUT_FIELD_MAP).forEach(function (elementId) {
            var element = document.getElementById(elementId);
            if (!element) return;

            var value = address[CHECKOUT_FIELD_MAP[elementId]];
            element.value = value == null ? "" : value;

            // Let any existing validation/character-count listeners react, so
            // the address counter and error styling stay in sync.
            element.dispatchEvent(new Event("input", { bubbles: true }));
        });

        var addressField = document.getElementById("address");
        if (addressField) {
            addressField.value = [address.addressLine1, address.addressLine2, address.landmark]
                .filter(Boolean)
                .join(", ");
            addressField.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    function renderCheckoutPicker(container) {
        if (!container) return;

        if (!isSignedIn() || state.addresses.length === 0) {
            container.innerHTML = "";
            container.hidden = true;
            return;
        }

        container.hidden = false;

        var options = state.addresses
            .map(function (address) {
                var selected = address.id === state.selectedId;

                return (
                    '<label class="saved-address-option' +
                    (selected ? " is-selected" : "") +
                    '">' +
                    '<input type="radio" name="saved-address" value="' +
                    esc(address.id) +
                    '"' +
                    (selected ? " checked" : "") +
                    ">" +
                    '<span class="saved-address-body">' +
                    '<span class="saved-address-label">' +
                    esc(address.label) +
                    (address.isDefault
                        ? ' <span class="saved-address-badge">Default</span>'
                        : "") +
                    "</span>" +
                    '<span class="saved-address-recipient">' +
                    esc(address.recipientName) +
                    " &middot; " +
                    esc(address.recipientPhone) +
                    "</span>" +
                    '<span class="saved-address-line">' +
                    esc(formatLine(address)) +
                    "</span>" +
                    "</span>" +
                    "</label>"
                );
            })
            .join("");

        container.innerHTML =
            '<div class="saved-addresses">' +
            "<h3>Deliver to a saved address</h3>" +
            '<div class="saved-address-list">' +
            options +
            "</div>" +
            '<button type="button" class="saved-address-clear" id="use-new-address">' +
            "Use a different address" +
            "</button>" +
            "</div>";

        container.querySelectorAll('input[name="saved-address"]').forEach(function (input) {
            input.addEventListener("change", function () {
                state.selectedId = input.value;

                var address = state.addresses.filter(function (a) {
                    return a.id === input.value;
                })[0];

                if (address) fillCheckoutForm(address);
                renderCheckoutPicker(container);
            });
        });

        var clearButton = container.querySelector("#use-new-address");
        if (clearButton) {
            clearButton.addEventListener("click", function () {
                state.selectedId = null;
                renderCheckoutPicker(container);
            });
        }
    }

    /**
     * Mount the checkout picker above the billing form.
     *
     * Prefills with the default address on first load so the common case —
     * a returning shopper ordering to the same place — needs no typing at all.
     */
    async function initCheckout() {
        var container = document.getElementById("saved-addresses");
        if (!container) return;

        await load();

        if (state.selectedId) {
            var selected = state.addresses.filter(function (a) {
                return a.id === state.selectedId;
            })[0];

            if (selected) fillCheckoutForm(selected);
        }

        renderCheckoutPicker(container);
    }

    // ------------------------------------------------------------------
    // Profile manager
    // ------------------------------------------------------------------

    function readFormValues(form) {
        var data = new FormData(form);
        var payload = {};

        [
            "label",
            "recipientName",
            "recipientPhone",
            "addressLine1",
            "addressLine2",
            "landmark",
            "city",
            "state",
            "postalCode",
            "country"
        ].forEach(function (field) {
            var value = data.get(field);
            if (value !== null) payload[field] = String(value).trim();
        });

        payload.isDefault = form.querySelector('[name="isDefault"]')
            ? form.querySelector('[name="isDefault"]').checked
            : false;

        return payload;
    }

    function addressCardHTML(address) {
        return (
            '<article class="address-card' +
            (address.isDefault ? " is-default" : "") +
            '" data-id="' +
            esc(address.id) +
            '">' +
            '<header class="address-card-head">' +
            "<h4>" +
            esc(address.label) +
            "</h4>" +
            (address.isDefault ? '<span class="address-badge">Default</span>' : "") +
            "</header>" +
            "<p class=\"address-card-recipient\">" +
            esc(address.recipientName) +
            " &middot; " +
            esc(address.recipientPhone) +
            "</p>" +
            '<p class="address-card-line">' +
            esc(formatLine(address)) +
            "</p>" +
            '<footer class="address-card-actions">' +
            (address.isDefault
                ? ""
                : '<button type="button" data-action="default">Make default</button>') +
            '<button type="button" data-action="edit">Edit</button>' +
            '<button type="button" data-action="delete" class="danger">Remove</button>' +
            "</footer>" +
            "</article>"
        );
    }

    function renderManager(container) {
        if (!container) return;

        if (!isSignedIn()) {
            container.innerHTML =
                '<p class="address-empty">Sign in to save delivery addresses.</p>';
            return;
        }

        if (state.addresses.length === 0) {
            container.innerHTML =
                '<p class="address-empty">No saved addresses yet. Add one to skip retyping it at checkout.</p>';
            return;
        }

        container.innerHTML = state.addresses.map(addressCardHTML).join("");
    }

    /**
     * Wire the profile page's address section.
     *
     * Card actions are handled by one delegated listener rather than per-card
     * bindings, so re-rendering after a change does not leak listeners — the
     * cards are replaced wholesale on every render.
     */
    async function initProfile() {
        var list = document.getElementById("address-list");
        var form = document.getElementById("address-form");
        if (!list) return;

        await load();
        renderManager(list);

        list.addEventListener("click", async function (event) {
            var button = event.target.closest("[data-action]");
            if (!button) return;

            var card = button.closest(".address-card");
            if (!card) return;

            var id = card.getAttribute("data-id");
            var action = button.getAttribute("data-action");

            try {
                if (action === "default") {
                    await setDefault(id);
                    notify("Default address updated.", "success");
                } else if (action === "delete") {
                    await remove(id);
                    notify("Address removed.", "success");
                } else if (action === "edit") {
                    var address = state.addresses.filter(function (a) {
                        return a.id === id;
                    })[0];

                    if (address && form) {
                        populateForm(form, address);
                        form.scrollIntoView({ behavior: "smooth", block: "center" });
                        return;
                    }
                }

                renderManager(list);
            } catch (error) {
                notify(error.message || "Could not update that address.", "error");
            }
        });

        if (form) {
            form.addEventListener("submit", async function (event) {
                event.preventDefault();

                var editingId = form.getAttribute("data-editing-id");
                var payload = readFormValues(form);

                try {
                    if (editingId) {
                        await update(editingId, payload);
                        notify("Address updated.", "success");
                    } else {
                        await create(payload);
                        notify("Address saved.", "success");
                    }

                    form.reset();
                    form.removeAttribute("data-editing-id");
                    renderManager(list);
                } catch (error) {
                    notify(error.message || "Could not save that address.", "error");
                }
            });
        }
    }

    function populateForm(form, address) {
        form.setAttribute("data-editing-id", address.id);

        Object.keys(address).forEach(function (key) {
            var field = form.querySelector('[name="' + key + '"]');
            if (!field) return;

            if (field.type === "checkbox") {
                field.checked = Boolean(address[key]);
            } else {
                field.value = address[key] == null ? "" : address[key];
            }
        });
    }

    // ------------------------------------------------------------------
    // Public surface
    // ------------------------------------------------------------------

    window.AddressBook = {
        load: load,
        create: create,
        update: update,
        setDefault: setDefault,
        remove: remove,
        formatLine: formatLine,
        initCheckout: initCheckout,
        initProfile: initProfile,

        /** The address id checkout should post, or null for a manual entry. */
        getSelectedId: function () {
            return state.selectedId;
        },

        /** Exposed for tests and for the checkout page's own validation. */
        getAddresses: function () {
            return state.addresses.slice();
        }
    };

    document.addEventListener("DOMContentLoaded", function () {
        if (document.getElementById("saved-addresses")) initCheckout();
        if (document.getElementById("address-list")) initProfile();
    });
})();
