// toast container
let toastContainer =
    document.getElementById(
        "toast-container"
    );

// create container
if (!toastContainer) {
    toastContainer =
        document.createElement(
            "div"
        );

    toastContainer.id =
        "toast-container";

    toastContainer.style.cssText = `
        position:fixed;
        top:20px;
        right:20px;
        z-index:99999;
        display:flex;
        flex-direction:column;
        gap:12px;
        width:320px;
        max-width:90%;
    `;

    document.body.appendChild(
        toastContainer
    );
}

// icons
const toastIcons = {

    success:
        "✔",

    error:
        "✖",

    warning:
        "⚠",

    info:
        "ℹ"
};

// colors
const toastColors = {
    success:
        "#16a34a",

    error:
        "#dc2626",

    warning:
        "#d97706",

    info:
        "#2563eb"
};

// show toast
function showToast(
    message,
    type = "info",
    duration = 3500
) {
    if (!message) {
        return;
    }

    const toast =
        document.createElement(
            "div"
        );

    toast.className =
        "toast-item";

    toast.style.cssText = `
        background:white;
        border-left:5px solid ${
            toastColors[type]
            || toastColors.info
        };
        color:#111;
        padding:14px 16px;
        border-radius:12px;
        box-shadow:0 10px 30px rgba(0,0,0,0.12);
        display:flex;
        align-items:flex-start;
        gap:12px;
        transform:translateX(120%);
        opacity:0;
        transition:all 0.35s ease;
        overflow:hidden;
        position:relative;
    `;

    const icon =
        document.createElement(
            "div"
        );

    icon.innerText =
        toastIcons[type]
        || toastIcons.info;

    icon.style.cssText = `
        font-size:18px;
        font-weight:bold;
        color:${
            toastColors[type]
            || toastColors.info
        };
        margin-top:2px;
    `;

    const content =
        document.createElement(
            "div"
        );

    content.style.flex =
        "1";

    const text =
        document.createElement(
            "p"
        );

    let displayMessage = message;
    if (message.toLowerCase().includes("wishlist")) {
        displayMessage += " (Click to view)";
        toast.style.cursor = "pointer";
        toast.addEventListener("click", (e) => {
            if (e.target !== closeButton) {
                window.location.href = "wishlist.html";
            }
        });
    }

    text.innerText = displayMessage;

    text.style.cssText = `
        margin:0;
        font-size:14px;
        line-height:1.5;
        word-break:break-word;
    `;

    const closeButton =
        document.createElement(
            "button"
        );

    closeButton.innerHTML =
        "&times;";

    closeButton.style.cssText = `
        border:none;
        background:none;
        font-size:18px;
        cursor:pointer;
        color:#777;
        padding:0;
        line-height:1;
    `;

    closeButton.addEventListener(
        "click",
        () => {
            removeToast(
                toast
            );
        }
    );

    const progress =
        document.createElement(
            "div"
        );

    progress.style.cssText = `
        position:absolute;
        left:0;
        bottom:0;
        height:3px;
        width:100%;
        background:${
            toastColors[type]
            || toastColors.info
        };
        transform-origin:left;
        animation:toast-progress linear forwards;
        animation-duration:${duration}ms;
    `;

    content.appendChild(
        text
    );

    toast.append(
        icon,
        content,
        closeButton,
        progress
    );

    toastContainer.appendChild(
        toast
    );

    requestAnimationFrame(
        () => {
            toast.style.transform =
                "translateX(0)";

            toast.style.opacity =
                "1";
        }
    );

    setTimeout(
        () => {
            removeToast(
                toast
            );
        },
        duration
    );
}

// remove toast
function removeToast(
    toast
) {
    if (!toast) {
        return;
    }

    toast.style.transform =
        "translateX(120%)";

    toast.style.opacity =
        "0";

    setTimeout(
        () => {
            toast.remove();
        },
        350
    );
}

// inject animation
const toastStyle =
    document.createElement(
        "style"
    );

toastStyle.innerHTML = `
    @keyframes toast-progress {
        from {
            transform:scaleX(1);
        }

        to {
            transform:scaleX(0);
        }
    }
`;

document.head.appendChild(
    toastStyle
);

// expose globally
window.showToast =
    showToast;