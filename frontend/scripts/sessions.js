// ============================================
// SIGNED-IN DEVICES
// Lists where the account is signed in and lets
// the account holder end those sessions.
// ============================================

const sessionElements = {
    card: document.getElementById("sessions-card"),
    list: document.getElementById("sessions-list"),
    empty: document.getElementById("sessions-empty"),
    error: document.getElementById("sessions-error"),
    revokeOthersBtn: document.getElementById("revoke-other-sessions-btn")
};

function formatSessionTimestamp(value) {
    if (!value) return "—";

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";

    return parsed.toLocaleString();
}

function renderSessions(sessions) {
    if (!sessionElements.list) return;

    sessionElements.list.innerHTML = "";

    if (!sessions.length) {
        if (sessionElements.empty) sessionElements.empty.style.display = "block";
        return;
    }

    if (sessionElements.empty) sessionElements.empty.style.display = "none";

    sessions.forEach((session) => {
        const row = document.createElement("div");
        row.className = "profile-info-item";

        const heading = document.createElement("span");
        heading.textContent = session.isCurrent
            ? `${session.device || "Unknown device"} (this device)`
            : session.device || "Unknown device";

        const detail = document.createElement("p");
        detail.textContent =
            `${session.ipAddress || "Unknown location"} · ` +
            `signed in ${formatSessionTimestamp(session.createdAt)} · ` +
            `last used ${formatSessionTimestamp(session.lastUsedAt || session.createdAt)}`;

        row.appendChild(heading);
        row.appendChild(detail);

        if (!session.isCurrent) {
            const endBtn = document.createElement("button");
            endBtn.type = "button";
            endBtn.className = "profile-save-btn";
            endBtn.textContent = "End session";
            endBtn.addEventListener("click", () => endSession(session.id, endBtn));
            row.appendChild(endBtn);
        }

        sessionElements.list.appendChild(row);
    });
}

async function loadSessions() {
    if (!sessionElements.card) return;

    try {
        const response = await AppUtils.apiRequest("/auth/sessions");

        if (!response.success) {
            throw new Error(response.message || "Failed to load sessions");
        }

        if (sessionElements.error) sessionElements.error.style.display = "none";
        renderSessions(response.sessions || []);
    } catch (error) {
        console.error("LOAD SESSIONS ERROR:", error);
        if (sessionElements.error) {
            sessionElements.error.style.display = "block";
            sessionElements.error.textContent = "Could not load your signed-in devices.";
        }
    }
}

async function endSession(sessionId, button) {
    if (button) button.disabled = true;

    try {
        const response = await AppUtils.apiRequest(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
            method: "DELETE"
        });

        if (!response.success) {
            throw new Error(response.message || "Failed to end session");
        }

        AppUtils.notify("Session ended.", "success");
        await loadSessions();
    } catch (error) {
        console.error("END SESSION ERROR:", error);
        AppUtils.notify("Could not end that session.", "error");
        if (button) button.disabled = false;
    }
}

async function endOtherSessions() {
    const button = sessionElements.revokeOthersBtn;
    if (button) button.disabled = true;

    try {
        const response = await AppUtils.apiRequest("/auth/sessions", { method: "DELETE" });

        if (!response.success) {
            throw new Error(response.message || "Failed to end sessions");
        }

        AppUtils.notify(
            response.revokedCount
                ? `Ended ${response.revokedCount} other session(s).`
                : "No other sessions were signed in.",
            "success"
        );
        await loadSessions();
    } catch (error) {
        console.error("END OTHER SESSIONS ERROR:", error);
        AppUtils.notify("Could not end your other sessions.", "error");
    } finally {
        if (button) button.disabled = false;
    }
}

sessionElements.revokeOthersBtn?.addEventListener("click", endOtherSessions);

document.addEventListener("DOMContentLoaded", () => {
    if (AppUtils.getUser()) {
        loadSessions();
    }
});
