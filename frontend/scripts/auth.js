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

// new auth endpoints
async function verifySignupUser(email, otp) {
    return await AppUtils.apiRequest(
        "/auth/verify-signup",
        {
            method: "POST",
            body: JSON.stringify({ email, otp })
        }
    );
}

async function forgotPasswordUser(email) {
    return await AppUtils.apiRequest(
        "/auth/forgot-password",
        {
            method: "POST",
            body: JSON.stringify({ email })
        }
    );
}

async function resetPasswordUser(userId, otp, newPassword) {
    return await AppUtils.apiRequest(
        "/auth/reset-password",
        {
            method: "POST",
            body: JSON.stringify({ userId, otp, newPassword })
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
                "Sending OTP..."
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
                        "OTP sent to your email!",
                        "success"
                    );

                    // Show OTP form and hide Signup form
                    elements.signupForm.style.display = "none";
                    const otpForm = document.getElementById("otp-form");
                    if (otpForm) {
                        otpForm.style.display = "block";
                        otpForm.dataset.email = email;
                    }

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

// OTP verification for signup
const otpForm = document.getElementById("otp-form");
if (otpForm) {
    otpForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const submitBtn = otpForm.querySelector('button[type="submit"]');
        if (submitBtn?.disabled) return;

        const otp = document.getElementById("otp-input").value.trim();
        const email = otpForm.dataset.email;

        if (!otp || otp.length !== 6) {
            AppUtils.notify("Enter a valid 6-digit OTP.", "error");
            return;
        }

        toggleFormLoading(submitBtn, true, "Verifying...");

        try {
            const response = await verifySignupUser(email, otp);

            if (response.success) {
                AppUtils.notify("Account created successfully! Please login.", "success");
                setTimeout(() => {
                    window.location.href = "signin.html";
                }, 1500);
            } else {
                AppUtils.notify(response.message || "Invalid OTP.", "error");
            }
        } catch (error) {
            console.error("OTP VERIFY ERROR:", error);
            AppUtils.notify("Verification failed. Please try again.", "error");
        } finally {
            toggleFormLoading(submitBtn, false);
        }
    });

    // Resend Signup OTP
    const resendSignupLink = document.getElementById("resend-signup-otp-link");
    const resendSignupTimer = document.getElementById("resend-signup-timer");
    
    if (resendSignupLink && resendSignupTimer) {
        resendSignupLink.addEventListener("click", async (e) => {
            e.preventDefault();
            
            if (resendSignupLink.style.pointerEvents === 'none') return;
            
            const email = otpForm.dataset.email;
            const name = elements.signupName.value.trim();
            const password = elements.signupPassword.value;
            
            try {
                const response = await signupUser(name, email, password);
                if (response.success) {
                    AppUtils.notify("OTP resent successfully!", "success");
                    
                    // Start cooldown
                    let timeLeft = 60;
                    resendSignupLink.style.pointerEvents = 'none';
                    resendSignupLink.style.color = '#777';
                    resendSignupTimer.style.display = 'inline';
                    
                    const interval = setInterval(() => {
                        timeLeft--;
                        resendSignupTimer.textContent = `(${timeLeft}s)`;
                        
                        if (timeLeft <= 0) {
                            clearInterval(interval);
                            resendSignupLink.style.pointerEvents = 'auto';
                            resendSignupLink.style.color = '#088178';
                            resendSignupTimer.style.display = 'none';
                            resendSignupTimer.textContent = '(60s)';
                        }
                    }, 1000);
                } else {
                    AppUtils.notify(response.message || "Failed to resend OTP.", "error");
                }
            } catch (error) {
                console.error("RESEND OTP ERROR:", error);
                AppUtils.notify("Failed to resend OTP.", "error");
            }
        });
    }
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

                    // pull this account's cart + wishlist into local
                    // storage so the browser reflects the logged-in user
                    await AppUtils.loadUserCollections();

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

// Forgot Password flows
const forgotPasswordLink = document.getElementById("forgot-password-link");
const backToLoginLink = document.getElementById("back-to-login-link");
const forgotPasswordForm = document.getElementById("forgot-password-form");
const resetOtpForm = document.getElementById("reset-otp-form");
const setNewPasswordForm = document.getElementById("set-new-password-form");

if (forgotPasswordLink && elements.signinForm && forgotPasswordForm) {
    forgotPasswordLink.addEventListener("click", (e) => {
        e.preventDefault();
        elements.signinForm.style.display = "none";
        forgotPasswordForm.style.display = "block";
    });

    backToLoginLink.addEventListener("click", (e) => {
        e.preventDefault();
        forgotPasswordForm.style.display = "none";
        resetOtpForm.style.display = "none";
        setNewPasswordForm.style.display = "none";
        elements.signinForm.style.display = "block";
    });

    // Send Reset OTP
    forgotPasswordForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submitBtn = forgotPasswordForm.querySelector('button[type="submit"]');
        const email = document.getElementById("forgot-email").value.trim();

        if (!emailRegex.test(email)) {
            AppUtils.notify("Enter a valid email.", "error");
            return;
        }

        toggleFormLoading(submitBtn, true, "Sending...");

        try {
            const response = await forgotPasswordUser(email);
            if (response.success) {
                AppUtils.notify("OTP sent if the email is registered.", "success");
                forgotPasswordForm.style.display = "none";
                resetOtpForm.style.display = "block";
                
                // Store userId from response (Appwrite)
                if (response.userId) {
                    resetOtpForm.dataset.userId = response.userId;
                }
            } else {
                AppUtils.notify(response.message || "Failed to send OTP.", "error");
            }
        } catch (error) {
            console.error("FORGOT PW ERROR:", error);
            AppUtils.notify("Failed to send OTP.", "error");
        } finally {
            toggleFormLoading(submitBtn, false);
        }
    });

    // Verify Reset OTP
    resetOtpForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const otp = document.getElementById("reset-otp-input").value.trim();
        const userId = resetOtpForm.dataset.userId;

        if (!otp || otp.length !== 6) {
            AppUtils.notify("Enter a valid 6-digit OTP.", "error");
            return;
        }

        // Keep OTP in dataset for next step, we don't verify it in backend yet until password is set
        // Actually the backend endpoint /reset-password verifies both OTP and new password at once
        // So we just advance to the new password form!
        resetOtpForm.style.display = "none";
        setNewPasswordForm.style.display = "block";
        setNewPasswordForm.dataset.userId = userId;
        setNewPasswordForm.dataset.otp = otp;
    });

    // Set New Password
    setNewPasswordForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const submitBtn = setNewPasswordForm.querySelector('button[type="submit"]');
        const newPassword = document.getElementById("new-password-input").value;
        const userId = setNewPasswordForm.dataset.userId;
        const otp = setNewPasswordForm.dataset.otp;

        if (!passwordRegex.test(newPassword)) {
            AppUtils.notify("Password must contain uppercase, lowercase, number, special character and 8 characters.", "error");
            return;
        }

        toggleFormLoading(submitBtn, true, "Resetting...");

        try {
            const response = await resetPasswordUser(userId, otp, newPassword);
            if (response.success) {
                AppUtils.notify("Password reset successful! Please login.", "success");
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } else {
                AppUtils.notify(response.message || "Reset failed.", "error");
                // If OTP was invalid, maybe go back to OTP form
                if (response.message && response.message.toLowerCase().includes('otp')) {
                    setNewPasswordForm.style.display = "none";
                    resetOtpForm.style.display = "block";
                }
            }
        } catch (error) {
            console.error("RESET PW ERROR:", error);
            AppUtils.notify("Failed to reset password.", "error");
        } finally {
            toggleFormLoading(submitBtn, false);
        }
    });

    // Resend Reset OTP
    const resendResetLink = document.getElementById("resend-reset-otp-link");
    const resendResetTimer = document.getElementById("resend-reset-timer");
    
    if (resendResetLink && resendResetTimer) {
        resendResetLink.addEventListener("click", async (e) => {
            e.preventDefault();
            
            if (resendResetLink.style.pointerEvents === 'none') return;
            
            const email = document.getElementById("forgot-email").value.trim();
            
            try {
                const response = await forgotPasswordUser(email);
                if (response.success) {
                    AppUtils.notify("OTP resent successfully!", "success");
                    
                    // Store new userId just in case
                    if (response.userId) {
                        resetOtpForm.dataset.userId = response.userId;
                    }
                    
                    // Start cooldown
                    let timeLeft = 60;
                    resendResetLink.style.pointerEvents = 'none';
                    resendResetLink.style.color = '#777';
                    resendResetTimer.style.display = 'inline';
                    
                    const interval = setInterval(() => {
                        timeLeft--;
                        resendResetTimer.textContent = `(${timeLeft}s)`;
                        
                        if (timeLeft <= 0) {
                            clearInterval(interval);
                            resendResetLink.style.pointerEvents = 'auto';
                            resendResetLink.style.color = '#088178';
                            resendResetTimer.style.display = 'none';
                            resendResetTimer.textContent = '(60s)';
                        }
                    }, 1000);
                } else {
                    AppUtils.notify(response.message || "Failed to resend OTP.", "error");
                }
            } catch (error) {
                console.error("RESEND RESET OTP ERROR:", error);
                AppUtils.notify("Failed to resend OTP.", "error");
            }
        });
    }
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

    if (
        user
    ) {
        authLink.innerHTML =
            `<i class="fas fa-user"></i>`;

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
