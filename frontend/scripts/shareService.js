// frontend/scripts/shareService.js

// ============================================
// SHARE SERVICE CONFIGURATION
// ============================================

const SHARE_CONFIG = {
    whatsappBaseUrl: 'https://wa.me/',
    copySuccessDuration: 3000, // 3 seconds
    useWebShareAPI: true,
    fallbackMethods: ['whatsapp', 'clipboard', 'native']
};

// ============================================
// SHARE SERVICE
// ============================================

class ShareService {
    constructor() {
        this.isNativeShareSupported = this.checkNativeShareSupport();
        this.isClipboardSupported = this.checkClipboardSupport();
        this.copyTimeout = null;
    }

    /**
     * Check if native Web Share API is supported
     */
    checkNativeShareSupport() {
        return typeof navigator.share === 'function';
    }

    /**
     * Check if Clipboard API is supported
     */
    checkClipboardSupport() {
        return typeof navigator.clipboard === 'object' && 
               typeof navigator.clipboard.writeText === 'function';
    }

    /**
     * Generate share data for a product
     */
    generateShareData(product) {
        const productName = product.name || 'Product';
        const productPrice = product.price ? `₹${parseFloat(product.price).toFixed(2)}` : '';
        const productUrl = `${window.location.origin}/product.html?id=${product.id || product.productId}`;
        
        const message = `✨ Check out this amazing product!\n\n📦 ${productName}\n`;
        const priceMessage = productPrice ? `💰 Price: ${productPrice}\n` : '';
        const urlMessage = `🔗 ${productUrl}`;
        
        const fullMessage = `${message}${priceMessage}\n${urlMessage}`;
        
        // WhatsApp message (URL encoded)
        const whatsappMessage = `${productName} ${productPrice ? `- ${productPrice}` : ''}\n${productUrl}`;
        
        return {
            productName,
            productPrice,
            productUrl,
            message: fullMessage,
            whatsappMessage: whatsappMessage,
            title: `Check out ${productName}`,
            text: `I found this amazing product: ${productName}${productPrice ? ` for ${productPrice}` : ''}`,
            url: productUrl
        };
    }

    /**
     * Share via Native Web Share API
     */
    async shareNative(shareData) {
        if (!this.isNativeShareSupported) {
            throw new Error('Native share not supported');
        }

        try {
            await navigator.share({
                title: shareData.title,
                text: shareData.text,
                url: shareData.url
            });
            return { success: true, method: 'native' };
        } catch (error) {
            if (error.name !== 'AbortError') {
                throw error;
            }
            return { success: false, method: 'native', cancelled: true };
        }
    }

    /**
     * Share via WhatsApp
     */
    shareWhatsApp(shareData) {
        const encodedMessage = encodeURIComponent(shareData.whatsappMessage);
        const whatsappUrl = `${SHARE_CONFIG.whatsappBaseUrl}?text=${encodedMessage}`;
        window.open(whatsappUrl, '_blank');
        return { success: true, method: 'whatsapp' };
    }

    /**
     * Copy link to clipboard
     */
    async copyLink(shareData) {
        if (!this.isClipboardSupported) {
            // Fallback to legacy method
            return this.copyLinkLegacy(shareData.url);
        }

        try {
            await navigator.clipboard.writeText(shareData.url);
            return { success: true, method: 'clipboard' };
        } catch (error) {
            console.error('Clipboard copy failed:', error);
            return this.copyLinkLegacy(shareData.url);
        }
    }

    /**
     * Legacy copy link method (fallback)
     */
    copyLinkLegacy(text) {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            return { success: true, method: 'clipboard_fallback' };
        } catch (error) {
            console.error('Legacy copy failed:', error);
            return { success: false, method: 'clipboard_fallback', error };
        }
    }

    /**
     * Share product using best available method
     */
    async shareProduct(product, method = 'auto') {
        const shareData = this.generateShareData(product);

        try {
            // Check if user wants specific method
            if (method === 'whatsapp') {
                return this.shareWhatsApp(shareData);
            }

            if (method === 'clipboard') {
                return await this.copyLink(shareData);
            }

            // Auto: use best available
            if (method === 'auto') {
                // Prefer native share on mobile
                if (this.isNativeShareSupported && window.innerWidth <= 768) {
                    return await this.shareNative(shareData);
                }
                
                // Fallback to WhatsApp
                return this.shareWhatsApp(shareData);
            }

            return { success: false, method: 'unknown' };
        } catch (error) {
            console.error('Share error:', error);
            return { success: false, method, error };
        }
    }

    /**
     * Get share methods available
     */
    getAvailableMethods() {
        const methods = [];

        if (this.isNativeShareSupported) {
            methods.push({ id: 'native', label: 'Share', icon: '📱' });
        }

        methods.push({ id: 'whatsapp', label: 'WhatsApp', icon: '💬' });

        if (this.isClipboardSupported) {
            methods.push({ id: 'clipboard', label: 'Copy Link', icon: '🔗' });
        }

        return methods;
    }
}

// ============================================
// SHARE BUTTON COMPONENT
// ============================================

class ShareButton {
    constructor(options = {}) {
        this.container = options.container || document.getElementById('share-container');
        this.product = options.product || null;
        this.service = new ShareService();
        this.isOpen = false;
        this.init();
    }

    init() {
        if (!this.container) return;
        this.render();
        this.attachEvents();
    }

    render() {
        const methods = this.service.getAvailableMethods();
        
        this.container.innerHTML = `
            <div class="share-wrapper">
                <button class="share-main-btn" id="shareMainBtn" aria-label="Share">
                    <span class="share-icon">📤</span>
                    <span class="share-text">Share</span>
                </button>
                <div class="share-dropdown" id="shareDropdown">
                    ${methods.map(method => `
                        <button class="share-option" data-method="${method.id}">
                            <span class="share-option-icon">${method.icon}</span>
                            <span class="share-option-label">${method.label}</span>
                        </button>
                    `).join('')}
                </div>
                <div class="share-toast" id="shareToast"></div>
            </div>
        `;

        // Add styles
        this.addStyles();
    }

    attachEvents() {
        const mainBtn = document.getElementById('shareMainBtn');
        const dropdown = document.getElementById('shareDropdown');
        const options = dropdown?.querySelectorAll('.share-option');

        // Toggle dropdown
        mainBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDropdown();
        });

        // Close dropdown on outside click
        document.addEventListener('click', () => {
            if (this.isOpen) {
                this.closeDropdown();
            }
        });

        // Handle share options
        options?.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const method = btn.dataset.method;
                this.handleShare(method);
                this.closeDropdown();
            });
        });
    }

    toggleDropdown() {
        const dropdown = document.getElementById('shareDropdown');
        if (!dropdown) return;
        
        this.isOpen = !this.isOpen;
        dropdown.classList.toggle('active');
    }

    closeDropdown() {
        const dropdown = document.getElementById('shareDropdown');
        if (!dropdown) return;
        
        this.isOpen = false;
        dropdown.classList.remove('active');
    }

    async handleShare(method) {
        if (!this.product) {
            this.showToast('Product data not available', 'error');
            return;
        }

        try {
            const result = await this.service.shareProduct(this.product, method);
            
            if (result.success) {
                const messages = {
                    'whatsapp': '✅ Opening WhatsApp...',
                    'clipboard': '✅ Link copied to clipboard!',
                    'native': '✅ Share dialog opened',
                    'clipboard_fallback': '✅ Link copied to clipboard!'
                };
                this.showToast(messages[result.method] || '✅ Shared successfully!', 'success');
            } else if (result.cancelled) {
                // User cancelled native share - don't show error
                return;
            } else {
                this.showToast('❌ Failed to share. Please try again.', 'error');
            }
        } catch (error) {
            console.error('Share error:', error);
            this.showToast('❌ Failed to share. Please try again.', 'error');
        }
    }

    showToast(message, type = 'info') {
        const toast = document.getElementById('shareToast');
        if (!toast) return;

        toast.textContent = message;
        toast.className = `share-toast ${type}`;
        toast.style.display = 'block';
        
        // Clear any existing timeout
        if (window._shareToastTimeout) {
            clearTimeout(window._shareToastTimeout);
        }
        
        window._shareToastTimeout = setTimeout(() => {
            toast.style.display = 'none';
        }, SHARE_CONFIG.copySuccessDuration);
    }

    addStyles() {
        const styleId = 'share-button-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .share-wrapper {
                position: relative;
                display: inline-block;
            }

            .share-main-btn {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 12px 20px;
                background: #2c7be5;
                color: white;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
            }

            .share-main-btn:hover {
                background: #1a68c4;
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(44, 123, 229, 0.3);
            }

            .share-main-btn:active {
                transform: translateY(0);
            }

            .share-icon {
                font-size: 20px;
            }

            .share-dropdown {
                position: absolute;
                top: calc(100% + 8px);
                left: 0;
                min-width: 180px;
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
                padding: 8px;
                opacity: 0;
                visibility: hidden;
                transform: translateY(-10px);
                transition: all 0.3s ease;
                z-index: 1000;
            }

            .share-dropdown.active {
                opacity: 1;
                visibility: visible;
                transform: translateY(0);
            }

            .share-option {
                display: flex;
                align-items: center;
                gap: 12px;
                width: 100%;
                padding: 10px 14px;
                background: none;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                transition: background 0.2s ease;
                font-size: 14px;
                color: #333;
            }

            .share-option:hover {
                background: #f5f7fa;
            }

            .share-option:active {
                background: #e8ecf1;
            }

            .share-option-icon {
                font-size: 18px;
            }

            .share-option-label {
                font-weight: 500;
            }

            .share-toast {
                position: fixed;
                bottom: 30px;
                left: 50%;
                transform: translateX(-50%);
                padding: 12px 24px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                z-index: 9999;
                display: none;
                animation: slideUp 0.3s ease;
                max-width: 90%;
                text-align: center;
            }

            .share-toast.success {
                background: #10b981;
                color: white;
            }

            .share-toast.error {
                background: #ef4444;
                color: white;
            }

            .share-toast.info {
                background: #3b82f6;
                color: white;
            }

            @keyframes slideUp {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }

            @media (max-width: 768px) {
                .share-main-btn {
                    padding: 10px 16px;
                    font-size: 14px;
                }
                
                .share-dropdown {
                    right: 0;
                    left: auto;
                    min-width: 160px;
                }

                .share-toast {
                    bottom: 20px;
                    padding: 10px 16px;
                    font-size: 13px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Update product data
     */
    setProduct(product) {
        this.product = product;
    }

    /**
     * Destroy component
     */
    destroy() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        if (window._shareToastTimeout) {
            clearTimeout(window._shareToastTimeout);
        }
    }
}

// ============================================
// EXPOSE GLOBALLY
// ============================================

window.ShareService = ShareService;
window.ShareButton = ShareButton;

// ============================================
// EXPORT FOR MODULE USE
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ShareService, ShareButton };
}