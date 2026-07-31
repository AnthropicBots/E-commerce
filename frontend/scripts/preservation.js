// public/scripts/preservation.js

class PreservationUI {
  constructor(options = {}) {
    // Path only; AppUtils.apiRequest prepends CONFIG.API_BASE (which already
    // ends in /api), so this must not carry its own /api prefix.
    this.apiBase = options.apiBase || '/preservation';
    this.container = options.container || '#preservation-container';
    this.currentItem = null;
    this.insights = null;
    
    this.init();
  }

  init() {
    this.renderInterface();
    this.loadItems();
    this.loadStats();
    this.loadInsights();
    this.setupEventListeners();
    console.log('✅ Preservation UI initialized');
  }

  renderInterface() {
    const container = document.querySelector(this.container);
    if (!container) return;

    container.innerHTML = `
      <div class="preservation-interface">
        <div class="preservation-header">
          <h2>🛡️ Heritage Preservation System</h2>
          <div class="preservation-actions">
            <button id="btn-assess-all" class="btn btn-primary">🔍 Assess All</button>
            <button id="btn-insights" class="btn btn-info">🧠 AI Insights</button>
            <button id="btn-stats" class="btn btn-secondary">📊 Stats</button>
          </div>
        </div>

        <!-- Stats -->
        <div id="preservation-stats" class="preservation-stats">
          <div class="loading">Loading stats...</div>
        </div>

        <!-- Insights -->
        <div id="insights-container" class="insights-container" style="display: none;">
          <!-- Insights will be loaded here -->
        </div>

        <!-- Heritage Items -->
        <div class="heritage-list" id="heritage-list">
          <h4>🏛️ Heritage Items</h4>
          <div id="items-grid" class="items-grid">
            <div class="loading">Loading items...</div>
          </div>
        </div>

        <!-- Item Detail -->
        <div id="item-detail" class="item-detail" style="display: none;">
          <!-- Item details will be loaded here -->
        </div>
      </div>
    `;
  }

  async loadItems() {
    try {
      const data = await AppUtils.apiRequest(`${this.apiBase}/items`);

      if (data.success) {
        this.renderItems(data.items);
      }
    } catch (error) {
      console.error('Error loading items:', error);
    }
  }

  renderItems(items) {
    const container = document.getElementById('items-grid');
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = '<p>No heritage items found</p>';
      return;
    }

    const statusColors = {
      'critically_endangered': '#f44336',
      'endangered': '#FF9800',
      'vulnerable': '#FFC107',
      'stable': '#4CAF50',
      'safe': '#2196F3'
    };

    container.innerHTML = `
      <div class="items-grid-layout">
        ${items.map(item => `
          <div class="item-card" data-item-id="${item.id}" style="
            background: white;
            border-radius: 12px;
            padding: 15px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            cursor: pointer;
            transition: transform 0.3s;
            border-left: 4px solid ${statusColors[item.status] || '#999'};
          ">
            <div style="display: flex; justify-content: space-between; align-items: start;">
              <h4 style="margin: 0;">${item.name}</h4>
              <span style="
                background: ${statusColors[item.status] || '#999'};
                color: white;
                padding: 2px 10px;
                border-radius: 12px;
                font-size: 11px;
              ">${item.status}</span>
            </div>
            <p style="color: #666; font-size: 14px; margin: 5px 0;">${item.category} • ${item.region}</p>
            <div style="display: flex; gap: 15px; font-size: 12px; color: #888; margin-top: 10px;">
              <span>📅 ${item.age} years old</span>
              <span>📊 ${item.significance}% significance</span>
              <span>🛡️ ${item.currentCondition}% condition</span>
            </div>
            <div style="margin-top: 10px;">
              <button onclick="event.stopPropagation(); window.preservationUI.assessItem('${item.id}')" style="
                padding: 5px 15px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
              ">🔍 Assess</button>
              <button onclick="event.stopPropagation(); window.preservationUI.viewItem('${item.id}')" style="
                padding: 5px 15px;
                background: #2196F3;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
              ">View</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    // Hover effect
    container.querySelectorAll('.item-card').forEach(card => {
      card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateY(-3px)';
        card.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'translateY(0)';
        card.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
      });
    });
  }

  async loadStats() {
    try {
      const data = await AppUtils.apiRequest(`${this.apiBase}/stats`);

      if (data.success) {
        this.renderStats(data.stats);
      }
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  }

  renderStats(stats) {
    const container = document.getElementById('preservation-stats');
    if (!container) return;

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.totalItems}</div>
          <div class="stat-label">Total Items</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.riskDistribution.critical || 0}</div>
          <div class="stat-label">Critical Risk</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.recommendations.total || 0}</div>
          <div class="stat-label">Recommendations</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.resources?.inProgress || 0}</div>
          <div class="stat-label">In Progress</div>
        </div>
      </div>
    `;
  }

  // ==========================================================
  // Everything below this point was missing entirely: the file
  // was committed truncated in the middle of renderStats()'s
  // template literal (#1297), so it did not parse and none of
  // the class ever loaded. init() calls loadInsights() and
  // setupEventListeners(), and renderItems() emits onclick
  // handlers referencing assessItem()/viewItem() -- all of
  // which had no implementation.
  // ==========================================================

  async loadInsights() {
    try {
      const data = await AppUtils.apiRequest(`${this.apiBase}/insights`);

      if (data.success) {
        this.insights = data.insights;
        this.renderInsights(data.insights);
      }
    } catch (error) {
      console.error('Error loading insights:', error);
    }
  }

  renderInsights(insights) {
    const container = document.getElementById('insights-container');
    if (!container) return;

    const entries = AppUtils.safeArray(insights);

    if (!entries.length) {
      container.innerHTML = '<div class="empty">No insights available yet.</div>';
      return;
    }

    container.innerHTML = `
      <h4>🧠 AI Insights</h4>
      <ul class="insights-list">
        ${entries
          .map((insight) => `<li>${AppUtils.escapeHTML(insight.summary || insight)}</li>`)
          .join('')}
      </ul>
    `;
  }

  /**
   * Request a fresh preservation assessment for one heritage item.
   *
   * @param {string} heritageId
   */
  async assessItem(heritageId) {
    if (!heritageId) return;

    try {
      const data = await AppUtils.apiRequest(`${this.apiBase}/assess`, {
        method: 'POST',
        body: JSON.stringify({ heritageId })
      });

      if (data.success) {
        AppUtils.notify('Assessment complete', 'success');
        this.loadItems();
        this.loadStats();
      } else {
        AppUtils.notify(data.message || 'Assessment failed', 'error');
      }
    } catch (error) {
      console.error('Error assessing item:', error);
      AppUtils.notify('Assessment failed', 'error');
    }
  }

  /**
   * Load and display the detail panel for one heritage item.
   *
   * @param {string} heritageId
   */
  async viewItem(heritageId) {
    if (!heritageId) return;

    try {
      const data = await AppUtils.apiRequest(`${this.apiBase}/item/${heritageId}`);

      if (!data.success) {
        AppUtils.notify(data.message || 'Could not load item', 'error');
        return;
      }

      this.currentItem = data.item;
      this.renderItemDetail(data.item);
    } catch (error) {
      console.error('Error loading item:', error);
      AppUtils.notify('Could not load item', 'error');
    }
  }

  renderItemDetail(item) {
    const container = document.getElementById('item-detail');
    if (!container || !item) return;

    container.style.display = 'block';
    container.innerHTML = `
      <h4>${AppUtils.escapeHTML(item.name || 'Heritage item')}</h4>
      <p>${AppUtils.escapeHTML(item.description || '')}</p>
      <dl class="item-meta">
        <dt>Risk level</dt><dd>${AppUtils.escapeHTML(item.riskLevel || 'unknown')}</dd>
        <dt>Location</dt><dd>${AppUtils.escapeHTML(item.location || 'unknown')}</dd>
      </dl>
      <button type="button" class="btn btn-secondary" id="btn-close-detail">Close</button>
    `;

    const closeBtn = document.getElementById('btn-close-detail');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        container.style.display = 'none';
      });
    }
  }

  setupEventListeners() {
    const assessAllBtn = document.getElementById('btn-assess-all');
    if (assessAllBtn) {
      assessAllBtn.addEventListener('click', () => this.loadItems());
    }

    const insightsBtn = document.getElementById('btn-insights');
    if (insightsBtn) {
      insightsBtn.addEventListener('click', () => {
        const container = document.getElementById('insights-container');
        if (!container) return;
        const hidden = container.style.display === 'none';
        container.style.display = hidden ? 'block' : 'none';
        if (hidden) this.loadInsights();
      });
    }

    const statsBtn = document.getElementById('btn-stats');
    if (statsBtn) {
      statsBtn.addEventListener('click', () => this.loadStats());
    }
  }
}

// The inline onclick handlers emitted by renderItems() call
// `window.preservationUI.*`, so the instance has to be reachable there.
document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('#preservation-container')) {
    window.preservationUI = new PreservationUI();
  }
});
