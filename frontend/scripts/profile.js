const currentUser = AppUtils.getJSON("user");

if (!currentUser) {
    window.location.href = "signin.html";
}

const PROFILE_KEY = `profile_${currentUser.email}`;
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

function loadProfile() {
    try {
        hideError();
        showLoading();

        const savedProfile = AppUtils.getJSON(PROFILE_KEY) || {};

        const profile = {
            name: savedProfile.name || currentUser.name || "User",
            email: savedProfile.email || currentUser.email || "",
            phone: savedProfile.phone || "",
            address: savedProfile.address || "",
            bio: savedProfile.bio || "",
            avatar: savedProfile.avatar || currentUser.image || currentUser.photoURL || getDefaultAvatar(currentUser.name)
        };

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

        const hasProfileData = savedProfile.name || savedProfile.phone || savedProfile.address || savedProfile.bio;
        if (hasProfileData) {
            showViewMode();
        } else {
            showEditMode();
        }

        hideLoading();

    } catch (error) {
        console.error("Error loading profile:", error);
        hideLoading();
        showError("Failed to load profile. Please refresh the page.");
    }
}

function saveProfile() {
    try {
        const name = profileElements.profileName.value.trim();
        const email = profileElements.profileEmail.value.trim();
        const phone = profileElements.profilePhone.value.trim();
        const address = profileElements.profileAddress.value.trim();
        const bio = profileElements.profileBio.value.trim();

        const errors = validateInputs(name, phone, address, bio);
        if (errors.length > 0) {
            AppUtils.notify(errors.join("\n"), "error");
            return;
        }

        const profile = {
            name: name,
            email: email,
            phone: phone,
            address: address,
            bio: bio,
            avatar: profileElements.profilePreview.src
        };

        AppUtils.setJSON(PROFILE_KEY, profile);
        loadProfile();
        AppUtils.notify("Profile saved successfully!", "success");

        setTimeout(() => {
            window.location.href = "index.html";
        }, 1000);

    } catch (error) {
        console.error("Error saving profile:", error);
        AppUtils.notify("Failed to save profile. Please try again.", "error");
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
    setupFormTracking
};