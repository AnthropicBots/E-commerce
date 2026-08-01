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
        )
};

// validate profile
function validateDashboardProfile(
    name,
    email
) {
    if (
        !name ||
        !email
    ) {
        notify(
            "All profile fields are required",
            "error"
        );
        return false;
    }

    const emailRegex =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
        !emailRegex.test(
            email
        )
    ) {
        notify(
            "Invalid email address",
            "error"
        );
        return false;
    }
    return true;
}

// save profile
function saveDashboardProfile(
    event
) {
    event.preventDefault();
    const user =
        AppUtils.getJSON(
            "user",
            {}
        );

    const updatedUser = {
        ...user,

        name:
            dashboardSettingsElements
                .settingsName
                ?.value
                .trim(),

        email:
            dashboardSettingsElements
                .settingsEmail
                ?.value
                .trim()
    };

    const valid =
        validateDashboardProfile(
            updatedUser.name,
            updatedUser.email
        );

    if (!valid) {
        return;
    }

    AppUtils.setJSON(
        "user",
        updatedUser
    );

    // update dashboard UI
    if (
        dashboardElements?.userName
    ) {
        dashboardElements.userName.innerText =
            updatedUser.name;
    }

    if (
        dashboardElements?.userEmail
    ) {
        dashboardElements.userEmail.innerText =
            updatedUser.email;
    }

    notify(
        "Profile updated successfully!",
        "success"
    );
}

// bind form
if (
    dashboardSettingsElements.settingsForm
) {
    dashboardSettingsElements
        .settingsForm
        .addEventListener(
            "submit",
            saveDashboardProfile
        );
}

// expose globally
window.saveDashboardProfile =
    saveDashboardProfile;

// ==================== PASSKEYS (#1385) ====================
const passkeyListEl = document.getElementById("passkey-list");
const passkeyRegisterBtn = document.getElementById("passkey-register-btn");
const passkeyDeviceNameEl = document.getElementById("passkey-device-name");

function formatPasskeyDate(value) {
    if (!value) return "—";
    try {
        return new Date(value).toLocaleString();
    } catch (_) {
        return String(value);
    }
}

async function refreshPasskeyList() {
    if (!passkeyListEl || !window.AuthPasskeys) return;
    const user = typeof AppUtils !== "undefined"
        ? (AppUtils.getUser?.() || AppUtils.getJSON?.("user"))
        : null;
    if (!user) {
        passkeyListEl.innerHTML =
            "<li style='color:#666;'>Sign in to manage passkeys.</li>";
        return;
    }
    try {
        const res = await window.AuthPasskeys.listPasskeys();
        const creds = res?.credentials || [];
        if (!creds.length) {
            passkeyListEl.innerHTML =
                "<li style='color:#666;'>No passkeys yet. Add one to enable passwordless sign-in.</li>";
            return;
        }
        passkeyListEl.innerHTML = creds
            .map(
                (c) => `
            <li data-id="${c.id}" style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0;border-bottom:1px solid #eee;flex-wrap:wrap;">
                <div style="flex:1;min-width:140px;">
                    <strong class="passkey-name">${String(c.deviceName || "Passkey").replace(/</g, "&lt;")}</strong>
                    <div style="font-size:0.8rem;color:#777;">
                        Added ${formatPasskeyDate(c.createdAt)}
                        ${c.lastUsedAt ? ` · Last used ${formatPasskeyDate(c.lastUsedAt)}` : ""}
                    </div>
                </div>
                <button type="button" class="passkey-rename-btn" data-id="${c.id}">Rename</button>
                <button type="button" class="passkey-remove-btn" data-id="${c.id}">Remove</button>
            </li>`
            )
            .join("");
    } catch (err) {
        console.error("PASSKEY LIST ERROR:", err);
        passkeyListEl.innerHTML =
            "<li style='color:#c00;'>Could not load passkeys.</li>";
    }
}

if (passkeyRegisterBtn) {
    passkeyRegisterBtn.addEventListener("click", async () => {
        if (!window.AuthPasskeys?.isWebAuthnAvailable?.()) {
            notify("Passkeys are not supported in this browser.", "error");
            return;
        }
        const deviceName =
            passkeyDeviceNameEl?.value?.trim() ||
            "This device";
        passkeyRegisterBtn.disabled = true;
        try {
            const res = await window.AuthPasskeys.registerPasskey(deviceName);
            if (res?.success) {
                notify("Passkey added.", "success");
                if (passkeyDeviceNameEl) passkeyDeviceNameEl.value = "";
                await refreshPasskeyList();
            } else {
                notify(res?.message || "Could not add passkey.", "error");
            }
        } catch (err) {
            if (err?.name === "NotAllowedError") {
                notify("Passkey registration was cancelled.", "warning");
            } else {
                console.error("PASSKEY REGISTER ERROR:", err);
                notify(err?.message || "Could not add passkey.", "error");
            }
        } finally {
            passkeyRegisterBtn.disabled = false;
        }
    });
}

if (passkeyListEl) {
    passkeyListEl.addEventListener("click", async (event) => {
        const renameBtn = event.target.closest(".passkey-rename-btn");
        const removeBtn = event.target.closest(".passkey-remove-btn");
        if (!window.AuthPasskeys) return;

        if (renameBtn) {
            const id = renameBtn.dataset.id;
            const next = window.prompt("Device name for this passkey:");
            if (!next?.trim()) return;
            const res = await window.AuthPasskeys.renamePasskey(id, next.trim());
            if (res?.success) {
                notify("Passkey renamed.", "success");
                await refreshPasskeyList();
            } else {
                notify(res?.message || "Rename failed.", "error");
            }
        }

        if (removeBtn) {
            const id = removeBtn.dataset.id;
            if (!window.confirm("Remove this passkey? You can still sign in with your password.")) {
                return;
            }
            const res = await window.AuthPasskeys.deletePasskey(id);
            if (res?.success) {
                notify("Passkey removed.", "success");
                await refreshPasskeyList();
            } else {
                notify(res?.message || "Remove failed.", "error");
            }
        }
    });

    document.addEventListener("DOMContentLoaded", () => {
        refreshPasskeyList();
    });
    if (document.readyState !== "loading") {
        refreshPasskeyList();
    }
}
