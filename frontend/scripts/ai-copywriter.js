// frontend/scripts/ai-copywriter.js

/**
 * AI Copywriter - Product Copy Generation
 */

class AICopywriter {
    constructor() {
        this.currentCopy = null;
        this.copyHistory = [];
        this.isGenerating = false;
        this.init();
    }

    init() {
        // Attach event listeners
        document.getElementById('generateCopyBtn')?.addEventListener('click', () => this.generateCopy());
        document.getElementById('regenerateBtn')?.addEventListener('click', () => this.regenerateCopy());
        document.getElementById('useCopyBtn')?.addEventListener('click', () => this.useCopy());
        document.getElementById('generateMultipleBtn')?.addEventListener('click', () => this.generateMultipleVersions());
        
        // Auto-generate on keyword input (debounced)
        const keywordInput = document.getElementById('productKeywords');
        if (keywordInput) {
            let debounceTimer;
            keywordInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    if (keywordInput.value.length > 5) {
                        this.generateCopy();
                    }
                }, 1000);
            });
        }
    }

    /**
     * Generate product copy
     */
    async generateCopy() {
        if (this.isGenerating) return;
        
        const keywords = document.getElementById('productKeywords')?.value || '';
        const category = document.getElementById('productCategory')?.value || '';
        const audience = document.getElementById('targetAudience')?.value || '';
        const tone = document.getElementById('toneSelect')?.value || 'Professional';
        
        if (!keywords || keywords.split(',').length < 2) {
            this.showToast('Please enter at least 2 keywords', 'warning');
            return;
        }

        this.isGenerating = true;
        this.showLoading(true);

        try {
            const token = localStorage.getItem('jwt');
            const response = await fetch('/api/copywriter/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    keywords: keywords.split(',').map(k => k.trim()),
                    category,
                    targetAudience: audience,
                    tone
                })
            });

            const data = await response.json();
            
            if (data.success) {
                this.currentCopy = data.data;
                this.copyHistory.push(data.data);
                this.displayCopy(data.data);
                this.showToast('✅ Copy generated successfully!', 'success');
            } else {
                this.showToast('❌ Failed to generate copy', 'error');
            }
        } catch (error) {
            console.error('Generate copy error:', error);
            this.showToast('❌ Error generating copy', 'error');
        } finally {
            this.isGenerating = false;
            this.showLoading(false);
        }
    }

    /**
     * Regenerate copy
     */
    async regenerateCopy() {
        const keywords = document.getElementById('productKeywords')?.value || '';
        if (!keywords) {
            this.showToast('Please enter keywords first', 'warning');
            return;
        }
        await this.generateCopy();
    }

    /**
     * Generate multiple versions
     */
    async generateMultipleVersions() {
        const keywords = document.getElementById('productKeywords')?.value || '';
        const category = document.getElementById('productCategory')?.value || '';
        
        if (!keywords || keywords.split(',').length < 2) {
            this.showToast('Please enter at least 2 keywords', 'warning');
            return;
        }

        this.showLoading(true);

        try {
            const token = localStorage.getItem('jwt');
            const response = await fetch('/api/copywriter/multiple', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    keywords: keywords.split(',').map(k => k.trim()),
                    category,
                    count: 3
                })
            });

            const data = await response.json();
            
            if (data.success) {
                this.displayVersions(data.data.versions);
                this.showToast('✅ Generated 3 versions!', 'success');
            } else {
                this.showToast('❌ Failed to generate versions', 'error');
            }
        } catch (error) {
            console.error('Multiple versions error:', error);
            this.showToast('❌ Error generating versions', 'error');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Display generated copy
     */
    displayCopy(copy) {
        const container = document.getElementById('aiGeneratedContent');
        if (!container) return;

        document.getElementById('generatedName').textContent = copy.name || '';
        document.getElementById('generatedDescription').textContent = copy.description || '';
        
        // Display bullet points
        const bulletContainer = document.getElementById('bulletPoints');
        if (bulletContainer && copy.bulletPoints) {
            bulletContainer.innerHTML = copy.bulletPoints.map(point => 
                `<li class="bullet-point">✓ ${point}</li>`
            ).join('');
        }

        // Display SEO keywords
        const seoContainer = document.getElementById('seoKeywords');
        if (seoContainer && copy.seoKeywords) {
            seoContainer.innerHTML = copy.seoKeywords.map(keyword => 
                `<span class="seo-tag">#${keyword}</span>`
            ).join('');
        }

        container.classList.remove('hidden');
        container.style.display = 'block';
    }

    /**
     * Display multiple versions
     */
    displayVersions(versions) {
        const container = document.getElementById('versionsContainer');
        if (!container) return;

        container.innerHTML = versions.map((v, index) => `
            <div class="version-card" data-version="${index + 1}">
                <h4>Version ${index + 1} - ${v.tone}</h4>
                <p><strong>Name:</strong> ${v.name}</p>
                <p><strong>Description:</strong> ${v.description}</p>
                <button onclick="aiCopywriter.selectVersion(${index + 1})" class="btn-select">
                    Select This Version
                </button>
            </div>
        `).join('');

        container.classList.remove('hidden');
    }

    /**
     * Select a version
     */
    selectVersion(versionNumber) {
        const version = this.currentVersion[versionNumber - 1];
        if (version) {
            this.currentCopy = version;
            this.displayCopy(version);
            document.getElementById('versionsContainer').classList.add('hidden');
            this.showToast(`✅ Selected Version ${versionNumber}`, 'success');
        }
    }

    /**
     * Use the generated copy
     */
    useCopy() {
        if (!this.currentCopy) {
            this.showToast('No copy to use', 'warning');
            return;
        }

        // Fill form fields
        document.getElementById('productName').value = this.currentCopy.name || '';
        document.getElementById('productDescription').value = this.currentCopy.description || '';
        document.getElementById('shortDescription').value = this.currentCopy.shortDescription || '';

        this.showToast('✅ Copy applied to form!', 'success');

        // Log usage
        this.logCopyUsage();
    }

    /**
     * Log copy usage
     */
    async logCopyUsage() {
        try {
            const token = localStorage.getItem('jwt');
            await fetch('/api/copywriter/use', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    copyId: this.currentCopy.id || null,
                    productId: document.getElementById('productId')?.value || null
                })
            });
        } catch (error) {
            console.error('Error logging usage:', error);
        }
    }

    /**
     * Show loading state
     */
    showLoading(show) {
        const loader = document.getElementById('copyLoader');
        if (loader) {
            loader.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        // Use existing toast system
        if (window.showToast) {
            window.showToast(message, type);
        } else {
            alert(message);
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.aiCopywriter = new AICopywriter();
});

// Export for use in other scripts
export default AICopywriter;