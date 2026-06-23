/* =============================
current user
============================= */

const currentUser =
    AppUtils.getJSON(
        "user"
    );

if (!currentUser) {

    window.location.href =
        "signin.html";
}

/* =============================
storage key
============================= */

const PROFILE_KEY =
    `profile_${currentUser.email}`;

/* =============================
elements
============================= */

const profileElements = {
    sidebarName:
        document.getElementById(
            "sidebar-name"
        ),

    sidebarEmail:
        document.getElementById(
            "sidebar-email"
        ),

    profilePreview:
        document.getElementById(
            "profile-preview"
        ),

    avatarInput:
        document.getElementById(
            "avatar-input"
        ),

    profileForm:
        document.getElementById(
            "profile-form"
        ),

    profileView:
        document.getElementById(
            "profile-view"
        ),

    profileEdit:
        document.getElementById(
            "profile-edit"
        ),

    editBtn:
        document.getElementById(
            "edit-profile-btn"
        ),

    profileName:
        document.getElementById(
            "profile-name"
        ),

    profileEmail:
        document.getElementById(
            "profile-email"
        ),

    profilePhone:
        document.getElementById(
            "profile-phone"
        ),

    profileAddress:
        document.getElementById(
            "profile-address"
        ),

    profileBio:
        document.getElementById(
            "profile-bio"
        ),

    viewName:
        document.getElementById(
            "view-name"
        ),

    viewEmail:
        document.getElementById(
            "view-email"
        ),

    viewPhone:
        document.getElementById(
            "view-phone"
        ),

    viewAddress:
        document.getElementById(
            "view-address"
        ),

    viewBio:
        document.getElementById(
            "view-bio"
        )
};

/* =============================
default avatar
============================= */

function getDefaultAvatar(
    name = "User"
) {

    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=088178&color=fff`;
}

/* =============================
view mode
============================= */

function showViewMode() {

    profileElements.profileView.style.display =
        "block";

    profileElements.profileEdit.style.display =
        "none";
}

/* =============================
edit mode
============================= */

function showEditMode() {

    profileElements.profileView.style.display =
        "none";

    profileElements.profileEdit.style.display =
        "block";
}

/* =============================
load profile
============================= */

function loadProfile() {

    const savedProfile =
        AppUtils.getJSON(
            PROFILE_KEY
        ) || {};

    const profile = {

        name:
            savedProfile.name
            || currentUser.name
            || "User",

        email:
            savedProfile.email
            || currentUser.email
            || "",

        phone:
            savedProfile.phone
            || "",

        address:
            savedProfile.address
            || "",

        bio:
            savedProfile.bio
            || "",

        avatar:
            savedProfile.avatar
            || currentUser.image
            || currentUser.photoURL
            || getDefaultAvatar(
                currentUser.name
            )
    };

    /* sidebar */

    profileElements.sidebarName.textContent =
        profile.name;

    profileElements.sidebarEmail.textContent =
        profile.email;

    profileElements.profilePreview.src =
        profile.avatar;

    /* view */

    profileElements.viewName.textContent =
        profile.name;

    profileElements.viewEmail.textContent =
        profile.email;

    profileElements.viewPhone.textContent =
        profile.phone || "-";

    profileElements.viewAddress.textContent =
        profile.address || "-";

    profileElements.viewBio.textContent =
        profile.bio || "-";

    /* form */
    profileElements.profileName.value =
        profile.name;

    profileElements.profileEmail.value =
        profile.email;

    profileElements.profilePhone.value =
        profile.phone;

    profileElements.profileAddress.value =
        profile.address;

    profileElements.profileBio.value =
        profile.bio;

    /* mode */

    const hasProfileData =

        savedProfile.name
        || savedProfile.phone
        || savedProfile.address
        || savedProfile.bio;

    if (hasProfileData) {

        showViewMode();

    } else {

        showEditMode();
    }
}

/* =============================
edit profile
============================= */

profileElements.editBtn?.addEventListener(
    "click",
    () => {

        showEditMode();
    }
);

/* =============================
save profile
============================= */

profileElements.profileForm?.addEventListener(
    "submit",
    (event) => {

        event.preventDefault();

        const profile = {

            name:
                profileElements.profileName.value.trim(),

            email:
                profileElements.profileEmail.value.trim(),

            phone:
                profileElements.profilePhone.value.trim(),

            address:
                profileElements.profileAddress.value.trim(),

            bio:
                profileElements.profileBio.value.trim(),

            avatar:
                profileElements.profilePreview.src
        };

        AppUtils.setJSON(
            PROFILE_KEY,
            profile
        );

        loadProfile();

        AppUtils.notify(
            "Profile saved successfully!",
            "success"
        );

        setTimeout(
            () => {

                window.location.href =
                    "index.html";

            },
            1000
        );
    }
);

/* =============================
avatar upload
============================= */

profileElements.avatarInput?.addEventListener(
    "change",
    (event) => {

        const file =
            event.target.files?.[0];

        if (!file) {
            return;
        }

        const reader =
            new FileReader();

        reader.onload =
            (loadEvent) => {

                profileElements.profilePreview.src =
                    loadEvent.target.result;
            };

        reader.readAsDataURL(
            file
        );
    }
);

/* =============================
init
============================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        loadProfile();
    }
);