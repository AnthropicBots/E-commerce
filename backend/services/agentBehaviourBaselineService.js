// backend/services/agentBehavioralBaselineService.js
const db = require('../config/db').promise;
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const BASELINE_CONFIG = {
    // Behavioral tracking
    baselineWindow: 30, // days
    updateFrequency: 7, // days
    
    // Merchant tracking
    maxMerchants: 20,
    merchantExpansionThreshold: 3, // new merchants per day
    
    // Basket composition
    basketHistoryLength: 50,
    compositionDeviationThreshold: 0.3, // 30% deviation
    
    // Conversation analysis
    conversationHistoryLength: 100,
    fingerprintThreshold: 0.75,
    
    // Mandate scope
    mandateDeviationThreshold: 0.2,
    
    // Confidence thresholds
    lowConfidenceThreshold: 0.4,
    mediumConfidenceThreshold: 0.6,
    highConfidenceThreshold: 0.8
};

// ============================================
// AGENT BEHAVIORAL BASELINE CLASS
// ============================================

class AgentBehavioralBaselineService {
    constructor() {
        this.agentBaselines = new Map();
        this.merchantProfiles = new Map();
        this.basketProfiles = new Map();
        this.conversationFingerprints = new Map();
        this.mandateProfiles = new Map();
        this.anomalyLogs = [];
        this.detectionAlerts = [];
    }

    /**
     * Initialize agent behavioral baseline
     */
    async initializeBaseline(agentId, initialData = {}) {
        const baseline = {
            agentId,
            initializedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            merchantProfile: await this.buildMerchantProfile(agentId, initialData.merchants),
            basketProfile: await this.buildBasketProfile(agentId, initialData.baskets),
            conversationFingerprint: await this.buildConversationFingerprint(agentId, initialData.conversations),
            mandateProfile: await this.buildMandateProfile(agentId, initialData.mandates),
            behavioralPatterns: await this.extractBehavioralPatterns(agentId, initialData)
        };

        this.agentBaselines.set(agentId, baseline);
        await this.storeBaseline(agentId, baseline);

        console.log(`✅ Baseline initialized for agent: ${agentId}`);
        return baseline;
    }

    /**
     * Update agent baseline with new data
     */
    async updateBaseline(agentId, newData) {
        const current = this.agentBaselines.get(agentId);
        if (!current) {
            throw new Error(`No baseline found for agent: ${agentId}`);
        }

        // Update merchant profile
        if (newData.merchants) {
            current.merchantProfile = await this.updateMerchantProfile(
                current.merchantProfile,
                newData.merchants
            );
        }

        // Update basket profile
        if (newData.baskets) {
            current.basketProfile = await this.updateBasketProfile(
                current.basketProfile,
                newData.baskets
            );
        }

        // Update conversation fingerprint
        if (newData.conversations) {
            current.conversationFingerprint = await this.updateConversationFingerprint(
                current.conversationFingerprint,
                newData.conversations
            );
        }

        // Update mandate profile
        if (newData.mandates) {
            current.mandateProfile = await this.updateMandateProfile(
                current.mandateProfile,
                newData.mandates
            );
        }

        // Update behavioral patterns
        current.behavioralPatterns = await this.updateBehavioralPatterns(
            current.behavioralPatterns,
            newData
        );

        current.lastUpdated = new Date().toISOString();
        this.agentBaselines.set(agentId, current);
        await this.storeBaseline(agentId, current);

        return current;
    }

    /**
     * Detect if agent is compromised
     */
    async detectCompromisedAgent(agentId, currentActivity) {
        const baseline = this.agentBaselines.get(agentId);
        if (!baseline) {
            throw new Error(`No baseline found for agent: ${agentId}`);
        }

        const detection = {
            isCompromised: false,
            confidence: 0,
            flags: [],
            details: {},
            timestamp: new Date().toISOString()
        };

        // 1. Check merchant behavior
        const merchantCheck = await this.checkMerchantBehavior(
            baseline.merchantProfile,
            currentActivity.merchants
        );
        if (merchantCheck.flags.length > 0) {
            detection.flags.push(...merchantCheck.flags);
            detection.confidence += merchantCheck.confidence;
            detection.details.merchant = merchantCheck.details;
        }

        // 2. Check basket composition
        const basketCheck = await this.checkBasketComposition(
            baseline.basketProfile,
            currentActivity.basket
        );
        if (basketCheck.flags.length > 0) {
            detection.flags.push(...basketCheck.flags);
            detection.confidence += basketCheck.confidence;
            detection.details.basket = basketCheck.details;
        }

        // 3. Check conversation fingerprint
        const conversationCheck = await this.checkConversationFingerprint(
            baseline.conversationFingerprint,
            currentActivity.conversation
        );
        if (conversationCheck.flags.length > 0) {
            detection.flags.push(...conversationCheck.flags);
            detection.confidence += conversationCheck.confidence;
            detection.details.conversation = conversationCheck.details;
        }

        // 4. Check mandate scope
        const mandateCheck = await this.checkMandateScope(
            baseline.mandateProfile,
            currentActivity.mandate
        );
        if (mandateCheck.flags.length > 0) {
            detection.flags.push(...mandateCheck.flags);
            detection.confidence += mandateCheck.confidence;
            detection.details.mandate = mandateCheck.details;
        }

        // 5. Check behavioral patterns
        const patternCheck = await this.checkBehavioralPatterns(
            baseline.behavioralPatterns,
            currentActivity
        );
        if (patternCheck.flags.length > 0) {
            detection.flags.push(...patternCheck.flags);
            detection.confidence += patternCheck.confidence;
            detection.details.patterns = patternCheck.details;
        }

        // Calculate overall confidence (0-100)
        const totalFlags = detection.flags.length;
        const avgConfidence = totalFlags > 0 
            ? detection.confidence / totalFlags 
            : 0;

        detection.confidence = Math.min(100, avgConfidence * 100);
        detection.isCompromised = detection.confidence > 60;

        // Log detection
        await this.logAnomalyDetection(agentId, detection);

        // Generate alert for compromised agents
        if (detection.isCompromised) {
            await this.generateAlert(agentId, detection);
        }

        return detection;
    }

    // ============================================
    // MERCHANT PROFILE METHODS
    // ============================================

    async buildMerchantProfile(agentId, merchantData = []) {
        const profile = {
            knownMerchants: new Set(),
            merchantFrequency: {},
            averageBasketSize: {},
            lastInteraction: {},
            expansionRate: 0,
            typicalMerchantCount: merchantData.length || 0
        };

        for (const merchant of merchantData) {
            profile.knownMerchants.add(merchant.id);
            profile.merchantFrequency[merchant.id] = (profile.merchantFrequency[merchant.id] || 0) + 1;
            profile.averageBasketSize[merchant.id] = merchant.basketSize || 0;
            profile.lastInteraction[merchant.id] = merchant.timestamp || new Date().toISOString();
        }

        return profile;
    }

    async updateMerchantProfile(current, newMerchants) {
        for (const merchant of newMerchants) {
            current.knownMerchants.add(merchant.id);
            current.merchantFrequency[merchant.id] = (current.merchantFrequency[merchant.id] || 0) + 1;
            current.averageBasketSize[merchant.id] = merchant.basketSize || 0;
            current.lastInteraction[merchant.id] = merchant.timestamp || new Date().toISOString();
        }

        // Update expansion rate
        const recent = await this.getRecentMerchants(current);
        current.expansionRate = recent.length / 7; // per day

        return current;
    }

    async checkMerchantBehavior(baseline, currentMerchants) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!currentMerchants || currentMerchants.length === 0) {
            return { flags, confidence, details };
        }

        // Check for new merchants (unusual expansion)
        const newMerchants = currentMerchants.filter(
            m => !baseline.knownMerchants.has(m.id)
        );

        if (newMerchants.length > BASELINE_CONFIG.merchantExpansionThreshold) {
            flags.push({
                type: 'rapid_merchant_expansion',
                severity: 'high',
                details: `Expanded to ${newMerchants.length} new merchants`
            });
            confidence += 0.3;
            details.newMerchants = newMerchants.map(m => m.id);
        }

        // Check for unusual merchant frequency
        for (const merchant of currentMerchants) {
            const frequency = baseline.merchantFrequency[merchant.id] || 0;
            const expected = (baseline.typicalMerchantCount / Object.keys(baseline.merchantFrequency).length) || 1;
            
            if (frequency > expected * 3) {
                flags.push({
                    type: 'unusual_merchant_frequency',
                    severity: 'medium',
                    details: `Merchant ${merchant.id} has unusual frequency: ${frequency}`
                });
                confidence += 0.2;
                details[merchant.id] = { frequency, expected };
            }
        }

        // Check for unusual basket sizes
        for (const merchant of currentMerchants) {
            const avgSize = baseline.averageBasketSize[merchant.id] || 0;
            if (merchant.basketSize > avgSize * 3 && avgSize > 0) {
                flags.push({
                    type: 'unusual_basket_size',
                    severity: 'medium',
                    details: `Unusual basket size for merchant ${merchant.id}: ${merchant.basketSize}`
                });
                confidence += 0.2;
            }
        }

        return {
            flags,
            confidence: Math.min(1, confidence),
            details
        };
    }

    // ============================================
    // BASKET COMPOSITION METHODS
    // ============================================

    async buildBasketProfile(agentId, baskets = []) {
        const profile = {
            typicalItems: new Map(),
            typicalCategories: new Map(),
            itemFrequency: {},
            categoryFrequency: {},
            averageItemCount: 0,
            averageValue: 0,
            history: baskets.slice(-BASELINE_CONFIG.basketHistoryLength)
        };

        for (const basket of baskets) {
            this.updateBasketStats(profile, basket);
        }

        return profile;
    }

    async updateBasketProfile(current, newBaskets) {
        for (const basket of newBaskets) {
            this.updateBasketStats(current, basket);
            current.history.push(basket);
        }

        // Keep only recent history
        if (current.history.length > BASELINE_CONFIG.basketHistoryLength) {
            current.history = current.history.slice(-BASELINE_CONFIG.basketHistoryLength);
        }

        return current;
    }

    updateBasketStats(profile, basket) {
        if (!basket.items) return;

        // Update item frequency
        for (const item of basket.items) {
            profile.itemFrequency[item.id] = (profile.itemFrequency[item.id] || 0) + 1;
            if (profile.itemFrequency[item.id] > 5) {
                profile.typicalItems.set(item.id, item);
            }
        }

        // Update category frequency
        for (const category of basket.categories || []) {
            profile.categoryFrequency[category] = (profile.categoryFrequency[category] || 0) + 1;
            if (profile.categoryFrequency[category] > 5) {
                profile.typicalCategories.set(category, category);
            }
        }

        // Update averages
        const totalItems = Object.values(profile.itemFrequency).reduce((a, b) => a + b, 0);
        profile.averageItemCount = totalItems / Object.keys(profile.itemFrequency).length || 0;
        
        const totalValue = basket.items.reduce((sum, item) => sum + (item.price || 0), 0);
        profile.averageValue = (profile.averageValue + totalValue) / 2;
    }

    async checkBasketComposition(baseline, currentBasket) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!currentBasket || !currentBasket.items) {
            return { flags, confidence, details };
        }

        // Check for unusual items
        const unusualItems = currentBasket.items.filter(
            item => !baseline.typicalItems.has(item.id)
        );

        if (unusualItems.length > currentBasket.items.length * 0.5) {
            flags.push({
                type: 'unusual_items',
                severity: 'high',
                details: `${unusualItems.length} unusual items in basket`
            });
            confidence += 0.3;
            details.unusualItems = unusualItems.map(i => i.id);
        }

        // Check for unusual categories
        const unusualCategories = (currentBasket.categories || []).filter(
            cat => !baseline.typicalCategories.has(cat)
        );

        if (unusualCategories.length > 3) {
            flags.push({
                type: 'unusual_categories',
                severity: 'medium',
                details: `Unusual categories: ${unusualCategories.join(', ')}`
            });
            confidence += 0.2;
            details.unusualCategories = unusualCategories;
        }

        // Check for value deviation
        const currentValue = currentBasket.items.reduce((sum, item) => sum + (item.price || 0), 0);
        if (currentValue > baseline.averageValue * 3 && baseline.averageValue > 0) {
            flags.push({
                type: 'unusual_basket_value',
                severity: 'medium',
                details: `Basket value (${currentValue}) exceeds typical (${baseline.averageValue})`
            });
            confidence += 0.2;
        }

        return {
            flags,
            confidence: Math.min(1, confidence),
            details
        };
    }

    // ============================================
    // CONVERSATION FINGERPRINT METHODS
    // ============================================

    async buildConversationFingerprint(agentId, conversations = []) {
        const fingerprint = {
            patterns: {},
            typicalPhrases: new Set(),
            style: {},
            history: conversations.slice(-BASELINE_CONFIG.conversationHistoryLength),
            hash: null
        };

        for (const conversation of conversations) {
            this.updateConversationFingerprintData(fingerprint, conversation);
        }

        // Generate fingerprint hash
        fingerprint.hash = this.generateFingerprintHash(fingerprint);
        
        return fingerprint;
    }

    async updateConversationFingerprint(current, newConversations) {
        for (const conversation of newConversations) {
            this.updateConversationFingerprintData(current, conversation);
            current.history.push(conversation);
        }

        // Keep only recent history
        if (current.history.length > BASELINE_CONFIG.conversationHistoryLength) {
            current.history = current.history.slice(-BASELINE_CONFIG.conversationHistoryLength);
        }

        // Update fingerprint hash
        current.hash = this.generateFingerprintHash(current);

        return current;
    }

    updateConversationFingerprintData(fingerprint, conversation) {
        const text = conversation.text || '';
        
        // Extract patterns
        const words = text.toLowerCase().split(' ');
        for (const word of words) {
            if (word.length > 3) {
                fingerprint.typicalPhrases.add(word);
            }
        }

        // Update style
        fingerprint.style = {
            avgLength: (fingerprint.style.avgLength || 0) + text.length,
            avgWords: (fingerprint.style.avgWords || 0) + words.length,
            count: (fingerprint.style.count || 0) + 1
        };
    }

    generateFingerprintHash(fingerprint) {
        const data = {
            phrases: Array.from(fingerprint.typicalPhrases).slice(0, 50),
            style: fingerprint.style
        };
        return crypto.createHash('sha256')
            .update(JSON.stringify(data))
            .digest('hex');
    }

    async checkConversationFingerprint(baseline, currentConversation) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!currentConversation) {
            return { flags, confidence, details };
        }

        const currentHash = this.generateFingerprintHash({
            typicalPhrases: new Set(currentConversation.text.toLowerCase().split(' ')),
            style: { count: 1 }
        });

        // Check fingerprint similarity
        const similarity = this.calculateFingerprintSimilarity(
            baseline.hash,
            currentHash
        );

        if (similarity < BASELINE_CONFIG.fingerprintThreshold) {
            flags.push({
                type: 'conversation_fingerprint_mismatch',
                severity: 'high',
                details: `Fingerprint similarity: ${similarity.toFixed(2)}`
            });
            confidence += 0.35;
            details.similarity = similarity;
        }

        // Check for suspicious patterns
        const suspiciousPatterns = [
            /urgent/i,
            /emergency/i,
            /immediate/i,
            /bypass/i,
            /override/i,
            /ignore/i,
            /free/i,
            /unlimited/i,
            /admin/i,
            /ceo/i
        ];

        for (const pattern of suspiciousPatterns) {
            if (pattern.test(currentConversation.text)) {
                flags.push({
                    type: 'suspicious_conversation_pattern',
                    severity: 'medium',
                    details: `Detected pattern: ${pattern}`
                });
                confidence += 0.15;
                break;
            }
        }

        return {
            flags,
            confidence: Math.min(1, confidence),
            details
        };
    }

    calculateFingerprintSimilarity(hash1, hash2) {
        if (!hash1 || !hash2) return 0;
        
        let matches = 0;
        for (let i = 0; i < Math.min(hash1.length, hash2.length); i++) {
            if (hash1[i] === hash2[i]) matches++;
        }
        
        return matches / Math.min(hash1.length, hash2.length);
    }

    // ============================================
    // MANDATE PROFILE METHODS
    // ============================================

    async buildMandateProfile(agentId, mandates = []) {
        const profile = {
            allowedActions: new Set(),
            allowedMerchants: new Set(),
            maxAmount: 0,
            scope: {},
            history: mandates,
            deviationCount: 0
        };

        for (const mandate of mandates) {
            this.updateMandateProfile(profile, mandate);
        }

        return profile;
    }

    async updateMandateProfile(current, newMandates) {
        for (const mandate of newMandates) {
            this.updateMandateProfile(current, mandate);
            current.history.push(mandate);
        }

        return current;
    }

    updateMandateProfile(profile, mandate) {
        if (mandate.actions) {
            for (const action of mandate.actions) {
                profile.allowedActions.add(action);
            }
        }

        if (mandate.merchants) {
            for (const merchant of mandate.merchants) {
                profile.allowedMerchants.add(merchant);
            }
        }

        if (mandate.maxAmount && mandate.maxAmount > profile.maxAmount) {
            profile.maxAmount = mandate.maxAmount;
        }

        profile.scope = {
            actionCount: profile.allowedActions.size,
            merchantCount: profile.allowedMerchants.size,
            maxAmount: profile.maxAmount
        };
    }

    async checkMandateScope(baseline, currentMandate) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!currentMandate) {
            return { flags, confidence, details };
        }

        // Check for actions outside mandate
        const unauthorizedActions = (currentMandate.actions || []).filter(
            action => !baseline.allowedActions.has(action)
        );

        if (unauthorizedActions.length > 0) {
            flags.push({
                type: 'unauthorized_actions',
                severity: 'critical',
                details: `Unauthorized actions: ${unauthorizedActions.join(', ')}`
            });
            confidence += 0.4;
            details.unauthorizedActions = unauthorizedActions;
        }

        // Check for merchants outside mandate
        const unauthorizedMerchants = (currentMandate.merchants || []).filter(
            merchant => !baseline.allowedMerchants.has(merchant)
        );

        if (unauthorizedMerchants.length > 0) {
            flags.push({
                type: 'unauthorized_merchants',
                severity: 'high',
                details: `Unauthorized merchants: ${unauthorizedMerchants.join(', ')}`
            });
            confidence += 0.3;
            details.unauthorizedMerchants = unauthorizedMerchants;
        }

        // Check for amount violation
        if (currentMandate.amount && baseline.maxAmount > 0) {
            if (currentMandate.amount > baseline.maxAmount) {
                flags.push({
                    type: 'amount_exceeded',
                    severity: 'high',
                    details: `Amount (${currentMandate.amount}) exceeds mandate (${baseline.maxAmount})`
                });
                confidence += 0.3;
                details.amountViolation = currentMandate.amount - baseline.maxAmount;
            }
        }

        // Check for scope deviation
        const currentScope = {
            actionCount: (currentMandate.actions || []).length,
            merchantCount: (currentMandate.merchants || []).length
        };

        const actionDeviation = Math.abs(currentScope.actionCount - baseline.scope.actionCount);
        const merchantDeviation = Math.abs(currentScope.merchantCount - baseline.scope.merchantCount);

        if (actionDeviation > 2 || merchantDeviation > 2) {
            flags.push({
                type: 'scope_deviation',
                severity: 'medium',
                details: `Scope deviation: actions ${actionDeviation}, merchants ${merchantDeviation}`
            });
            confidence += 0.2;
            details.scopeDeviation = { actionDeviation, merchantDeviation };
        }

        return {
            flags,
            confidence: Math.min(1, confidence),
            details
        };
    }

    // ============================================
    // BEHAVIORAL PATTERN METHODS
    // ============================================

    async extractBehavioralPatterns(agentId, data) {
        return {
            timePatterns: await this.extractTimePatterns(data),
            frequencyPatterns: await this.extractFrequencyPatterns(data),
            valuePatterns: await this.extractValuePatterns(data),
            interactionPatterns: await this.extractInteractionPatterns(data)
        };
    }

    async updateBehavioralPatterns(current, newData) {
        // Update time patterns
        if (newData.timestamps) {
            current.timePatterns = await this.updateTimePatterns(current.timePatterns, newData.timestamps);
        }

        // Update frequency patterns
        if (newData.frequencies) {
            current.frequencyPatterns = await this.updateFrequencyPatterns(
                current.frequencyPatterns,
                newData.frequencies
            );
        }

        // Update value patterns
        if (newData.values) {
            current.valuePatterns = await this.updateValuePatterns(current.valuePatterns, newData.values);
        }

        // Update interaction patterns
        if (newData.interactions) {
            current.interactionPatterns = await this.updateInteractionPatterns(
                current.interactionPatterns,
                newData.interactions
            );
        }

        return current;
    }

    async checkBehavioralPatterns(baseline, currentActivity) {
        const flags = [];
        let confidence = 0;
        const details = {};

        // Check time patterns
        if (currentActivity.timestamp) {
            const timeCheck = await this.checkTimePatterns(
                baseline.timePatterns,
                currentActivity.timestamp
            );
            if (timeCheck.flags.length > 0) {
                flags.push(...timeCheck.flags);
                confidence += timeCheck.confidence;
                details.time = timeCheck.details;
            }
        }

        // Check frequency patterns
        if (currentActivity.frequency) {
            const freqCheck = await this.checkFrequencyPatterns(
                baseline.frequencyPatterns,
                currentActivity.frequency
            );
            if (freqCheck.flags.length > 0) {
                flags.push(...freqCheck.flags);
                confidence += freqCheck.confidence;
                details.frequency = freqCheck.details;
            }
        }

        // Check value patterns
        if (currentActivity.value) {
            const valueCheck = await this.checkValuePatterns(
                baseline.valuePatterns,
                currentActivity.value
            );
            if (valueCheck.flags.length > 0) {
                flags.push(...valueCheck.flags);
                confidence += valueCheck.confidence;
                details.value = valueCheck.details;
            }
        }

        // Check interaction patterns
        if (currentActivity.interaction) {
            const interactionCheck = await this.checkInteractionPatterns(
                baseline.interactionPatterns,
                currentActivity.interaction
            );
            if (interactionCheck.flags.length > 0) {
                flags.push(...interactionCheck.flags);
                confidence += interactionCheck.confidence;
                details.interaction = interactionCheck.details;
            }
        }

        return {
            flags,
            confidence: Math.min(1, confidence),
            details
        };
    }

    // ============================================
    // PATTERN EXTRACTION METHODS
    // ============================================

    async extractTimePatterns(data) {
        const patterns = {
            typicalHours: new Set(),
            typicalDays: new Set(),
            intervals: [],
            count: 0
        };

        if (data && data.timestamps) {
            for (const timestamp of data.timestamps) {
                const date = new Date(timestamp);
                patterns.typicalHours.add(date.getHours());
                patterns.typicalDays.add(date.getDay());
                patterns.count++;
            }
        }

        return patterns;
    }

    async updateTimePatterns(current, newTimestamps) {
        for (const timestamp of newTimestamps) {
            const date = new Date(timestamp);
            current.typicalHours.add(date.getHours());
            current.typicalDays.add(date.getDay());
            current.count++;
        }
        return current;
    }

    async checkTimePatterns(patterns, timestamp) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!timestamp || patterns.count === 0) {
            return { flags, confidence, details };
        }

        const date = new Date(timestamp);
        const hour = date.getHours();
        const day = date.getDay();

        // Check unusual hour
        if (!patterns.typicalHours.has(hour) && patterns.typicalHours.size > 0) {
            flags.push({
                type: 'unusual_hour',
                severity: 'low',
                details: `Activity at unusual hour: ${hour}:00`
            });
            confidence += 0.15;
        }

        // Check unusual day
        if (!patterns.typicalDays.has(day) && patterns.typicalDays.size > 0) {
            flags.push({
                type: 'unusual_day',
                severity: 'low',
                details: `Activity on unusual day: ${day}`
            });
            confidence += 0.1;
        }

        return {
            flags,
            confidence: Math.min(1, confidence),
            details
        };
    }

    async extractFrequencyPatterns(data) {
        return {
            averageFrequency: data.frequencies ? 
                data.frequencies.reduce((a, b) => a + b, 0) / data.frequencies.length : 0,
            maxFrequency: data.frequencies ? Math.max(...data.frequencies) : 0,
            count: data.frequencies ? data.frequencies.length : 0
        };
    }

    async updateFrequencyPatterns(current, newFrequencies) {
        const allFrequencies = [...current, ...newFrequencies];
        current.averageFrequency = allFrequencies.reduce((a, b) => a + b, 0) / allFrequencies.length;
        current.maxFrequency = Math.max(...allFrequencies);
        current.count = allFrequencies.length;
        return current;
    }

    async checkFrequencyPatterns(patterns, frequency) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!frequency || patterns.count === 0) {
            return { flags, confidence, details };
        }

        if (frequency > patterns.averageFrequency * 3) {
            flags.push({
                type: 'unusual_frequency',
                severity: 'medium',
                details: `Frequency (${frequency}) exceeds average (${patterns.averageFrequency})`
            });
            confidence += 0.2;
            details.frequency = frequency;
        }

        return {
            flags,
            confidence: Math.min(1, confidence),
            details
        };
    }

    async extractValuePatterns(data) {
        return {
            averageValue: data.values ? 
                data.values.reduce((a, b) => a + b, 0) / data.values.length : 0,
            maxValue: data.values ? Math.max(...data.values) : 0,
            count: data.values ? data.values.length : 0
        };
    }

    async updateValuePatterns(current, newValues) {
        const allValues = [...current, ...newValues];
        current.averageValue = allValues.reduce((a, b) => a + b, 0) / allValues.length;
        current.maxValue = Math.max(...allValues);
        current.count = allValues.length;
        return current;
    }

    async checkValuePatterns(patterns, value) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!value || patterns.count === 0) {
            return { flags, confidence, details };
        }

        if (value > patterns.averageValue * 3) {
            flags.push({
                type: 'unusual_value',
                severity: 'medium',
                details: `Value (${value}) exceeds average (${patterns.averageValue})`
            });
            confidence += 0.2;
            details.value = value;
        }

        return {
            flags,
            confidence: Math.min(1, confidence),
            details
        };
    }

    async extractInteractionPatterns(data) {
        return {
            typicalActions: new Set(data.interactions || []),
            count: data.interactions ? data.interactions.length : 0
        };
    }

    async updateInteractionPatterns(current, newInteractions) {
        for (const interaction of newInteractions) {
            current.typicalActions.add(interaction);
            current.count++;
        }
        return current;
    }

    async checkInteractionPatterns(patterns, interaction) {
        const flags = [];
        let confidence = 0;
        const details = {};

        if (!interaction || patterns.count === 0) {
            return { flags, confidence, details };
        }

        if (!patterns.typicalActions.has(interaction) && patterns.typicalActions.size > 0) {
            flags.push({
                type: 'unusual_interaction',
                severity: 'medium',
                details: `Unusual interaction: ${interaction}`
            });
            confidence += 0.2;
            details.interaction = interaction;
        }

        return {
            flags,
            confidence: Math.min(1, confidence),
            details
        };
    }

    // ============================================
    // DATABASE OPERATIONS
    // ============================================

    async storeBaseline(agentId, baseline) {
        try {
            await db.query(
                `INSERT INTO agent_behavioral_baselines 
                 (agent_id, initialized_at, last_updated, merchant_profile, 
                  basket_profile, conversation_fingerprint, mandate_profile, 
                  behavioral_patterns)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                 last_updated = VALUES(last_updated),
                 merchant_profile = VALUES(merchant_profile),
                 basket_profile = VALUES(basket_profile),
                 conversation_fingerprint = VALUES(conversation_fingerprint),
                 mandate_profile = VALUES(mandate_profile),
                 behavioral_patterns = VALUES(behavioral_patterns)`,
                [
                    agentId,
                    baseline.initializedAt,
                    baseline.lastUpdated,
                    JSON.stringify(baseline.merchantProfile),
                    JSON.stringify(baseline.basketProfile),
                    JSON.stringify(baseline.conversationFingerprint),
                    JSON.stringify(baseline.mandateProfile),
                    JSON.stringify(baseline.behavioralPatterns)
                ]
            );
        } catch (error) {
            console.error('Store baseline error:', error);
        }
    }

    async getRecentMerchants(profile) {
        const recent = [];
        const now = new Date();
        for (const [merchantId, lastTime] of Object.entries(profile.lastInteraction)) {
            const diff = (now - new Date(lastTime)) / (1000 * 60 * 60 * 24);
            if (diff < 7) {
                recent.push(merchantId);
            }
        }
        return recent;
    }

    async logAnomalyDetection(agentId, detection) {
        try {
            await db.query(
                `INSERT INTO agent_behavioral_anomalies 
                 (agent_id, confidence, flags, details, timestamp)
                 VALUES (?, ?, ?, ?, NOW())`,
                [
                    agentId,
                    detection.confidence,
                    JSON.stringify(detection.flags),
                    JSON.stringify(detection.details)
                ]
            );
        } catch (error) {
            console.error('Log anomaly error:', error);
        }
    }

    async generateAlert(agentId, detection) {
        const alert = {
            agentId,
            detection,
            timestamp: new Date().toISOString()
        };

        this.detectionAlerts.push(alert);

        // Store in database
        try {
            await db.query(
                `INSERT INTO agent_compromise_alerts 
                 (agent_id, confidence, flags, details, timestamp, resolved)
                 VALUES (?, ?, ?, ?, NOW(), FALSE)`,
                [
                    agentId,
                    detection.confidence,
                    JSON.stringify(detection.flags),
                    JSON.stringify(detection.details)
                ]
            );
        } catch (error) {
            console.error('Store alert error:', error);
        }

        // Log critical alert
        if (detection.confidence > 80) {
            console.error(`🚨 CRITICAL: Agent ${agentId} appears compromised!`);
            console.error(`Confidence: ${detection.confidence}%`);
            console.error(`Flags:`, detection.flags);
            // Send Slack/email alert here
        }

        return alert;
    }

    // ============================================
    // STATISTICS
    // ============================================

    async getStatistics() {
        try {
            const [stats] = await db.query(
                `SELECT 
                    COUNT(*) as total_baselines,
                    AVG(confidence) as avg_confidence,
                    SUM(CASE WHEN confidence > 60 THEN 1 ELSE 0 END) as compromised_agents,
                    COUNT(DISTINCT agent_id) as unique_agents
                 FROM agent_behavioral_anomalies
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
            );

            const [alertStats] = await db.query(
                `SELECT 
                    COUNT(*) as total_alerts,
                    SUM(CASE WHEN resolved = FALSE THEN 1 ELSE 0 END) as pending_alerts
                 FROM agent_compromise_alerts
                 WHERE timestamp > DATE_SUB(NOW(), INTERVAL 7 DAY)`
            );

            return {
                anomalies: stats[0],
                alerts: alertStats[0],
                timestamp