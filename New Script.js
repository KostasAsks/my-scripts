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
        let selectedActor = null;
        let pixiApp = null;
        let highlightOverlay = null;
        let isCompactMode = false;
        const expandedActors = new Set();
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
            tracerWindow = window.open('', 'UnifiedFlowAnalyzer', 'width=900,height=600,left=50,top=50');

            tracerWindow.document.write(\`<!DOCTYPE html>
<html>
<head>
    <title>⚡ Code Flow Analyzer - \${gameName}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', system-ui, sans-serif;
            font-size: 12px;
            background: linear-gradient(135deg, #0f0e1a 0%, #1a1a2e 50%, #16213e 100%);
            color: #e8e8e8;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* Header */
        .header {
            padding: 8px 16px;
            background: rgba(0,0,0,0.5);
            backdrop-filter: blur(15px);
            border-bottom: 2px solid rgba(123,97,255,0.3);
            display: flex;
            gap: 12px;
            align-items: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        body.compact .header {
            padding: 6px 12px;
            gap: 8px;
        }
        .brand { display: flex; align-items: center; gap: 8px; }
        .logo { font-size: 24px; }
        body.compact .logo { font-size: 20px; }
        .title {
            font-weight: 700; font-size: 16px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.5px;
        }
        body.compact .title { font-size: 14px; }
        .game-badge {
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
            color: #000; padding: 4px 12px; border-radius: 16px;
            font-size: 11px; font-weight: 600; text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        body.compact .game-badge { padding: 3px 10px; font-size: 10px; }
        .status-pill {
            padding: 5px 14px; border-radius: 16px;
            font-size: 10px; font-weight: 600;
            display: flex; align-items: center; gap: 6px;
        }
        body.compact .status-pill { padding: 4px 10px; font-size: 9px; }
        .status-pill.recording { background: linear-gradient(135deg, #00b894 0%, #00cec9 100%); color: #000; }
        .status-pill.paused { background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); color: #fff; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.9); } }

        .view-tabs { display: flex; background: rgba(255,255,255,0.05); border-radius: 10px; padding: 3px; gap: 3px; }
        .view-tab {
            background: transparent; border: none; color: rgba(255,255,255,0.6);
            padding: 6px 14px; cursor: pointer; font: inherit; font-weight: 500;
            border-radius: 7px; transition: all 0.2s; font-size: 11px;
        }
        body.compact .view-tab { padding: 4px 10px; font-size: 10px; }
        .view-tab:hover { color: #fff; background: rgba(255,255,255,0.05); }
        .view-tab.active {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }

        .search-box {
            background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
            color: #fff; padding: 6px 12px; border-radius: 8px; width: 180px; font: inherit;
            font-size: 11px;
        }
        body.compact .search-box { padding: 4px 10px; width: 140px; font-size: 10px; }
        .search-box:focus { outline: none; border-color: #667eea; background: rgba(255,255,255,0.12); }
        .search-box::placeholder { color: rgba(255,255,255,0.4); }

        .header-btn {
            background: rgba(255,255,255,0.08); color: #fff;
            border: 1px solid rgba(255,255,255,0.15); border-radius: 8px;
            padding: 6px 12px; cursor: pointer; font: inherit; font-weight: 500;
            transition: all 0.2s; font-size: 11px;
        }
        body.compact .header-btn { padding: 4px 10px; font-size: 10px; }
        .header-btn:hover { background: rgba(255,255,255,0.15); transform: translateY(-1px); }
        .header-btn.danger { background: rgba(231, 76, 60, 0.2); border-color: rgba(231, 76, 60, 0.4); color: #ff6b6b; }

        /* Main Content */
        .main { flex: 1; display: flex; overflow: hidden; }

        /* Two Panel Layout */
        .tree-panel {
            width: 320px;
            min-width: 200px;
            background: rgba(0,0,0,0.2);
            border-right: 1px solid rgba(255,255,255,0.1);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .tree-header {
            padding: 10px 12px;
            background: rgba(0,0,0,0.3);
            border-bottom: 1px solid rgba(255,255,255,0.1);
            display: flex;
            gap: 8px;
            align-items: center;
        }
        body.compact .tree-header { padding: 8px 10px; }
        .tree-title {
            font-weight: 600;
            font-size: 11px;
            color: rgba(255,255,255,0.6);
            text-transform: uppercase;
            letter-spacing: 1px;
            flex: 1;
        }
        .tree-btn {
            background: rgba(255,255,255,0.08);
            border: 1px solid rgba(255,255,255,0.1);
            color: rgba(255,255,255,0.7);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 10px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .tree-btn:hover { background: rgba(255,255,255,0.15); }
        .tree-container {
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        }
        .tree-container::-webkit-scrollbar { width: 6px; }
        .tree-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }

        .resizer {
            width: 4px;
            background: rgba(255,255,255,0.05);
            cursor: col-resize;
            transition: background 0.2s;
        }
        .resizer:hover { background: rgba(123,97,255,0.3); }

        .details-panel {
            flex: 1;
            background: rgba(0,0,0,0.2);
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* Unified Flow View */
        .flow-container {
            flex: 1; padding: 16px; overflow-y: auto; background: rgba(0,0,0,0.2);
        }
        body.compact .flow-container { padding: 12px; }
        .flow-container::-webkit-scrollbar { width: 8px; }
        .flow-container::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 4px; }

        /* Tree View */
        .tree-actor-group {
            margin-bottom: 4px;
        }
        .tree-actor-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 8px;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s;
        }
        body.compact .tree-actor-header { padding: 4px 6px; }
        .tree-actor-header:hover {
            background: rgba(255,255,255,0.08);
            border-color: rgba(255,255,255,0.2);
        }
        .tree-actor-header.selected {
            background: rgba(102, 126, 234, 0.15);
            border-color: rgba(102, 126, 234, 0.4);
        }
        .tree-expand-icon {
            font-size: 10px;
            color: rgba(255,255,255,0.5);
            transition: transform 0.2s;
            width: 12px;
        }
        .tree-expand-icon.expanded { transform: rotate(90deg); }
        .tree-actor-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        .tree-actor-name {
            font-size: 11px;
            font-weight: 600;
            color: rgba(255,255,255,0.8);
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        body.compact .tree-actor-name { font-size: 10px; }
        .tree-badge {
            background: rgba(255,255,255,0.1);
            padding: 2px 6px;
            border-radius: 8px;
            font-size: 9px;
            color: rgba(255,255,255,0.6);
            font-weight: 600;
        }
        body.compact .tree-badge { padding: 1px 5px; font-size: 8px; }
        .tree-children {
            margin-left: 16px;
            margin-top: 2px;
            display: none;
        }
        .tree-children.expanded { display: block; }
        .tree-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 8px;
            margin: 2px 0;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.05);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 10px;
        }
        body.compact .tree-item { padding: 3px 6px; font-size: 9px; }
        .tree-item:hover {
            background: rgba(255,255,255,0.06);
            border-color: rgba(255,255,255,0.15);
        }
        .tree-item.selected {
            background: rgba(102, 126, 234, 0.1);
            border-color: rgba(102, 126, 234, 0.3);
        }
        .tree-item.recent {
            border-color: rgba(0, 184, 148, 0.4);
            background: rgba(0, 184, 148, 0.05);
        }
        .tree-item-icon {
            font-size: 12px;
        }
        body.compact .tree-item-icon { font-size: 11px; }
        .tree-item-text {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: rgba(255,255,255,0.7);
        }
        .tree-item-type {
            font-size: 8px;
            padding: 2px 4px;
            border-radius: 3px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .tree-item-type.action {
            background: rgba(102, 126, 234, 0.3);
            color: #a5b4fc;
        }
        .tree-item-type.trigger {
            background: rgba(139, 92, 246, 0.3);
            color: #c4b5fd;
        }

        .tree-empty {
            text-align: center;
            padding: 40px 20px;
            color: rgba(255,255,255,0.4);
        }
        .tree-empty-icon {
            font-size: 48px;
            margin-bottom: 12px;
            opacity: 0.6;
        }
        .tree-empty-text {
            font-size: 11px;
            line-height: 1.6;
        }

        .flow-timeline { position: relative; }
        .flow-item {
            display: flex; margin-bottom: 0; position: relative;
            transition: all 0.2s;
        }
        .flow-item:hover { transform: translateX(4px); }

        .flow-time-col {
            width: 60px; padding: 10px 0; text-align: right; padding-right: 12px;
        }
        body.compact .flow-time-col { width: 50px; padding: 8px 0; padding-right: 10px; }
        .flow-time {
            font-size: 9px; color: rgba(255,255,255,0.4);
            font-family: 'JetBrains Mono', monospace;
            font-weight: 500;
        }
        body.compact .flow-time { font-size: 8px; }

        .flow-line-col {
            width: 30px; display: flex; flex-direction: column;
            align-items: center; position: relative;
        }
        body.compact .flow-line-col { width: 24px; }
        .flow-dot {
            width: 10px; height: 10px; border-radius: 50%;
            border: 2px solid rgba(0,0,0,0.6);
            z-index: 1; margin-top: 12px;
            box-shadow: 0 0 8px currentColor;
        }
        body.compact .flow-dot { width: 8px; height: 8px; margin-top: 10px; }
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

        .flow-content-col { flex: 1; padding: 8px 0 8px 12px; }
        body.compact .flow-content-col { padding: 6px 0 6px 8px; }
        .flow-card {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px; padding: 10px 12px;
            backdrop-filter: blur(10px);
            transition: all 0.2s;
            cursor: pointer;
        }
        body.compact .flow-card { padding: 8px 10px; border-radius: 6px; }
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
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 8px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
        }
        body.compact .flow-type-badge { padding: 2px 6px; font-size: 7px; margin-bottom: 4px; }
        .flow-type-badge.action {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: #fff;
        }
        .flow-type-badge.trigger {
            background: linear-gradient(135deg, #f093fb, #f5576c);
            color: #fff;
        }

        .flow-header-row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
        body.compact .flow-header-row { gap: 4px; margin-bottom: 3px; }
        .flow-actor-dot { width: 8px; height: 8px; border-radius: 50%; }
        body.compact .flow-actor-dot { width: 6px; height: 6px; }
        .flow-actor-name { font-weight: 600; font-size: 10px; color: rgba(255,255,255,0.7); }
        body.compact .flow-actor-name { font-size: 9px; }
        .flow-icon { font-size: 14px; }
        body.compact .flow-icon { font-size: 12px; }
        .flow-name { font-size: 12px; color: #ffeaa7; font-weight: 600; flex: 1; }
        body.compact .flow-name { font-size: 11px; }
        .flow-count {
            background: rgba(255,255,255,0.1);
            padding: 2px 8px;
            border-radius: 8px;
            font-size: 9px;
            color: rgba(255,255,255,0.6);
            font-weight: 600;
        }
        body.compact .flow-count { padding: 1px 6px; font-size: 8px; }

        .flow-receivers {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid rgba(255,255,255,0.1);
            font-size: 10px;
            color: rgba(255,255,255,0.5);
        }
        body.compact .flow-receivers { margin-top: 4px; padding-top: 4px; font-size: 9px; }

        .flow-params {
            font-family: 'JetBrains Mono', monospace; font-size: 10px;
            color: rgba(255,255,255,0.6); background: rgba(0,0,0,0.4);
            padding: 8px 10px; border-radius: 6px; margin-top: 6px;
            white-space: pre-wrap; max-height: 80px; overflow-y: auto;
            border: 1px solid rgba(255,255,255,0.05);
        }
        body.compact .flow-params { padding: 6px 8px; font-size: 9px; max-height: 60px; margin-top: 4px; }

        .empty {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: rgba(255,255,255,0.4);
            text-align: center;
            padding: 20px;
        }
        .empty-icon { font-size: 60px; margin-bottom: 16px; opacity: 0.6; }
        body.compact .empty-icon { font-size: 48px; margin-bottom: 12px; }
        .empty-title { font-size: 16px; color: rgba(255,255,255,0.7); margin-bottom: 8px; font-weight: 600; }
        body.compact .empty-title { font-size: 14px; margin-bottom: 6px; }
        .empty-subtitle { font-size: 12px; max-width: 350px; line-height: 1.6; }
        body.compact .empty-subtitle { font-size: 11px; max-width: 300px; }

        /* Stats Panel */
        .stats-panel {
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .stats-header {
            padding: 10px 12px;
            background: rgba(0,0,0,0.3);
            border-bottom: 1px solid rgba(255,255,255,0.1);
            font-weight: 600; font-size: 11px;
            color: rgba(255,255,255,0.6);
            text-transform: uppercase; letter-spacing: 1px;
        }
        body.compact .stats-header { padding: 8px 10px; font-size: 10px; }
        .stats-body { flex: 1; overflow-y: auto; padding: 12px; }
        body.compact .stats-body { padding: 10px; }
        .stats-body::-webkit-scrollbar { width: 6px; }
        .stats-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 3px; }

        .stat-card {
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.1);
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 8px;
        }
        body.compact .stat-card { padding: 8px 10px; margin-bottom: 6px; border-radius: 6px; }
        .stat-label {
            font-size: 9px;
            color: rgba(255,255,255,0.5);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
        }
        body.compact .stat-label { font-size: 8px; margin-bottom: 4px; }
        .stat-value {
            font-size: 20px;
            font-weight: 700;
            color: #fff;
        }
        body.compact .stat-value { font-size: 18px; }
        .stat-value.large { font-size: 26px; }
        body.compact .stat-value.large { font-size: 22px; }

        .stat-list {
            margin-top: 6px;
        }
        body.compact .stat-list { margin-top: 4px; }
        .stat-list-item {
            display: flex;
            justify-content: space-between;
            padding: 6px 0;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-size: 10px;
        }
        body.compact .stat-list-item { padding: 4px 0; font-size: 9px; }
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
        <input id="searchBox" class="search-box" placeholder="Search...">
        <div style="flex:1"></div>
        <button id="compactBtn" class="header-btn">🔲 Compact</button>
        <button id="pauseBtn" class="header-btn">⏸️ Pause</button>
        <button id="clearBtn" class="header-btn danger">🗑️ Clear</button>
    </div>

    <div class="main">
        <div id="flowView" style="display:flex; flex:1;">
            <div class="tree-panel">
                <div class="tree-header">
                    <span class="tree-title">📁 Actors</span>
                    <button id="expandAllBtn" class="tree-btn">Expand All</button>
                    <button id="collapseAllBtn" class="tree-btn">Collapse</button>
                </div>
                <div class="tree-container" id="treeContainer"></div>
            </div>
            <div class="resizer" id="resizer"></div>
            <div class="details-panel">
                <div class="flow-container" id="detailsContainer"></div>
                <div class="stats-panel">
                    <div class="stats-header">Statistics</div>
                    <div class="stats-body" id="statsBody"></div>
                </div>
            </div>
        </div>
        <div id="helpView" class="help-container" style="display:none;"></div>
    </div>
</body>
</html>\`);

            tracerWindow.document.close();
            
            // Add global functions to tracerWindow for tree interaction
            tracerWindow.toggleActor = (actor) => {
                if (expandedActors.has(actor)) {
                    expandedActors.delete(actor);
                } else {
                    expandedActors.add(actor);
                }
                selectedActor = actor;
                selectedItem = null;
                renderContent();
            };

            tracerWindow.selectItem = (index) => {
                selectedItem = executionFlow[index];
                selectedActor = selectedItem ? selectedItem.actor : null;
                renderContent();
            };

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
                selectedActor = null;
                renderContent();
            };

            doc.getElementById('compactBtn').onclick = () => {
                isCompactMode = !isCompactMode;
                if (isCompactMode) {
                    doc.body.classList.add('compact');
                    doc.getElementById('compactBtn').textContent = '🔳 Normal';
                } else {
                    doc.body.classList.remove('compact');
                    doc.getElementById('compactBtn').textContent = '🔲 Compact';
                }
            };

            doc.getElementById('searchBox').oninput = () => renderContent();

            doc.getElementById('expandAllBtn').onclick = () => {
                const actors = getUniqueActors();
                actors.forEach(actor => expandedActors.add(actor));
                renderContent();
            };

            doc.getElementById('collapseAllBtn').onclick = () => {
                expandedActors.clear();
                renderContent();
            };

            doc.getElementById('flowBtn').onclick = () => {
                currentView = 'flow';
                doc.getElementById('flowBtn').classList.add('active');
                doc.getElementById('helpBtn').classList.remove('active');
                doc.getElementById('flowView').style.display = 'flex';
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

            // Resizer functionality
            const resizer = doc.getElementById('resizer');
            const treePanel = doc.querySelector('.tree-panel');
            let isResizing = false;

            resizer.onmousedown = (e) => {
                isResizing = true;
                doc.body.style.cursor = 'col-resize';
            };

            doc.onmousemove = (e) => {
                if (!isResizing) return;
                const newWidth = e.clientX;
                if (newWidth > 150 && newWidth < 600) {
                    treePanel.style.width = newWidth + 'px';
                }
            };

            doc.onmouseup = () => {
                if (isResizing) {
                    isResizing = false;
                    doc.body.style.cursor = '';
                }
            };
        }

        function getUniqueActors() {
            const actors = new Set();
            executionFlow.forEach(f => actors.add(f.actor));
            return Array.from(actors).sort();
        }

        function renderContent() {
            if (!tracerWindow || tracerWindow.closed) return;
            if (currentView === 'help') {
                renderHelp();
            } else {
                renderTree();
                renderDetails();
                renderStats();
            }
        }

        function renderTree() {
            if (!tracerWindow || tracerWindow.closed) return;
            const doc = tracerWindow.document;
            const container = doc.getElementById('treeContainer');
            const search = doc.getElementById('searchBox').value.toLowerCase();

            if (executionFlow.length === 0) {
                container.innerHTML = \`
                    <div class="tree-empty">
                        <div class="tree-empty-icon">⚡</div>
                        <div class="tree-empty-text">No actors yet.<br>Start interacting with the game.</div>
                    </div>
                \`;
                return;
            }

            const now = Date.now();
            const actors = getUniqueActors();

            // Group items by actor
            const actorItems = {};
            executionFlow.forEach(item => {
                if (!actorItems[item.actor]) actorItems[item.actor] = [];
                actorItems[item.actor].push(item);
            });

            let html = '';
            actors.forEach(actor => {
                const items = actorItems[actor] || [];
                const filteredItems = items.filter(item => {
                    if (!search) return true;
                    return actor.toLowerCase().includes(search) ||
                           item.name?.toLowerCase().includes(search) ||
                           item.trigger?.toLowerCase().includes(search);
                });

                if (search && filteredItems.length === 0) return;

                const color = getActorColor(actor);
                const isExpanded = expandedActors.has(actor);
                const isSelected = selectedActor === actor;
                const count = items.length;

                html += \`
                    <div class="tree-actor-group">
                        <div class="tree-actor-header \${isSelected ? 'selected' : ''}" onclick="window.toggleActor('\${actor}')">
                            <span class="tree-expand-icon \${isExpanded ? 'expanded' : ''}">▶</span>
                            <div class="tree-actor-dot" style="background:\${color}"></div>
                            <div class="tree-actor-name">\${actor.replace(/^actor-/, '')}</div>
                            <span class="tree-badge">\${count}</span>
                        </div>
                        <div class="tree-children \${isExpanded ? 'expanded' : ''}">
                \`;

                if (isExpanded) {
                    filteredItems.slice(0, 50).forEach(item => {
                        const isRecent = now - item.time < 3000;
                        const isItemSelected = selectedItem === item;
                        
                        if (item.type === 'action') {
                            const actionName = String(item.name).replace(/^action-/, '').split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                            html += \`
                                <div class="tree-item \${isRecent ? 'recent' : ''} \${isItemSelected ? 'selected' : ''}" 
                                     onclick="window.selectItem(\${executionFlow.indexOf(item)})">
                                    <span class="tree-item-icon">🎬</span>
                                    <span class="tree-item-text">\${actionName}</span>
                                    <span class="tree-item-type action">A</span>
                                </div>
                            \`;
                        } else if (item.type === 'trigger') {
                            const triggerName = String(item.trigger || 'Unknown').replace(/^on-/i, '').replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                            const icon = getTriggerIcon(item.trigger);
                            html += \`
                                <div class="tree-item \${isRecent ? 'recent' : ''} \${isItemSelected ? 'selected' : ''}" 
                                     onclick="window.selectItem(\${executionFlow.indexOf(item)})">
                                    <span class="tree-item-icon">\${icon}</span>
                                    <span class="tree-item-text">\${triggerName}</span>
                                    <span class="tree-item-type trigger">T</span>
                                </div>
                            \`;
                        }
                    });
                }

                html += \`
                        </div>
                    </div>
                \`;
            });

            container.innerHTML = html;
        }

        function renderDetails() {
            if (!tracerWindow || tracerWindow.closed) return;
            const doc = tracerWindow.document;
            const container = doc.getElementById('detailsContainer');
            const search = doc.getElementById('searchBox').value.toLowerCase();

            let itemsToShow = executionFlow;

            // Filter by selected actor or search
            if (selectedActor) {
                itemsToShow = executionFlow.filter(f => f.actor === selectedActor);
            } else if (search) {
                itemsToShow = executionFlow.filter(f => {
                    return f.actor.toLowerCase().includes(search) ||
                           f.name?.toLowerCase().includes(search) ||
                           (f.type === 'trigger' && f.trigger?.toLowerCase().includes(search));
                });
            }

            if (itemsToShow.length === 0) {
                container.innerHTML = \`
                    <div class="empty">
                        <div class="empty-icon">⚡</div>
                        <div class="empty-title">No items to show</div>
                        <div class="empty-subtitle">
                            \${selectedActor ? 'No events for this actor yet.' : 
                              search ? 'No matches found. Try a different search.' :
                              'Start interacting with the game to see the execution flow.'}
                        </div>
                    </div>
                \`;
                return;
            }

            const now = Date.now();
            let html = '<div class="flow-timeline">';

            itemsToShow.slice(0, MAX_FLOW_DISPLAY).forEach((item, idx) => {
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
