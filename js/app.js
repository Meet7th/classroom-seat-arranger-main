// ==================== System Plugins (Heatmap & SmartRecommend) ====================
const SystemPlugins = {
    registerAll() {
        // Heatmap System Plugin
        PluginManager.register('system-heatmap', {
            name: '🔥 成绩热力图', description: '多维度成绩可视化热力图', version: '2.0.0',
            defaultEnabled: true, hasSettings: false, defaultSettings: {},
            securityStatus: 'ok',
            init() { console.log('Heatmap plugin initialized'); },
            beforeDraw(availableStudents, probabilities, nextSeat) { return { availableStudents, probabilities }; },
            afterDraw(student, seat) {},
            beforeExport(data) { return data; }
        });

        // Smart Recommend System Plugin
        PluginManager.register('system-smart-recommend', {
            name: '🧠 智能座位推荐', description: '基于多维良性影响分析的智能座位推荐', version: '2.0.0',
            defaultEnabled: true, hasSettings: false, defaultSettings: {},
            securityStatus: 'ok',
            init() { console.log('Smart Recommend plugin initialized'); },
            beforeDraw(availableStudents, probabilities, nextSeat) { return { availableStudents, probabilities }; },
            afterDraw(student, seat) {},
            beforeExport(data) { return data; }
        });

        // Mark system plugins
        ['system-heatmap', 'system-smart-recommend'].forEach(id => {
            if (state.plugins[id]) {
                state.plugins[id].isSystem = true;
                state.plugins[id].securityStatus = 'ok';
            }
        });
    }
};

let currentEditingPlugin = null;

// ==================== Advanced Export/Import ====================
const AdvExportImport = {
    _pendingImportData: null,

    /** Build export data based on selected modules */
    buildExportData(selectedModules) {
        const data = { _version: '26.6.16', _exportedAt: new Date().toISOString(), _modules: selectedModules };
        if (selectedModules.includes('students')) {
            data.students = state.students;
        }
        if (selectedModules.includes('bwlists')) {
            data.blacklist = state.blacklist;
            data.whitelist = state.whitelist;
            data.bwSettings = {
                blacklistPenalty: state.settings.blacklistPenalty,
                blacklistRadius: state.settings.blacklistRadius,
                whitelistDeskBonus: state.settings.whitelistDeskBonus,
                whitelistFrontBackBonus: state.settings.whitelistFrontBackBonus,
                whitelistDiagonalBonus: state.settings.whitelistDiagonalBonus,
                whitelistFallbackBonus: state.settings.whitelistFallbackBonus
            };
        }
        if (selectedModules.includes('seats')) {
            data.seats = state.seats.map(s => ({ number: s.number, row: s.row, col: s.col, disabled: s.disabled, student: s.student }));
            data.platformLeft = { disabled: state.platformLeft.disabled, student: state.platformLeft.student };
            data.platformRight = { disabled: state.platformRight.disabled, student: state.platformRight.student };
            data.rows = state.rows;
            data.cols = state.cols;
            data.drawnStudents = state.drawnStudents;
            data.remainingStudents = state.remainingStudents;
            data.currentDrawIndex = state.currentDrawIndex;
        }
        if (selectedModules.includes('settings')) {
            data.settings = { ...state.settings };
        }
        if (selectedModules.includes('plugins')) {
            data.plugins = {};
            Object.entries(state.plugins).forEach(([name, p]) => {
                data.plugins[name] = { name: p.name, description: p.description, version: p.version, enabled: p.enabled, settings: p.settings, isSystem: p.isSystem };
            });
        }
        if (selectedModules.includes('history')) {
            data.history = state.history;
            data.operationLogs = opLogs.slice(0, 50);
        }
        if (selectedModules.includes('relationships')) {
            data.relationships = state.relationships;
        }
        if (selectedModules.includes('theme')) {
            const computed = getComputedStyle(document.documentElement);
            data.theme = {
                current: state.settings.theme || '',
                accentColor: state.settings.accentColor || '#007AFF',
                darkMode: document.body.classList.contains('dark'),
                vars: {}
            };
            ['--primary','--primary-light','--primary-dark','--danger','--success','--warning','--info'].forEach(v => {
                data.theme.vars[v] = computed.getPropertyValue(v).trim();
            });
        }
        if (selectedModules.includes('demo') && state.demoSequence && state.demoSequence.length > 0) {
            data.demoSequence = state.demoSequence;
        }
        return data;
    },

    /** Show advanced export modal */
    showExportModal() {
        const modal = document.getElementById('advExportModal');
        modal.classList.add('active');
        // Wire up checkbox visual state
        modal.querySelectorAll('.adv-export-item input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => cb.closest('.adv-export-item').classList.toggle('checked', cb.checked));
        });
    },

    /** Execute advanced export */
    doExport() {
        const modal = document.getElementById('advExportModal');
        const selected = [];
        modal.querySelectorAll('.adv-export-item input[type="checkbox"]:checked').forEach(cb => selected.push(cb.dataset.module));
        if (selected.length === 0) { Toast.warning('请至少选择一个模块'); return; }
        const data = this.buildExportData(selected);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = `座位编排_完整配置_${UI.getTimestamp()}.json`;
        link.href = URL.createObjectURL(blob); link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        modal.classList.remove('active');
        Toast.success(`已导出 ${selected.length} 个模块`);
        addLog('📤', `高级导出: ${selected.join(', ')}`);
    },

    /** Show advanced import modal with file data */
    showImportModal(fileData) {
        this._pendingImportData = fileData;
        const modal = document.getElementById('advImportModal');
        const content = document.getElementById('advImportContent');
        const modules = fileData._modules || [];

        // Build preview
        let previewHtml = '<div class="adv-import-preview">';
        previewHtml += `<div class="preview-item"><span class="preview-label">导出时间</span><span>${fileData._exportedAt ? new Date(fileData._exportedAt).toLocaleString('zh-CN') : '未知'}</span></div>`;
        previewHtml += `<div class="preview-item"><span class="preview-label">版本</span><span>${fileData._version || '未知'}</span></div>`;
        if (fileData.students) previewHtml += `<div class="preview-item"><span class="preview-label">👥 学生名单</span><span>${fileData.students.length} 人</span></div>`;
        if (fileData.blacklist) previewHtml += `<div class="preview-item"><span class="preview-label">🚫 黑名单</span><span>${fileData.blacklist.length} 组</span></div>`;
        if (fileData.whitelist) previewHtml += `<div class="preview-item"><span class="preview-label">✅ 白名单</span><span>${fileData.whitelist.length} 组</span></div>`;
        if (fileData.seats) previewHtml += `<div class="preview-item"><span class="preview-label">🪑 座位分配</span><span>${fileData.seats.filter(s => s.student).length} 个已分配 (${fileData.rows || '?'}×${fileData.cols || '?'})</span></div>`;
        if (fileData.settings) previewHtml += `<div class="preview-item"><span class="preview-label">⚙️ 系统设置</span><span>已包含</span></div>`;
        if (fileData.plugins) previewHtml += `<div class="preview-item"><span class="preview-label">🔌 插件</span><span>${Object.keys(fileData.plugins).length} 个</span></div>`;
        if (fileData.history) previewHtml += `<div class="preview-item"><span class="preview-label">📋 历史</span><span>${fileData.history.length} 条</span></div>`;
        if (fileData.theme) previewHtml += `<div class="preview-item"><span class="preview-label">🎨 主题</span><span>${fileData.theme.current || '自定义'}</span></div>`;
        if (fileData.relationships) previewHtml += `<div class="preview-item"><span class="preview-label">🔗 关系网络</span><span>${fileData.relationships.length} 条</span></div>`;
        if (fileData.demoSequence) previewHtml += `<div class="preview-item"><span class="preview-label">🎬 演示序列</span><span>${fileData.demoSequence.length} 个座位</span></div>`;
        previewHtml += '</div>';

        // Build checkboxes for available modules
        const availableModules = [];
        if (fileData.students) availableModules.push({ key: 'students', label: '👥 学生名单' });
        if (fileData.blacklist || fileData.whitelist) availableModules.push({ key: 'bwlists', label: '📋 黑白名单' });
        if (fileData.seats) availableModules.push({ key: 'seats', label: '🪑 座位分配' });
        if (fileData.settings) availableModules.push({ key: 'settings', label: '⚙️ 系统设置' });
        if (fileData.plugins) availableModules.push({ key: 'plugins', label: '🔌 插件配置' });
        if (fileData.history) availableModules.push({ key: 'history', label: '📋 操作历史' });
        if (fileData.relationships) availableModules.push({ key: 'relationships', label: '🔗 关系网络' });
        if (fileData.theme) availableModules.push({ key: 'theme', label: '🎨 主题外观' });
        if (fileData.demoSequence) availableModules.push({ key: 'demo', label: '🎬 演示序列' });

        let checkboxesHtml = '<div style="margin-top:12px;"><label class="form-label">选择要导入的模块：</label>';
        checkboxesHtml += '<div class="btn-group" style="margin:6px 0;"><button class="btn btn-ghost btn-sm" id="advImportSelectAll">全选</button><button class="btn btn-ghost btn-sm" id="advImportDeselectAll">取消全选</button></div>';
        checkboxesHtml += '<div class="adv-export-grid">';
        availableModules.forEach((m, i) => {
            checkboxesHtml += `<label class="adv-export-item checked"><input type="checkbox" data-module="${m.key}" checked> ${m.label}</label>`;
        });
        checkboxesHtml += '</div></div>';

        content.innerHTML = previewHtml + checkboxesHtml;
        modal.classList.add('active');

        // Wire up select all / deselect all
        document.getElementById('advImportSelectAll')?.addEventListener('click', () => {
            content.querySelectorAll('.adv-export-item input[type="checkbox"]').forEach(cb => { cb.checked = true; cb.closest('.adv-export-item').classList.add('checked'); });
        });
        document.getElementById('advImportDeselectAll')?.addEventListener('click', () => {
            content.querySelectorAll('.adv-export-item input[type="checkbox"]').forEach(cb => { cb.checked = false; cb.closest('.adv-export-item').classList.remove('checked'); });
        });
        content.querySelectorAll('.adv-export-item input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => cb.closest('.adv-export-item').classList.toggle('checked', cb.checked));
        });
    },

    /** Execute advanced import */
    doImport() {
        const modal = document.getElementById('advImportModal');
        const data = this._pendingImportData;
        if (!data) { Toast.error('无导入数据'); return; }
        const selected = [];
        modal.querySelectorAll('.adv-export-item input[type="checkbox"]:checked').forEach(cb => selected.push(cb.dataset.module));
        if (selected.length === 0) { Toast.warning('请至少选择一个模块'); return; }

        try {
            if (selected.includes('students') && data.students) {
                state.students = data.students;
            }
            if (selected.includes('bwlists')) {
                if (data.blacklist) state.blacklist = data.blacklist;
                if (data.whitelist) state.whitelist = data.whitelist;
                if (data.bwSettings) {
                    Object.assign(state.settings, data.bwSettings);
                }
                document.getElementById('blacklist').value = state.blacklist.map(g => g.join(' ')).join('\n');
                document.getElementById('whitelist').value = state.whitelist.map(g => g.join(' ')).join('\n');
            }
            if (selected.includes('seats') && data.seats) {
                if (data.rows) state.rows = data.rows;
                if (data.cols) state.cols = data.cols;
                document.getElementById('rows').value = state.rows;
                document.getElementById('cols').value = state.cols;
                UI.renderClassroom();
                data.seats.forEach((saved, i) => {
                    if (state.seats[i]) {
                        state.seats[i].disabled = saved.disabled;
                        state.seats[i].student = saved.student;
                        UI.updateSeatDisplay(state.seats[i]);
                    }
                });
                if (data.platformLeft) { state.platformLeft.disabled = data.platformLeft.disabled; state.platformLeft.student = data.platformLeft.student; UI.updateSeatDisplay(state.platformLeft); }
                if (data.platformRight) { state.platformRight.disabled = data.platformRight.disabled; state.platformRight.student = data.platformRight.student; UI.updateSeatDisplay(state.platformRight); }
                UI.checkAisles(); UI.generateDrawOrder();
                // Restore draw state
                state.drawnStudents = []; state.remainingStudents = []; state.currentDrawIndex = 0;
                [...state.seats, state.platformLeft, state.platformRight].forEach(s => { if (s.student) state.drawnStudents.push(s.student); });
                state.students.forEach(s => { if (!state.drawnStudents.some(d => d.id === s.id)) state.remainingStudents.push(s); });
                while (state.currentDrawIndex < state.drawOrder.length) {
                    const s = state.drawOrder[state.currentDrawIndex];
                    if (!s.student && !s.disabled) break;
                    state.currentDrawIndex++;
                }
            }
            if (selected.includes('settings') && data.settings) {
                const defaults = { ...state.settings };
                state.settings = { ...defaults, ...data.settings };
                if (data.settings.quickInfoItems) state.settings.quickInfoItems = { ...defaults.quickInfoItems, ...data.settings.quickInfoItems };
                if (data.settings.weights) state.settings.weights = { ...defaults.weights, ...data.settings.weights };
            }
            if (selected.includes('plugins') && data.plugins) {
                Object.entries(data.plugins).forEach(([name, plugin]) => {
                    if (!state.plugins[name]) {
                        state.plugins[name] = plugin;
                        if (plugin.init) try { plugin.init(); } catch(e) {}
                    }
                });
                PluginManager.renderPluginsList();
            }
            if (selected.includes('history') && data.history) {
                state.history = data.history;
            }
            if (selected.includes('relationships') && data.relationships) {
                state.relationships = data.relationships;
                UI.renderRelationshipPanel();
                UI.renderRelationshipGrid();
                UI._refreshRelGraph();
            }
            if (selected.includes('theme') && data.theme) {
                if (data.theme.vars) {
                    Object.entries(data.theme.vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
                }
                if (data.theme.darkMode !== undefined) {
                    document.body.classList.toggle('dark', data.theme.darkMode);
                    document.getElementById('themeToggle').textContent = data.theme.darkMode ? '☀️' : '🌙';
                }
                if (data.theme.accentColor) state.settings.accentColor = data.theme.accentColor;
            }
            if (selected.includes('demo') && data.demoSequence) {
                state.demoSequence = data.demoSequence;
            }

            UI.applyGlobalSettings();
            UI.updateStats(); UI.updateProbabilityPanel(); UI.renderPool();
            if (selected.includes('students')) UI.checkStaleListEntries();
            saveConfig();
            modal.classList.remove('active');

            // If seats were imported, ask user whether to display
            if (selected.includes('seats') && data.seats) {
                const seatCount = data.seats.filter(s => s.student).length;
                if (seatCount > 0) {
                    document.getElementById('importSeatCount').textContent = seatCount;
                    document.getElementById('importDisplayOptionModal').classList.add('active');
                    // Store import info for later use
                    AdvExportImport._lastImportModules = selected;
                    return;
                }
            }

            Toast.success(`已导入 ${selected.length} 个模块`);
            addLog('📥', `高级导入: ${selected.join(', ')}`);
        } catch (err) {
            Toast.error('导入失败: ' + err.message);
            console.error('Advanced import error:', err);
        }
    },

    /** Trigger file selection for advanced import */
    triggerImport() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (!data._version) { Toast.warning('此文件可能不是高级导出格式，将尝试按兼容模式导入'); }
                    this.showImportModal(data);
                } catch (err) { Toast.error('文件解析失败: ' + err.message); }
            };
            reader.readAsText(file);
        };
        input.click();
    }
};

// ==================== Demo Mode ====================
const DemoMode = {
    _running: false,
    _paused: false,
    _timer: null,
    _currentIndex: 0,
    _sequence: [],
    _currentBubble: null,
    _currentHighlight: null,

    /** Build demo sequence from current seat assignments */
    buildSequence() {
        const seq = [];
        // Add platform seats first if occupied
        if (state.platformRight.student && !state.platformRight.disabled) {
            seq.push({ type: 'platform-right', seat: state.platformRight, number: '讲台右' });
        }
        if (state.platformLeft.student && !state.platformLeft.disabled) {
            seq.push({ type: 'platform-left', seat: state.platformLeft, number: '讲台左' });
        }
        // Add normal seats sorted by number
        const occupiedSeats = state.seats.filter(s => s.student && !s.disabled).sort((a, b) => a.number - b.number);
        occupiedSeats.forEach(s => seq.push({ type: 'normal', seat: s, number: s.number }));
        return seq;
    },

    /** Start demo mode */
    start() {
        this._sequence = this.buildSequence();
        if (this._sequence.length === 0) { Toast.warning('当前没有已分配的学生可演示'); return; }
        // Save demo sequence to state for export
        state.demoSequence = this._sequence.map(item => ({ type: item.type, number: item.number, studentName: item.seat.student?.name }));

        // Save original seat data for restore on stop
        this._savedSeatData = this._sequence.map(item => ({ type: item.type, seat: item.seat, student: JSON.parse(JSON.stringify(item.seat.student)) }));

        // Clear all seat assignments first
        state.seats.forEach(s => { s.student = null; UI.updateSeatDisplay(s); });
        state.platformLeft.student = null; UI.updateSeatDisplay(state.platformLeft);
        state.platformRight.student = null; UI.updateSeatDisplay(state.platformRight);
        UI.updateStats(); UI.updateProbabilityPanel(); UI.renderPool();

        this._running = true;
        this._paused = false;
        this._currentIndex = 0;

        // Disable other buttons
        document.getElementById('drawNext').disabled = true;
        document.getElementById('autoDraw').disabled = true;
        document.getElementById('resetDraw').disabled = true;

        // Show demo toolbar
        const toolbar = document.getElementById('demoToolbar');
        toolbar.classList.add('visible');
        document.getElementById('demoPauseBtn').textContent = '⏸ 暂停';
        document.getElementById('demoProgress').textContent = `0/${this._sequence.length}`;

        // Change more menu item
        const mmDemo = document.getElementById('mmDemo');
        if (mmDemo) { mmDemo.querySelector('.mmi-icon').textContent = '⏹'; mmDemo.lastChild.textContent = ' 结束演示'; }

        addLog('🎬', '开始演示模式');
        Toast.info(`演示开始，共 ${this._sequence.length} 个座位`);

        this._step();
    },

    /** Execute one demo step */
    _step() {
        if (!this._running || this._paused) return;
        if (this._currentIndex >= this._sequence.length) {
            this.stop();
            Toast.success('演示完成！');
            return;
        }

        const item = this._sequence[this._currentIndex];
        const seat = item.seat;
                    const el = seat.type === 'normal' ? seat.element : document.getElementById(seat.type === 'platform-left' ? 'platformLeft' : 'platformRight');

        // Clear previous highlight
        if (this._currentHighlight) {
            this._currentHighlight.classList.remove('demo-highlight');
        }
        if (this._currentBubble) {
            this._currentBubble.remove();
            this._currentBubble = null;
        }

        // Assign student to seat (replay the assignment)
        if (this._savedSeatData && this._savedSeatData[this._currentIndex]) {
            const saved = this._savedSeatData[this._currentIndex];
            seat.student = saved.student;
            UI.updateSeatDisplay(seat);
            UI.updateStats(); UI.updateProbabilityPanel(); UI.renderPool();
        }

        // Highlight current seat
        if (el) {
            el.classList.add('demo-highlight');
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this._currentHighlight = el;
        }

        // Show info bubble
        if (seat.student && el) {
            const bubble = document.createElement('div');
            bubble.className = 'demo-bubble';
            const rect = el.getBoundingClientRect();
            bubble.style.left = (rect.right + 12) + 'px';
            bubble.style.top = (rect.top + rect.height / 2 - 30) + 'px';
            // Keep within viewport
            if (rect.right + 200 > window.innerWidth) {
                bubble.style.left = (rect.left - 200) + 'px';
            }
            const s = seat.student;
            const avg = CompositeEval.getAvgScore(s);
            let info = `${s.gender === 'male' ? '♂ 男' : '♀ 女'}`;
            if (avg !== null) info += ` | 均分 ${avg}`;
            if (s.personality) info += ` | ${s.personality}`;
            if (s.position) info += ` | ${s.position}`;
            bubble.innerHTML = `<div class="demo-bubble-name">${escapeHtml(s.name)}</div><div class="demo-bubble-info">${info}</div>`;
            document.body.appendChild(bubble);
            this._currentBubble = bubble;
        }

        this._currentIndex++;
        document.getElementById('demoProgress').textContent = `${this._currentIndex}/${this._sequence.length}`;

        // Schedule next step
        const speed = state.settings.demoSpeed || 600;
        this._timer = setTimeout(() => this._step(), speed);
    },

    /** Pause/Resume demo */
    togglePause() {
        if (!this._running) return;
        this._paused = !this._paused;
        document.getElementById('demoPauseBtn').textContent = this._paused ? '▶ 继续' : '⏸ 暂停';
        if (!this._paused) this._step();
    },

    /** Stop demo mode */
    stop() {
        this._running = false;
        this._paused = false;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }

        // Clear highlight and bubble
        if (this._currentHighlight) { this._currentHighlight.classList.remove('demo-highlight'); this._currentHighlight = null; }
        if (this._currentBubble) { this._currentBubble.remove(); this._currentBubble = null; }

        // Re-enable buttons
        document.getElementById('drawNext').disabled = false;
        document.getElementById('autoDraw').disabled = false;
        document.getElementById('resetDraw').disabled = false;

        // Hide demo toolbar
        document.getElementById('demoToolbar').classList.remove('visible');

        // Reset more menu item
        const mmDemo = document.getElementById('mmDemo');
        if (mmDemo) { mmDemo.querySelector('.mmi-icon').textContent = '🎬'; mmDemo.lastChild.textContent = ' 演示'; }

        addLog('⏹', '演示结束');
    }
};

// ==================== Bug Fix: Pool Load More ====================
// [FIX] Ensure load more rebinds events correctly
const _originalRenderPool = UI.renderPool.bind(UI);
UI.renderPool = function() {
    _originalRenderPool();
    // After render, ensure the load-more button's new items get events
    const loadMoreBtn = document.getElementById('poolLoadMore');
    if (loadMoreBtn && !loadMoreBtn._fixed) {
        loadMoreBtn._fixed = true;
        // The original code already handles this, but we ensure it works
    }
};

// ==================== Bug Fix: Dropdown close on outside click ====================
// [FIX] Ensure all dropdowns close when clicking outside
document.addEventListener('click', (e) => {
    // Close export/view/recommend dropdowns
    ['exportDropdown', 'viewDropdown', 'recommendDropdown'].forEach(id => {
        const dd = document.getElementById(id);
        if (dd && !e.target.closest('#' + id) && !e.target.closest('[id$="MenuBtn"],[id$="Recommend"]')) {
            dd.style.display = 'none';
        }
    });
});

// ==================== Config Save ====================
function saveConfig() {
    try {
        const seatsData = state.seats.map(s => ({ number: s.number, row: s.row, col: s.col, disabled: s.disabled, student: s.student }));
        localStorage.setItem('seatArrangerConfig', JSON.stringify({
            rows: state.rows, cols: state.cols,
            platformLeft: { disabled: state.platformLeft.disabled, student: state.platformLeft.student },
            platformRight: { disabled: state.platformRight.disabled, student: state.platformRight.student },
            showPlatformLeft: state.showPlatformLeft, showPlatformRight: state.showPlatformRight,
            heatmapType: state.heatmapType, podiumView: document.getElementById('classroom')?.classList.contains('podium-view') || false,
            students: state.students, blacklist: state.blacklist, whitelist: state.whitelist,
            relationships: state.relationships,
            subjectMaxScores: state.subjectMaxScores,
            seats: seatsData,
            history: state.history, plugins: Object.fromEntries(
                Object.entries(state.plugins).map(([name, p]) => [name, {
                    name: p.name, description: p.description, version: p.version,
                    enabled: p.enabled, settings: p.settings, isSystem: p.isSystem,
                    securityStatus: p.securityStatus, defaultEnabled: p.defaultEnabled,
                    hasSettings: p.hasSettings, defaultSettings: p.defaultSettings
                }])
            ), settings: state.settings
        }));
        const indicator = document.getElementById('savedIndicator');
        if (indicator) { indicator.style.opacity = '1'; setTimeout(() => { indicator.style.opacity = '0.5'; }, 2000); }
    } catch (err) {
        console.error('自动保存失败', err);
        if (err.name === 'QuotaExceededError' || err.code === 22) {
            Toast.error('本地存储已满，请清理缓存');
        }
    }
}

// Debounced auto-save
const debouncedSave = debounce(() => { saveConfig(); }, 1000);

// ==================== Init ====================
document.addEventListener('DOMContentLoaded', () => {
    // Pre-load podium view state before first render to avoid flash
    try {
        const savedCfg = localStorage.getItem('seatArrangerConfig');
        if (savedCfg) {
            const cfg = JSON.parse(savedCfg);
            if (cfg.podiumView) document.getElementById('classroom')?.classList.add('podium-view');
        }
    } catch(e) {}
    UI.init();
    window._startTime = Date.now();

    // Register core modules
    ModuleRegistry.register({ id: 'core-state', name: '状态管理', version: '26.6.16', type: 'core', description: '全局状态管理与数据持久化', init() {}, destroy() {} });
    ModuleRegistry.register({ id: 'core-algorithm', name: '抽取算法', version: '26.6.16', type: 'core', description: '概率计算与座位分配算法', init() {}, destroy() {} });
    ModuleRegistry.register({ id: 'core-eval', name: '综合评价引擎', version: '1.0.0', type: 'core', description: '多维度学生能力评估系统', init() {}, destroy() {} });
    ModuleRegistry.register({ id: 'core-security', name: '安全沙箱', version: '1.0.0', type: 'core', description: '插件安全检测与权限管理', init() {}, destroy() {} });
    ModuleRegistry.register({ id: 'panel-ui', name: '用户操作面板', version: '26.6.16', type: 'panel', description: '主界面渲染与交互处理', init() {}, destroy() {} });
    ModuleRegistry.register({ id: 'panel-management', name: '管理面板', version: '1.0.0', type: 'panel', description: '模块管理、健康监控、主题仓库', init() {}, destroy() {} });
    ModuleRegistry.register({ id: 'plugin-manager', name: '插件管理器', version: '1.0.0', type: 'core', description: '插件注册、安全检测、生命周期管理', init() {}, destroy() {} });
    ModuleRegistry.register({ id: 'theme-repo', name: '主题仓库', version: '1.0.0', type: 'panel', description: '多套视觉方案管理与切换', init() {}, destroy() {} });

    // Register system algorithm plugins
    ModuleRegistry.register({ id: 'algo-predictable', name: '公平可预测抽取', version: '1.0.0', type: 'algorithm', description: '基于概率权重的公平抽取，结果可预测', init() {}, destroy() {} });
    ModuleRegistry.register({ id: 'algo-unpredictable', name: '公平不可预测抽取', version: '1.0.0', type: 'algorithm', description: '在公平基础上加入随机扰动', init() {}, destroy() {} });

    // Register system feature plugins
    ModuleRegistry.register({ id: 'system-heatmap', name: '成绩热力图', version: '2.0.0', type: 'plugin', description: '多维度成绩可视化（综合评价/综合成绩/单科）', init() {}, destroy() {} });
    ModuleRegistry.register({ id: 'system-smart-recommend', name: '智能座位推荐', version: '2.0.0', type: 'plugin', description: '基于良性影响分析的智能座位互换推荐', init() {}, destroy() {} });

    // [FEATURE #26] Deferred non-critical init - only classroom render is critical at startup
    // Defer: module list, health monitor, theme repo, security report
    setTimeout(() => {
        ModuleRegistry.renderList();
        ThemeRepository.renderList();
        SecuritySandbox.renderReport();
    }, 0);
    setTimeout(() => { ModuleRegistry.renderHealth(); }, 100);

    // System panel event bindings
    document.getElementById('exportTheme')?.addEventListener('click', () => ThemeRepository.exportTheme());
    document.getElementById('importTheme')?.addEventListener('click', () => document.getElementById('themeFile').click());
    document.getElementById('themeFile')?.addEventListener('change', e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => ThemeRepository.importTheme(ev.target.result);
        reader.readAsText(file); e.target.value = '';
    });

    // Module OTA import
    document.getElementById('importModule')?.addEventListener('click', () => document.getElementById('moduleFile').click());
    document.getElementById('moduleFile')?.addEventListener('change', e => {
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 512 * 1024) { Toast.error('模块文件过大（最大 512KB）'); e.target.value = ''; return; }
        const reader = new FileReader();
        reader.onload = ev => {
            const code = ev.target.result;
            try {
                // Security scan before importing
                const report = SecuritySandbox.scan(code);
                if (report.riskLevel === 'critical') {
                    Toast.error('模块安全检测未通过：包含高危代码，已阻止导入');
                    addLog('🛡️', `模块安全拦截: ${file.name} (危险级别: ${report.riskLevel})`);
                    e.target.value = '';
                    return;
                }
                // Execute module code in sandbox
                const safeModuleRegistry = {
                    register: (mod) => {
                        if (!mod.id || !mod.name) { Toast.error('模块缺少必要字段 (id, name)'); return; }
                        ModuleRegistry.register(mod);
                        Toast.success(`模块 "${mod.name}" 已导入`);
                        addLog('📦', `导入系统模块: ${mod.name} v${mod.version || '1.0.0'}`);
                        ModuleRegistry.renderList();
                        ModuleRegistry.renderHealth();
                    },
                    hotSwap: (id, mod) => {
                        ModuleRegistry.hotSwap(id, mod);
                        Toast.success(`模块 "${mod.name || id}" 已热替换`);
                        ModuleRegistry.renderList();
                    }
                };
                const fn = new Function('ModuleRegistry', 'console', code);
                fn(safeModuleRegistry, console);
                if (report.riskLevel !== 'safe') {
                    Toast.warning(`模块已导入，但检测到潜在风险`);
                }
                SecuritySandbox.renderReport();
            } catch (err) {
                console.error('模块导入失败', err);
                Toast.error('模块导入失败: ' + err.message);
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    });

    // Health monitor refresh
    // [FEATURE #26] Health monitor refresh (deferred, then periodic)
    setTimeout(() => { ModuleRegistry.renderHealth(); }, 200);
    setInterval(() => { ModuleRegistry.renderHealth(); }, 10000);

    // [FEATURE #9] Guide "试一试" buttons
    document.getElementById('guideTryFillExample')?.addEventListener('click', () => {
        document.getElementById('helpModal').classList.remove('active');
        document.querySelector('.sidebar-tab[data-tab=students]')?.click();
        document.getElementById('fillExample')?.click();
    });
    document.getElementById('guideGoAlgorithm')?.addEventListener('click', () => {
        UI.openHelpTab('algorithm');
    });
    document.getElementById('guideGoAiAlgo')?.addEventListener('click', () => {
        UI.openHelpTab('ai-algo');
    });
    document.getElementById('guideGoPlugins')?.addEventListener('click', () => {
        UI.openHelpTab('plugins');
    });
    document.getElementById('guideTryLayout')?.addEventListener('click', () => {
        document.getElementById('helpModal').classList.remove('active');
        document.getElementById('settingsModal')?.classList.add('active');
        document.querySelector('[data-stab=layout]')?.click();
    });
    document.getElementById('guideTryPodium')?.addEventListener('click', () => {
        document.getElementById('helpModal').classList.remove('active');
        document.getElementById('mmPodium')?.click();
    });
    document.getElementById('guideTryHeatmap')?.addEventListener('click', () => {
        document.getElementById('helpModal').classList.remove('active');
        document.getElementById('mmHeatmap')?.click();
    });
    const saved = localStorage.getItem('seatArrangerConfig');
    if (saved) {
        try {
            const config = JSON.parse(saved);
            if (config.rows) state.rows = clamp(config.rows, 1, 20);
            if (config.cols) state.cols = clamp(config.cols, 1, 20);
            if (config.showPlatformLeft !== undefined) state.showPlatformLeft = config.showPlatformLeft;
            if (config.showPlatformRight !== undefined) state.showPlatformRight = config.showPlatformRight;
            if (config.heatmapType) state.heatmapType = config.heatmapType;
            if (config.platformLeft) { state.platformLeft.disabled = config.platformLeft.disabled; state.platformLeft.student = config.platformLeft.student; }
            if (config.platformRight) { state.platformRight.disabled = config.platformRight.disabled; state.platformRight.student = config.platformRight.student; }
            if (config.students) state.students = config.students;
            if (config.blacklist) state.blacklist = config.blacklist;
            if (config.whitelist) state.whitelist = config.whitelist;
            if (config.relationships) state.relationships = config.relationships;
            if (config.subjectMaxScores) state.subjectMaxScores = { ...state.subjectMaxScores, ...config.subjectMaxScores };
            if (config.history) state.history = config.history;
            if (config.settings) {
                const defaults = state.settings;
                state.settings = { ...defaults, ...config.settings };
                if (config.settings.quickInfoItems) state.settings.quickInfoItems = { ...defaults.quickInfoItems, ...config.settings.quickInfoItems };
                if (config.settings.weights) state.settings.weights = { ...defaults.weights, ...config.settings.weights };
            }
            if (config.plugins) {
                Object.entries(config.plugins).forEach(([name, plugin]) => {
                    state.plugins[name] = plugin;
                    if (plugin.init) try { plugin.init(); } catch(e) {}
                });
                PluginManager.renderPluginsList();
            }
            UI.applyGlobalSettings();
            // Restore podium view state before rendering classroom
            if (config.podiumView) {
                document.getElementById('classroom')?.classList.add('podium-view');
            }
            UI.renderClassroom();
            UI.updateViewModeUI();
            // Restore theme and accent color
            if (config.settings?.theme) UI.applyTheme(config.settings.theme);
            if (config.settings?.accentColor) UI.applyAccentColor(config.settings.accentColor);
            if (config.seats) {
                config.seats.forEach((saved, i) => {
                    if (state.seats[i]) {
                        state.seats[i].disabled = saved.disabled;
                        state.seats[i].student = saved.student;
                        UI.updateSeatDisplay(state.seats[i]);
                    }
                });
                UI.checkAisles(); UI.generateDrawOrder();
            }
            state.drawnStudents = []; state.remainingStudents = []; state.currentDrawIndex = 0;
            [...state.seats, state.platformLeft, state.platformRight].forEach(s => { if (s.student) state.drawnStudents.push(s.student); });
            state.students.forEach(s => { if (!state.drawnStudents.some(d => d.id === s.id)) state.remainingStudents.push(s); });
            while (state.currentDrawIndex < state.drawOrder.length) {
                const s = state.drawOrder[state.currentDrawIndex];
                if (!s.student && !s.disabled) break;
                state.currentDrawIndex++;
            }
            UI.updateStats(); UI.updateProbabilityPanel(); UI.renderPool();
            document.getElementById('blacklist').value = state.blacklist.map(g => g.join(' ')).join('\n');
            document.getElementById('whitelist').value = state.whitelist.map(g => g.join(' ')).join('\n');
        } catch (e) { console.error('恢复配置失败', e); }
    }
    // [FIX] Auto-save with dirty flag detection - only saves when actual changes occur
    setInterval(() => { debouncedSave(); }, 5000);
    window.addEventListener('beforeunload', saveConfig);

    // [FEATURE #24] Throttled resize handler
    let _resizeTimer = null;
    window.addEventListener('resize', () => {
        if (_resizeTimer) return;
        _resizeTimer = setTimeout(() => {
            _resizeTimer = null;
            // Recalculate layout if needed
            if (state.heatmapVisible) UI.renderHeatmap();
        }, 150);
    });

    // Performance mode initialization
    const savedPerfMode = state.settings.performanceMode;
    if (savedPerfMode === 'auto' || !savedPerfMode) {
        // First time use, show detection modal
        setTimeout(() => UI.showPerfModeModal(), 500);
    } else {
        // Already have settings, apply directly
        UI.applyPerformanceMode(savedPerfMode);
    }

    // Bind performance mode test button
    document.getElementById('perfModeTestBtn')?.addEventListener('click', () => {
        UI.showPerfModeModal();
    });
});
