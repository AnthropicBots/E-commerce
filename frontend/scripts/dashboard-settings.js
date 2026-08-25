// The dashboard settings tab (#1548).
//
// This wrote the form straight into the cached `user` object in localStorage
// and reported success. Nothing was sent anywhere, so the change was gone on
// the next device -- and because the profile page wrote a different key with a
// different field set, editing your name here did not change it there either.
//
// Worse, `email` went into that cached object. It is the identity the rest of
// the frontend reads, so the UI started showing an address the account could
// not be signed in with, while the real address was untouched. The API refuses
// an email change for exactly that reason, and the field is read-only here.
//
// Both editors now speak to the same endpoint and hold the same profile.

// dashboard settings elements
const dashboardSettingsElements = {
    settingsForm:
        document.getElementById(
            "settings-form"
        ),

    settingsName:
        document.getElementById(
            "settings-name"
        ),

    settingsEmail:
        document.getElementById(
            "settings-email"
        ),

    settingsPhone:
        document.getElementById(
            "settings-phone"
        )
};

// validate profile
//
// A courtesy check only. profileService validates every field again against
// the actual `users` column widths, because a browser is not somewhere a
// constraint can live.
function validateDashboardProfile(
    name
) {
    if (
        !name
    ) {
        notify(
            "Name is required",
            "error"
        );
        return false;
    }

    if (
        name.length < 2
    ) {
        notify(
            "Name must be at least 2 characters",
            "error"
        );
        return false;
    }

    return true;
}

/**
 * The email field is read-only.
 *
 * Editing it used to "save" a new address locally while the account kept the
 * old one. Changing an account's email is an identity change and belongs with
 * the verification flow, so the field says so rather than inviting an edit
 * that cannot land.
 */
function lockDashboardEmailField() {
    const field =
        dashboardSettingsElements.settingsEmail;

    if (!field) {
        return;
    }

    field.readOnly = true;
    field.setAttribute(
        "aria-readonly",
        "true"
    );
    field.title =
        "Your email address cannot be changed here";
}

/**
 * Show the profile the server holds.
 *
 * The dashboard used to fill these fields from the cached `user` object, which
 * is a copy of the session and carries no phone number at all.
 */
function applyDashboardProfile(
    profile
) {
    if (!profile) {
        return;
    }

    if (
        dashboardSettingsElements.settingsName
    ) {
        dashboardSettingsElements.settingsName.value =
            profile.name || "";
    }

    if (
        dashboardSettingsElements.settingsEmail
    ) {
        dashboardSettingsElements.settingsEmail.value =
            profile.email || "";
    }

    if (
        dashboardSettingsElements.settingsPhone
    ) {
        dashboardSettingsElements.settingsPhone.value =
            profile.phone || "";
    }

    if (
        dashboardElements?.userName
    ) {
        dashboardElements.userName.innerText =
            profile.name || "User";
    }

    if (
        dashboardElements?.userEmail
    ) {
        dashboardElements.userEmail.innerText =
            profile.email || "";
    }
}

// load profile
async function loadDashboardProfile() {
    if (
        !dashboardSettingsElements.settingsForm
    ) {
        return;
    }

    try {
        const response =
            await AppUtils.apiRequest(
                "/auth/profile"
            );

        if (
            response
            &&
            response.success
        ) {
            applyDashboardProfile(
                response.profile
            );
        }
    } catch (error) {
        // The tab is still usable from the cached session copy, so this is a
        // console note rather than a toast on a panel the shopper may not even
        // have opened.
        console.error(
            "Failed to load profile:",
            error
        );
    }
}

// save profile
async function saveDashboardProfile(
    event
) {
    event.preventDefault();

    const name =
        dashboardSettingsElements
            .settingsName
            ?.value
            .trim();

    const phone =
        dashboardSettingsElements
            .settingsPhone
            ?.value
            .trim();

    if (
        !validateDashboardProfile(name)
    ) {
        return;
    }

    const submitButton =
        dashboardSettingsElements
            .settingsForm
            ?.querySelector(
                "button[type='submit']"
            );

    if (submitButton) {
        submitButton.disabled = true;
    }

    try {
        // `email` is deliberately absent: the API refuses it, and sending it
        // would fail the whole save rather than being quietly dropped.
        // `phone` is only sent when the field exists on the page.
        const payload = { name };

        if (
            dashboardSettingsElements.settingsPhone
        ) {
            payload.phone = phone;
        }

        const response =
            await AppUtils.apiRequest(
                "/auth/profile",
                {
                    method: "PUT",
                    body: JSON.stringify(payload)
                }
            );

        if (
            !response
            ||
            !response.success
        ) {
            throw new Error(
                (response && response.message)
                || "Profile could not be saved"
            );
        }

        // Rendered from what the server stored, not from what was typed. A
        // success message about a request that never landed is the defect this
        // replaces.
        applyDashboardProfile(
            response.profile
        );

        // The name is on the navbar, so the cached session copy moves with it.
        // The email is not touched -- the server did not change it.
        const cachedUser =
            AppUtils.getJSON("user", {}) || {};

        AppUtils.setJSON(
            "user",
            {
                ...cachedUser,
                name: response.profile?.name || name
            }
        );

        notify(
            "Profile updated",
            "success"
        );
    } catch (error) {
        console.error(
            "Failed to save profile:",
            error
        );

        notify(
            error.message
            || "Failed to save profile. Please try again.",
            "error"
        );
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
        }
    }
}

// bind form
if (
    dashboardSettingsElements.settingsForm
) {
    lockDashboardEmailField();

    dashboardSettingsElements
        .settingsForm
        .addEventListener(
            "submit",
            saveDashboardProfile
        );

    loadDashboardProfile();
}

// expose globally
window.saveDashboardProfile =
    saveDashboardProfile;

window.loadDashboardProfile =
    loadDashboardProfile;
