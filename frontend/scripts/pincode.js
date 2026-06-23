document.addEventListener("DOMContentLoaded", () => {
    const checkBtn = document.getElementById("pincode-check-btn");
    const input = document.getElementById("pincode-input");
    const resultEl = document.getElementById("pincode-result");

    if (!checkBtn || !input || !resultEl) return;

    checkBtn.addEventListener("click", async () => {
        const pincode = input.value.trim();

        if (!/^\d{6}$/.test(pincode)) {
            resultEl.textContent = "Please enter a valid 6-digit pincode.";
            resultEl.className = "pincode-error";
            return;
        }

        resultEl.textContent = "Checking...";
        resultEl.className = "pincode-loading";

        try {
            const response = await fetch(
                `${window.CONFIG.API_BASE}/pincode/check/${pincode}`
            );
            const data = await response.json();

            resultEl.textContent = data.message;
            resultEl.className = data.deliverable
                ? "pincode-success"
                : "pincode-error";
        } catch (error) {
            resultEl.textContent = "Something went wrong. Please try again.";
            resultEl.className = "pincode-error";
        }
    });

    // allow pressing Enter inside the input
    input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            checkBtn.click();
        }
    });
});