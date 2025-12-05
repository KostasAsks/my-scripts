// ==UserScript==
// @name         Zeus V3 Unified Code Flow Analyzer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Combined Flow & Reaction Tracer - Understand game code execution flow - Alt+8
// @author       Debug Helper
// @match        http://localhost:*/*
// @match        https://localhost:*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    const script = document.createElement('script');
    script.textContent = `
    (function() {
        let tracerWindow = null;
        let isPaused = false;
        const hookedActors = new Set();
        const executionFlow = [];
        const actorData = new Map();
        const triggerData = new Map();
        let isInitialized = false;
        let currentView = 'flow';
        let selectedItem = null;
        let pixiApp = null;
        let highlightOverlay = null;
        const MAX_FLOW = 200;
        const MAX_FLOW_DISPLAY = 100;
        const MAX_RECEIVERS = 100;

        // Utility Functions
        function getPixiApp() {
            if (pixiApp) return pixiApp;
            if (window.__PIXI_APP__) { pixiApp = window.__PIXI_APP__; return pixiApp; }
            if (window.ZeusPlay?.pixiApp) { pixiApp = window.ZeusPlay.pixiApp; return pixiApp; }
            for (const key of Object.keys(window)) {
                const val = window[key];
                if (val && val.stage && val.renderer && typeof val.render === 'function') {
                    pixiApp = val; return pixiApp;
                }
            }
            return null;
        }

        function detectGameName() {
            const path = window.location.pathname;
            let match = path.match(/games\\/([^/]+)/);
            if (match) return match[1];
            const scripts = document.querySelectorAll('script[src]');
            for (const s of scripts) {
                match = s.src.match(/games\\/([^/]+)/);
                if (match) return match[1];
            }
            return 'game';
        }

        function getRelativeTime(timestamp) {
            const diff = Date.now() - timestamp;
            if (diff < 1000) return 'now';
            if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
            if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
            return Math.floor(diff / 3600000) + 'h ago';
        }

        function formatParams(params) {
            if (!params || typeof params !== 'object') return null;
            try {
                const str = JSON.stringify(params, null, 2);
                if (str === '{}' || str === '[]') return null;
                // Limit size to prevent UI slowdown
                if (str.length > 5000) return str.substring(0, 5000) + '\\n... (truncated)';
                return str;
            } catch (e) { 
                return '(Error serializing params)';
            }
        }

        function getActorColor(actorName) {
            const colors = {
                'game-scene': '#FF6B6B', 'symbols': '#4ECDC4', 'coins': '#FFD93D',
                'stickies': '#6BCB77', 'win': '#9B59B6', 'splash': '#3498DB',
                'logo': '#E67E22', 'background': '#1ABC9C', 'particles': '#F39C12',
                'dialog': '#E74C3C', 'pay-lines': '#9B59B6', 'collectors': '#2ECC71',
                'reel': '#f59e0b', 'trigger': '#8b5cf6'
            };
            for (const [key, color] of Object.entries(colors)) {
                if (actorName.toLowerCase().includes(key)) return color;
            }
            return '#95A5A6';
        }

        function getTriggerIcon(name) {
            const nl = (name || '').toLowerCase();
            if (nl.includes('reel') || nl.includes('spin')) return '🎰';
            if (nl.includes('winning')) return '🏆';
            if (nl.includes('mini') || nl.includes('idle')) return '🎮';
            if (nl.includes('actor') || nl.includes('child')) return '👤';
            if (nl.includes('custom')) return '⚡';
            return '📦';
        }

        // Create Tracer Window
        function createTracerWindow() {
            if (tracerWindow && !tracerWindow.closed) { tracerWindow.focus(); return; }
            const gameName = detectGameName();
            tracerWindow = window.open('', 'UnifiedFlowAnalyzer', 'width=1600,height=1000,left=50,top=50');

            tracerWindow.document.write(\`<!DOCTYPE html>
<html>
<head>
    <title>⚡ Code Flow Analyzer - \${gameName}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', system-ui, sans-serif;
            font-size: 13px;
            background: linear-gradient(135deg, #0f0e1a 0%, #1a1a2e 50%, #16213e 100%);
            color: #e8e8e8;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* Header */
        .header {
            padding: 14px 24px;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(15px);
            border-bottom: 2px solid rgba(123,97,255,0.3);
            display: flex;
            gap: 16px;
            align-items: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .brand { display: flex; align-items: center; gap: 12px; }
        .logo { font-size: 32px; }
        .title {
            font-weight: 700; font-size: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }
        .game-badge {
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
            color: #000; padding: 6px 16px; border-radius: 20px;
            font-size: 12px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .status-pill {
            padding: 7px 18px; border-radius: 20px;
            font-size: 11px; font-weight: 600;
            display: flex; align-items: center; gap: 8px;
        }
        .status-pill.recording { background: linear-gradient(135deg, #00b894 0%, #00cec9 100%); color: #000; }
        .status-pill.paused { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: #fff; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.9); } }

        .view-tabs { display: flex; background: rgba(255,255,255,0.05); border-radius: 12px; padding: 4px; gap: 4px; }
        .view-tab {
            background: transparent; border: none; color: rgba(255,255,255,0.6);
            padding: 8px 20px; cursor: pointer; font: inherit; font-weight: 500;
            border-radius: 8px; transition: all 0.2s; font-size: 13px;
        }
        .view-tab:hover { color: #fff; background: rgba(255,255,255,0.05); }
        .view-tab.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }

        .search-box {
            background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
            color: #fff; padding: 9px 18px; border-radius: 10px; width: 240px; font: inherit;
        }
        .search-box:focus { outline: none; border-color: #667eea; background: rgba(255,255,255,0.12); }
        .search-box::placeholder { color: rgba(255,255,255,0.4); }

        .header-btn {
            background: rgba(255,255,255,0.08); color: #fff;
            border: 1px solid rgba(255,255,255,0.15); border-radius: 10px;
            padding: 9px 18px; cursor: pointer; font: inherit; font-weight: 500;
            transition: all 0.2s;
        }
        .header-btn:hover { background: rgba(255,255,255,0.15); transform: translateY(-1px); }
        .header-btn.danger { background: rgba(231, 76, 60, 0.2); border-color: rgba(231, 76, 60, 0.4); color: #ff6b6b; }

        /* Main Content */
        .main { flex: 1; display: flex; overflow: hidden; }

        /* Unified Flow View */
        .flow-container {
            flex: 1; padding: 24px; overflow-y: auto; background: rgba(0,0,0,0.2);
        }
        .flow-container::-webkit-scrollbar { width: 8px; }
        .flow-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }

        .flow-timeline { position: relative; }
        .flow-item {
            display: flex; margin-bottom: 0; position: relative;
            transition: all 0.2s;
        }
        .flow-item:hover { transform: translateX(4px); }

        .flow-time-col {
            width: 80px; padding: 16px 0; text-align: right; padding-right: 20px;
        }
        .flow-time {
            font-size: 10px; color: rgba(255,255,255,0.4);
            font-family: 'JetBrains Mono', monospace;
            font-weight: 500;
        }

        .flow-line-col {
            width: 40px; display: flex; flex-direction: column;
            align-items: center; position: relative;
        }
        .flow-dot {
            width: 14px; height: 14px; border-radius: 50%;
            border: 3px solid rgba(0,0,0,0.6);
            z-index: 1; margin-top: 18px;
            box-shadow: 0 0 10px currentColor;
        }
        .flow-item.recent .flow-dot {
            animation: dotPulse 2s infinite;
        }
        @keyframes dotPulse {
            0%, 100% { transform: scale(1); box-shadow: 0 0 10px currentColor; }
            50% { transform: scale(1.15); box-shadow: 0 0 20px currentColor; }
        }
        .flow-connector {
            width: 2px; flex: 1; background: rgba(255,255,255,0.1); margin-top: -2px;
        }
        .flow-item:last-child .flow-connector { display: none; }

        .flow-content-col { flex: 1; padding: 12px 0 12px 16px; }
        .flow-card {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 12px; padding: 16px 18px;
            backdrop-filter: blur(10px);
            transition: all 0.2s;
            cursor: pointer;
        }
        .flow-card:hover {
            background: rgba(255,255,255,0.08);
            border-color: rgba(255,255,255,0.2);
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        }
        .flow-item.recent .flow-card {
            border-color: rgba(0, 184, 148, 0.4);
            background: rgba(0, 184, 148, 0.08);
        }

        .flow-type-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 10px;
        }
        .flow-type-badge.action {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: #fff;
        }
        .flow-type-badge.trigger {
            background: linear-gradient(135deg, #f093fb, #f5576c);
            color: #fff;
        }

        .flow-header-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .flow-actor-dot { width: 10px; height: 10px; border-radius: 50%; }
        .flow-actor-name { font-weight: 600; font-size: 12px; color: rgba(255,255,255,0.7); }
        .flow-icon { font-size: 18px; }
        .flow-name { font-size: 15px; color: #ffeaa7; font-weight: 600; flex: 1; }
        .flow-count {
            background: rgba(255,255,255,0.1);
            padding: 3px 10px;
            border-radius: 10px;
            font-size: 10px;
            color: rgba(255,255,255,0.6);
            font-weight: 600;
        }

        .flow-receivers {
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid rgba(255,255,255,0.1);
            font-size: 11px;
            color: rgba(255,255,255,0.5);
        }

        .flow-params {
            font-family: 'JetBrains Mono', monospace; font-size: 11px;
            color: rgba(255,255,255,0.6); background: rgba(0,0,0,0.4);
            padding: 10px 12px; border-radius: 8px; margin-top: 10px;
            white-space: pre-wrap; max-height: 100px; overflow-y: auto;
            border: 1px solid rgba(255,255,255,0.05);
        }

        .empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: rgba(255,255,255,0.4);
            text-align: center;
        }
        .empty-icon { font-size: 80px; margin-bottom: 24px; opacity: 0.6; }
        .empty-title { font-size: 20px; color: rgba(255,255,255,0.7); margin-bottom: 12px; font-weight: 600; }
        .empty-subtitle { font-size: 14px; max-width: 400px; line-height: 1.6; }

        /* Stats Panel */
        .stats-panel {
            width: 320px;
            background: rgba(0,0,0,0.3);
            backdrop-filter: blur(10px);
            border-left: 1px solid rgba(255,255,255,0.1);
            display: flex;
            flex-direction: column;
        }
        .stats-header {
            padding: 16px 20px;
            background: rgba(0,0,0,0.3);
            border-bottom: 1px solid rgba(255,255,255,0.1);
            font-weight: 600; font-size: 12px;
            color: rgba(255,255,255,0.6);
            text-transform: uppercase; letter-spacing: 1.5px;
        }
        .stats-body { flex: 1; overflow-y: auto; padding: 16px; }
        .stats-body::-webkit-scrollbar { width: 6px; }
        .stats-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }

        .stat-card {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 14px 16px;
            margin-bottom: 12px;
        }
        .stat-label {
            font-size: 11px;
            color: rgba(255,255,255,0.5);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }
        .stat-value {
            font-size: 24px;
            font-weight: 700;
            color: #fff;
        }
        .stat-value.large { font-size: 32px; }

        .stat-list {
            margin-top: 8px;
        }
        .stat-list-item {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 12px;
        }
        .stat-list-item:last-child { border-bottom: none; }
        .stat-list-label { color: rgba(255,255,255,0.7); }
        .stat-list-value { font-weight: 600; color: #fff; }

        /* Help View */
        .help-container {
            flex: 1;
            padding: 40px;
            overflow-y: auto;
            background: rgba(0,0,0,0.2);
        }
        .help-section {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 24px;
            max-width: 900px;
            margin-left: auto;
            margin-right: auto;
        }
        .help-section h2 {
            font-size: 20px;
            color: #fff;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .help-section h3 {
            font-size: 16px;
            color: #a78bfa;
            margin-top: 20px;
            margin-bottom: 12px;
        }
        .help-section p {
            color: rgba(255,255,255,0.7);
            line-height: 1.7;
            margin-bottom: 12px;
        }
        .help-section ul {
            margin-left: 24px;
            margin-bottom: 12px;
        }
        .help-section li {
            color: rgba(255,255,255,0.7);
            line-height: 1.8;
            margin-bottom: 8px;
        }
        .help-code {
            background: rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 16px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            color: #86efac;
            margin: 12px 0;
            overflow-x: auto;
        }
        .help-badge {
            display: inline-block;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: #fff;
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            margin-right: 8px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="brand">
            <span class="logo">⚡</span>
            <span class="title">Code Flow Analyzer</span>
        </div>
        <span class="game-badge" id="gameBadge">\${gameName}</span>
        <span id="statusPill" class="status-pill recording">
            <span class="status-dot"></span>Recording
        </span>
        <div class="view-tabs">
            <button id="flowBtn" class="view-tab active">📊 Execution Flow</button>
            <button id="helpBtn" class="view-tab">📖 How to Use</button>
        </div>
        <input id="searchBox" class="search-box" placeholder="Search actions, triggers, actors...">
        <div style="flex:1"></div>
        <button id="pauseBtn" class="header-btn">⏸️ Pause</button>
        <button id="clearBtn" class="header-btn danger">🗑️ Clear</button>
    </div>

    <div class="main">
        <div id="flowView" class="flow-container"></div>
        <div id="helpView" class="help-container" style="display:none;"></div>
        <div class="stats-panel">
            <div class="stats-header">Statistics</div>
            <div class="stats-body" id="statsBody"></div>
        </div>
    </div>
</body>
</html>\`);

            tracerWindow.document.close();
            setTimeout(() => { setupWindowEvents(); renderContent(); }, 100);
        }

        function setupWindowEvents() {
            if (!tracerWindow || tracerWindow.closed) return;
            const doc = tracerWindow.document;

            doc.getElementById('pauseBtn').onclick = () => {
                isPaused = !isPaused;
                doc.getElementById('pauseBtn').textContent = isPaused ? '▶️ Resume' : '⏸️ Pause';
                doc.getElementById('statusPill').innerHTML = isPaused
                    ? '<span class="status-dot"></span> Paused'
                    : '<span class="status-dot"></span> Recording';
                doc.getElementById('statusPill').className = 'status-pill ' + (isPaused ? 'paused' : 'recording');
            };

            doc.getElementById('clearBtn').onclick = () => {
                executionFlow.length = 0;
                actorData.clear();
                triggerData.clear();
                selectedItem = null;
                renderContent();
            };

            doc.getElementById('searchBox').oninput = () => renderContent();

            doc.getElementById('flowBtn').onclick = () => {
                currentView = 'flow';
                doc.getElementById('flowBtn').classList.add('active');
                doc.getElementById('helpBtn').classList.remove('active');
                doc.getElementById('flowView').style.display = 'block';
                doc.getElementById('helpView').style.display = 'none';
                renderContent();
            };

            doc.getElementById('helpBtn').onclick = () => {
                currentView = 'help';
                doc.getElementById('helpBtn').classList.add('active');
                doc.getElementById('flowBtn').classList.remove('active');
                doc.getElementById('flowView').style.display = 'none';
                doc.getElementById('helpView').style.display = 'block';
                renderHelp();
            };
        }

        function renderContent() {
            if (!tracerWindow || tracerWindow.closed) return;
            if (currentView === 'help') {
                renderHelp();
            } else {
                renderFlow();
                renderStats();
            }
        }

        function renderFlow() {
            if (!tracerWindow || tracerWindow.closed) return;
            const doc = tracerWindow.document;
            const container = doc.getElementById('flowView');
            const search = doc.getElementById('searchBox').value.toLowerCase();

            const filtered = executionFlow.filter(f => {
                if (!search) return true;
                return f.actor.toLowerCase().includes(search) ||
                       f.name.toLowerCase().includes(search) ||
                       (f.type === 'trigger' && f.trigger?.toLowerCase().includes(search));
            });

            if (filtered.length === 0) {
                container.innerHTML = \`
                    <div class="empty">
                        <div class="empty-icon">⚡</div>
                        <div class="empty-title">Waiting for code execution...</div>
                        <div class="empty-subtitle">
                            The analyzer will capture all actor actions and trigger exposures in real-time.
                            Start interacting with the game to see the execution flow.
                        </div>
                    </div>
                \`;
                return;
            }

            const now = Date.now();
            let html = '<div class="flow-timeline">';

            filtered.slice(0, MAX_FLOW_DISPLAY).forEach((item, idx) => {
                const isRecent = now - item.time < 3000;
                const color = getActorColor(item.actor);
                const params = formatParams(item.params || item.state);

                if (item.type === 'action') {
                    const actionName = String(item.name).replace(/^action-/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    html += \`
                        <div class="flow-item \${isRecent ? 'recent' : ''}">
                            <div class="flow-time-col"><div class="flow-time">\${getRelativeTime(item.time)}</div></div>
                            <div class="flow-line-col">
                                <div class="flow-dot" style="background:\${color}"></div>
                                <div class="flow-connector"></div>
                            </div>
                            <div class="flow-content-col">
                                <div class="flow-card">
                                    <span class="flow-type-badge action">ACTION</span>
                                    <div class="flow-header-row">
                                        <div class="flow-actor-dot" style="background:\${color}"></div>
                                        <div class="flow-actor-name">\${item.actor.replace(/^actor-/, '')}</div>
                                    </div>
                                    <div class="flow-header-row">
                                        <div class="flow-icon">🎬</div>
                                        <div class="flow-name">\${actionName}</div>
                                    </div>
                                    \${params ? '<div class="flow-params">' + params + '</div>' : ''}
                                </div>
                            </div>
                        </div>
                    \`;
                } else if (item.type === 'trigger') {
                    const triggerName = String(item.trigger || 'Unknown').replace(/^on-/i, '').replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                    const icon = getTriggerIcon(item.trigger);
                    const receivers = item.receivers || [];
                    html += \`
                        <div class="flow-item \${isRecent ? 'recent' : ''}">
                            <div class="flow-time-col"><div class="flow-time">\${getRelativeTime(item.time)}</div></div>
                            <div class="flow-line-col">
                                <div class="flow-dot" style="background:#8b5cf6"></div>
                                <div class="flow-connector"></div>
                            </div>
                            <div class="flow-content-col">
                                <div class="flow-card">
                                    <span class="flow-type-badge trigger">TRIGGER</span>
                                    <div class="flow-header-row">
                                        <div class="flow-actor-dot" style="background:#8b5cf6"></div>
                                        <div class="flow-actor-name">\${item.actor}</div>
                                    </div>
                                    <div class="flow-header-row">
                                        <div class="flow-icon">\${icon}</div>
                                        <div class="flow-name">\${triggerName}</div>
                                    </div>
                                    \${receivers.length > 0 ? '<div class="flow-receivers">→ ' + receivers.length + ' receivers: ' + receivers.slice(0, 3).join(', ') + (receivers.length > 3 ? '...' : '') + '</div>' : ''}
                                    \${params ? '<div class="flow-params">' + params + '</div>' : ''}
                                </div>
                            </div>
                        </div>
                    \`;
                }
            });

            html += '</div>';
            container.innerHTML = html;
        }

        function renderStats() {
            if (!tracerWindow || tracerWindow.closed) return;
            const doc = tracerWindow.document;
            const container = doc.getElementById('statsBody');

            const totalActions = executionFlow.filter(f => f.type === 'action').length;
            const totalTriggers = executionFlow.filter(f => f.type === 'trigger').length;
            const uniqueActors = new Set(executionFlow.map(f => f.actor)).size;

            // Count by actor
            const actorCounts = {};
            executionFlow.forEach(f => {
                actorCounts[f.actor] = (actorCounts[f.actor] || 0) + 1;
            });
            const topActors = Object.entries(actorCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);

            let html = \`
                <div class="stat-card">
                    <div class="stat-label">Total Events</div>
                    <div class="stat-value large">\${executionFlow.length}</div>
                </div>

                <div class="stat-card">
                    <div class="stat-label">Actions</div>
                    <div class="stat-value">\${totalActions}</div>
                </div>

                <div class="stat-card">
                    <div class="stat-label">Triggers</div>
                    <div class="stat-value">\${totalTriggers}</div>
                </div>

                <div class="stat-card">
                    <div class="stat-label">Active Actors</div>
                    <div class="stat-value">\${uniqueActors}</div>
                </div>

                <div class="stat-card">
                    <div class="stat-label">Top Actors</div>
                    <div class="stat-list">
                        \${topActors.map(([actor, count]) => \`
                            <div class="stat-list-item">
                                <div class="stat-list-label">\${actor.replace(/^actor-/, '')}</div>
                                <div class="stat-list-value">\${count}</div>
                            </div>
                        \`).join('')}
                    </div>
                </div>
            \`;

            container.innerHTML = html;
        }

        function renderHelp() {
            if (!tracerWindow || tracerWindow.closed) return;
            const doc = tracerWindow.document;
            const container = doc.getElementById('helpView');

            container.innerHTML = \`
                <div class="help-section">
                    <h2>⚡ Welcome to Code Flow Analyzer</h2>
                    <p>
                        This tool combines the functionality of Flow Tracer and Reaction Tracer to give you a unified view
                        of how your game code executes. It helps you understand the sequence of actions and triggers
                        in your Zeus game, making it easier to debug issues and optimize performance.
                    </p>
                </div>

                <div class="help-section">
                    <h2>🎯 What Does It Track?</h2>
                    
                    <h3>📘 Actions (Blue)</h3>
                    <p>
                        Actions are method calls on actors. Every time an actor's <code>callAction()</code> method is invoked,
                        it appears in the flow with:
                    </p>
                    <ul>
                        <li><strong>Actor Name:</strong> Which actor performed the action</li>
                        <li><strong>Action Name:</strong> What action was performed (e.g., "Play Animation", "Show Symbol")</li>
                        <li><strong>Parameters:</strong> Data passed to the action</li>
                        <li><strong>Timestamp:</strong> When it happened</li>
                    </ul>

                    <h3>🟣 Triggers (Purple)</h3>
                    <p>
                        Triggers are events that actors expose to notify other actors. When an actor's <code>exposeTrigger()</code>
                        is called, it appears with:
                    </p>
                    <ul>
                        <li><strong>Trigger Name:</strong> What event occurred (e.g., "On Reel Stop Spinning", "On Winning")</li>
                        <li><strong>Sender:</strong> Which actor exposed the trigger</li>
                        <li><strong>Receivers:</strong> List of actors that will receive this trigger</li>
                        <li><strong>State:</strong> Additional data passed with the trigger</li>
                    </ul>
                </div>

                <div class="help-section">
                    <h2>🔍 How to Use</h2>
                    
                    <h3>1. Understanding the Flow</h3>
                    <p>
                        Events are displayed chronologically from top to bottom. The most recent events appear at the top.
                        Look for patterns in the execution:
                    </p>
                    <ul>
                        <li>Which actions trigger which other actions?</li>
                        <li>What is the sequence of events when something happens in the game?</li>
                        <li>Are there any unexpected or redundant calls?</li>
                    </ul>

                    <h3>2. Finding Issues</h3>
                    <p>Use the search box to filter events. You can search by:</p>
                    <ul>
                        <li><strong>Actor name:</strong> e.g., "symbols", "reels", "win"</li>
                        <li><strong>Action name:</strong> e.g., "animate", "show", "hide"</li>
                        <li><strong>Trigger name:</strong> e.g., "spin", "stop", "winning"</li>
                    </ul>

                    <h3>3. Identifying What to Change</h3>
                    <p>Look for these patterns to identify issues:</p>
                    <ul>
                        <li><strong>Repeated calls:</strong> Same action called multiple times in quick succession</li>
                        <li><strong>Missing triggers:</strong> Expected trigger doesn't appear after an action</li>
                        <li><strong>Wrong order:</strong> Events happen in unexpected sequence</li>
                        <li><strong>Performance:</strong> Too many events happening at once</li>
                    </ul>
                </div>

                <div class="help-section">
                    <h2>📂 Finding the Code</h2>
                    
                    <h3>Actor Files</h3>
                    <p>When you see an actor in the flow, find its code here:</p>
                    <div class="help-code">games/[game-name]/src/actors/[actor-folder]/[actor-name]-actor.ts</div>
                    <p>Example:</p>
                    <div class="help-code">games/my-game/src/actors/symbols/symbol-wild-actor.ts</div>

                    <h3>Action Enum</h3>
                    <p>Actions are defined in an enum at the top of the actor file:</p>
                    <div class="help-code">
enum SymbolWildActorActions {
    PLAY_ANIMATION = 'action-play-animation',
    SHOW = 'action-show',
    HIDE = 'action-hide'
}
                    </div>

                    <h3>Trigger Handlers</h3>
                    <p>Look for <code>onTrigger()</code> methods in the actor to see how it reacts to triggers:</p>
                    <div class="help-code">
onTrigger(trigger: ActorTrigger) {
    if (trigger.triggerName === 'OnReelStopSpinning') {
        this.callAction('action-show');
    }
}
                    </div>
                </div>

                <div class="help-section">
                    <h2>💡 Tips & Tricks</h2>
                    <ul>
                        <li><span class="help-badge">TIP</span> Use Pause to freeze the recording when you find something interesting</li>
                        <li><span class="help-badge">TIP</span> Clear the flow before testing a specific feature to isolate events</li>
                        <li><span class="help-badge">TIP</span> Recent events (last 3 seconds) are highlighted in green</li>
                        <li><span class="help-badge">TIP</span> Check the Statistics panel to see which actors are most active</li>
                        <li><span class="help-badge">TIP</span> Look at the receiver count on triggers to understand event propagation</li>
                    </ul>
                </div>

                <div class="help-section">
                    <h2>🎮 Workflow Example</h2>
                    <p><strong>Problem:</strong> Symbol doesn't animate after reel stops</p>
                    <ol style="margin-left: 24px; color: rgba(255,255,255,0.7); line-height: 1.8;">
                        <li>Open the analyzer (Alt+8)</li>
                        <li>Click Clear to start fresh</li>
                        <li>Trigger a spin in the game</li>
                        <li>Search for "symbol" to filter events</li>
                        <li>Look for the sequence:
                            <ul style="margin-left: 24px; margin-top: 8px;">
                                <li>Trigger: "On Reel Stop Spinning" ✓</li>
                                <li>Action: "Play Animation" ✗ (missing!)</li>
                            </ul>
                        </li>
                        <li>Check the symbol actor's <code>onTrigger()</code> method</li>
                        <li>Add handler for "OnReelStopSpinning" trigger</li>
                    </ol>
                </div>
            \`;
        }

        // Logging Functions
        function logAction(actorName, action, params, pixiContainer) {
            if (isPaused) return;
            const now = Date.now();

            executionFlow.unshift({
                type: 'action',
                actor: actorName,
                name: action,
                params: params,
                time: now
            });

            if (executionFlow.length > MAX_FLOW) executionFlow.length = MAX_FLOW;

            const existing = actorData.get(actorName);
            actorData.set(actorName, {
                lastAction: action,
                lastTime: now,
                totalCalls: (existing?.totalCalls || 0) + 1
            });

            if (tracerWindow && !tracerWindow.closed) renderContent();
        }

        function logTrigger(name, state, sender, receivers) {
            if (isPaused) return;
            const now = Date.now();

            executionFlow.unshift({
                type: 'trigger',
                trigger: name,
                actor: sender,
                state: state,
                receivers: receivers,
                time: now
            });

            if (executionFlow.length > MAX_FLOW) executionFlow.length = MAX_FLOW;

            const existing = triggerData.get(name);
            triggerData.set(name, {
                lastTime: now,
                count: (existing?.count || 0) + 1,
                receivers: receivers
            });

            if (tracerWindow && !tracerWindow.closed) renderContent();
        }

        // Hook Actors
        function hookActor(actor, actorName) {
            if (!actor) return false;
            if (hookedActors.has(actor)) return false;

            // Hook callAction
            if (typeof actor.callAction === 'function') {
                const originalAction = actor.callAction.bind(actor);
                actor.callAction = function(action, params) {
                    const actionStr = typeof action === 'object' ? (action.type || JSON.stringify(action)) : String(action);
                    logAction(actorName, actionStr, params);
                    return originalAction(action, params);
                };
            }

            // Hook exposeTrigger
            if (typeof actor.exposeTrigger === 'function') {
                const originalTrigger = actor.exposeTrigger.bind(actor);
                actor.exposeTrigger = function(trigger) {
                    const name = trigger?.triggerName || trigger?.constructor?.triggerName || trigger?.name || 'unknown';
                    const state = trigger?.state || {};
                    const registry = window.ZeusPlay?.actors?.actorsRegistry;
                    const receivers = [];
                    if (registry) {
                        registry.forEach((store, n) => {
                            const actorsList = store._actors || store.actors || [];
                            actorsList.forEach((a, i) => {
                                if (a !== actor) {
                                    receivers.push(actorsList.length > 1 ? n + '[' + i + ']' : n);
                                }
                            });
                        });
                    }
                    logTrigger(name, state, actorName, receivers.slice(0, MAX_RECEIVERS));
                    return originalTrigger(trigger);
                };
            }

            hookedActors.add(actor);
            return true;
        }

        function hookAllActors() {
            const registry = window.ZeusPlay?.actors?.actorsRegistry;
            if (!registry) return 0;
            let hooked = 0;
            registry.forEach((store, name) => {
                const actorsList = store._actors || store.actors || [];
                actorsList.forEach((actor, idx) => {
                    const actorName = actorsList.length > 1 ? name + '[' + idx + ']' : name;
                    if (hookActor(actor, actorName)) hooked++;
                });
            });
            return hooked;
        }

        function init() {
            if (isInitialized) return;
            isInitialized = true;
            hookAllActors();
            setInterval(hookAllActors, 2000);
        }

        document.addEventListener('keydown', (e) => {
            if (e.altKey && e.key === '8') {
                e.preventDefault();
                if (tracerWindow && !tracerWindow.closed) { tracerWindow.focus(); return; }
                if (!window.ZeusPlay?.actors?.actorsRegistry) {
                    console.log('[Code Flow Analyzer] ⏳ Waiting for game to initialize...');
                    return;
                }
                init();
                createTracerWindow();
            }
        });

        console.log('[Code Flow Analyzer v1.0] ✅ Press Alt+8 to open');
        console.log('[Code Flow Analyzer] Combines action flow and trigger tracking in one unified view');
    })();
    `;
    document.head.appendChild(script);
})();
