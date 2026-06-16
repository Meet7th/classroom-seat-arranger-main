// ==================== Plugin Manager ====================
const PluginManager = {
    register(name, plugin) {
        if (state.plugins[name]) { Toast.warning(`插件 ${plugin.name} 已存在`); return; }
        state.plugins[name] = { ...plugin, enabled: plugin.defaultEnabled !== false, settings: { ...(plugin.defaultSettings || {}) } };
        if (state.plugins[name].init) {
            try { state.plugins[name].init(); }
            catch (err) { console.error(`插件 ${name} 初始化失败`, err); Toast.error(`插件 ${plugin.name} 初始化失败`); delete state.plugins[name]; return; }
        }
        this.renderPluginsList();
        Toast.success(`插件 ${plugin.name} 已安装`);
    },
    isEnabled(name) { return state.plugins[name] && state.plugins[name].enabled; },
    call(name, method, ...args) {
        if (this.isEnabled(name) && state.plugins[name][method]) {
            try { return state.plugins[name][method](...args); }
            catch (err) { console.error(`插件 ${name}.${method} 失败`, err); Toast.error(`插件调用失败`); }
        }
    },
    getPluginSettings(name) { return state.plugins[name]?.settings || {}; },
    uninstall(name) {
        if (state.plugins[name]) {
            const pn = state.plugins[name].name;
            delete state.plugins[name];
            this.renderPluginsList();
            Toast.success(`插件 ${pn} 已卸载`);
        }
    },
    renderPluginsList() {
        const container = document.getElementById('pluginsList');
        container.innerHTML = '';
        Object.entries(state.plugins).forEach(([name, plugin]) => {
            const isSystem = plugin.isSystem;
            const securityIcon = plugin.securityStatus === 'ok' ? '🛡️' : plugin.securityStatus === 'risk' ? '⚠️' : '';
            const div = document.createElement('div');
            div.className = 'plugin-item';
            div.innerHTML = `
                <div class="plugin-info">
                    <div class="plugin-name">${isSystem ? '⭐ ' : ''}${escapeHtml(plugin.name)} <span style="font-size:10px;color:var(--text-tertiary);">v${escapeHtml(plugin.version)}</span> ${securityIcon}</div>
                    <div class="plugin-desc">${escapeHtml(plugin.description)}${plugin.securityStatus === 'risk' ? ' <span style="color:var(--warning);">[风险]</span>' : ''}</div>
                </div>
                <div class="plugin-actions">
                    ${plugin.hasSettings ? `<button class="btn btn-secondary btn-icon plugin-settings-btn" data-plugin="${name}">⚙</button>` : ''}
                    ${!isSystem ? `<button class="btn btn-danger btn-icon plugin-uninstall-btn" data-plugin="${name}">✕</button>` : ''}
                    <label class="switch"><input type="checkbox" ${plugin.enabled ? 'checked' : ''} data-plugin="${name}" ${isSystem ? 'disabled' : ''}><span class="slider"></span></label>
                </div>`;
            container.appendChild(div);
        });
        container.querySelectorAll('input[type="checkbox"]:not([disabled])').forEach(cb => {
            cb.addEventListener('change', e => {
                const pn = e.target.dataset.plugin;
                state.plugins[pn].enabled = e.target.checked;
                Toast.success(`${state.plugins[pn].name} 已${e.target.checked ? '启用' : '禁用'}`);
            });
        });
        container.querySelectorAll('.plugin-settings-btn').forEach(btn => {
            btn.addEventListener('click', e => this.openPluginSettings(e.target.dataset.plugin));
        });
        container.querySelectorAll('.plugin-uninstall-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const pn = e.target.dataset.plugin;
                if (confirm(`确定卸载 ${state.plugins[pn].name}？`)) this.uninstall(pn);
            });
        });
    },
    openPluginSettings(pluginName) {
        const plugin = state.plugins[pluginName];
        document.getElementById('pluginSettingsTitle').textContent = `${plugin.name} 设置`;
        const content = document.getElementById('pluginSettingsContent');
        content.innerHTML = '';
        if (plugin.renderSettings) plugin.renderSettings(content, plugin.settings);
        else content.innerHTML = '<p style="color:var(--text-tertiary);">该插件暂无设置选项</p>';
        document.getElementById('pluginSettingsModal').classList.add('active');
    },
    getBlankTemplate() {
        return `const MyPlugin = {
    name: "我的插件", description: "插件功能描述", version: "1.0.0",
    defaultEnabled: true, hasSettings: false, defaultSettings: {},
    renderSettings(container, settings) { container.innerHTML = '<p>设置内容</p>'; },
    saveSettings() {},
    init() { console.log("插件初始化"); },
    beforeDraw(availableStudents, probabilities, nextSeat) {
        return { availableStudents, probabilities };
    },
    afterDraw(student, seat) {},
    beforeExport(data) { return data; }
};
PluginManager.register('my-plugin', MyPlugin);`;
    }
};

// ==================== AI Plugin Development Doc Generator ====================
function generateAiDevDoc() {
    return `# 座位编排系统 - AI 插件开发文档 v${ModuleRegistry.systemVersion}

> 本文档供 AI 助手参考，用于为用户生成插件代码。
> 请严格遵守安全规范，不得生成任何恶意代码。

## 一、系统概述

本系统是一个教室座位智能编排系统，支持：
- 多维度学生数据（多科成绩、性格、爱好、职务）
- 概率公平抽取算法
- 成绩热力图可视化
- 智能座位推荐

## 二、插件结构

\`\`\`javascript
const MyPlugin = {
    name: "插件名称",           // 显示名称（必填）
    description: "功能描述",    // 简要描述（必填）
    version: "1.0.0",          // 语义化版本号（必填）
    author: "作者名",           // 作者（可选）
    dependencies: [],           // 依赖的其他插件ID（可选）
    permissions: ['core.read'], // 所需权限声明（见下方）

    defaultEnabled: true,       // 默认启用
    hasSettings: false,         // 是否有设置面板
    defaultSettings: {},        // 默认设置

    // 生命周期
    init() { /* 插件初始化，系统启动时调用 */ },
    destroy() { /* 插件销毁，卸载时调用 */ },

    // 核心钩子
    beforeDraw(availableStudents, probabilities, nextSeat) {
        // 在每次抽取前调用
        // 可修改概率分布
        // 必须返回 { availableStudents, probabilities }
        return { availableStudents, probabilities };
    },
    afterDraw(student, seat) {
        // 在每次抽取后调用
        // student: 被抽中的学生对象
        // seat: 被分配的座位对象
    },
    beforeExport(data) {
        // 在导出数据前调用
        // 可修改导出内容
        // 必须返回 data
        return data;
    },

    // 设置面板渲染（hasSettings=true时生效）
    renderSettings(container, settings) {
        container.innerHTML = '<p>设置内容</p>';
    },
    saveSettings() { /* 保存设置 */ }
};
PluginManager.register('my-plugin', MyPlugin);
\`\`\`

## 三、权限系统

### 权限列表
| 权限ID | 说明 | 风险等级 |
|--------|------|----------|
| core.read | 读取核心数据（学生、座位、配置） | 低 |
| core.write | 修改核心数据 | 中 |
| ui.toast | 显示提示消息 | 低 |
| ui.modal | 显示弹窗 | 低 |
| ui.render | 渲染自定义UI | 低 |
| data.students | 访问学生数据 | 中 |
| data.seats | 修改座位安排 | 中 |
| data.export | 导出数据 | 低 |
| storage.local | 使用本地存储 | 中 |
| network.fetch | 网络请求 | ⚠️ 高危 |
| system.eval | 动态执行代码 | ⚠️ 高危 |

### 安全规则（必须遵守）

1. **禁止**使用 \`eval()\`、\`new Function()\` 动态执行代码
2. **禁止**使用 \`fetch()\`、\`XMLHttpRequest\` 发送网络请求（除非用户明确授权）
3. **禁止**访问 \`document.cookie\`
4. **禁止**使用 \`document.write()\`
5. **禁止**修改 \`window.location\` 进行页面跳转
6. **禁止**访问地理位置、摄像头、麦克风等敏感API
7. **禁止**生成任何形式的恶意代码、数据窃取代码、键盘记录器
8. **禁止**生成绕过安全检测的代码
9. **推荐**使用 \`Toast.success()\` 显示提示
10. **推荐**使用 \`addLog()\` 记录操作日志

### 权限声明示例
\`\`\`javascript
permissions: ['core.read', 'data.students', 'ui.toast']
\`\`\`

## 四、可用 API

### 数据访问
- \`state.students\` - 学生列表（只读推荐）
- \`state.drawnStudents\` - 已抽取学生
- \`state.remainingStudents\` - 未抽取学生
- \`state.seats\` - 座位列表
- \`state.settings\` - 系统配置

### 学生对象结构
\`\`\`javascript
{
    id: Number,          // 唯一ID
    name: String,        // 姓名
    gender: 'male'|'female',
    lunch: Boolean,      // 是否午休
    pinned: Boolean,     // 是否固定
    score: Number|null,  // 综合成绩（兼容旧版）
    scores: {            // 多科成绩
        '语文': 85,
        '数学': 92,
        '英语': 78
    },
    personality: '外向'|'内向'|'中性'|null,
    hobbies: ['篮球', '绘画'],  // 爱好列表
    position: '班长'|'学习委员'|null  // 班级职务
}
\`\`\`

### 座位对象结构
\`\`\`javascript
{
    element: HTMLElement, // DOM元素
    number: Number,      // 座位编号
    row: Number,         // 行号（0开始）
    col: Number,         // 列号（0开始）
    disabled: Boolean,   // 是否禁用
    student: Object|null,// 坐在此座位的学生
    type: 'normal'|'platform-left'|'platform-right'
}
\`\`\`

### UI 工具
- \`Toast.success(msg)\` / \`Toast.error(msg)\` / \`Toast.warning(msg)\` / \`Toast.info(msg)\`
- \`addLog(icon, text)\` - 添加操作日志
- \`document.getElementById(id)\` - 访问DOM

### 综合评价 API
- \`CompositeEval.getScore(student)\` - 获取综合评价分数
- \`CompositeEval.getAvgScore(student)\` - 获取平均成绩
- \`CompositeEval.peerInfluence(s1, s2)\` - 计算两名学生的良性影响分

## 五、插件类型

| 类型 | 说明 | 示例 |
|------|------|------|
| algorithm | 抽取/分配算法 | 自定义抽取策略 |
| visualization | 数据可视化 | 自定义图表 |
| notification | 通知提醒 | 定时提醒 |
| export | 导出格式 | PDF导出、自定义模板 |
| analysis | 数据分析 | 成绩趋势分析 |
| utility | 实用工具 | 批量操作、快捷功能 |

## 六、重要提示

1. 所有插件代码将在安全沙箱中运行
2. 涉及高危操作的代码会被自动禁用
3. 插件不得要求用户关闭安全检测
4. 如需特殊权限，请在 permissions 中声明并说明理由
5. 插件不得收集或上传用户数据
6. 插件不得干扰系统核心功能

---
*文档版本: v${ModuleRegistry.systemVersion} | 生成时间: ${new Date().toLocaleString('zh-CN')}*
`;
}

// ==================== Module Registry & Version Control ====================
const ModuleRegistry = {
    modules: new Map(),
    systemVersion: '26.6.16',

    register(mod) {
        if (!mod.id || !mod.version) {
            console.error('Module must have id and version');
            return false;
        }
        if (mod.dependencies) {
            for (const dep of mod.dependencies) {
                if (!this.modules.has(dep)) {
                    console.error(`Module ${mod.id} missing dependency: ${dep}`);
                    mod.status = 'error';
                }
            }
        }
        this.modules.set(mod.id, {
            ...mod,
            status: mod.status || 'ok',
            loadedAt: Date.now(),
            health: { uptime: 0, errors: 0, lastError: null }
        });
        return true;
    },

    unregister(id) {
        const mod = this.modules.get(id);
        if (!mod) return false;
        if (mod.type === 'core') { console.error('Cannot unregister core module'); return false; }
        if (mod.destroy) try { mod.destroy(); } catch(e) { console.error(`Module ${id} destroy error`, e); }
        this.modules.delete(id);
        return true;
    },

    get(id) { return this.modules.get(id); },
    getAll() { return [...this.modules.values()]; },
    getByType(type) { return this.getAll().filter(m => m.type === type); },

    hotSwap(id, newMod) {
        const old = this.modules.get(id);
        if (!old) return this.register(newMod);
        if (old.destroy) try { old.destroy(); } catch(e) {}
        newMod.id = id;
        this.modules.set(id, {
            ...newMod,
            loadedAt: Date.now(),
            health: old.health || { uptime: 0, errors: 0, lastError: null }
        });
        if (newMod.init) try { newMod.init(); } catch(e) { console.error(`Hot-swap init error for ${id}`, e); }
        return true;
    },

    getHealth() {
        const mods = this.getAll();
        return {
            total: mods.length,
            ok: mods.filter(m => m.status === 'ok').length,
            warn: mods.filter(m => m.status === 'warn').length,
            error: mods.filter(m => m.status === 'error').length,
            disabled: mods.filter(m => m.status === 'disabled').length,
            uptime: Date.now() - (window._startTime || Date.now()),
            memoryUsage: performance?.memory?.usedJSHeapSize || null
        };
    },

    renderList() {
        const container = document.getElementById('moduleList');
        if (!container) return;
        const mods = this.getAll();
        container.innerHTML = mods.map(m => `
            <div class="module-card" data-module="${m.id}">
                <div class="module-info">
                    <div class="module-name">
                        ${escapeHtml(m.name || m.id)}
                        <span class="module-version">v${escapeHtml(m.version)}</span>
                        <span class="module-type-badge ${escapeHtml(m.type)}">${escapeHtml(m.type)}</span>
                    </div>
                    <div class="module-desc">${escapeHtml(m.description || '')}</div>
                </div>
                <div class="module-status">
                    <span class="status-dot ${m.status}"></span>
                    ${m.type !== 'core' ? `<label class="switch"><input type="checkbox" ${m.status !== 'disabled' ? 'checked' : ''} data-mod-toggle="${m.id}"><span class="slider"></span></label>` : ''}
                </div>
            </div>
        `).join('');
        container.querySelectorAll('[data-mod-toggle]').forEach(cb => {
            cb.addEventListener('change', e => {
                const modId = e.target.dataset.modToggle;
                const mod = this.modules.get(modId);
                if (mod) {
                    mod.status = e.target.checked ? 'ok' : 'disabled';
                    if (mod.init && e.target.checked) try { mod.init(); } catch(e) {}
                    if (mod.destroy && !e.target.checked) try { mod.destroy(); } catch(e) {}
                    this.renderList();
                    Toast.success(`${mod.name} 已${e.target.checked ? '启用' : '停用'}`);
                }
            });
        });
        const subtitle = document.getElementById('moduleSubtitle');
        if (subtitle) subtitle.textContent = `系统模块 v${this.systemVersion} · ${mods.length} 个模块`;
    },

    renderHealth() {
        const grid = document.getElementById('healthGrid');
        if (!grid) return;
        const h = this.getHealth();
        const uptimeStr = h.uptime > 60000 ? Math.floor(h.uptime / 60000) + '分钟' : Math.floor(h.uptime / 1000) + '秒';
        grid.innerHTML = `
            <div class="health-item"><div class="health-value" style="color:var(--success);">${h.ok}</div><div class="health-label">正常模块</div></div>
            <div class="health-item"><div class="health-value" style="color:var(--warning);">${h.warn}</div><div class="health-label">告警模块</div></div>
            <div class="health-item"><div class="health-value" style="color:var(--danger);">${h.error}</div><div class="health-label">异常模块</div></div>
            <div class="health-item"><div class="health-value">${uptimeStr}</div><div class="health-label">运行时间</div></div>
        `;
    }
};

// ==================== Security Sandbox ====================
const SecuritySandbox = {
    dangerousPatterns: [
        { pattern: /eval\s*\(/, name: 'eval执行', severity: 'high', action: 'block' },
        { pattern: /new\s+Function\s*\(/, name: '动态函数构造', severity: 'high', action: 'block' },
        { pattern: /document\.cookie/, name: 'Cookie访问', severity: 'high', action: 'block' },
        { pattern: /localStorage\.(setItem|removeItem|clear)/, name: '存储写入', severity: 'medium', action: 'warn' },
        { pattern: /fetch\s*\(/, name: '网络请求(fetch)', severity: 'high', action: 'block' },
        { pattern: /XMLHttpRequest/, name: '网络请求(XHR)', severity: 'high', action: 'block' },
        { pattern: /\.innerHTML\s*=/, name: 'innerHTML注入', severity: 'medium', action: 'warn' },
        { pattern: /document\.write/, name: 'document.write', severity: 'high', action: 'block' },
        { pattern: /window\.location/, name: '页面跳转', severity: 'high', action: 'block' },
        { pattern: /navigator\.geolocation/, name: '地理位置', severity: 'high', action: 'block' },
        { pattern: /navigator\.mediaDevices/, name: '媒体设备', severity: 'high', action: 'block' },
        { pattern: /Notification\s*\(/, name: '系统通知', severity: 'low', action: 'allow' },
        { pattern: /alert\s*\(/, name: '弹窗(alert)', severity: 'low', action: 'allow' },
        { pattern: /confirm\s*\(/, name: '确认框', severity: 'low', action: 'allow' },
    ],

    permissions: {
        'core.read': { name: '读取核心数据', risk: 'low' },
        'core.write': { name: '修改核心数据', risk: 'medium' },
        'ui.toast': { name: '显示提示', risk: 'low' },
        'ui.modal': { name: '显示弹窗', risk: 'low' },
        'ui.render': { name: '渲染UI', risk: 'low' },
        'data.students': { name: '访问学生数据', risk: 'medium' },
        'data.seats': { name: '修改座位', risk: 'medium' },
        'data.export': { name: '导出数据', risk: 'low' },
        'network.fetch': { name: '网络请求', risk: 'high' },
        'storage.local': { name: '本地存储', risk: 'medium' },
        'system.eval': { name: '动态执行代码', risk: 'high' },
    },

    scan(code) {
        const issues = [];
        const permissions = [];
        let riskLevel = 'safe';

        for (const { pattern, name, severity, action } of this.dangerousPatterns) {
            if (pattern.test(code)) {
                issues.push({ name, severity, action });
                if (action === 'block') {
                    if (severity === 'high') riskLevel = 'critical';
                    else if (riskLevel !== 'critical') riskLevel = 'high';
                } else if (action === 'warn') {
                    if (riskLevel === 'safe' || riskLevel === 'low') riskLevel = 'medium';
                }
            }
        }

        if (/state\./.test(code)) permissions.push('core.read');
        if (/state\.\w+\s*=/.test(code)) permissions.push('core.write');
        if (/Toast\./.test(code)) permissions.push('ui.toast');
        if (/document\./.test(code)) permissions.push('ui.render');
        if (/students/.test(code)) permissions.push('data.students');
        if (/seats/.test(code)) permissions.push('data.seats');
        if (/localStorage/.test(code)) permissions.push('storage.local');

        return {
            riskLevel,
            issues,
            permissions,
            blockedAPIs: issues.filter(i => i.action === 'block').map(i => i.name),
            warnings: issues.filter(i => i.action === 'warn').map(i => i.name),
            safe: issues.length === 0 || issues.every(i => i.action === 'allow')
        };
    },

    createSandbox(code, report) {
        let safeCode = code;
        for (const issue of report.issues) {
            if (issue.action === 'block') {
                safeCode = safeCode.replace(
                    /eval\s*\(/g, '(function(){console.warn("[Security] eval blocked");return null;})('
                );
            }
        }

        return function(pluginContext) {
            const safeConsole = { log: console.log, warn: console.warn, error: console.error };
            const safePluginManager = { register: (n, p) => PluginManager.register(n, p) };
            const safeState = new Proxy(state, {
                get(target, prop) {
                    if (prop === 'plugins' || prop === 'history') return JSON.parse(JSON.stringify(target[prop]));
                    return target[prop];
                }
            });
            const safeToast = {
                success: (m) => Toast.success(m),
                error: (m) => Toast.error(m),
                warning: (m) => Toast.warning(m),
                info: (m) => Toast.info(m)
            };
            const safeAddLog = (icon, text) => addLog(icon, text);
            try {
                const fn = new Function('PluginManager', 'console', 'state', 'Toast', 'addLog', safeCode);
                fn(safePluginManager, safeConsole, safeState, safeToast, safeAddLog);
            } catch(err) {
                console.error('Plugin sandbox execution error:', err);
                throw err;
            }
        };
    },

    renderReport() {
        const container = document.getElementById('securityReport');
        if (!container) return;
        const plugins = Object.entries(state.plugins);
        if (plugins.length === 0) {
            container.innerHTML = '<p style="color:var(--text-tertiary);font-size:12px;text-align:center;padding:12px;">暂无已安装插件</p>';
            return;
        }
        container.innerHTML = plugins.map(([name, plugin]) => {
            const statusIcon = plugin.securityStatus === 'ok' ? '✅' : plugin.securityStatus === 'risk' ? '⚠️' : '❓';
            const statusText = plugin.securityStatus === 'ok' ? '安全' : plugin.securityStatus === 'risk' ? '风险' : '未检测';
            const statusClass = plugin.securityStatus === 'ok' ? 'pass' : plugin.securityStatus === 'risk' ? 'warn' : '';
            return `
                <div class="security-item">
                    <span class="security-icon ${statusClass}">${statusIcon}</span>
                    <span style="flex:1;font-weight:600;">${escapeHtml(plugin.name)}</span>
                    <span style="font-size:10px;color:var(--text-tertiary);">v${escapeHtml(plugin.version || '?')}</span>
                    <span class="permission-tag ${plugin.securityStatus === 'risk' ? 'risk' : 'allowed'}">${statusText}</span>
                </div>
                ${plugin.securityReport ? `
                    <div style="padding:4px 0 8px 24px;font-size:11px;color:var(--text-secondary);">
                        ${plugin.securityReport.blockedAPIs?.length ? `<div>🚫 禁用: ${escapeHtml(plugin.securityReport.blockedAPIs.join(', '))}</div>` : ''}
                        ${plugin.securityReport.warnings?.length ? `<div>⚠️ 警告: ${escapeHtml(plugin.securityReport.warnings.join(', '))}</div>` : ''}
                    </div>
                ` : ''}
            `;
        }).join('');
    }
};

// ==================== Theme Repository ====================
const ThemeRepository = {
    themes: [
        {
            id: 'default', name: '默认蓝', description: '经典蓝色主题',
            vars: { '--primary':'#007AFF', '--primary-light':'#5AC8FA', '--primary-dark':'#0051D5', '--danger':'#FF3B30', '--success':'#34C759', '--warning':'#FF9500', '--info':'#AF52DE' },
            preview: 'linear-gradient(135deg,#007AFF,#5AC8FA)'
        },
        {
            id: 'ocean', name: '深海蓝', description: '沉稳深邃的海洋色系',
            vars: { '--primary':'#0A84FF', '--primary-light':'#409CFF', '--primary-dark':'#0060CC', '--danger':'#FF453A', '--success':'#30D158', '--warning':'#FF9F0A', '--info':'#BF5AF2' },
            preview: 'linear-gradient(135deg,#0A84FF,#0060CC)'
        },
        {
            id: 'forest', name: '森林绿', description: '清新自然的绿色主题',
            vars: { '--primary':'#34C759', '--primary-light':'#5AC8FA', '--primary-dark':'#248A3D', '--danger':'#FF3B30', '--success':'#30D158', '--warning':'#FF9500', '--info':'#AF52DE' },
            preview: 'linear-gradient(135deg,#34C759,#248A3D)'
        },
        {
            id: 'sunset', name: '日落橙', description: '温暖活力的橙色主题',
            vars: { '--primary':'#FF6B35', '--primary-light':'#FF8F5E', '--primary-dark':'#E05520', '--danger':'#FF3B30', '--success':'#34C759', '--warning':'#FFB340', '--info':'#AF52DE' },
            preview: 'linear-gradient(135deg,#FF6B35,#FFB340)'
        },
        {
            id: 'purple', name: '星空紫', description: '优雅神秘的紫色主题',
            vars: { '--primary':'#AF52DE', '--primary-light':'#BF69E8', '--primary-dark':'#8B3CB0', '--danger':'#FF3B30', '--success':'#34C759', '--warning':'#FF9500', '--info':'#5856D6' },
            preview: 'linear-gradient(135deg,#AF52DE,#5856D6)'
        },
        {
            id: 'minimal', name: '极简灰', description: '低饱和度的极简风格',
            vars: { '--primary':'#636366', '--primary-light':'#8E8E93', '--primary-dark':'#48484A', '--danger':'#FF3B30', '--success':'#34C759', '--warning':'#FF9500', '--info':'#AF52DE' },
            preview: 'linear-gradient(135deg,#636366,#8E8E93)'
        }
    ],

    currentTheme: 'default',

    apply(id) {
        const theme = this.themes.find(t => t.id === id);
        if (!theme) return;
        Object.entries(theme.vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
        this.currentTheme = id;
        state.settings.themeId = id;
        this.renderList();
    },

    renderList() {
        const container = document.getElementById('themeRepoList');
        if (!container) return;
        container.innerHTML = this.themes.map(t => `
            <div class="theme-card ${t.id === this.currentTheme ? 'active' : ''}" data-theme-id="${t.id}">
                <div class="theme-card-preview" style="background:${t.preview};"></div>
                <div class="theme-card-name">${t.name}</div>
                <div class="theme-card-desc">${t.description}</div>
            </div>
        `).join('');
        container.querySelectorAll('.theme-card').forEach(card => {
            card.addEventListener('click', () => this.apply(card.dataset.themeId));
        });
    },

    exportTheme() {
        const computed = getComputedStyle(document.documentElement);
        const vars = {};
        ['--primary','--primary-light','--primary-dark','--danger','--success','--warning','--info',
         '--text-primary','--text-secondary','--bg-primary','--bg-secondary','--bg-tertiary',
         '--radius-sm','--radius-md','--radius-lg','--font-sans'].forEach(v => {
            vars[v] = computed.getPropertyValue(v).trim();
        });
        const blob = new Blob([JSON.stringify({ name: '自定义主题', vars, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = `主题_${Date.now()}.json`;
        link.href = URL.createObjectURL(blob); link.click();
        Toast.success('主题已导出');
    },

    importTheme(json) {
        try {
            const data = JSON.parse(json);
            if (!data.vars) throw new Error('无效主题文件');
            Object.entries(data.vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
            Toast.success(`主题 "${data.name || '自定义'}" 已应用`);
        } catch(e) { Toast.error('主题导入失败: ' + e.message); }
    }
};
