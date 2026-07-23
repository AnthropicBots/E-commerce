// services/preservationAIService.js
const { v4: uuidv4 } = require('uuid');
const store = require('../data/store');

class PreservationAIService {
  constructor() {
    this.heritageItems = [];
    this.riskAssessments = new Map();
    this.preservationTasks = [];
    this.progressRecords = new Map();
    this.resourceAllocations = [];
    this.recommendations = [];
    this.preservationMetrics = {};
    this.engagementActivities = [];
    
    this.init();
  }

  init() {
    this.loadHeritageItems();
    this.loadPreservationMetrics();
    this.loadSampleAssessments();
    console.log('✅ Preservation AI Service initialized');
  }

  loadHeritageItems() {
    this.heritageItems = [
      {
        id: 'heritage_1',
        name: 'Kantha Embroidery Tradition',
        category: 'craft',
        region: 'West Bengal',
        age: 500,
        significance: 95,
        status: 'endangered',
        currentCondition: 65,
        threatLevel: 75,
        communitySupport: 70,
        documentation: 60,
        lastAssessed: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'heritage_2',
        name: 'Dokra Metal Casting',
        category: 'craft',
        region: 'Odisha',
        age: 400,
        significance: 90,
        status: 'vulnerable',
        currentCondition: 70,
        threatLevel: 60,
        communitySupport: 80,
        documentation: 55,
        lastAssessed: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'heritage_3',
        name: 'Madhubani Painting',
        category: 'art',
        region: 'Bihar',
        age: 300,
        significance: 92,
        status: 'stable',
        currentCondition: 80,
        threatLevel: 40,
        communitySupport: 85,
        documentation: 70,
        lastAssessed: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'heritage_4',
        name: 'Baul Music Tradition',
        category: 'music',
        region: 'West Bengal',
        age: 600,
        significance: 88,
        status: 'critically_endangered',
        currentCondition: 45,
        threatLevel: 90,
        communitySupport: 50,
        documentation: 40,
        lastAssessed: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString()
      },
      {
        id: 'heritage_5',
        name: 'Terracotta Temple Architecture',
        category: 'architecture',
        region: 'West Bengal',
        age: 800,
        significance: 94,
        status: 'endangered',
        currentCondition: 55,
        threatLevel: 80,
        communitySupport: 65,
        documentation: 50,
        lastAssessed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
      }
    ];
  }

  loadPreservationMetrics() {
    this.preservationMetrics = {
      riskFactors: {
        naturalDisaster: 25,
        urbanization: 20,
        neglect: 30,
        lackOfDocumentation: 15,
        communityDisinterest: 10
      },
      preservationPriorities: {
        documentation: 35,
        awareness: 25,
        training: 20,
        restoration: 15,
        digitalArchiving: 5
      },
      successIndicators: {
        communityEngagement: 30,
        documentationQuality: 25,
        revivalRate: 20,
        youthParticipation: 15,
        economicSustainability: 10
      }
    };
  }

  loadSampleAssessments() {
    this.heritageItems.forEach(item => {
      const assessment = this.assessRisk(item.id);
      this.riskAssessments.set(item.id, assessment);
    });
  }

  /**
   * Assess risk for heritage item
   */
  assessRisk(heritageId) {
    const item = this.getHeritageItem(heritageId);
    if (!item) {
      throw new Error('Heritage item not found');
    }

    // Calculate risk score
    const riskScore = this.calculateRiskScore(item);
    const riskLevel = this.getRiskLevel(riskScore);
    const factors = this.identifyRiskFactors(item);
    const urgency = this.calculateUrgency(item, riskScore);

    const assessment = {
      id: `assessment_${Date.now()}_${uuidv4().slice(0, 8)}`,
      heritageId,
      riskScore,
      riskLevel,
      factors,
      urgency,
      timestamp: new Date().toISOString(),
      recommendations: this.generateRecommendations(item, riskScore, factors)
    };

    this.riskAssessments.set(heritageId, assessment);
    return assessment;
  }

  /**
   * Calculate risk score
   */
  calculateRiskScore(item) {
    const weights = {
      status: 0.25,
      condition: 0.20,
      threatLevel: 0.25,
      communitySupport: 0.15,
      documentation: 0.15
    };

    const statusScores = {
      'critically_endangered': 100,
      'endangered': 80,
      'vulnerable': 60,
      'stable': 30,
      'safe': 10
    };

    let score = 0;
    score += (statusScores[item.status] || 50) * weights.status;
    score += (100 - item.currentCondition) * weights.condition;
    score += item.threatLevel * weights.threatLevel;
    score += (100 - item.communitySupport) * weights.communitySupport;
    score += (100 - item.documentation) * weights.documentation;

    return Math.round(Math.min(score, 100));
  }

  /**
   * Get risk level
   */
  getRiskLevel(riskScore) {
    if (riskScore >= 80) return 'critical';
    if (riskScore >= 60) return 'high';
    if (riskScore >= 40) return 'medium';
    if (riskScore >= 20) return 'low';
    return 'minimal';
  }

  /**
   * Identify risk factors
   */
  identifyRiskFactors(item) {
    const factors = [];

    if (item.status === 'critically_endangered') {
      factors.push({
        type: 'critical_status',
        severity: 'high',
        description: 'Item is critically endangered',
        impact: 90
      });
    }

    if (item.currentCondition < 50) {
      factors.push({
        type: 'poor_condition',
        severity: 'high',
        description: 'Current condition is poor',
        impact: 80
      });
    }

    if (item.threatLevel > 70) {
      factors.push({
        type: 'high_threat',
        severity: 'high',
        description: 'High threat level from external factors',
        impact: 85
      });
    }

    if (item.communitySupport < 60) {
      factors.push({
        type: 'low_community_support',
        severity: 'medium',
        description: 'Low community engagement and support',
        impact: 70
      });
    }

    if (item.documentation < 50) {
      factors.push({
        type: 'insufficient_documentation',
        severity: 'medium',
        description: 'Insufficient documentation and records',
        impact: 65
      });
    }

    return factors;
  }

  /**
   * Calculate urgency
   */
  calculateUrgency(item, riskScore) {
    const urgencyFactors = {
      age: Math.min(item.age / 100, 10),
      significance: item.significance / 20,
      threatLevel: item.threatLevel / 20,
      communityDecline: (100 - item.communitySupport) / 20
    };

    const urgencyScore = Object.values(urgencyFactors).reduce((a, b) => a + b, 0);
    const maxUrgency = 20;
    const normalizedUrgency = Math.min(urgencyScore / maxUrgency, 1);

    return {
      score: Math.round(normalizedUrgency * 100),
      level: normalizedUrgency > 0.7 ? 'immediate' : normalizedUrgency > 0.4 ? 'short_term' : 'long_term',
      factors: urgencyFactors
    };
  }

  /**
   * Generate preservation recommendations
   */
  generateRecommendations(item, riskScore, factors) {
    const recommendations = [];

    // Documentation priority
    if (item.documentation < 60) {
      recommendations.push({
        id: `rec_${Date.now()}_${uuidv4().slice(0, 6)}`,
        type: 'documentation',
        priority: riskScore > 60 ? 'high' : 'medium',
        action: 'Comprehensive Documentation',
        description: `Create detailed documentation of ${item.name} including photos, videos, and written records`,
        steps: [
          'Conduct field documentation',
          'Interview practitioners',
          'Record techniques and processes',
          'Create digital archive',
          'Publish documentation'
        ],
        estimatedTime: '3-6 months',
        resources: ['Documentation team', 'Camera equipment', 'Storage'],
        cost: riskScore > 60 ? 'high' : 'medium',
        impact: 85
      });
    }

    // Community engagement
    if (item.communitySupport < 70) {
      recommendations.push({
        id: `rec_${Date.now()}_${uuidv4().slice(0, 6)}`,
        type: 'community_engagement',
        priority: 'high',
        action: 'Community Engagement Program',
        description: `Engage local community in preserving ${item.name}`,
        steps: [
          'Organize community workshops',
          'Establish local preservation committee',
          'Create awareness programs',
          'Involve youth in preservation',
          'Celebrate cultural events'
        ],
        estimatedTime: '2-4 months',
        resources: ['Community coordinators', 'Event venues', 'Promotional materials'],
        cost: 'medium',
        impact: 90
      });
    }

    // Training and capacity building
    if (item.status === 'critically_endangered' || item.status === 'endangered') {
      recommendations.push({
        id: `rec_${Date.now()}_${uuidv4().slice(0, 6)}`,
        type: 'training',
        priority: 'critical',
        action: 'Skill Transmission Program',
        description: `Train new practitioners in ${item.name}`,
        steps: [
          'Identify master practitioners',
          'Develop training curriculum',
          'Recruit apprentices',
          'Conduct training sessions',
          'Certify practitioners'
        ],
        estimatedTime: '6-12 months',
        resources: ['Trainers', 'Training materials', 'Workshop space'],
        cost: 'high',
        impact: 95
      });
    }

    // Digital preservation
    if (item.documentation < 70) {
      recommendations.push({
        id: `rec_${Date.now()}_${uuidv4().slice(0, 6)}`,
        type: 'digital_preservation',
        priority: 'medium',
        action: 'Digital Archive Creation',
        description: `Create digital archive for ${item.name}`,
        steps: [
          'Digitize existing records',
          'Create 3D models if applicable',
          'Develop online exhibition',
          'Create interactive resources',
          'Ensure long-term accessibility'
        ],
        estimatedTime: '4-8 months',
        resources: ['Digital archivist', 'Software', 'Server space'],
        cost: 'medium',
        impact: 80
      });
    }

    return recommendations;
  }

  /**
   * Get heritage item by ID
   */
  getHeritageItem(heritageId) {
    return this.heritageItems.find(item => item.id === heritageId);
  }

  /**
   * Get all heritage items
   */
  getHeritageItems(filters = {}) {
    let items = [...this.heritageItems];

    if (filters.status) {
      items = items.filter(item => item.status === filters.status);
    }

    if (filters.category) {
      items = items.filter(item => item.category === filters.category);
    }

    if (filters.region) {
      items = items.filter(item => item.region === filters.region);
    }

    if (filters.minRisk) {
      items = items.filter(item => {
        const assessment = this.riskAssessments.get(item.id);
        return assessment && assessment.riskScore >= filters.minRisk;
      });
    }

    return items;
  }

  /**
   * Get risk assessment
   */
  getRiskAssessment(heritageId) {
    return this.riskAssessments.get(heritageId);
  }

  /**
   * Get all risk assessments
   */
  getAllRiskAssessments() {
    return Array.from(this.riskAssessments.values());
  }

  /**
   * Get preservation recommendations
   */
  getPreservationRecommendations(heritageId = null) {
    if (heritageId) {
      const assessment = this.riskAssessments.get(heritageId);
      return assessment ? assessment.recommendations : [];
    }

    const allRecommendations = [];
    this.riskAssessments.forEach(assessment => {
      allRecommendations.push(...assessment.recommendations);
    });
    return allRecommendations;
  }

  /**
   * Track preservation progress
   */
  trackProgress(heritageId, progressData) {
    if (!this.progressRecords.has(heritageId)) {
      this.progressRecords.set(heritageId, []);
    }

    const record = {
      id: `progress_${Date.now()}_${uuidv4().slice(0, 8)}`,
      heritageId,
      ...progressData,
      timestamp: new Date().toISOString()
    };

    this.progressRecords.get(heritageId).push(record);
    return record;
  }

  /**
   * Get preservation progress
   */
  getProgress(heritageId) {
    return this.progressRecords.get(heritageId) || [];
  }

  /**
   * Get overall preservation progress
   */
  getOverallProgress() {
    const progress = {
      totalItems: this.heritageItems.length,
      assessedItems: this.riskAssessments.size,
      totalRecommendations: this.getPreservationRecommendations().length,
      inProgress: 0,
      completed: 0,
      pending: 0
    };

    this.progressRecords.forEach(records => {
      records.forEach(record => {
        if (record.status === 'completed') progress.completed++;
        else if (record.status === 'in_progress') progress.inProgress++;
        else progress.pending++;
      });
    });

    return progress;
  }

  /**
   * Allocate resources
   */
  allocateResources(heritageId, resourceData) {
    const allocation = {
      id: `allocation_${Date.now()}_${uuidv4().slice(0, 8)}`,
      heritageId,
      ...resourceData,
      allocatedAt: new Date().toISOString(),
      status: 'pending'
    };

    this.resourceAllocations.push(allocation);
    return allocation;
  }

  /**
   * Get resource allocations
   */
  getResourceAllocations(heritageId = null) {
    if (heritageId) {
      return this.resourceAllocations.filter(a => a.heritageId === heritageId);
    }
    return this.resourceAllocations;
  }

  /**
   * Log community engagement
   */
  logEngagement(activityData) {
    const activity = {
      id: `engagement_${Date.now()}_${uuidv4().slice(0, 8)}`,
      ...activityData,
      timestamp: new Date().toISOString()
    };

    this.engagementActivities.push(activity);
    return activity;
  }

  /**
   * Get engagement activities
   */
  getEngagementActivities(filters = {}) {
    let activities = [...this.engagementActivities];

    if (filters.heritageId) {
      activities = activities.filter(a => a.heritageId === filters.heritageId);
    }

    if (filters.type) {
      activities = activities.filter(a => a.type === filters.type);
    }

    return activities;
  }

  /**
   * Get preservation statistics
   */
  getPreservationStats() {
    const riskDistribution = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      minimal: 0
    };

    this.riskAssessments.forEach(assessment => {
      riskDistribution[assessment.riskLevel] = (riskDistribution[assessment.riskLevel] || 0) + 1;
    });

    const categoryDistribution = {};
    this.heritageItems.forEach(item => {
      categoryDistribution[item.category] = (categoryDistribution[item.category] || 0) + 1;
    });

    const statusDistribution = {};
    this.heritageItems.forEach(item => {
      statusDistribution[item.status] = (statusDistribution[item.status] || 0) + 1;
    });

    const totalRecommendations = this.getPreservationRecommendations().length;
    const inProgress = this.resourceAllocations.filter(a => a.status === 'in_progress').length;
    const completed = this.resourceAllocations.filter(a => a.status === 'completed').length;

    return {
      totalItems: this.heritageItems.length,
      riskDistribution,
      categoryDistribution,
      statusDistribution,
      recommendations: {
        total: totalRecommendations,
        high: this.getPreservationRecommendations().filter(r => r.priority === 'high').length,
        medium: this.getPreservationRecommendations().filter(r => r.priority === 'medium').length,
        low: this.getPreservationRecommendations().filter(r => r.priority === 'low').length
      },
      progress: this.getOverallProgress(),
      resources: {
        allocated: this.resourceAllocations.length,
        inProgress,
        completed
      },
      engagement: {
        totalActivities: this.engagementActivities.length,
        types: this.engagementActivities.reduce((acc, a) => {
          acc[a.type] = (acc[a.type] || 0) + 1;
          return acc;
        }, {})
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get AI insights
   */
  getAIInsights() {
    const highRiskItems = this.heritageItems.filter(item => {
      const assessment = this.riskAssessments.get(item.id);
      return assessment && assessment.riskLevel === 'critical';
    });

    const topRecommendations = this.getPreservationRecommendations()
      .filter(r => r.priority === 'high' || r.priority === 'critical')
      .slice(0, 5);

    const urgentActions = this.heritageItems
      .filter(item => {
        const assessment = this.riskAssessments.get(item.id);
        return assessment && assessment.urgency.level === 'immediate';
      })
      .map(item => ({
        heritageId: item.id,
        name: item.name,
        urgency: this.riskAssessments.get(item.id).urgency.score,
        action: 'Immediate preservation action required'
      }));

    return {
      criticalItems: highRiskItems.length,
      urgentActions,
      topRecommendations,
      overallRisk: this.calculateOverallRisk(),
      preservationPriority: this.getPreservationPriority(),
      estimatedResources: this.estimateResources(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Calculate overall risk
   */
  calculateOverallRisk() {
    const scores = [];
    this.riskAssessments.forEach(assessment => {
      scores.push(assessment.riskScore);
    });
    
    if (scores.length === 0) return 0;
    const average = scores.reduce((a, b) => a + b, 0) / scores.length;
    return Math.round(average);
  }

  /**
   * Get preservation priority
   */
  getPreservationPriority() {
    const priorities = ['documentation', 'training', 'community_engagement', 'digital_archiving'];
    const scores = {};

    priorities.forEach(priority => {
      scores[priority] = this.getPreservationRecommendations()
        .filter(r => r.type === priority)
        .reduce((sum, r) => sum + (r.impact || 0), 0);
    });

    const sorted = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);

    return sorted;
  }

  /**
   * Estimate resources needed
   */
  estimateResources() {
    const recommendations = this.getPreservationRecommendations();
    const resources = {
      total: 0,
      high: 0,
      medium: 0,
      low: 0,
      details: {}
    };

    recommendations.forEach(rec => {
      resources.total++;
      resources[rec.cost || 'medium']++;
      rec.resources.forEach(resource => {
        resources.details[resource] = (resources.details[resource] || 0) + 1;
      });
    });

    return resources;
  }
}

module.exports = PreservationAIService;