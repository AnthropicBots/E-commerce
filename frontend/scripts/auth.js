// auth elements
const elements = {
    signupForm:
        document.getElementById(
            "signup-form"
        ),

    signinForm:
        document.getElementById(
            "signin-form"
        ),

    signupName:
        document.getElementById(
            "signup-name"
        ),

    signupEmail:
        document.getElementById(
            "signup-email"
        ),

    signupPassword:
        document.getElementById(
            "signup-password"
        ),

    signinEmail:
        document.getElementById(
            "signin-email"
        ),

    signinPassword:
        document.getElementById(
            "signin-password"
        ),

    authLink:
        document.getElementById(
            "auth-link"
        ),

    dropdown:
        document.getElementById(
            "profile-dropdown"
        ),

    logoutBtn:
        document.getElementById(
            "logout-btn"
        ),

    googleLogin:
        document.getElementById(
            "google-login"
        )
};

// validation
const emailRegex =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// synced with backend validation
const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;

// auth api
async function signupUser(
    name,
    email,
    password
) {
    return await AppUtils.apiRequest(
        "/auth/signup",
        {
            method: "POST",
            body:
                JSON.stringify({
                    name,
                    email,
                    password
                })
        }
    );
}

async function loginUser(
    email,
    password
) {
    return await AppUtils.apiRequest(
        "/auth/login",
        {
            method: "POST",
            body:
                JSON.stringify({
                    email,
                    password
                })
        }
    );
}

async function logoutUser() {
    return await AppUtils.apiRequest(
        "/auth/logout",
        {
            method: "POST"
        }
    );
}

// loading state
function toggleFormLoading(
    button,
    isLoading,
    loadingText = "Please wait..."
) {
    if (!button) {
        return;
    }

    if (isLoading) {
        button.dataset.originalText =
            button.innerHTML;

        button.disabled =
            true;

        button.innerHTML =
            loadingText;

    } else {
        button.disabled =
            false;

        button.innerHTML =
            button.dataset.originalText ||
            "Submit";
    }
}

// save auth
function saveAuthSession(
    response
) {
    if (
        !response
    ) {
        return;
    }

    // Tokens are securely stored in HttpOnly cookies by the backend.
    
    AppUtils.setJSON(
        CONFIG.STORAGE_KEYS.USER,
        response.user || {}
    );
}

// clear auth
async function clearAuthSession() {

    try {

        // invalidate refresh token
        if (
            AppUtils.getUser()
        ) {

            await logoutUser();
        }

    } catch (error) {

        console.error(
            "LOGOUT API ERROR:",
            error
        );

    } finally {

        // always clear local session
        AppUtils.clearAuthData();

        AppUtils.setJSON(
            "socialUser",
        );

        try {

            await firebase.auth().signOut();

        } catch (firebaseError) {

            console.error(
                "FIREBASE LOGOUT ERROR:",
                firebaseError
            );
        }
    }
}

// signup
if (
    elements.signupForm
) {
    elements.signupForm.addEventListener(
        "submit",
        async (event) => {
            event.preventDefault();

            const submitBtn =
                elements.signupForm.querySelector(
                    'button[type="submit"]'
                );

            if (
                submitBtn?.disabled
            ) {
                return;
            }

            const name =
                elements.signupName.value.trim();

            const email =
                elements.signupEmail.value.trim();

            const password =
                elements.signupPassword.value;

            if (
                !name
            ) {
                AppUtils.notify(
                    "Name is required.",
                    "error"
                );

                return;
            }

            if (
                !emailRegex.test(email)
            ) {
                AppUtils.notify(
                    "Enter a valid email.",
                    "error"
                );

                return;
            }

            if (
                !passwordRegex.test(password)
            ) {
                AppUtils.notify(
                    "Password must contain uppercase, lowercase, number, special character and 8 characters.",
                    "error"
                );

                return;
            }

            toggleFormLoading(
                submitBtn,
                true,
                "Creating Account..."
            );

            try {
                const response =
                    await signupUser(
                        name,
                        email,
                        password
                    );

                if (
                    response.success
                ) {
                    AppUtils.notify(
                        "Account created successfully!",
                        "success"
                    );

                    setTimeout(() => {
                        window.location.href =
                            "signin.html";

                    }, 1000);

                } else {
                    AppUtils.notify(
                        response.message ||
                        "Signup failed.",
                        "error"
                    );
                }

            } catch (error) {
                console.error(
                    "SIGNUP ERROR:",
                    error
                );

                AppUtils.notify(
                    "Signup failed. Please try again.",
                    "error"
                );

            } finally {
                toggleFormLoading(
                    submitBtn,
                    false
                );
            }
        }
    );
}

// signin
if (
    elements.signinForm
) {
    elements.signinForm.addEventListener(
        "submit",
        async (event) => {
            event.preventDefault();

            const submitBtn =
                elements.signinForm.querySelector(
                    'button[type="submit"]'
                );

            if (
                submitBtn?.disabled
            ) {
                return;
            }

            const email =
                elements.signinEmail.value.trim();

            // do not trim password
            const password =
                elements.signinPassword.value;

            if (
                !emailRegex.test(email)
            ) {
                AppUtils.notify(
                    "Enter a valid email.",
                    "error"
                );

                return;
            }

            if (
                !password
            ) {
                AppUtils.notify(
                    "Password is required.",
                    "error"
                );

                return;
            }

            toggleFormLoading(
                submitBtn,
                true,
                "Signing In..."
            );

            try {
                const response =
                    await loginUser(
                        email,
                        password
                    );

                if (
                    response.success
                ) {
                    saveAuthSession(
                        response
                    );

                    AppUtils.notify(
                        "Login successful!",
                        "success"
                    );

                    const redirect =
                        response.user?.role === "admin"
                            ? "admin.html"
                            : "index.html";

                    setTimeout(() => {
                        window.location.href =
                            redirect;
                    }, 1000);

                } else {
                    AppUtils.notify(
                        response.message ||
                        "Login failed.",
                        "error"
                    );
                }

            } catch (error) {
                console.error(
                    "LOGIN ERROR:",
                    error
                );

                AppUtils.notify(
                    "Login failed. Please try again.",
                    "error"
                );

            } finally {
                toggleFormLoading(
                    submitBtn,
                    false
                );
            }
        }
    );
}

// auth ui

function syncNavbarAuth() {
    const user = AppUtils.getUser();
    const authButtons = document.querySelectorAll("[data-auth-state]");

    authButtons.forEach((element) => {
        const requiredState = element.dataset.authState;
        if (requiredState === "authenticated") {
            element.style.display = user ? "" : "none";
        }
        if (requiredState === "guest") {
            element.style.display = user ? "none" : "";
        }
    });
}

function initializeAuthUI() {
    syncNavbarAuth();

    const authLink =
        document.getElementById(
            "auth-link"
        );

    const dropdown =
        document.getElementById(
            "profile-dropdown"
        );

    const logoutBtn =
        document.getElementById(
            "logout-btn"
        );

    if (!authLink) {
        return;
    }

    const user = AppUtils.getUser();

    const socialUser =
        AppUtils.getJSON(
            "socialUser",
            null
        );

    if (
        user
        || socialUser
    ) {
        authLink.innerHTML =
            socialUser?.image
                ? `
                    <img
                        src="${escapeHTML(
                            socialUser.image
                        )}"
                        alt="profile"
                        class="nav-profile-image"
                    >
                  `

                : `<i class="fas fa-user"></i>`;

        authLink.href =
            "#";

        authLink.classList.add(
            "profile-active"
        );

        authLink.addEventListener(
            "click",
            (event) => {
                event.preventDefault();
                dropdown?.classList.toggle(
                    "active"
                );
            }
        );

        logoutBtn?.addEventListener(
            "click",
            async () => {
                await clearAuthSession();

                dropdown?.classList.remove(
                    "active"
                );

                AppUtils.notify(
                    "Logged out successfully!",
                    "success"
                );

                setTimeout(() => {
                    window.location.href =
                        document.referrer?.includes(
                            window.location.hostname
                        )
                            ? document.referrer
                            : "index.html";

                }, 1000);
            }
        );
    } else {
        authLink.innerHTML =
            "Sign In";

        authLink.href =
            "signin.html";

        authLink.classList.remove(
            "profile-active"
        );

        dropdown?.classList.remove(
            "active"
        );
    }
}

/* wait for navbar components */
document.addEventListener(
    "componentsLoaded",
    () => {

        initializeAuthUI();
    }
);

// password visibility toggle
document.querySelectorAll(
    ".password-toggle"
).forEach((toggle) => {

    toggle.addEventListener(
        "click",
        () => {

            const field =
                toggle.closest(
                    ".password-field"
                );

            const input =
                field?.querySelector(
                    "input"
                );

            if (
                !input
            ) {
                return;
            }

            const isHidden =
                input.type === "password";

            input.type =
                isHidden
                    ? "text"
                    : "password";

            toggle.setAttribute(
                "aria-pressed",
                String(isHidden)
            );

            toggle.setAttribute(
                "aria-label",
                isHidden
                    ? "Hide password"
                    : "Show password"
            );

            const icon =
                toggle.querySelector("i");

            if (icon) {
                icon.classList.toggle(
                    "fa-eye",
                    !isHidden
                );

                icon.classList.toggle(
                    "fa-eye-slash",
                    isHidden
                );
            }
        }
    );
});

// google login
elements.googleLogin?.addEventListener(
    "click",
    async () => {
        try {
            const result =
                await auth.signInWithPopup(
                    googleProvider
                );

            const user =
                result.user;

            AppUtils.notify(
                `Welcome ${user.displayName}!`,
                "success"
            );

            localStorage.setItem(
                "socialUser",
                JSON.stringify({
                    name:
                        user.displayName,

                    email:
                        user.email,

                    image:
                        user.photoURL,

                    provider:
                        "google"
                })
            );

            setTimeout(() => {
                window.location.href =
                    "index.html";

            }, 1000);

        } catch (error) {
            console.error(
                "GOOGLE LOGIN ERROR:",
                error
            );

            AppUtils.notify(
                error.message ||
                "Google login failed.",
                "error"
            );
        }
    }
);

// ========================================
// Password Strength Meter (Issue #166)
// ========================================
function evaluatePasswordStrength(password) {
    let score = 0;
    const tips = [];

    if (password.length >= 8) score++;
    else tips.push('At least 8 characters');

    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    else tips.push('Include both uppercase and lowercase letters');

    if (/\d/.test(password)) score++;
    else tips.push('Include at least one number');

    if (/[^a-zA-Z0-9]/.test(password)) score++;
    else tips.push('Include at least one special character');

    let level = 'Weak';
    let color = 'strength-weak';
    let percent = 25;
    if (score === 4) { level = 'Strong'; color = 'strength-strong'; percent = 100; }
    else if (score === 3) { level = 'Medium'; color = 'strength-medium'; percent = 70; }
    else if (score === 2) { level = 'Weak'; color = 'strength-weak'; percent = 45; }
    else { percent = 20; }

    return { level, color, percent, tips };
}

function updatePasswordStrength() {
    const passwordInput = document.getElementById('signup-password');
    const fill = document.getElementById('password-strength-fill');
    const text = document.getElementById('password-strength-text');
    const tips = document.getElementById('password-strength-tips');
    const signupBtn = document.getElementById('signup-btn');

    if (!passwordInput || !fill || !text || !tips) return;

    const password = passwordInput.value;
    const result = evaluatePasswordStrength(password);

    fill.style.width = result.percent + '%';
    fill.className = result.color;
    text.textContent = result.level;
    text.style.color = result.level === 'Strong' ? '#28a745' : result.level === 'Medium' ? '#ffa500' : '#ff4d4d';

    if (password.length === 0) {
        tips.textContent = '';
        if (signupBtn) signupBtn.disabled = true;
        return;
    }

    tips.textContent = result.tips.join(' • ');
    if (signupBtn) signupBtn.disabled = (result.level === 'Weak');
}

// Attach event listener after DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    const passwordInput = document.getElementById('signup-password');
    if (passwordInput) {
        passwordInput.addEventListener('input', updatePasswordStrength);
        // Initial check
        updatePasswordStrength();
    }
});