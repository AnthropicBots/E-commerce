// ============================================
// AUTHENTICATION MODULE - Enhanced Version
// Features: Password Strength, OTP Timer, 
// Remember Me, Session Timeout, Login Attempts
// ============================================

// ==================== CONFIGURATION ====================
const AUTH_CONFIG = {
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION: 15 * 60 * 1000, // 15 minutes
    SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
    OTP_RESEND_COOLDOWN: 60, // seconds
    PASSWORD_MIN_LENGTH: 8,
};

// ==================== AUTH ELEMENTS ====================
const elements = {
    signupForm: document.getElementById("signup-form"),
    signinForm: document.getElementById("signin-form"),
    signupName: document.getElementById("signup-name"),
    signupEmail: document.getElementById("signup-email"),
    signupPassword: document.getElementById("signup-password"),
    signupConfirmPassword: document.getElementById("signup-confirm-password"),
    signinEmail: document.getElementById("signin-email"),
    signinPassword: document.getElementById("signin-password"),
    authLink: document.getElementById("auth-link"),
    dropdown: document.getElementById("profile-dropdown"),
    logoutBtn: document.getElementById("logout-btn"),
    rememberMe: document.getElementById("remember-me"),
};

// ==================== VALIDATION REGEX ====================
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;

// ==================== LOGIN ATTEMPT TRACKING ====================
let loginAttempts = {};

function getLoginAttempts(email) {
    return loginAttempts[email]?.count || 0;
}

function recordLoginAttempt(email) {
    if (!loginAttempts[email]) {
        loginAttempts[email] = { count: 0, timestamp: Date.now() };
    }
    loginAttempts[email].count++;
    loginAttempts[email].timestamp = Date.now();
    
    // Save to localStorage for persistence
    try {
        localStorage.setItem('loginAttempts', JSON.stringify(loginAttempts));
    } catch (e) {}
}

function resetLoginAttempts(email) {
    delete loginAttempts[email];
    try {
        localStorage.setItem('loginAttempts', JSON.stringify(loginAttempts));
    } catch (e) {}
}

function isAccountLocked(email) {
    const attempt = loginAttempts[email];
    if (!attempt) return false;
    
    if (attempt.count >= AUTH_CONFIG.MAX_LOGIN_ATTEMPTS) {
        const timeElapsed = Date.now() - attempt.timestamp;
        return timeElapsed < AUTH_CONFIG.LOCKOUT_DURATION;
    }
    return false;
}

function getRemainingLockoutTime(email) {
    const attempt = loginAttempts[email];
    if (!attempt) return 0;
    
    const timeElapsed = Date.now() - attempt.timestamp;
    const remaining = Math.ceil((AUTH_CONFIG.LOCKOUT_DURATION - timeElapsed) / 60000);
    return Math.max(0, remaining);
}

function lockAccount(email) {
    if (!loginAttempts[email]) {
        loginAttempts[email] = { count: 0, timestamp: Date.now() };
    }
    loginAttempts[email].count = AUTH_CONFIG.MAX_LOGIN_ATTEMPTS;
    loginAttempts[email].timestamp = Date.now();
    try {
        localStorage.setItem('loginAttempts', JSON.stringify(loginAttempts));
    } catch (e) {}
}

// Load login attempts from localStorage
try {
    const saved = localStorage.getItem('loginAttempts');
    if (saved) {
        loginAttempts = JSON.parse(saved);
    }
} catch (e) {}

// ==================== SESSION MANAGEMENT ====================
let sessionTimer = null;

function startSessionTimer() {
    if (sessionTimer) clearInterval(sessionTimer);
    
    const loginTime = localStorage.getItem('loginTime');
    if (!loginTime) return;
    
    sessionTimer = setInterval(() => {
        const elapsed = Date.now() - parseInt(loginTime);
        if (elapsed >= AUTH_CONFIG.SESSION_TIMEOUT) {
            autoLogout('Session expired. Please login again.');
        }
    }, 60000); // Check every minute
}

function stopSessionTimer() {
    if (sessionTimer) {
        clearInterval(sessionTimer);
        sessionTimer = null;
    }
}

function autoLogout(message) {
    stopSessionTimer();
    clearAuthSession();
    AppUtils.notify(message || 'Session expired', 'warning');
    setTimeout(() => {
        window.location.href = 'signin.html?expired=true';
    }, 1000);
}

// ==================== REMEMBER ME ====================
function saveRememberMe(email) {
    if (email) {
        localStorage.setItem('rememberedEmail', email);
    }
}

function clearRememberMe() {
    localStorage.removeItem('rememberedEmail');
}

function loadRememberMe() {
    const email = localStorage.getItem('rememberedEmail');
    if (email && elements.signinEmail) {
        elements.signinEmail.value = email;
        if (elements.rememberMe) {
            elements.rememberMe.checked = true;
        }
    }
}

// ==================== OTP TIMER ====================
let otpTimer = null;
let otpTimeLeft = AUTH_CONFIG.OTP_RESEND_COOLDOWN;

function startOtpTimer(buttonId, timerId) {
    const resendBtn = document.getElementById(buttonId);
    const timerDisplay = document.getElementById(timerId);
    
    if (!resendBtn) return;

    otpTimeLeft = AUTH_CONFIG.OTP_RESEND_COOLDOWN;
    resendBtn.disabled = true;
    resendBtn.style.pointerEvents = 'none';
    
    if (otpTimer) clearInterval(otpTimer);
    
    otpTimer = setInterval(() => {
        otpTimeLeft--;
        
        if (timerDisplay) {
            timerDisplay.textContent = `(${otpTimeLeft}s)`;
            timerDisplay.style.display = 'inline';
        }
        
        if (otpTimeLeft <= 0) {
            clearInterval(otpTimer);
            resendBtn.disabled = false;
            resendBtn.style.pointerEvents = 'auto';
            if (timerDisplay) {
                timerDisplay.style.display = 'none';
                timerDisplay.textContent = '(60s)';
            }
        }
    }, 1000);
}

function resetOtpTimer(buttonId, timerId) {
    if (otpTimer) {
        clearInterval(otpTimer);
        otpTimer = null;
    }
    const resendBtn = document.getElementById(buttonId);
    const timerDisplay = document.getElementById(timerId);
    if (resendBtn) {
        resendBtn.disabled = false;
        resendBtn.style.pointerEvents = 'auto';
    }
    if (timerDisplay) {
        timerDisplay.style.display = 'none';
        timerDisplay.textContent = '(60s)';
    }
}

// ==================== API CALLS ====================
async function signupUser(name, email, password, confirmPassword) {
    return await AppUtils.apiRequest("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name, email, password, confirmPassword })
    });
}

async function loginUser(email, password) {
    return await AppUtils.apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
    });
}

async function logoutUser() {
    return await AppUtils.apiRequest("/auth/logout", {
        method: "POST"
    });
}

async function verifySignupUser(email, otp) {
    return await AppUtils.apiRequest("/auth/verify-signup", {
        method: "POST",
        body: JSON.stringify({ email, otp })
    });
}

async function forgotPasswordUser(email) {
    return await AppUtils.apiRequest("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email })
    });
}

async function resetPasswordUser(userId, otp, newPassword) {
    return await AppUtils.apiRequest("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ userId, otp, newPassword })
    });
}

// ==================== LOADING STATE ====================
function toggleFormLoading(button, isLoading, loadingText = "Please wait...") {
    if (!button) return;

    if (isLoading) {
        button.dataset.originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = `<span class="spinner"></span> ${loadingText}`;
    } else {
        button.disabled = false;
        button.innerHTML = button.dataset.originalText || "Submit";
    }
}

// ==================== AUTH SESSION ====================
function saveAuthSession(response) {
    if (!response) return;

    if (response.accessToken) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN, response.accessToken);
    }
    
    if (response.refreshToken) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.REFRESH_TOKEN, response.refreshToken);
    }

    AppUtils.setJSON(CONFIG.STORAGE_KEYS.USER, response.user || {});
    
    // Start session timer
    localStorage.setItem('loginTime', Date.now().toString());
    startSessionTimer();
}

async function clearAuthSession() {
    try {
        if (AppUtils.getUser()) {
            await logoutUser();
        }
    } catch (error) {
        console.error("LOGOUT API ERROR:", error);
    } finally {
        stopSessionTimer();
        AppUtils.clearAuthData();
        clearRememberMe();
    }
}

// ==================== SIGNUP HANDLING ====================
if (elements.signupForm) {
    elements.signupForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const submitBtn = elements.signupForm.querySelector('button[type="submit"]');
        if (submitBtn?.disabled) return;

        const name = elements.signupName.value.trim();
        const email = elements.signupEmail.value.trim();
        const password = elements.signupPassword.value;
        const confirmPassword = elements.signupConfirmPassword?.value || "";

        if (!name) {
            AppUtils.notify("Name is required.", "error");
            return;
        }

        if (!emailRegex.test(email)) {
            AppUtils.notify("Enter a valid email.", "error");
            return;
        }

        if (password !== confirmPassword) {
            AppUtils.notify("Passwords do not match. Please try again.", "error");
            return;
        }

        if (!passwordRegex.test(password)) {
            AppUtils.notify(
                "Password must contain uppercase, lowercase, number, special character and 8 characters.",
                "error"
            );
            return;
        }

        toggleFormLoading(submitBtn, true, "Sending OTP...");

        try {
            const response = await signupUser(name, email, password, confirmPassword);

            if (response.success) {
                AppUtils.notify("OTP sent to your email!", "success");
                
                // Show OTP form and hide Signup form
                elements.signupForm.style.display = "none";
                const otpForm = document.getElementById("otp-form");
                if (otpForm) {
                    otpForm.style.display = "block";
                    otpForm.dataset.email = email;
                    
                    // Start OTP timer
                    startOtpTimer('resend-signup-otp-link', 'resend-signup-timer');
                }
            } else {
                AppUtils.notify(response.message || "Signup failed.", "error");
            }
        } catch (error) {
            console.error("SIGNUP ERROR:", error);
            AppUtils.notify("Signup failed. Please try again.", "error");
        } finally {
            toggleFormLoading(submitBtn, false);
        }
    });
}

// ==================== OTP VERIFICATION ====================
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
                resetOtpTimer('resend-signup-otp-link', 'resend-signup-timer');
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
                const response = await signupUser(name, email, password, elements.signupConfirmPassword?.value || "");
                if (response.success) {
                    AppUtils.notify("OTP resent successfully!", "success");
                    startOtpTimer('resend-signup-otp-link', 'resend-signup-timer');
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

// ==================== SIGNIN HANDLING ====================
if (elements.signinForm) {
    // Load remembered email
    loadRememberMe();

    elements.signinForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const submitBtn = elements.signinForm.querySelector('button[type="submit"]');
        if (submitBtn?.disabled) return;

        const email = elements.signinEmail.value.trim();
        const password = elements.signinPassword.value;

        if (!emailRegex.test(email)) {
            AppUtils.notify("Enter a valid email.", "error");
            return;
        }

        if (!password) {
            AppUtils.notify("Password is required.", "error");
            return;
        }

        // Check if account is locked
        if (isAccountLocked(email)) {
            const remaining = getRemainingLockoutTime(email);
            AppUtils.notify(`Account temporarily locked. Please try again in ${remaining} minutes.`, "error");
            return;
        }

        toggleFormLoading(submitBtn, true, "Signing In...");

        try {
            const response = await loginUser(email, password);

            if (response.success) {
                // Reset login attempts on success
                resetLoginAttempts(email);
                
                // Save session
                saveAuthSession(response);
                
                // Handle Remember Me
                if (elements.rememberMe && elements.rememberMe.checked) {
                    saveRememberMe(email);
                } else {
                    clearRememberMe();
                }

                // Load user collections
                await AppUtils.loadUserCollections();

                AppUtils.notify("Login successful!", "success");

                const redirect = response.user?.role === "admin" ? "admin.html" : "index.html";
                setTimeout(() => {
                    window.location.href = redirect;
                }, 1000);
            } else {
                // Record failed attempt
                recordLoginAttempt(email);
                
                // Check if account should be locked
                if (getLoginAttempts(email) >= AUTH_CONFIG.MAX_LOGIN_ATTEMPTS) {
                    lockAccount(email);
                    AppUtils.notify(`Too many failed attempts. Account locked for 15 minutes.`, "error");
                } else {
                    const remaining = AUTH_CONFIG.MAX_LOGIN_ATTEMPTS - getLoginAttempts(email);
                    AppUtils.notify(
                        response.message || `Login failed. ${remaining} attempts remaining.`,
                        "error"
                    );
                }
            }
        } catch (error) {
            console.error("LOGIN ERROR:", error);
            AppUtils.notify("Login failed. Please try again.", "error");
        } finally {
            toggleFormLoading(submitBtn, false);
        }
    });
}

// ==================== FORGOT PASSWORD FLOWS ====================
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

    if (backToLoginLink) {
        backToLoginLink.addEventListener("click", (e) => {
            e.preventDefault();
            forgotPasswordForm.style.display = "none";
            resetOtpForm.style.display = "none";
            setNewPasswordForm.style.display = "none";
            elements.signinForm.style.display = "block";
        });
    }

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
                
                if (response.userId) {
                    resetOtpForm.dataset.userId = response.userId;
                }
                // Store email for resend
                resetOtpForm.dataset.email = email;
                
                // Start OTP timer for reset
                startOtpTimer('resend-reset-otp-link', 'resend-reset-timer');
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
            AppUtils.notify(
                "Password must contain uppercase, lowercase, number, special character and 8 characters.",
                "error"
            );
            return;
        }

        toggleFormLoading(submitBtn, true, "Resetting...");

        try {
            const response = await resetPasswordUser(userId, otp, newPassword);
            if (response.success) {
                AppUtils.notify("Password reset successful! Please login.", "success");
                resetOtpTimer('resend-reset-otp-link', 'resend-reset-timer');
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } else {
                AppUtils.notify(response.message || "Reset failed.", "error");
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
            
            const email = resetOtpForm.dataset.email || document.getElementById("forgot-email").value.trim();
            
            try {
                const response = await forgotPasswordUser(email);
                if (response.success) {
                    AppUtils.notify("OTP resent successfully!", "success");
                    
                    if (response.userId) {
                        resetOtpForm.dataset.userId = response.userId;
                    }
                    
                    startOtpTimer('resend-reset-otp-link', 'resend-reset-timer');
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

// ==================== PASSWORD STRENGTH METER ====================
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

    if (score === 4) {
        level = 'Strong';
        color = 'strength-strong';
        percent = 100;
    } else if (score === 3) {
        level = 'Medium';
        color = 'strength-medium';
        percent = 60;
    } else if (score === 2) {
        level = 'Weak';
        color = 'strength-weak';
        percent = 30;
    }

    return { level, color, percent, tips };
}

function updatePasswordStrength() {
    const passwordInput = document.getElementById('signup-password');
    const container = document.getElementById('password-strength-container');
    const fill = document.getElementById('password-strength-fill');
    const text = document.getElementById('password-strength-text');
    const tips = document.getElementById('password-strength-tips');
    const signupBtn = document.getElementById('signup-btn');

    if (!passwordInput || !fill || !text || !tips || !container) return;

    const password = passwordInput.value;

    if (password.length === 0) {
        container.style.display = 'none';
        tips.textContent = '';
        if (signupBtn) signupBtn.disabled = false;
        return;
    }

    container.style.display = 'block';

    const result = evaluatePasswordStrength(password);

    fill.style.width = result.percent + '%';
    fill.className = result.color;
    text.textContent = result.level;
    text.className = result.color;
    tips.textContent = result.tips.join(' • ');
    
    if (signupBtn) {
        signupBtn.disabled = (result.level === 'Weak');
    }
}

// ==================== PASSWORD VISIBILITY TOGGLE ====================
document.querySelectorAll(".password-toggle").forEach((toggle) => {
    let autoHideTimer = null;
    let countdownTimer = null;
    let secondsLeft = 3;

    const field = toggle.closest(".password-field");
    const countdown = field?.querySelector(".countdown-indicator");

    function resetToggle(input, icon) {
        input.type = "password";
        toggle.setAttribute("aria-pressed", "false");
        toggle.setAttribute("aria-label", "Show password");
        if (icon) {
            icon.classList.add("fa-eye");
            icon.classList.remove("fa-eye-slash");
        }
        if (countdown) {
            countdown.style.display = "none";
            countdown.textContent = "";
        }
        clearTimeout(autoHideTimer);
        clearInterval(countdownTimer);
        autoHideTimer = null;
        countdownTimer = null;
        secondsLeft = 3;
    }

    function startCountdown(input, icon) {
        secondsLeft = 3;
        if (countdown) {
            countdown.style.display = "inline";
            countdown.textContent = "Hiding in " + secondsLeft + "s";
        }

        countdownTimer = setInterval(() => {
            secondsLeft--;
            if (countdown) {
                countdown.textContent = "Hiding in " + secondsLeft + "s";
            }
            if (secondsLeft <= 0) {
                clearInterval(countdownTimer);
            }
        }, 1000);

        autoHideTimer = setTimeout(() => {
            resetToggle(input, icon);
        }, 3000);
    }

    toggle.addEventListener("click", () => {
        const input = field?.querySelector("input");
        if (!input) return;

        const isHidden = input.type === "password";
        const icon = toggle.querySelector("i");

        if (!isHidden) {
            resetToggle(input, icon);
            return;
        }

        input.type = "text";
        toggle.setAttribute("aria-pressed", "true");
        toggle.setAttribute("aria-label", "Hide password");
        if (icon) {
            icon.classList.remove("fa-eye");
            icon.classList.add("fa-eye-slash");
        }

        clearTimeout(autoHideTimer);
        clearInterval(countdownTimer);
        startCountdown(input, icon);
    });
});

// ==================== AUTH UI ====================
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

    const authLink = document.getElementById("auth-link");
    const dropdown = document.getElementById("profile-dropdown");
    const logoutBtn = document.getElementById("logout-btn");

    if (!authLink) return;

    const user = AppUtils.getUser();

    if (user) {
        authLink.innerHTML = `<i class="fas fa-user"></i>`;
        authLink.href = "#";
        authLink.classList.add("profile-active");

        authLink.addEventListener("click", (event) => {
            event.preventDefault();
            dropdown?.classList.toggle("active");
        });

        logoutBtn?.addEventListener("click", async () => {
            await clearAuthSession();
            dropdown?.classList.remove("active");
            AppUtils.notify("Logged out successfully!", "success");
            setTimeout(() => {
                window.location.href = document.referrer?.includes(window.location.hostname)
                    ? document.referrer
                    : "index.html";
            }, 1000);
        });
    } else {
        authLink.innerHTML = "Sign In";
        authLink.href = "signin.html";
        authLink.classList.remove("profile-active");
        dropdown?.classList.remove("active");
    }
}

// ==================== DOM INITIALIZATION ====================
document.addEventListener("componentsLoaded", () => {
    initializeAuthUI();
});

document.addEventListener('DOMContentLoaded', function() {
    // Password strength meter
    const passwordInput = document.getElementById('signup-password');
    if (passwordInput) {
        passwordInput.addEventListener('input', updatePasswordStrength);
        // Initial check
        updatePasswordStrength();
    }
    
    // Check for expired session query param
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('expired') === 'true') {
        AppUtils.notify('Your session has expired. Please login again.', 'warning');
        // Remove the query param
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
    }
    
    // Start session timer if user is logged in
    if (AppUtils.getUser()) {
        startSessionTimer();
    }
});

// ==================== EXPORTS ====================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        signupUser,
        loginUser,
        logoutUser,
        verifySignupUser,
        forgotPasswordUser,
        resetPasswordUser,
        saveAuthSession,
        clearAuthSession,
        evaluatePasswordStrength,
        updatePasswordStrength
    };
}
