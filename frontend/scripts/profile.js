// The profile page (#1548).
//
// This used to be a `localStorage` editor. `saveProfile` wrote a
// `profile_<email>` key, `loadProfile` read it straight back, and the success
// toast fired without a single request leaving the browser -- so the change
// was gone on any other device, gone after clearing site data, and invisible
// to the dashboard settings tab, which kept its own separate copy under a
// different key.
//
// The server owns the profile now. `localStorage` is kept as a first-paint
// cache so the page is not blank while the request is in flight, and it is
// only ever written from what the server confirmed it stored.

const currentUser = AppUtils.getJSON("user");

if (!currentUser) {
    window.location.href = "signin.html";
}

// Read on first paint, written only from a server response. Never the source
// of truth.
const PROFILE_CACHE_KEY = `profile_${currentUser?.email}`;
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
let hasUnsavedChanges = false;

const profileElements = {
    sidebarName: document.getElementById("sidebar-name"),
    sidebarEmail: document.getElementById("sidebar-email"),
    profilePreview: document.getElementById("profile-preview"),
    avatarInput: document.getElementById("avatar-input"),
    profileForm: document.getElementById("profile-form"),
    profileView: document.getElementById("profile-view"),
    profileEdit: document.getElementById("profile-edit"),
    editBtn: document.getElementById("edit-profile-btn"),
    cancelBtn: document.getElementById("cancel-edit-btn"),
    profileName: document.getElementById("profile-name"),
    profileEmail: document.getElementById("profile-email"),
    profilePhone: document.getElementById("profile-phone"),
    profileAddress: document.getElementById("profile-address"),
    profileBio: document.getElementById("profile-bio"),
    viewName: document.getElementById("view-name"),
    viewEmail: document.getElementById("view-email"),
    viewPhone: document.getElementById("view-phone"),
    viewAddress: document.getElementById("view-address"),
    viewBio: document.getElementById("view-bio"),
    loadingState: document.getElementById("profile-loading"),
    errorState: document.getElementById("profile-error")
};

function getDefaultAvatar(name = "User") {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=088178&color=fff&size=200`;
}

function showViewMode() {
    if (profileElements.profileView) profileElements.profileView.style.display = "block";
    if (profileElements.profileEdit) profileElements.profileEdit.style.display = "none";
    hasUnsavedChanges = false;
}

function showEditMode() {
    if (profileElements.profileView) profileElements.profileView.style.display = "none";
    if (profileElements.profileEdit) profileElements.profileEdit.style.display = "block";
}

function showLoading() {
    if (profileElements.loadingState) profileElements.loadingState.style.display = "flex";
    if (profileElements.errorState) profileElements.errorState.style.display = "none";
}

function hideLoading() {
    if (profileElements.loadingState) profileElements.loadingState.style.display = "none";
}

function showError(message) {
    if (profileElements.errorState) {
        profileElements.errorState.style.display = "block";
        const errorMessage = profileElements.errorState.querySelector('.error-message');
        if (errorMessage) errorMessage.textContent = message;
    }
}

function hideError() {
    if (profileElements.errorState) {
        profileElements.errorState.style.display = "none";
    }
}

// Client-side validation is a courtesy, not the rule. profileService checks
// every one of these again against the actual column widths, because a browser
// is not somewhere a constraint can live.
function validateInputs(name, phone, address, bio) {
    const errors = [];

    if (name && name.length < 2) {
        errors.push("Name must be at least 2 characters");
    }
    if (name && name.length > 50) {
        errors.push("Name must be less than 50 characters");
    }

    if (phone && phone.length > 0 && !/^[\+\d\s\-\(\)]{10,15}$/.test(phone)) {
        errors.push("Please enter a valid phone number");
    }

    if (address && address.length > 200) {
        errors.push("Address must be less than 200 characters");
    }

    if (bio && bio.length > 500) {
        errors.push("Bio must be less than 500 characters");
    }

    return errors;
}

/**
 * Paint a profile object onto the page.
 *
 * Split out of `loadProfile` because the same rendering runs twice: once from
 * the cache on first paint, once from the server's answer.
 */
function renderProfile(profile) {
    if (profileElements.sidebarName) {
        profileElements.sidebarName.textContent = profile.name;
    }
    if (profileElements.sidebarEmail) {
        profileElements.sidebarEmail.textContent = profile.email;
    }
    if (profileElements.profilePreview) {
        profileElements.profilePreview.src = profile.avatar;
        profileElements.profilePreview.alt = `${profile.name}'s avatar`;
    }

    if (profileElements.viewName) profileElements.viewName.textContent = profile.name;
    if (profileElements.viewEmail) profileElements.viewEmail.textContent = profile.email;
    if (profileElements.viewPhone) profileElements.viewPhone.textContent = profile.phone || "-";
    if (profileElements.viewAddress) profileElements.viewAddress.textContent = profile.address || "-";
    if (profileElements.viewBio) profileElements.viewBio.textContent = profile.bio || "-";

    if (profileElements.profileName) profileElements.profileName.value = profile.name;
    if (profileElements.profileEmail) profileElements.profileEmail.value = profile.email;
    if (profileElements.profilePhone) profileElements.profilePhone.value = profile.phone;
    if (profileElements.profileAddress) profileElements.profileAddress.value = profile.address;
    if (profileElements.profileBio) profileElements.profileBio.value = profile.bio;
}

/**
 * Fill in the fields the API does not carry.
 *
 * `bio` has never had a column; it stays local until one exists, and is marked
 * here rather than silently posted to an endpoint that would reject it as an
 * unknown field.
 */
function toViewModel(apiProfile, cached = {}) {
    return {
        name: apiProfile.name || currentUser?.name || "User",
        email: apiProfile.email || currentUser?.email || "",
        phone: apiProfile.phone || "",
        address: apiProfile.address || "",
        bio: cached.bio || "",
        avatar:
            apiProfile.avatar
            || cached.avatar
            || currentUser?.image
            || currentUser?.photoURL
            || getDefaultAvatar(apiProfile.name || currentUser?.name)
    };
}

/**
 * The email field is read-only.
 *
 * It was editable, and "saving" it wrote the typed address into the cached
 * `user` object -- the identity the rest of the frontend reads -- while the
 * account kept the old one. The UI then showed an address the shopper could
 * not sign in with. Changing an account's email is an identity change and
 * belongs with the verification flow, so the API refuses it and the field says
 * so rather than inviting an edit that cannot land.
 */
function lockEmailField() {
    const field = profileElements.profileEmail;

    if (!field) return;

    field.readOnly = true;
    field.setAttribute("aria-readonly", "true");
    field.title = "Your email address cannot be changed here";
}

async function loadProfile() {
    try {
        hideError();
        showLoading();

        // First paint from the cache so the page is not blank while the
        // request is in flight. This is a mirror, not the record.
        const cached = AppUtils.getJSON(PROFILE_CACHE_KEY) || {};

        if (cached.name) {
            renderProfile(toViewModel(cached, cached));
        }

        const response = await AppUtils.apiRequest("/auth/profile");

        if (!response || !response.success || !response.profile) {
            throw new Error(
                (response && response.message) || "Profile could not be loaded"
            );
        }

        const profile = toViewModel(response.profile, cached);

        renderProfile(profile);
        AppUtils.setJSON(PROFILE_CACHE_KEY, profile);

        // A profile with nothing filled in opens in edit mode, which is what
        // it did before -- a page of dashes invites nothing.
        const hasProfileData =
            response.profile.phone
            || response.profile.address
            || profile.bio;

        if (hasProfileData) {
            showViewMode();
        } else {
            showEditMode();
        }

        hideLoading();
    } catch (error) {
        console.error("Error loading profile:", error);
        hideLoading();
        showError(
            error.message || "Failed to load profile. Please refresh the page."
        );
    }
}

async function saveProfile() {
    const submitButton = profileElements.profileForm?.querySelector(
        "button[type='submit']"
    );

    try {
        const name = profileElements.profileName.value.trim();
        const phone = profileElements.profilePhone.value.trim();
        const address = profileElements.profileAddress.value.trim();
        const bio = profileElements.profileBio.value.trim();
        const avatar = profileElements.profilePreview.src;

        const errors = validateInputs(name, phone, address, bio);
        if (errors.length > 0) {
            AppUtils.notify(errors.join("\n"), "error");
            return;
        }

        if (submitButton) submitButton.disabled = true;

        // `email` is deliberately absent. The API refuses it, and sending it
        // would fail the whole save rather than being quietly dropped.
        // `bio` has no column yet, so it stays out of the request and in the
        // local cache.
        const response = await AppUtils.apiRequest("/auth/profile", {
            method: "PUT",
            body: JSON.stringify({ name, phone, address, avatar })
        });

        if (!response || !response.success) {
            throw new Error(
                (response && response.message) || "Profile could not be saved"
            );
        }

        // Cached from the server's answer, not from what was typed. A save
        // that reports success on a request that never landed is the whole
        // defect this replaces.
        const stored = toViewModel(response.profile, { bio, avatar });

        renderProfile(stored);
        AppUtils.setJSON(PROFILE_CACHE_KEY, stored);

        // The name is on the navbar, so the cached session copy moves with it.
        // The email is not touched: the API did not change it.
        const cachedUser = AppUtils.getJSON("user", {}) || {};
        AppUtils.setJSON("user", { ...cachedUser, name: stored.name });

        hasUnsavedChanges = false;
        showViewMode();

        AppUtils.notify("Profile saved", "success");
    } catch (error) {
        console.error("Error saving profile:", error);
        AppUtils.notify(
            error.message || "Failed to save profile. Please try again.",
            "error"
        );
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

function cancelEdit() {
    if (hasUnsavedChanges) {
        const confirmCancel = confirm("You have unsaved changes. Are you sure you want to cancel?");
        if (!confirmCancel) return;
    }
    loadProfile();
    showViewMode();
}

function handleAvatarUpload(file) {
    if (!file) return;

    if (file.size > MAX_AVATAR_SIZE) {
        AppUtils.notify(`Image size must be less than ${MAX_AVATAR_SIZE / (1024 * 1024)}MB`, "error");
        return;
    }

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        AppUtils.notify(`Please upload a valid image (${ALLOWED_IMAGE_TYPES.join(', ')})`, "error");
        return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
        if (profileElements.profilePreview) {
            profileElements.profilePreview.src = loadEvent.target.result;
        }
        hasUnsavedChanges = true;
    };
    reader.onerror = () => {
        AppUtils.notify("Failed to read image file", "error");
    };
    reader.readAsDataURL(file);
}

function setupFormTracking() {
    const form = profileElements.profileForm;
    if (!form) return;

    const inputs = form.querySelectorAll('input, textarea');
    inputs.forEach(input => {
        input.addEventListener('change', () => {
            hasUnsavedChanges = true;
        });
        input.addEventListener('input', () => {
            hasUnsavedChanges = true;
        });
    });
}

profileElements.editBtn?.addEventListener("click", () => {
    showEditMode();
});

profileElements.cancelBtn?.addEventListener("click", cancelEdit);

profileElements.profileForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveProfile();
});

profileElements.avatarInput?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    handleAvatarUpload(file);
});

window.addEventListener("beforeunload", (event) => {
    if (hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return event.returnValue;
    }
});

document.addEventListener("DOMContentLoaded", () => {
    lockEmailField();
    loadProfile();
    setupFormTracking();
});

export {
    loadProfile,
    saveProfile,
    cancelEdit,
    showViewMode,
    showEditMode,
    getDefaultAvatar,
    validateInputs,
    handleAvatarUpload,
    setupFormTracking,
    renderProfile,
    toViewModel,
    lockEmailField
};
