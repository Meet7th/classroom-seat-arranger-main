// ==================== UI ====================
const UI = {
    _seatAbort: null,
    longPressTimer: null,
    _closeMenuFn: null,

    /** Get the DOM element for any seat (normal, platform-left, platform-right) */
    getSeatElement(seat) {
        if (seat.type === 'normal') return seat.element;
        return document.getElementById(seat.type === 'platform-left' ? 'platformLeft' : 'platformRight');
    },
    _autoDrawInterval: null,
    _autoDrawRunning: false,

    init() {
        this.renderClassroom();
        this.bindEvents();
        this.updateStats();
        this.applyGlobalSettings();
        PluginManager.renderPluginsList();
        this.updateEmptyState();
        this.renderPool();
        this.updateViewModeUI();
        UndoManager.updateButtons();
        makeDraggable(document.getElementById('probabilityPanel'));
        makeDraggable(document.getElementById('recommendPanel'));
        makeDraggable(document.getElementById('sidePanel'));
        // Initialize smart search for blacklist/whitelist
        this.blacklistSearch = new SmartSearch({ inputId: 'blacklistSearch', dropdownId: 'blacklistDropdown', textareaId: 'blacklist', listKey: 'blacklist' });
        this.whitelistSearch = new SmartSearch({ inputId: 'whitelistSearch', dropdownId: 'whitelistDropdown', textareaId: 'whitelist', listKey: 'whitelist' });
        // Initialize subject tabs and heatmap subject select
        this.renderSubjectTabs();
        this.updateHeatmapSubjectSelect();
    },

    // ==================== Render Classroom ====================
    renderClassroom() {
        const pL = document.getElementById('platformLeft');
        const pR = document.getElementById('platformRight');
        pL.style.display = state.showPlatformLeft ? 'flex' : 'none';
        pR.style.display = state.showPlatformRight ? 'flex' : 'none';
        pL.classList.toggle('disabled', state.platformLeft.disabled);
        pR.classList.toggle('disabled', state.platformRight.disabled);

        // Column headers
        const colHeaders = document.getElementById('columnHeaders');
        colHeaders.innerHTML = '';
        colHeaders.style.gridTemplateColumns = `repeat(${state.cols}, 1fr)`;
        for (let col = 0; col < state.cols; col++) {
            const ch = document.createElement('div');
            ch.className = 'column-header';
            ch.textContent = col + 1;
            ch.dataset.col = col;
            ch.addEventListener('contextmenu', e => { e.preventDefault(); this.showColumnContextMenu(e, col); });
            ch.addEventListener('touchstart', e => {
                this.longPressTimer = setTimeout(() => { e.preventDefault(); this.showColumnContextMenu(e.touches[0], col); }, 500);
            }, { passive: false });
            ch.addEventListener('touchend', () => clearTimeout(this.longPressTimer));
            ch.addEventListener('touchmove', () => clearTimeout(this.longPressTimer));
            colHeaders.appendChild(ch);
        }

        // Seats grid
        const grid = document.getElementById('seatsGrid');
        grid.innerHTML = '';
        grid.style.gridTemplateColumns = `repeat(${state.cols}, 1fr)`;
        state.seats = [];
        const totalSeats = state.rows * state.cols;
        const randomNumbers = this.generateUniqueRandomNumbers(totalSeats);
        for (let row = 0; row < state.rows; row++) {
            for (let col = 0; col < state.cols; col++) {
                const seatEl = document.createElement('div');
                seatEl.className = 'seat';
                seatEl.dataset.row = row;
                seatEl.dataset.col = col;
                let seatNumber;
                if (state.settings.numberingMode === 'horizontal-snake') {
                    seatNumber = row % 2 === 0 ? row * state.cols + col + 1 : (row + 1) * state.cols - col;
                } else if (state.settings.numberingMode === 'vertical-snake') {
                    seatNumber = col % 2 === 0 ? col * state.rows + row + 1 : (col + 1) * state.rows - row;
                } else {
                    seatNumber = randomNumbers[row * state.cols + col];
                }
                seatEl.innerHTML = `<span class="seat-number">${seatNumber}</span><span class="seat-name" style="font-size:${state.settings.seatFontSize}px;"></span><span class="seat-gender"></span><div class="heatmap-overlay"></div>`;
                grid.appendChild(seatEl);
                state.seats.push({ element: seatEl, number: seatNumber, row, col, disabled: false, student: null, type: 'normal' });
            }
        }
        this.generateDrawOrder();
        this.checkAisles();
        this.bindSeatEvents();
        this.updateEmptyState();
        if (state.heatmapVisible) this.renderHeatmap();
        this.animateSeatsIn();
    },

    generateUniqueRandomNumbers(n) {
        const numbers = Array.from({ length: n }, (_, i) => i + 1);
        for (let i = numbers.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
        }
        return numbers;
    },

    generateDrawOrder() {
        state.drawOrder = [];
        if (!state.platformRight.disabled && state.showPlatformRight) state.drawOrder.push(state.platformRight);
        if (!state.platformLeft.disabled && state.showPlatformLeft) state.drawOrder.push(state.platformLeft);
        state.drawOrder.push(...[...state.seats].filter(s => !s.disabled).sort((a, b) => a.number - b.number));
    },

    // [FIX] Aisles no longer clear seat HTML
    checkAisles() {
        for (let col = 0; col < state.cols; col++) {
            let allDisabled = true;
            for (let row = 0; row < state.rows; row++) {
                if (!state.seats[row * state.cols + col].disabled) { allDisabled = false; break; }
            }
            for (let row = 0; row < state.rows; row++) {
                const s = state.seats[row * state.cols + col];
                s.element.classList.toggle('aisle', allDisabled);
            }
        }
    },

    updateEmptyState() {
        const es = document.getElementById('emptyState');
        const cl = document.getElementById('classroom');
        if (state.students.length === 0) { es.style.display = 'block'; cl.style.display = 'none'; }
        else { es.style.display = 'none'; cl.style.display = 'flex'; }
    },

    // [FIX] Unified seat event binding
    bindSeatEvents() {
        if (this._seatAbort) this._seatAbort.abort();
        this._seatAbort = new AbortController();
        const sig = this._seatAbort.signal;

        const bindSeat = (seat, el) => {
            el.draggable = state.settings.enableDragDrop;
            el.addEventListener('click', e => {
                if (state.batchMode) { this.toggleBatchSeat(seat); return; }
                if (state.swapMode && state.selectedSeat) {
                    if (state.selectedSeat !== seat && !seat.disabled) {
                        this.doSwap(state.selectedSeat, seat);
                    }
                    return;
                }
                // Pool click-to-place
                if (state.selectedPoolStudent !== null && !seat.student && !seat.disabled) {
                    const student = state.remainingStudents.find(s => s.id === state.selectedPoolStudent);
                    if (student) {
                        state.remainingStudents = state.remainingStudents.filter(s => s.id !== student.id);
                        state.drawnStudents.push(student);
                        seat.student = student;
                        this.updateSeatDisplay(seat);
                        this.updateStats();
                        this.updateProbabilityPanel();
                        this.renderPool();
                        state.selectedPoolStudent = null;
                        document.querySelectorAll('.seat').forEach(s => s.classList.remove('pool-target'));
                        addLog('🎯', `${student.name} 被点击分配到 ${seat.type === 'normal' ? seat.number + '号' : '讲台'}`);
                        Toast.success(`${student.name} 已分配到 ${seat.type === 'normal' ? seat.number + '号座位' : '讲台座位'}`);
                        return;
                    }
                }
                if (state.settings.enableClickSwap && seat.student) this.handleSeatClick(seat);
                else if (seat.student) this.toggleLunch(seat);
            }, { signal: sig });
            el.addEventListener('contextmenu', e => { e.preventDefault(); this.showContextMenu(e, seat); }, { signal: sig });
            // Long press
            let tts = 0, tsx = 0, tsy = 0;
            el.addEventListener('touchstart', e => {
                tts = Date.now(); tsx = e.touches[0].clientX; tsy = e.touches[0].clientY;
                this.longPressTimer = setTimeout(() => { e.preventDefault(); this.showContextMenu(e.touches[0], seat); }, 500);
            }, { passive: false, signal: sig });
            el.addEventListener('touchend', e => {
                clearTimeout(this.longPressTimer);
                if (!e.changedTouches || e.changedTouches.length === 0) return;
                const dur = Date.now() - tts;
                const dist = Math.hypot(e.changedTouches[0].clientX - tsx, e.changedTouches[0].clientY - tsy);
                if (dur < 300 && dist < 10) {
                    if (state.batchMode) { this.toggleBatchSeat(seat); return; }
                    if (state.swapMode && state.selectedSeat) {
                        if (state.selectedSeat !== seat && !seat.disabled) this.doSwap(state.selectedSeat, seat);
                        return;
                    }
                    if (state.settings.enableClickSwap && seat.student) this.handleSeatClick(seat);
                    else if (seat.student) this.toggleLunch(seat);
                }
            }, { signal: sig });
            el.addEventListener('touchmove', () => clearTimeout(this.longPressTimer), { signal: sig });
            // Drag & Drop
            if (state.settings.enableDragDrop) {
                el.addEventListener('dragstart', e => {
                    clearTimeout(this.longPressTimer); // [FIX #13] Cancel long press on drag
                    if (!seat.student) { e.preventDefault(); return; }
                    e.dataTransfer.setData('text/plain', JSON.stringify({ type: seat.type, index: seat.type === 'normal' ? state.seats.indexOf(seat) : seat.type }));
                    el.classList.add('dragging');
                }, { signal: sig });
                el.addEventListener('dragend', () => { el.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over')); }, { signal: sig });
                el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); }, { signal: sig });
                el.addEventListener('dragleave', () => el.classList.remove('drag-over'), { signal: sig });
                el.addEventListener('drop', e => {
                    e.preventDefault(); el.classList.remove('drag-over');
                    try {
                        const src = JSON.parse(e.dataTransfer.getData('text/plain'));
                        const tgt = { type: seat.type, index: seat.type === 'normal' ? state.seats.indexOf(seat) : seat.type };
                        this.handleDrop(src, tgt);
                    } catch(err) { console.error('拖拽数据解析失败', err); }
                }, { signal: sig });
            }
            // Pool drop target
            el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/pool-student')) e.preventDefault(); }, { signal: sig });
            el.addEventListener('drop', e => {
                if (e.dataTransfer.types.includes('text/pool-student')) {
                    e.preventDefault();
                    try {
                        const data = JSON.parse(e.dataTransfer.getData('text/pool-student'));
                        const student = state.remainingStudents.find(s => s.id === data.id);
                        if (student && !seat.student && !seat.disabled) {
                            // Remove from remaining, assign to seat
                            state.remainingStudents = state.remainingStudents.filter(s => s.id !== student.id);
                            state.drawnStudents.push(student);
                            seat.student = student;
                            this.updateSeatDisplay(seat);
                            this.updateStats();
                            this.updateProbabilityPanel();
                            this.renderPool();
                            addLog('🎯', `${student.name} 被拖拽分配到 ${seat.type === 'normal' ? seat.number + '号' : '讲台'}`);
                            Toast.success(`${student.name} 已分配到 ${seat.type === 'normal' ? seat.number + '号座位' : '讲台座位'}`);
                        }
                    } catch(err) {}
                }
            }, { signal: sig });
        };

        // Bind normal seats
        state.seats.forEach((seat, idx) => bindSeat(seat, seat.element));
        // Bind platform seats
        [state.platformLeft, state.platformRight].forEach(seat => {
            const el = this.getSeatElement(seat);
            seat.element = el;
            bindSeat(seat, el);
        });
    },

    // ==================== Seat Operations ====================
    handleSeatClick(seat) {
        if (state.swapMode) return; // handled in click listener now
        if (state.selectedSeat === seat) this.clearSelection();
        else { this.clearSelection(); state.selectedSeat = seat; seat.element.classList.add('selected'); }
    },

    doSwap(s1, s2) {
        const desc = `${this.seatLabel(s1)} ↔ ${this.seatLabel(s2)}`;
        const oldS1 = s1.student, oldS2 = s2.student;
        UndoManager.push({
            desc: '互换: ' + desc,
            undo: () => { s1.student = oldS1; s2.student = oldS2; this.updateSeatDisplay(s1); this.updateSeatDisplay(s2); },
            redo: () => { s1.student = oldS2; s2.student = oldS1; this.updateSeatDisplay(s1); this.updateSeatDisplay(s2); }
        });
        this.swapSeats(s1, s2);
        this.clearSelection();
        this.updateProbabilityPanel();
        Toast.success('座位互换成功');
        addLog('🔄', '互换: ' + desc);
    },

    swapSeats(s1, s2) {
        const temp = s1.student; s1.student = s2.student; s2.student = temp;
        this.updateSeatDisplay(s1); this.updateSeatDisplay(s2);
    },

    updateSeatDisplay(seat) {
        const el = this.getSeatElement(seat);
        if (!el) return;
        el.className = seat.type === 'normal' ? 'seat' : 'platform-side-seat';
        if (seat.disabled) { el.classList.add('disabled'); this.clearSeatName(el); return; }
        if (seat.student) {
            el.classList.add(seat.student.gender);
            if (seat.student.pinned) el.classList.add('pinned');
            const nameEl = el.querySelector('.seat-name');
            if (nameEl) {
                nameEl.textContent = seat.student.name;
                nameEl.style.fontSize = `${state.settings.seatFontSize}px`;
                if (seat.student.lunch) {
                    nameEl.classList.add('lunch-underline');
                    nameEl.style.textDecorationColor = state.settings.lunchUnderlineColor;
                } else {
                    nameEl.classList.remove('lunch-underline');
                    nameEl.style.textDecorationColor = '';
                }
            }
            if (seat.type === 'normal') {
                const gEl = el.querySelector('.seat-gender');
                if (gEl) gEl.textContent = seat.student.gender === 'male' ? '男' : '女';
            }
            // [FIX] No-score visual indicator
            if (seat.student.score === null || seat.student.score === undefined) {
                el.classList.add('no-score');
            } else {
                el.classList.remove('no-score');
            }
        } else {
            this.clearSeatName(el);
            el.classList.remove('no-score');
        }
        // Heatmap overlay (uses overlay div, not background)
        const overlay = el.querySelector('.heatmap-overlay');
        if (overlay) {
            if (state.heatmapVisible && seat.student && seat.student.score !== undefined && seat.student.score !== null) {
                overlay.style.background = this.getHeatmapColor(seat.student.score, 0.3);
            } else {
                overlay.style.background = 'transparent';
            }
        }
    },

    clearSeatName(el) {
        const nameEl = el.querySelector('.seat-name');
        if (nameEl) { nameEl.textContent = ''; nameEl.classList.remove('lunch-underline'); nameEl.style.textDecorationColor = ''; }
        const gEl = el.querySelector('.seat-gender');
        if (gEl) gEl.textContent = '';
        const overlay = el.querySelector('.heatmap-overlay');
        if (overlay) overlay.style.background = 'transparent';
        el.classList.remove('pinned');
    },

    clearSelection() {
        if (state.selectedSeat && state.selectedSeat.element) state.selectedSeat.element.classList.remove('selected');
        state.selectedSeat = null; state.swapMode = false;
    },

    toggleLunch(seat) {
        if (!seat.student) return;
        const old = seat.student.lunch;
        seat.student.lunch = !seat.student.lunch;
        UndoManager.push({
            desc: `${seat.student.name} ${old ? '取消' : '标记'}午休`,
            undo: () => { seat.student.lunch = old; this.updateSeatDisplay(seat); this.updateStats(); this.renderPool(); },
            redo: () => { seat.student.lunch = !old; this.updateSeatDisplay(seat); this.updateStats(); this.renderPool(); }
        });
        this.updateSeatDisplay(seat); this.updateStats(); this.renderPool(); this.updateProbabilityPanel();
        Toast.success(`${seat.student.name} 已${seat.student.lunch ? '标记' : '取消'}午休`);
        addLog('💤', `${seat.student.name} ${seat.student.lunch ? '标记' : '取消'}午休`);
    },

    clearSeat(seat) {
        if (!seat.student) return;
        const student = seat.student;
        const seatLabel = this.seatLabel(seat);
        state.remainingStudents.push(student);
        state.drawnStudents = state.drawnStudents.filter(s => s.id !== student.id);
        seat.student = null;
        UndoManager.push({
            desc: `${student.name} 移至待选区`,
            undo: () => {
                state.remainingStudents = state.remainingStudents.filter(s => s.id !== student.id);
                state.drawnStudents.push(student);
                seat.student = student;
                this.updateSeatDisplay(seat); this.updateStats(); this.updateProbabilityPanel(); this.renderPool();
            },
            redo: () => {
                state.remainingStudents.push(student);
                state.drawnStudents = state.drawnStudents.filter(s => s.id !== student.id);
                seat.student = null;
                this.updateSeatDisplay(seat); this.updateStats(); this.updateProbabilityPanel(); this.renderPool();
            }
        });
        this.updateSeatDisplay(seat); this.updateStats(); this.updateProbabilityPanel(); this.renderPool();
        Toast.success(`${student.name} 已移至待选区`);
        addLog('↩️', `${student.name} 从 ${seatLabel} 移至待选区`);
    },

    disableSeat(seat) {
        if (seat.student) { Toast.warning('请先清空该座位再禁用'); return; }
        seat.disabled = true;
        UndoManager.push({
            desc: `禁用座位 ${this.seatLabel(seat)}`,
            undo: () => { seat.disabled = false; seat.element.classList.remove('aisle'); this.updateSeatDisplay(seat); this.generateDrawOrder(); this.checkAisles(); },
            redo: () => { seat.disabled = true; this.updateSeatDisplay(seat); this.generateDrawOrder(); this.checkAisles(); }
        });
        this.updateSeatDisplay(seat); this.generateDrawOrder(); this.checkAisles(); this.updateProbabilityPanel();
        Toast.success('座位已禁用'); addLog('🚫', `禁用座位 ${this.seatLabel(seat)}`);
    },

    enableSeat(seat) {
        seat.disabled = false;
        UndoManager.push({
            desc: `启用座位 ${this.seatLabel(seat)}`,
            undo: () => { seat.disabled = true; this.updateSeatDisplay(seat); this.generateDrawOrder(); this.checkAisles(); },
            redo: () => { seat.disabled = false; seat.element.classList.remove('aisle'); this.updateSeatDisplay(seat); this.generateDrawOrder(); this.checkAisles(); }
        });
        seat.element.classList.remove('aisle');
        this.updateSeatDisplay(seat); this.generateDrawOrder(); this.checkAisles(); this.updateProbabilityPanel();
        Toast.success('座位已启用'); addLog('✅', `启用座位 ${this.seatLabel(seat)}`);
    },

    disableColumn(col) {
        const clearedStudents = [];
        for (let row = 0; row < state.rows; row++) {
            const s = state.seats[row * state.cols + col];
            if (s.student) { clearedStudents.push({ seat: s, student: s.student }); this.clearSeat(s); }
            s.disabled = true; this.updateSeatDisplay(s);
        }
        UndoManager.push({
            desc: `禁用第 ${col + 1} 列`,
            undo: () => {
                for (let row = 0; row < state.rows; row++) {
                    const s = state.seats[row * state.cols + col];
                    s.disabled = false; s.element.classList.remove('aisle'); this.updateSeatDisplay(s);
                }
                clearedStudents.forEach(({ seat, student }) => {
                    state.remainingStudents = state.remainingStudents.filter(s => s.id !== student.id);
                    state.drawnStudents.push(student);
                    seat.student = student;
                    this.updateSeatDisplay(seat);
                });
                this.generateDrawOrder(); this.checkAisles(); this.updateStats(); this.renderPool();
            },
            redo: () => {
                for (let row = 0; row < state.rows; row++) {
                    const s = state.seats[row * state.cols + col];
                    if (s.student) this.clearSeat(s);
                    s.disabled = true; this.updateSeatDisplay(s);
                }
                this.generateDrawOrder(); this.checkAisles();
            }
        });
        this.generateDrawOrder(); this.checkAisles();
        Toast.success(`第 ${col + 1} 列已禁用`); addLog('🚫', `禁用第 ${col + 1} 列`);
    },

    enableColumn(col) {
        for (let row = 0; row < state.rows; row++) {
            const s = state.seats[row * state.cols + col];
            s.disabled = false; s.element.classList.remove('aisle'); this.updateSeatDisplay(s);
        }
        UndoManager.push({
            desc: `启用第 ${col + 1} 列`,
            undo: () => {
                for (let row = 0; row < state.rows; row++) {
                    const s = state.seats[row * state.cols + col];
                    if (s.student) this.clearSeat(s);
                    s.disabled = true; this.updateSeatDisplay(s);
                }
                this.generateDrawOrder(); this.checkAisles();
            },
            redo: () => {
                for (let row = 0; row < state.rows; row++) {
                    const s = state.seats[row * state.cols + col];
                    s.disabled = false; s.element.classList.remove('aisle'); this.updateSeatDisplay(s);
                }
                this.generateDrawOrder(); this.checkAisles();
            }
        });
        this.generateDrawOrder(); this.checkAisles();
        Toast.success(`第 ${col + 1} 列已启用`); addLog('✅', `启用第 ${col + 1} 列`);
    },

    seatLabel(seat) {
        if (seat.type === 'platform-left') return '讲台左';
        if (seat.type === 'platform-right') return '讲台右';
        return seat.number + '号';
    },

    // ==================== Batch Mode ====================
    toggleBatchSeat(seat) {
        const idx = state.batchSeats.indexOf(seat);
        if (idx >= 0) { state.batchSeats.splice(idx, 1); seat.element.classList.remove('selected'); }
        else { state.batchSeats.push(seat); seat.element.classList.add('selected'); }
        document.getElementById('batchCount').textContent = state.batchSeats.length;
    },

    enterBatchMode() {
        state.batchMode = true; state.batchSeats = [];
        document.getElementById('batchToolbar').classList.add('visible');
        document.getElementById('quickInfo').style.display = 'none';
        document.getElementById('batchCount').textContent = '0';
    },

    exitBatchMode() {
        state.batchMode = false;
        state.batchSeats.forEach(s => s.element.classList.remove('selected'));
        state.batchSeats = [];
        document.getElementById('batchToolbar').classList.remove('visible');
        document.getElementById('quickInfo').style.display = '';
    },

    // ==================== Context Menus ====================
    showContextMenu(e, seat) {
        // Close the other menu if open
        const colMenu = document.getElementById('columnContextMenu');
        if (colMenu) colMenu.style.display = 'none';
        const menu = document.getElementById('seatContextMenu');
        const menuW = 200, menuH = 320;
        let x = e.clientX || e.pageX, y = e.clientY || e.pageY;
        if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 8;
        if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 8;
        if (x < 8) x = 8; if (y < 8) y = 8;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.style.display = 'block';
        menu.dataset.seatType = seat.type;
        menu.dataset.seatIndex = seat.type === 'normal' ? state.seats.indexOf(seat) : '';
        menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.style.display = 'block';
            const a = item.dataset.action;
            if (!seat.student && ['swap','moveToPool','toggleLunch','clearSeat','togglePin','viewInfo'].includes(a)) item.style.display = 'none';
            if (a === 'enableSeat') item.style.display = seat.disabled ? 'block' : 'none';
            if (a === 'disableSeat') item.style.display = seat.disabled ? 'none' : 'block';
            if (a === 'togglePin' && seat.student) item.textContent = seat.student.pinned ? '📌 取消固定' : '📌 固定学生';
        });
        if (this._closeMenuFn) document.removeEventListener('click', this._closeMenuFn);
        this._closeMenuFn = () => { menu.style.display = 'none'; document.removeEventListener('click', this._closeMenuFn); };
        setTimeout(() => document.addEventListener('click', this._closeMenuFn), 0);
    },

    showColumnContextMenu(e, col) {
        // Close the other menu if open
        const seatMenu = document.getElementById('seatContextMenu');
        if (seatMenu) seatMenu.style.display = 'none';
        const menu = document.getElementById('columnContextMenu');
        let x = e.clientX || e.pageX, y = e.clientY || e.pageY;
        if (x + 200 > window.innerWidth) x = window.innerWidth - 208;
        if (y + 100 > window.innerHeight) y = window.innerHeight - 108;
        if (x < 8) x = 8; if (y < 8) y = 8;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.style.display = 'block';
        menu.dataset.col = col;
        let allDisabled = true;
        for (let row = 0; row < state.rows; row++) { if (!state.seats[row * state.cols + col].disabled) { allDisabled = false; break; } }
        menu.querySelector('[data-action="disableColumn"]').style.display = allDisabled ? 'none' : 'block';
        menu.querySelector('[data-action="enableColumn"]').style.display = allDisabled ? 'block' : 'none';
        if (this._closeMenuFn) document.removeEventListener('click', this._closeMenuFn);
        this._closeMenuFn = () => { menu.style.display = 'none'; document.removeEventListener('click', this._closeMenuFn); };
        setTimeout(() => document.addEventListener('click', this._closeMenuFn), 0);
    },

    handleDrop(source, target) {
        const getSeat = d => {
            if (d.type === 'normal') return state.seats[d.index];
            if (d.type === 'platform-left') return state.platformLeft;
            if (d.type === 'platform-right') return state.platformRight;
            return state[d.type];
        };
        const src = getSeat(source), tgt = getSeat(target);
        if (src && tgt && src !== tgt && !tgt.disabled && src.student) {
            this.doSwap(src, tgt);
        }
    },

    // ==================== Stats ====================
    updateStats() {
        const el = id => { const e = document.getElementById(id); return e; };
        const safe = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
        // Settings console stats
        safe('stTotal', state.students.length);
        safe('stDrawn', state.drawnStudents.length);
        safe('stRemaining', state.remainingStudents.length);
        safe('stLunch', state.drawnStudents.filter(s => s.lunch).length);
        safe('stLayout', `${state.rows}×${state.cols}`);
        safe('poolSubtitle', `${state.remainingStudents.length} 人待抽取`);
        this.updateQuickInfo();
    },

    updateProbabilityPanel() {
        const panel = document.getElementById('probabilityPanel');
        if (state.settings.drawMode !== 'predictable' || !state.settings.showProbabilityByDefault) { panel.style.display = 'none'; return; }
        panel.style.display = 'block';
        const probs = Algorithm.calculateProbabilities().slice(0, 5);
        const list = document.getElementById('probabilityContent');
        list.innerHTML = '';
        probs.forEach(item => {
            const div = document.createElement('div');
            div.className = 'probability-item';
            div.innerHTML = `<span class="probability-name">${escapeHtml(item.student.name)}</span><span class="probability-value">${(item.probability * 100).toFixed(1)}%</span>`;
            list.appendChild(div);
        });
    },

    // ==================== Fill Seat ====================
    fillSeat(student) {
        while (state.currentDrawIndex < state.drawOrder.length) {
            const seat = state.drawOrder[state.currentDrawIndex];
            if (!seat.student && !seat.disabled) {
                seat.student = student;
                this.updateSeatDisplay(seat);
                const el = this.getSeatElement(seat);
                if (el) { el.classList.add('drawing'); setTimeout(() => el.classList.remove('drawing'), state.settings.drawAnimationDuration); }
                state.currentDrawIndex++;
                Object.keys(state.plugins).forEach(pn => {
                    try { PluginManager.call(pn, 'afterDraw', student, seat); } catch(e) {}
                });
                return seat;
            }
            state.currentDrawIndex++;
        }
        return null;
    },

    // ==================== Reset ====================
    resetDraw() {
        this.stopAutoDraw();
        state.pendingDrawSequence = null; // Clear any imported draw sequence
        const prevDrawn = [...state.drawnStudents];
        const prevSeats = state.seats.map(s => ({ student: s.student, disabled: s.disabled }));
        const prevPL = state.platformLeft.student;
        const prevPR = state.platformRight.student;
        const prevDrawIdx = state.currentDrawIndex;
        UndoManager.push({
            desc: '重置抽取',
            undo: () => {
                state.drawnStudents = prevDrawn;
                state.remainingStudents = state.students.filter(s => !prevDrawn.some(d => d.id === s.id));
                prevSeats.forEach((sv, i) => { if (state.seats[i]) { state.seats[i].student = sv.student; this.updateSeatDisplay(state.seats[i]); } });
                state.platformLeft.student = prevPL; state.platformRight.student = prevPR;
                this.updateSeatDisplay(state.platformLeft); this.updateSeatDisplay(state.platformRight);
                state.currentDrawIndex = prevDrawIdx;
                this.updateStats(); this.updateProbabilityPanel(); this.renderPool();
            },
            redo: () => {
                state.drawnStudents = [];
                state.remainingStudents = [...state.students];
                state.currentDrawIndex = 0;
                state.platformLeft.student = null; state.platformRight.student = null;
                this.updateSeatDisplay(state.platformLeft); this.updateSeatDisplay(state.platformRight);
                state.seats.forEach(seat => { seat.student = null; this.updateSeatDisplay(seat); });
                this.updateStats(); this.updateProbabilityPanel(); this.updateEmptyState(); this.renderPool();
            }
        });
        state.drawnStudents = [];
        state.remainingStudents = [...state.students];
        state.currentDrawIndex = 0;
        state.platformLeft.student = null; state.platformRight.student = null;
        this.updateSeatDisplay(state.platformLeft); this.updateSeatDisplay(state.platformRight);
        state.seats.forEach(seat => { seat.student = null; this.updateSeatDisplay(seat); });
        this.clearSelection();
        this.updateStats(); this.updateProbabilityPanel(); this.updateEmptyState(); this.renderPool();
        document.getElementById('stopAutoDraw').style.display = 'none';
        document.getElementById('autoDraw').style.display = 'inline-flex';
        Toast.success('抽取已重置');
        addLog('🔄', '抽取已重置');
    },

    // ==================== Auto Draw (Built-in, not plugin) ====================
    startAutoDraw() {
        if (this._autoDrawRunning) return;
        // Check if we have a pending draw sequence
        if (state.pendingDrawSequence && state.pendingDrawSequence.length > 0) {
            this._autoDrawRunning = true;
            document.getElementById('autoDraw').style.display = 'none';
            document.getElementById('stopAutoDraw').style.display = 'inline-flex';
            const interval = state.settings.autoDrawInterval || 800;
            this._autoDrawInterval = setInterval(() => {
                if (!state.pendingDrawSequence || state.pendingDrawSequence.length === 0) {
                    this.stopAutoDraw();
                    Toast.success('所有座位已演示完毕');
                    return;
                }
                this._doDrawNextFromSequence();
            }, interval);
            addLog('⚡', '开始自动抽取（导入序列模式）');
            return;
        }
        this._autoDrawRunning = true;
        document.getElementById('autoDraw').style.display = 'none';
        document.getElementById('stopAutoDraw').style.display = 'inline-flex';
        const interval = state.settings.autoDrawInterval || 800;
        this._autoDrawInterval = setInterval(() => {
            if (state.remainingStudents.length === 0) { this.stopAutoDraw(); Toast.success('所有学生已抽取完毕'); return; }
            this.doDrawNext();
        }, interval);
        addLog('⚡', '开始自动抽取');
    },

    stopAutoDraw() {
        this._autoDrawRunning = false;
        if (this._autoDrawInterval) { clearInterval(this._autoDrawInterval); this._autoDrawInterval = null; }
        document.getElementById('stopAutoDraw').style.display = 'none';
        document.getElementById('autoDraw').style.display = 'inline-flex';
    },

    /** Draw next seat from imported sequence (demo-style animation) */
    _doDrawNextFromSequence() {
        if (!state.pendingDrawSequence || state.pendingDrawSequence.length === 0) return null;
        const item = state.pendingDrawSequence.shift();
        const seat = item.seat;
        if (!seat) return null;

        // Assign student to seat
        seat.student = item.student;
        UI.updateSeatDisplay(seat);
        UI.updateStats(); UI.updateProbabilityPanel(); UI.renderPool();

        // Animate
        const el = this.getSeatElement(seat);
        if (el) {
            el.classList.add('drawing');
            setTimeout(() => el.classList.remove('drawing'), state.settings.drawAnimationDuration);
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Update drawnStudents and remainingStudents
        if (!state.drawnStudents.some(d => d.id === item.student.id)) {
            state.drawnStudents.push(item.student);
        }
        const remIdx = state.remainingStudents.findIndex(s => s.id === item.student.id);
        if (remIdx >= 0) state.remainingStudents.splice(remIdx, 1);

        addLog('🎲', `抽取 ${item.student.name} → ${this.seatLabel(seat)}`);

        // Clear pending sequence when done
        if (state.pendingDrawSequence.length === 0) {
            state.pendingDrawSequence = null;
            Toast.success('所有座位已演示完毕');
            this.stopAutoDraw();
        }

        return seat;
    },

    doDrawNext() {
        // If there's a pending draw sequence, use that instead
        if (state.pendingDrawSequence && state.pendingDrawSequence.length > 0) {
            return this._doDrawNextFromSequence();
        }
        if (state.remainingStudents.length === 0) { Toast.warning('所有学生已抽取完毕'); return null; }
        // Save history before draw
        Algorithm.pushHistory();
        // [FIX #5] Snapshot for undo
        const snapRemaining = [...state.remainingStudents];
        const snapDrawn = [...state.drawnStudents];
        const seatSnapshots = {};
        [...state.seats, state.platformLeft, state.platformRight].forEach(s => {
            if (s.student) seatSnapshots[s.type === 'normal' ? `s${s.number}` : s.type] = JSON.parse(JSON.stringify(s.student)); // [AUDIT-4] Deep clone
        });
        const student = Algorithm.drawStudent();
        if (!student) return null;
        const seat = this.fillSeat(student);
        if (seat) {
            state.drawnStudents.push(student);
            const drawnName = student.name;
            const seatLbl = this.seatLabel(seat);
            // Push undo action
            UndoManager.push({
                desc: `抽取 ${drawnName} → ${seatLbl}`,
                undo: () => {
                    // Restore state
                    state.remainingStudents = snapRemaining;
                    state.drawnStudents = snapDrawn;
                    // Clear the seat
                    if (seat.student) { seat.student = null; }
                    // Restore all seat students from snapshot
                    [...state.seats, state.platformLeft, state.platformRight].forEach(s => {
                        const key = s.type === 'normal' ? `s${s.number}` : s.type;
                        if (seatSnapshots[key]) s.student = seatSnapshots[key];
                        else if (s === seat) s.student = null;
                    });
                    // Restore currentDrawIndex
                    if (state.currentDrawIndex > 0) state.currentDrawIndex--;
                    this.updateSeatDisplay(seat);
                    state.seats.forEach(ss => this.updateSeatDisplay(ss));
                    this.updateSeatDisplay(state.platformLeft);
                    this.updateSeatDisplay(state.platformRight);
                    this.updateStats(); this.updateProbabilityPanel(); this.renderPool();
                },
                redo: () => {
                    // Re-assign
                    const sIdx = state.remainingStudents.findIndex(s => s.id === student.id);
                    if (sIdx >= 0) state.remainingStudents.splice(sIdx, 1);
                    seat.student = student;
                    if (!state.drawnStudents.some(d => d.id === student.id)) state.drawnStudents.push(student);
                    this.updateSeatDisplay(seat);
                    this.updateStats(); this.updateProbabilityPanel(); this.renderPool();
                }
            });
            this.updateStats(); this.updateProbabilityPanel(); this.renderPool();
            return seat;
        }
        return null;
    },

    // ==================== Heatmap (Multi-type) ====================
    getHeatmapColor(score, alpha = 1) {
        const s = clamp(score, 0, 100);
        const hue = (s / 100) * 120;
        return `hsla(${hue}, 80%, 50%, ${alpha})`;
    },

    getHeatmapScore(student) {
        if (!student) return null;
        switch (state.heatmapType) {
            case 'composite': return CompositeEval.getScore(student);
            case 'average': return CompositeEval.getAvgScore(student);
            case 'subject': {
                const subj = document.getElementById('heatmapSubjectSelect')?.value;
                return subj ? CompositeEval.getSubjectScore(student, subj) : null;
            }
            default: return student.score;
        }
    },

    renderHeatmap() {
        // [FEATURE #23] Batch heatmap updates with requestAnimationFrame
        const updates = [];
        state.seats.forEach(seat => {
            const overlay = seat.element.querySelector('.heatmap-overlay');
            if (!overlay) return;
            if (seat.student) {
                const score = this.getHeatmapScore(seat.student);
                if (score !== null && score !== undefined) {
                    updates.push({ overlay, bg: this.getHeatmapColor(score, 0.35) });
                } else {
                    updates.push({ overlay, bg: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(120,120,128,0.12) 3px, rgba(120,120,128,0.12) 6px)' });
                }
            } else {
                updates.push({ overlay, bg: 'transparent' });
            }
        });
        [state.platformLeft, state.platformRight].forEach(seat => {
            const el = this.getSeatElement(seat);
            if (!el) return;
            let overlay = el.querySelector('.heatmap-overlay');
            if (!overlay) { overlay = document.createElement('div'); overlay.className = 'heatmap-overlay'; el.appendChild(overlay); }
            if (seat.student) {
                const score = this.getHeatmapScore(seat.student);
                if (score !== null && score !== undefined) {
                    updates.push({ overlay, bg: this.getHeatmapColor(score, 0.35) });
                } else {
                    updates.push({ overlay, bg: 'repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(120,120,128,0.12) 3px, rgba(120,120,128,0.12) 6px)' });
                }
            } else {
                updates.push({ overlay, bg: 'transparent' });
            }
        });
        // Apply all updates in a single rAF batch
        requestAnimationFrame(() => {
            updates.forEach(({ overlay, bg }) => { overlay.style.background = bg; });
        });
    },

    clearHeatmap() {
        state.seats.forEach(seat => {
            const overlay = seat.element.querySelector('.heatmap-overlay');
            if (overlay) overlay.style.background = 'transparent';
            seat.element.classList.remove('no-score');
        });
        [state.platformLeft, state.platformRight].forEach(seat => {
            const el = this.getSeatElement(seat);
            if (!el) return;
            const overlay = el.querySelector('.heatmap-overlay');
            if (overlay) overlay.style.background = 'transparent';
        });
    },

    // ==================== Pin Student ====================
    togglePin(seat) {
        if (!seat.student) return;
        seat.student.pinned = !seat.student.pinned;
        seat.element.classList.toggle('pinned', seat.student.pinned);
        Toast.success(`${seat.student.name} 已${seat.student.pinned ? '固定' : '取消固定'}`);
        addLog(seat.student.pinned ? '📌' : '📍', `${seat.student.name} ${seat.student.pinned ? '固定' : '取消固定'}`);
    },

    // ==================== Student Info Popup ====================
    showStudentInfo(seat) {
        if (!seat.student) return;
        const s = seat.student;
        const modal = document.getElementById('studentDetailModal');
        document.getElementById('studentDetailName').textContent = `${s.name} 的详细信息`;

        let html = '';

        // Basic info section
        html += `<div class="detail-section"><div class="detail-section-title">👤 基本信息</div><div class="detail-grid">`;
        html += `<div class="detail-item"><span class="detail-item-label">姓名</span><span class="detail-item-value">${escapeHtml(s.name)}</span></div>`;
        html += `<div class="detail-item"><span class="detail-item-label">性别</span><span class="detail-item-value">${s.gender === 'male' ? '♂ 男' : '♀ 女'}</span></div>`;
        html += `<div class="detail-item"><span class="detail-item-label">午休</span><span class="detail-item-value">${s.lunch ? '💤 是' : '否'}</span></div>`;
        html += `<div class="detail-item"><span class="detail-item-label">座位</span><span class="detail-item-value">${this.seatLabel(seat)}</span></div>`;
        if (s.personality) html += `<div class="detail-item"><span class="detail-item-label">性格</span><span class="detail-item-value">${escapeHtml(s.personality)}</span></div>`;
        if (s.position) html += `<div class="detail-item"><span class="detail-item-label">职务</span><span class="detail-item-value">${escapeHtml(s.position)}</span></div>`;
        if (s.hobbies && s.hobbies.length > 0) html += `<div class="detail-item" style="grid-column:1/-1;"><span class="detail-item-label">爱好</span><span class="detail-item-value">${s.hobbies.map(h => escapeHtml(h)).join(' / ')}</span></div>`;
        if (s.pinned) html += `<div class="detail-item"><span class="detail-item-label">状态</span><span class="detail-item-value">📌 已固定</span></div>`;
        html += `</div></div>`;

        // Scores section
        const scores = s.scores || {};
        const scoreEntries = Object.entries(scores).filter(([k, v]) => v !== null && v !== undefined);
        if (scoreEntries.length > 0) {
            html += `<div class="detail-section"><div class="detail-section-title">📊 各科成绩</div>`;
            scoreEntries.forEach(([subj, score]) => {
                const color = score >= 90 ? 'var(--success)' : score >= 80 ? 'var(--primary)' : score >= 70 ? 'var(--warning)' : score >= 60 ? '#FF9500' : 'var(--danger)';
                html += `<div class="detail-score-bar"><span class="detail-score-label">${subj}</span><div class="detail-score-track"><div class="detail-score-fill" style="width:${score}%;background:${color};">${score}</div></div></div>`;
            });
            html += `</div>`;
        }

        // Composite evaluation section
        const compositeScore = CompositeEval.getScore(s);
        const avgScore = CompositeEval.getAvgScore(s);
        html += `<div class="detail-section"><div class="detail-section-title">🏆 综合评价</div>`;
        html += `<div class="detail-grid">`;
        html += `<div class="detail-item"><span class="detail-item-label">综合评分</span><span class="detail-item-value" style="color:var(--primary);font-size:16px;">${compositeScore}</span></div>`;
        html += `<div class="detail-item"><span class="detail-item-label">平均成绩</span><span class="detail-item-value">${avgScore ?? 'N/A'}</span></div>`;
        html += `</div>`;
        // Dimension breakdown
        const w = state.settings.weights;
        html += `<div style="margin-top:10px;">`;
        if (w.academic > 0 && avgScore !== null) html += `<div class="detail-score-bar"><span class="detail-score-label">学业</span><div class="detail-score-track"><div class="detail-score-fill" style="width:${avgScore}%;background:var(--primary);">${avgScore}</div></div></div>`;
        if (w.personality > 0 && s.personality) { const ps = s.personality === '中性' ? 80 : s.personality === '外向' ? 70 : 65; html += `<div class="detail-score-bar"><span class="detail-score-label">性格</span><div class="detail-score-track"><div class="detail-score-fill" style="width:${ps}%;background:var(--success);">${ps}</div></div></div>`; }
        if (w.hobby > 0 && s.hobbies?.length > 0) { const hs = Math.min(100, 50 + s.hobbies.length * 10); html += `<div class="detail-score-bar"><span class="detail-score-label">爱好</span><div class="detail-score-track"><div class="detail-score-fill" style="width:${hs}%;background:var(--warning);">${hs}</div></div></div>`; }
        if (w.position > 0 && s.position) { const posScores = { '班长': 95, '副班长': 90, '学习委员': 90, '体育委员': 85, '文艺委员': 85, '劳动委员': 80, '小组长': 75, '课代表': 80 }; const poss = posScores[s.position] || 60; html += `<div class="detail-score-bar"><span class="detail-score-label">职务</span><div class="detail-score-track"><div class="detail-score-fill" style="width:${poss}%;background:var(--info);">${poss}</div></div></div>`; }
        html += `</div></div>`;

        document.getElementById('studentDetailContent').innerHTML = html;
        modal.classList.add('active');

        // Close handlers
        document.getElementById('closeStudentDetail').onclick = () => modal.classList.remove('active');
        document.getElementById('closeStudentDetailBtn').onclick = () => modal.classList.remove('active');
        document.getElementById('locateStudentBtn').style.display = '';
        document.getElementById('locateStudentBtn').onclick = () => {
            modal.classList.remove('active');
            seat.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            seat.element.classList.add('selected');
            setTimeout(() => seat.element.classList.remove('selected'), 2000);
        };
        // [FIX #8] Edit button handler
        document.getElementById('editStudentBtn').style.display = '';
        document.getElementById('editStudentBtn').onclick = () => {
            const content = document.getElementById('studentDetailContent');
            const editHtml = `<div class="detail-section"><div class="detail-section-title">✏️ 编辑信息</div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">姓名</label><input class="form-input" id="editName" value="${escapeHtml(s.name)}"></div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">性别</label><select class="form-input" id="editGender"><option value="male" ${s.gender==='male'?'selected':''}>♂ 男</option><option value="female" ${s.gender==='female'?'selected':''}>♀ 女</option></select></div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">午休</label><select class="form-input" id="editLunch"><option value="true" ${s.lunch?'selected':''}>是</option><option value="false" ${!s.lunch?'selected':''}>否</option></select></div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">性格</label><input class="form-input" id="editPersonality" value="${escapeHtml(s.personality||'')}"></div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">职务</label><input class="form-input" id="editPosition" value="${escapeHtml(s.position||'')}"></div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">爱好 (逗号分隔)</label><input class="form-input" id="editHobbies" value="${escapeHtml((s.hobbies||[]).join(','))}"></div>
                <button class="btn btn-primary" id="saveEditBtn" style="margin-top:8px;">💾 保存</button>
            </div>`;
            content.innerHTML = editHtml;
            document.getElementById('editStudentBtn').style.display = 'none';
            document.getElementById('saveEditBtn').onclick = () => {
                s.name = document.getElementById('editName').value.trim() || s.name;
                s.gender = document.getElementById('editGender').value;
                s.lunch = document.getElementById('editLunch').value === 'true';
                s.personality = document.getElementById('editPersonality').value.trim() || null;
                s.position = document.getElementById('editPosition').value.trim() || null;
                const hobbiesStr = document.getElementById('editHobbies').value.trim();
                s.hobbies = hobbiesStr ? hobbiesStr.split(',').map(h => h.trim()).filter(h => h) : [];
                this.updateSeatDisplay(seat);
                this.updateStats();
                this.renderPool();
                modal.classList.remove('active');
                Toast.success('学生信息已更新');
            };
        };
    },

    // ==================== Perspective Toggle ====================
    togglePerspective() {
        const cl = document.getElementById('classroom');
        cl.classList.toggle('podium-view');
        this.updateViewModeUI();
        const isPodium = cl.classList.contains('podium-view');
        Toast.info(isPodium ? '已切换到讲台视角' : '已切换到平面视图');
        addLog(isPodium ? '🎓' : '📐', isPodium ? '切换到讲台视角' : '切换到平面视图');
        saveConfig();
    },

    /** Sync all UI elements that reflect the current view mode */
    updateViewModeUI() {
        const isPodium = document.getElementById('classroom').classList.contains('podium-view');
        // Top-left toggle button
        const btn = document.getElementById('togglePerspective');
        if (btn) btn.textContent = isPodium ? '📐 平面视图' : '🎓 讲台视角';
        // View dropdown item
        const viewItem = document.getElementById('viewTogglePerspective');
        if (viewItem) viewItem.textContent = isPodium ? '📐 平面视图' : '🎓 讲台视角';
        // More menu item
        const mmItem = document.getElementById('mmPodium');
        if (mmItem) {
            const mmIcon = mmItem.querySelector('.mmi-icon');
            if (mmIcon) mmIcon.textContent = isPodium ? '📐' : '🎓';
            const mmText = mmItem.querySelector('.mmi-text') || mmItem.lastChild;
            if (mmText) mmText.textContent = isPodium ? ' 平面' : ' 讲台';
        }
    },

    // ==================== Screenshot Preview ====================
    _previewCanvas: null,
    showPreviewModal() {
        document.getElementById('previewModal').classList.add('active');
        document.getElementById('previewFrame').innerHTML = '<p style="color:var(--text-tertiary);">点击"生成预览"查看效果</p>';
        this._previewCanvas = null;
    },
    generatePreview() {
        const frame = document.getElementById('previewFrame');
        frame.innerHTML = '<p style="color:var(--text-tertiary);">正在生成预览...</p>';
        const scale = parseInt(document.getElementById('previewScale').value) || 2;
        const includePlatform = document.getElementById('previewIncludePlatform').checked;
        const includeTitle = document.getElementById('previewIncludeTitle').checked;
        const watermark = document.getElementById('previewWatermark').value.trim();
        const includeDate = document.getElementById('previewIncludeDate').checked;
        const bgColor = state.settings.screenshotTransparentBg ? null : state.settings.screenshotBgColor;
        const classroom = document.getElementById('classroom');
        // Use onclone callback to adjust cloned DOM for screenshot
        setTimeout(() => {
            html2canvas(classroom, {
                backgroundColor: bgColor, scale: scale, useCORS: true, allowTaint: true,
                logging: false, scrollX: 0, scrollY: 0,
                onclone: (clonedDoc) => {
                    const clonedClassroom = clonedDoc.getElementById('classroom');
                    if (!clonedClassroom) return;
                    // Hide UI elements in clone
                    const qi = clonedDoc.getElementById('quickInfo');
                    if (qi) qi.style.display = 'none';
                    const legend = clonedDoc.getElementById('seatLegend');
                    if (legend) legend.style.display = 'none';
                    const podium = clonedDoc.querySelector('.podium-toggle');
                    if (podium) podium.style.display = 'none';
                    const hmLegend = clonedDoc.getElementById('heatmapLegend');
                    if (hmLegend) hmLegend.style.display = 'none';
                    // Handle platform seats
                    if (!includePlatform) {
                        const pL = clonedDoc.getElementById('platformLeft'), pR = clonedDoc.getElementById('platformRight');
                        if (pL) pL.style.display = 'none';
                        if (pR) pR.style.display = 'none';
                    }
                }
            }).then(canvas => {
                // Add watermark
                if (watermark) {
                    const ctx = canvas.getContext('2d');
                    ctx.save();
                    ctx.globalAlpha = 0.12;
                    ctx.font = `${Math.floor(canvas.width / 20)}px ${getComputedStyle(document.body).getPropertyValue('--font-sans')}`;
                    ctx.fillStyle = '#000';
                    ctx.textAlign = 'center';
                    ctx.translate(canvas.width / 2, canvas.height / 2);
                    ctx.rotate(-Math.PI / 6);
                    ctx.fillText(watermark, 0, 0);
                    ctx.restore();
                }
                // Add date
                if (includeDate) {
                    const ctx = canvas.getContext('2d');
                    ctx.save();
                    ctx.globalAlpha = 0.5;
                    ctx.font = `${Math.floor(canvas.width / 60)}px sans-serif`;
                    ctx.fillStyle = '#666';
                    ctx.textAlign = 'right';
                    const now = new Date();
                    ctx.fillText(`${now.getFullYear()}/${(now.getMonth()+1).toString().padStart(2,'0')}/${now.getDate().toString().padStart(2,'0')} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`, canvas.width - 20, canvas.height - 15);
                    ctx.restore();
                }
                this._previewCanvas = canvas;
                frame.innerHTML = '';
                const img = document.createElement('img');
                img.src = canvas.toDataURL();
                img.style.maxWidth = '100%';
                img.style.borderRadius = '8px';
                frame.appendChild(img);
                // [FIX #6] No DOM restore needed - onclone handles cloned tree
            }).catch(err => {
                frame.innerHTML = '<p style="color:var(--danger);">预览生成失败</p>';
                console.error(err);
            });
        }, 100);
    },
    downloadPreview() {
        if (!this._previewCanvas) { Toast.warning('请先生成预览'); return; }
        const format = document.getElementById('previewFormat').value;
        const quality = parseFloat(document.getElementById('previewQuality').value);
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const ext = format === 'jpeg' ? 'jpg' : 'png';
        const dataUrl = this._previewCanvas.toDataURL(mimeType, quality);
        const link = document.createElement('a');
        link.download = `座位表_${this.getTimestamp()}.${ext}`;
        link.href = dataUrl;
        link.click();
        Toast.success(`截图已导出 (${format.toUpperCase()})`);
        addLog('📸', `导出截图 (${format.toUpperCase()})`);
        document.getElementById('previewModal').classList.remove('active');
    },

    // ==================== Print ====================
    printSeats() {
        document.getElementById('printDate').textContent = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
        // Calculate stats for print header
        const drawn = state.drawnStudents;
        const total = drawn.length;
        const male = drawn.filter(s => s.gender === state.settings.maleMapping).length;
        const female = drawn.filter(s => s.gender === state.settings.femaleMapping).length;
        const lunch = drawn.filter(s => s.lunch).length;
        document.getElementById('printStats').textContent = `总人数：${total}　男生：${male}　女生：${female}　午休：${lunch}`;
        window.print();
    },

    // [FEATURE] 家长会视图 - A4打印优化
    printParentView() {
        // Create a temporary print-optimized view
        const printWindow = window.open('', '_blank');
        if (!printWindow) { Toast.error('请允许弹出窗口以打印'); return; }

        const drawn = state.drawnStudents;
        const total = drawn.length;
        const male = drawn.filter(s => s.gender === state.settings.maleMapping).length;
        const female = drawn.filter(s => s.gender === state.settings.femaleMapping).length;

        let tableHtml = '<table style="width:100%;border-collapse:collapse;margin:20px 0;">';
        tableHtml += '<tr style="background:#f5f5f5;">';
        if (state.settings.exportIncludeSeatNumber) tableHtml += '<th style="border:1px solid #ddd;padding:8px;text-align:center;">座位号</th>';
        tableHtml += '<th style="border:1px solid #ddd;padding:8px;text-align:center;">姓名</th>';
        if (state.settings.exportIncludeGender) tableHtml += '<th style="border:1px solid #ddd;padding:8px;text-align:center;">性别</th>';
        tableHtml += '</tr>';

        const allSeats = [...state.drawOrder].sort((a, b) => a.number - b.number);
        allSeats.forEach(seat => {
            if (!seat.student) return;
            const s = seat.student;
            const genderBorder = s.gender === 'male' ? 'border-left:3px solid #007AFF;' : 'border-left:3px solid #FF2D55;';
            tableHtml += `<tr>`;
            if (state.settings.exportIncludeSeatNumber) tableHtml += `<td style="border:1px solid #ddd;padding:8px;text-align:center;${genderBorder}">${seat.number}</td>`;
            tableHtml += `<td style="border:1px solid #ddd;padding:8px;text-align:center;font-weight:600;${genderBorder}">${s.name}</td>`;
            if (state.settings.exportIncludeGender) tableHtml += `<td style="border:1px solid #ddd;padding:8px;text-align:center;">${s.gender === 'male' ? '♂' : '♀'}</td>`;
            tableHtml += '</tr>';
        });
        tableHtml += '</table>';

        const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>家长会座位表</title>
<style>
    @page { size: A4; margin: 15mm; }
    body { font-family: -apple-system, 'PingFang SC', sans-serif; padding: 20px; color: #333; }
    h1 { text-align: center; font-size: 22px; margin-bottom: 4px; }
    .subtitle { text-align: center; color: #666; font-size: 13px; margin-bottom: 20px; }
    .stats { text-align: center; color: #888; font-size: 12px; margin-bottom: 16px; }
    @media print { body { padding: 0; } }
</style></head><body>
<h1>📋 教室座位表</h1>
<div class="subtitle">${new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
<div class="stats">总人数：${total}　男生：${male}　女生：${female}</div>
${tableHtml}
<div style="text-align:center;color:#aaa;font-size:11px;margin-top:20px;">— 此表由教室座位智能编排系统生成 —</div>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`;

        printWindow.document.write(html);
        printWindow.document.close();
        Toast.success('家长会视图已生成，正在准备打印');
    },

    // ==================== Theme Switching ====================
    applyTheme(themeName) {
        document.body.classList.remove('theme-ocean', 'theme-forest', 'theme-sunset');
        if (themeName) document.body.classList.add(themeName);
        document.querySelectorAll('.theme-swatch').forEach(s => s.classList.toggle('active', s.dataset.theme === themeName));
        state.settings.theme = themeName;
    },
    applyAccentColor(color) {
        document.documentElement.style.setProperty('--primary', color);
        document.querySelectorAll('.accent-dot').forEach(d => d.classList.toggle('active', d.dataset.color === color));
        state.settings.accentColor = color;
    },

    // ==================== Quick Info Bar ====================
    updateQuickInfo() {
        document.getElementById('qiLayout').textContent = `${state.rows}×${state.cols}`;
        document.getElementById('qiTotal').textContent = state.students.length;
        document.getElementById('qiDrawn').textContent = state.drawnStudents.length;
        document.getElementById('qiRemaining').textContent = state.remainingStudents.length;

        const remMales = state.remainingStudents.filter(s => s.gender === 'male').length;
        const remFemales = state.remainingStudents.filter(s => s.gender === 'female').length;
        const lunchTotal = state.students.filter(s => s.lunch).length;

        document.getElementById('qiMaleRem').textContent = remMales;
        document.getElementById('qiFemaleRem').textContent = remFemales;
        document.getElementById('qiLunch').textContent = lunchTotal;

        // Apply visibility from settings
        this.applyQuickInfoVisibility();
    },

    applyQuickInfoVisibility() {
        const vis = state.settings.quickInfoItems || {};
        const defaults = { layout:true, total:true, drawn:true, remaining:true, male:true, female:true, lunch:true };
        document.querySelectorAll('#quickInfo .qi-item').forEach(el => {
            const key = el.dataset.qi;
            if (key && vis[key] === false) el.classList.add('hidden');
            else if (key) el.classList.remove('hidden');
        });
    },

    // ==================== Subject Management ====================
    renderSubjectTabs() {
        const container = document.getElementById('subjectTabs');
        container.innerHTML = state.subjects.map(s => {
            const maxScore = state.subjectMaxScores[s] ?? 100;
            return `<span class="subject-tab" data-subject="${s}">
                ${s}
                <input type="number" class="subject-max-score" value="${maxScore}" min="1" max="999" data-subject="${s}" title="满分值">
                <span style="cursor:pointer;opacity:0.5;" data-remove="${s}">×</span>
            </span>`;
        }).join('');
        container.querySelectorAll('.subject-tab').forEach(tab => {
            tab.querySelector('[data-remove]')?.addEventListener('click', e => {
                e.stopPropagation();
                const subj = e.target.dataset.remove;
                state.subjects = state.subjects.filter(s => s !== subj);
                delete state.subjectMaxScores[subj];
                this.renderSubjectTabs();
                this.updateHeatmapSubjectSelect();
            });
        });
        container.querySelectorAll('.subject-max-score').forEach(input => {
            input.addEventListener('change', e => {
                const subj = e.target.dataset.subject;
                state.subjectMaxScores[subj] = parseInt(e.target.value) || 100;
            });
        });
    },
    updateHeatmapSubjectSelect() {
        const sel = document.getElementById('heatmapSubjectSelect');
        sel.innerHTML = state.subjects.map(s => `<option value="${s}">${s}</option>`).join('');
    },
    updateHeatmapSubjectVisibility() {
        document.getElementById('heatmapSubjectWrap').style.display = state.heatmapType === 'subject' ? 'inline' : 'none';
    },
    updateHeatmapLegendLabels() {
        const lowSpan = document.getElementById('heatmapLowLabel');
        const highSpan = document.getElementById('heatmapHighLabel');
        if (!lowSpan || !highSpan) return;
        if (state.heatmapType === 'subject') {
            const subj = document.getElementById('heatmapSubjectSelect')?.value || '单科';
            lowSpan.textContent = `${subj} 低分`;
            highSpan.textContent = `${subj} 高分`;
        } else if (state.heatmapType === 'average') {
            lowSpan.textContent = '均分低';
            highSpan.textContent = '均分高';
        } else {
            lowSpan.textContent = '低分';
            highSpan.textContent = '高分';
        }
    },

    // ==================== Stale Blacklist/Whitelist Detection ====================
    checkStaleListEntries() {
        const studentNames = new Set(state.students.map(s => s.name));
        const staleBlacklist = [];
        const staleWhitelist = [];
        state.blacklist.forEach((group, i) => {
            const stale = group.map(n => n.replace(/^\*/, '').replace(/^[（(]/, '').replace(/[）)]$/, '')).filter(n => !studentNames.has(n));
            if (stale.length > 0) staleBlacklist.push({ group: group.join(' '), missing: stale });
        });
        state.whitelist.forEach((group, i) => {
            const stale = group.map(n => n.replace(/^\*/, '').replace(/^[（(]/, '').replace(/[）)]$/, '')).filter(n => !studentNames.has(n));
            if (stale.length > 0) staleWhitelist.push({ group: group.join(' '), missing: stale });
        });
        if (staleBlacklist.length > 0 || staleWhitelist.length > 0) {
            let msg = '检测到名单变更，以下黑白名单中包含不在当前学生名单中的成员：\n';
            if (staleBlacklist.length > 0) {
                msg += '\n🚫 黑名单：';
                staleBlacklist.forEach(s => msg += `\n  · ${s.group}（缺少：${s.missing.join('、')}）`);
            }
            if (staleWhitelist.length > 0) {
                msg += '\n✅ 白名单：';
                staleWhitelist.forEach(s => msg += `\n  · ${s.group}（缺少：${s.missing.join('、')}）`);
            }
            msg += '\n\n是否自动移除这些无效条目？';
            if (confirm(msg)) {
                if (staleBlacklist.length > 0) {
                    state.blacklist = state.blacklist.filter(group => {
                        const names = group.map(n => n.replace(/^\*/, '').replace(/^[（(]/, '').replace(/[）)]$/, ''));
                        return names.every(n => studentNames.has(n));
                    });
                    document.getElementById('blacklist').value = state.blacklist.map(g => g.join(' ')).join('\n');
                }
                if (staleWhitelist.length > 0) {
                    state.whitelist = state.whitelist.filter(group => {
                        const names = group.map(n => n.replace(/^\*/, '').replace(/^[（(]/, '').replace(/[）)]$/, ''));
                        return names.every(n => studentNames.has(n));
                    });
                    document.getElementById('whitelist').value = state.whitelist.map(g => g.join(' ')).join('\n');
                }
                Toast.success('已清理无效黑白名单条目');
            } else {
                Toast.warning('请手动检查黑白名单');
            }
        }
    },

    // ==================== Seat Animation ====================
    animateSeatsIn() {
        const seats = document.querySelectorAll('.seat');
        seats.forEach((seat, i) => {
            seat.classList.add('animate-in');
            seat.style.animationDelay = `${Math.min(i * 15, 600)}ms`;
            setTimeout(() => { seat.classList.remove('animate-in'); seat.style.animationDelay = ''; }, 800 + Math.min(i * 15, 600));
        });
    },

    // ==================== Arrow Key Navigation ====================
    _navSeat: null,
    navigateSeats(direction) {
        if (state.seats.length === 0) return;
        if (!this._navSeat) {
            this._navSeat = state.seats[0];
        } else {
            const cur = this._navSeat;
            const row = cur.row, col = cur.col;
            let target = null;
            switch (direction) {
                case 'ArrowUp':
                    for (let r = row - 1; r >= 0; r--) { const s = state.seats[r * state.cols + col]; if (s && !s.disabled) { target = s; break; } }
                    break;
                case 'ArrowDown':
                    for (let r = row + 1; r < state.rows; r++) { const s = state.seats[r * state.cols + col]; if (s && !s.disabled) { target = s; break; } }
                    break;
                case 'ArrowLeft':
                    for (let c = col - 1; c >= 0; c--) { const s = state.seats[row * state.cols + c]; if (s && !s.disabled) { target = s; break; } }
                    break;
                case 'ArrowRight':
                    for (let c = col + 1; c < state.cols; c++) { const s = state.seats[row * state.cols + c]; if (s && !s.disabled) { target = s; break; } }
                    break;
            }
            if (target) this._navSeat = target;
        }
        if (this._navSeat) {
            this.clearSelection();
            state.selectedSeat = this._navSeat;
            this._navSeat.element.classList.add('selected');
            this._navSeat.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },

    // ==================== Student Pool ====================
    renderPool() {
        const list = document.getElementById('poolList');
        let students = [...state.remainingStudents];
        // Filter
        if (state.poolFilter === 'male') students = students.filter(s => s.gender === 'male');
        else if (state.poolFilter === 'female') students = students.filter(s => s.gender === 'female');
        else if (state.poolFilter === 'lunch') students = students.filter(s => s.lunch);
        else if (state.poolFilter === 'no-lunch') students = students.filter(s => !s.lunch);
        // [FIX #4] Search using unified matchStudent
        if (state.poolSearch) {
            students = students.filter(s => matchStudent(s, state.poolSearch.toLowerCase()));
        }
        if (students.length === 0) { list.innerHTML = '<div class="pool-empty">无匹配学生</div>'; return; }
        // [FEATURE #23] Virtual scrolling / pagination for large pools
        const POOL_PAGE = 80;
        const displayStudents = students.slice(0, POOL_PAGE);
        list.innerHTML = displayStudents.map(s => {
            const meta = [];
            meta.push(s.gender === 'male' ? '♂' : '♀');
            if (s.lunch) meta.push('💤');
            if (s.score !== null && s.score !== undefined) meta.push(`📊${s.score}`);
            return `<div class="pool-item" draggable="true" data-student-id="${s.id}">
                <span class="pool-item-name">${escapeHtml(s.name)}</span>
                <span class="pool-item-meta">${meta.join(' ')}</span>
            </div>`;
        }).join('');
        // [FEATURE #23] Load more button for large pools
        if (students.length > POOL_PAGE) {
            list.innerHTML += `<div class="pool-empty" style="cursor:pointer;" id="poolLoadMore">显示 ${POOL_PAGE}/${students.length} — 点击加载更多</div>`;
        }
        // Drag from pool + Click-to-place
        list.querySelectorAll('.pool-item').forEach(item => {
            item.addEventListener('dragstart', e => {
                const id = parseInt(item.dataset.studentId);
                e.dataTransfer.setData('text/pool-student', JSON.stringify({ id }));
                e.dataTransfer.effectAllowed = 'move';
            });
            item.addEventListener('click', e => {
                e.stopPropagation();
                const id = parseInt(item.dataset.studentId);
                if (state.selectedPoolStudent === id) {
                    // Deselect
                    state.selectedPoolStudent = null;
                    item.classList.remove('pool-selected');
                    document.getElementById('poolClickHint')?.classList.remove('visible');
                    document.querySelectorAll('.seat').forEach(s => s.classList.remove('pool-target'));
                } else {
                    // Select this student
                    state.selectedPoolStudent = id;
                    list.querySelectorAll('.pool-item').forEach(pi => pi.classList.remove('pool-selected'));
                    item.classList.add('pool-selected');
                    document.getElementById('poolClickHint')?.classList.add('visible');
                    document.querySelectorAll('.seat:not(.disabled)').forEach(s => {
                        if (!state.seats.find(ss => ss.element === s)?.student) s.classList.add('pool-target');
                    });
                    Toast.info('请点击空座位落座，或按 ESC 取消');
                }
            });
        });
        // [FIX #5] Load more click handler
        const loadMoreBtn = document.getElementById('poolLoadMore');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => {
                const remainingHtml = students.slice(POOL_PAGE).map(s => {
                    const meta = [s.gender === 'male' ? '♂' : '♀'];
                    if (s.lunch) meta.push('💤');
                    if (s.score !== null && s.score !== undefined) meta.push(`📊${s.score}`);
                    return `<div class="pool-item" draggable="true" data-student-id="${s.id}">
                        <span class="pool-item-name">${escapeHtml(s.name)}</span>
                        <span class="pool-item-meta">${meta.join(' ')}</span>
                    </div>`;
                }).join('');
                loadMoreBtn.insertAdjacentHTML('beforebegin', remainingHtml);
                loadMoreBtn.remove();
                list.querySelectorAll('.pool-item').forEach(item => {
                    if (item._bound) return;
                    item._bound = true;
                    item.addEventListener('dragstart', e => {
                        const id = parseInt(item.dataset.studentId);
                        e.dataTransfer.setData('text/pool-student', JSON.stringify({ id }));
                        e.dataTransfer.effectAllowed = 'move';
                    });
                    item.addEventListener('click', e => {
                        e.stopPropagation();
                        const id = parseInt(item.dataset.studentId);
                        if (state.selectedPoolStudent === id) {
                            state.selectedPoolStudent = null;
                            item.classList.remove('pool-selected');
                            document.getElementById('poolClickHint')?.classList.remove('visible');
                            document.querySelectorAll('.seat').forEach(s => s.classList.remove('pool-target'));
                        } else {
                            state.selectedPoolStudent = id;
                            list.querySelectorAll('.pool-item').forEach(pi => pi.classList.remove('pool-selected'));
                            item.classList.add('pool-selected');
                            document.getElementById('poolClickHint')?.classList.add('visible');
                            document.querySelectorAll('.seat:not(.disabled)').forEach(s => {
                                if (!state.seats.find(ss => ss.element === s)?.student) s.classList.add('pool-target');
                            });
                            Toast.info('请点击空座位落座，或按 ESC 取消');
                        }
                    });
                });
            });
        }
    },
    showStats() {
        const content = document.getElementById('statsContent');
        const drawn = state.drawnStudents;
        const total = state.students.length;
        if (total === 0) { content.innerHTML = '<p style="color:var(--text-tertiary);text-align:center;padding:20px;">暂无数据</p>'; document.getElementById('statsModal').classList.add('active'); return; }

        const males = drawn.filter(s => s.gender === 'male').length;
        const females = drawn.filter(s => s.gender === 'female').length;
        const lunchCount = drawn.filter(s => s.lunch).length;
        const scores = drawn.filter(s => s.score !== null && s.score !== undefined).map(s => s.score);
        const avgScore = scores.length > 0 ? (scores.reduce((a,b) => a+b, 0) / scores.length).toFixed(1) : 'N/A';
        const maxScore = scores.length > 0 ? Math.max(...scores) : 'N/A';
        const minScore = scores.length > 0 ? Math.min(...scores) : 'N/A';

        // Score distribution
        const distFixed = [
            { label: '优秀 (90-100)', count: scores.filter(s => s >= 90).length },
            { label: '良好 (80-89)', count: scores.filter(s => s >= 80 && s < 90).length },
            { label: '中等 (70-79)', count: scores.filter(s => s >= 70 && s < 80).length },
            { label: '及格 (60-69)', count: scores.filter(s => s >= 60 && s < 70).length },
            { label: '不及格 (<60)', count: scores.filter(s => s < 60).length },
        ];
        const maxDist = Math.max(...distFixed.map(d => d.count), 1);

        // Front vs back row scores
        const frontScores = [], backScores = [];
        state.seats.forEach(s => {
            if (s.student && s.student.score !== null && s.student.score !== undefined) {
                if (s.row < Math.floor(state.rows / 2)) frontScores.push(s.student.score);
                else backScores.push(s.student.score);
            }
        });
        const frontAvg = frontScores.length > 0 ? (frontScores.reduce((a,b)=>a+b,0)/frontScores.length).toFixed(1) : 'N/A';
        const backAvg = backScores.length > 0 ? (backScores.reduce((a,b)=>a+b,0)/backScores.length).toFixed(1) : 'N/A';

        content.innerHTML = `
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-value">${drawn.length}</div><div class="stat-label">已抽取</div></div>
                <div class="stat-card"><div class="stat-value">${total - drawn.length}</div><div class="stat-label">剩余</div></div>
                <div class="stat-card"><div class="stat-value">${males}:${females}</div><div class="stat-label">男女比</div></div>
                <div class="stat-card"><div class="stat-value">${lunchCount}</div><div class="stat-label">午休人数</div></div>
                <div class="stat-card"><div class="stat-value">${avgScore}</div><div class="stat-label">平均分</div></div>
                <div class="stat-card"><div class="stat-value">${scores.length > 0 ? maxScore + '/' + minScore : 'N/A'}</div><div class="stat-label">最高/最低</div></div>
            </div>
            ${scores.length > 0 ? `
            <div class="stats-chart">
                <div class="stats-chart-title">📊 成绩分布</div>
                ${distFixed.map(d => `
                    <div class="stats-bar">
                        <span class="stats-bar-label">${d.label}</span>
                        <div class="stats-bar-track">
                            <div class="stats-bar-fill" style="width:${(d.count/maxDist*100)}%;background:${d.count > 0 ? 'var(--primary)' : 'var(--bg-tertiary)'};">
                                ${d.count > 0 ? d.count : ''}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="stats-chart">
                <div class="stats-chart-title">📍 前后排成绩对比</div>
                <div class="stats-bar">
                    <span class="stats-bar-label">前排均分</span>
                    <div class="stats-bar-track">
                        <div class="stats-bar-fill" style="width:${frontAvg !== 'N/A' ? frontAvg : 0}%;background:var(--success);">${frontAvg}</div>
                    </div>
                </div>
                <div class="stats-bar">
                    <span class="stats-bar-label">后排均分</span>
                    <div class="stats-bar-track">
                        <div class="stats-bar-fill" style="width:${backAvg !== 'N/A' ? backAvg : 0}%;background:var(--warning);">${backAvg}</div>
                    </div>
                </div>
            </div>` : '<p style="color:var(--text-tertiary);text-align:center;">未导入成绩数据，跳过成绩统计</p>'}
        `;
        document.getElementById('statsModal').classList.add('active');
    },

    // ==================== Smart Seat Recommendation (Multi-dimensional) ====================
    _recommendations: [],
    _customAlgorithms: {},
    _customAlgorithm: null,
    generateRecommendations() {
        this._recommendations = [];
        const allSeats = [...state.seats, state.platformLeft, state.platformRight].filter(s => s.student);
        if (allSeats.length < 2) { Toast.warning('需要至少2名已安排的学生'); return; }

        // Calculate current total peer influence score
        const currentScore = this.calcTotalInfluence(allSeats);

        // Try swapping each pair and find the best improvement
        // [FEATURE #23] Limit pairs to evaluate for performance (max 1000)
        const candidates = [];
        const maxPairs = 1000;
        let pairCount = 0;
        outer:
        for (let i = 0; i < allSeats.length; i++) {
            for (let j = i + 1; j < allSeats.length; j++) {
                if (++pairCount > maxPairs) break outer;
                const s1 = allSeats[i], s2 = allSeats[j];
                // Skip if either is pinned
                if (s1.student.pinned || s2.student.pinned) continue;

                // Simulate swap (clear swap/restore pattern)
                const orig1 = s1.student, orig2 = s2.student;
                s1.student = orig2; s2.student = orig1;
                const newScore = this.calcTotalInfluence(allSeats);
                const improvement = newScore - currentScore;
                s1.student = orig1; s2.student = orig2; // Restore original

                if (improvement > 0) {
                    const reasons = [];
                    const allFactors = [];
                    // Generate reasons using explainPairing
                    const neighbors1 = this.getNeighbors(s1).filter(n => n.student && n.student.id !== orig1.id && n.student.id !== orig2.id);
                    const neighbors2 = this.getNeighbors(s2).filter(n => n.student && n.student.id !== orig1.id && n.student.id !== orig2.id);
                    // After swap: s1 gets orig2, s2 gets orig1
                    const collectExplanation = (s1, s2) => {
                        const r = CompositeEval.explainPairing(s1, s2, 'adjacent');
                        if (r) {
                            if (r.factors) allFactors.push(...r.factors);
                            if (r.text && !reasons.includes(r.text)) reasons.push(r.text);
                        }
                    };
                    neighbors1.forEach(n => collectExplanation(orig2, n.student));
                    neighbors2.forEach(n => collectExplanation(orig1, n.student));
                    // Also explain the swapped pair's direct interaction
                    const directExplain = CompositeEval.explainPairing(orig1, orig2, 'swap');
                    if (directExplain) {
                        if (directExplain.factors) allFactors.push(...directExplain.factors);
                        if (directExplain.text && !reasons.includes(directExplain.text)) reasons.push(directExplain.text);
                    }

                    // Check relationship between the pair
                    const rel = this.getRelationshipBetween(orig1, orig2);
                    if (rel) {
                        reasons.push(`关系: ${this.getRelationshipPresetLabel(rel.type)} (${rel.score > 0 ? '+' : ''}${rel.score}分)`);
                        allFactors.push({
                            icon: rel.score > 0 ? '💕' : '⚡',
                            label: this.getRelationshipPresetLabel(rel.type).replace(/[^\u4e00-\u9fa5]/g, ''),
                            detail: `${rel.score > 0 ? '+' : ''}${rel.score}分`,
                            type: 'relationship',
                            score: rel.score
                        });
                    }

                    let priority = 'low';
                    if (improvement > 30) priority = 'high';
                    else if (improvement > 15) priority = 'medium';

                    candidates.push({
                        seat1: s1, seat2: s2,
                        student1: orig1, student2: orig2,
                        priority, improvement,
                        reason: reasons.length > 0 ? reasons.join('\n') : `良性影响分提升 ${improvement} 分`,
                        factors: allFactors,
                        applied: false
                    });
                }
            }
        }

        // Sort by improvement, take top 5
        candidates.sort((a, b) => b.improvement - a.improvement);
        this._recommendations = candidates.slice(0, 5);

        // [FEATURE] 学霸帮扶链自动推荐
        this._tutoringChains = this.buildTutoringChain();
    },

    /**
     * [FEATURE] 学霸帮扶链 - 识别成绩前30%和后30%的学生，推荐多种位置配对
     */
    buildTutoringChain() {
        const chains = [];
        const allSeated = [...state.seats, state.platformLeft, state.platformRight].filter(s => s.student);
        if (allSeated.length < 5) return chains;

        // Get students with scores
        const scored = allSeated
            .filter(s => s.student.score !== null && s.student.score !== undefined)
            .map(s => ({ seat: s, student: s.student, avg: CompositeEval.getAvgScore(s.student) ?? s.student.score ?? null }))
            .filter(s => s.avg !== null && s.avg !== undefined);

        if (scored.length < 5) return chains;

        // Sort by score
        scored.sort((a, b) => b.avg - a.avg);
        // Expanded to top 30% and bottom 30% for more pairing options
        const topCount = Math.max(1, Math.floor(scored.length * 0.3));
        const bottomCount = Math.max(1, Math.floor(scored.length * 0.3));

        const topStudents = scored.slice(0, topCount);
        const bottomStudents = scored.slice(-bottomCount);

        // Optimal score difference range for tutoring: 15-50 points
        const isOptimalDiff = (diff) => diff >= 15 && diff <= 50;

        // Check various adjacency patterns and collect candidates
        const candidates = [];
        
        topStudents.forEach(top => {
            bottomStudents.forEach(bottom => {
                if (top.seat.type !== 'normal' || bottom.seat.type !== 'normal') return;
                const scoreDiff = Math.abs(top.avg - bottom.avg);
                
                // Pattern 1: Same column, adjacent rows (best)
                if (top.seat.col === bottom.seat.col && Math.abs(top.seat.row - bottom.seat.row) === 1) {
                    candidates.push({
                        tutor: top.student, tutee: bottom.student,
                        tutorSeat: top.seat, tuteeSeat: bottom.seat,
                        scoreDiff, priority: isOptimalDiff(scoreDiff) ? 1 : 2,
                        reason: `${top.student.name}(${top.avg}分) 与 ${bottom.student.name}(${bottom.avg}分) 同列相邻，可帮扶提升`
                    });
                }
                // Pattern 2: Same column, 1 seat gap
                else if (top.seat.col === bottom.seat.col && Math.abs(top.seat.row - bottom.seat.row) === 2) {
                    candidates.push({
                        tutor: top.student, tutee: bottom.student,
                        tutorSeat: top.seat, tuteeSeat: bottom.seat,
                        scoreDiff, priority: isOptimalDiff(scoreDiff) ? 2 : 3,
                        reason: `${top.student.name}(${top.avg}分) 与 ${bottom.student.name}(${bottom.avg}分) 同列相近，可帮扶提升`
                    });
                }
                // Pattern 3: Same row, adjacent columns
                else if (top.seat.row === bottom.seat.row && Math.abs(top.seat.col - bottom.seat.col) === 1) {
                    candidates.push({
                        tutor: top.student, tutee: bottom.student,
                        tutorSeat: top.seat, tuteeSeat: bottom.seat,
                        scoreDiff, priority: isOptimalDiff(scoreDiff) ? 2 : 3,
                        reason: `${top.student.name}(${top.avg}分) 与 ${bottom.student.name}(${bottom.avg}分) 同排相邻，可互助学习`
                    });
                }
                // Pattern 4: Diagonal adjacent
                else if (Math.abs(top.seat.row - bottom.seat.row) === 1 && Math.abs(top.seat.col - bottom.seat.col) === 1) {
                    candidates.push({
                        tutor: top.student, tutee: bottom.student,
                        tutorSeat: top.seat, tuteeSeat: bottom.seat,
                        scoreDiff, priority: isOptimalDiff(scoreDiff) ? 3 : 4,
                        reason: `${top.student.name}(${top.avg}分) 与 ${bottom.student.name}(${bottom.avg}分) 斜对角相邻，可互相帮助`
                    });
                }
            });
        });

        // Sort by priority, then by score difference (prefer optimal range)
        candidates.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            // Prefer optimal score difference
            const aOptimal = isOptimalDiff(a.scoreDiff) ? 0 : 1;
            const bOptimal = isOptimalDiff(b.scoreDiff) ? 0 : 1;
            return aOptimal - bOptimal;
        });

        // Deduplicate: each student should appear at most once as tutor or tutee
        const usedTutors = new Set();
        const usedTutees = new Set();
        
        candidates.forEach(c => {
            if (chains.length >= 5) return; // Max 5 tutoring chains
            if (usedTutors.has(c.tutor.id) || usedTutees.has(c.tutee.id)) return;
            if (c.tutor.id === c.tutee.id) return;
            
            usedTutors.add(c.tutor.id);
            usedTutees.add(c.tutee.id);
            chains.push({
                ...c,
                type: 'tutoring',
                applied: false
            });
        });

        // If no direct pairs found, suggest swaps to create them
        if (chains.length === 0 && topStudents.length > 0 && bottomStudents.length > 0) {
            let bestPair = null;
            let bestScore = -Infinity;
            
            topStudents.forEach(top => {
                bottomStudents.forEach(bottom => {
                    if (top.seat.type !== 'normal' || bottom.seat.type !== 'normal') return;
                    const scoreDiff = Math.abs(top.avg - bottom.avg);
                    if (scoreDiff < 15 || scoreDiff > 50) return; // Skip if not in optimal range
                    
                    const colDist = Math.abs(top.seat.col - bottom.seat.col);
                    const rowDist = Math.abs(top.seat.row - bottom.seat.row);
                    const dist = colDist + rowDist;
                    
                    // Score: lower distance is better, optimal diff is better
                    const pairScore = 100 - dist + (isOptimalDiff(scoreDiff) ? 20 : 0);
                    if (pairScore > bestScore) {
                        bestScore = pairScore;
                        bestPair = { top, bottom, scoreDiff };
                    }
                });
            });

            if (bestPair && bestScore > 50) {
                chains.push({
                    tutor: bestPair.top.student,
                    tutee: bestPair.bottom.student,
                    tutorSeat: bestPair.top.seat,
                    tuteeSeat: bestPair.bottom.seat,
                    scoreDiff: bestPair.scoreDiff,
                    reason: `建议将 ${bestPair.top.student.name}(${bestPair.top.avg}分) 移至 ${bestPair.bottom.student.name}(${bestPair.bottom.avg}分) 附近进行帮扶`,
                    type: 'tutoring-suggest',
                    applied: false
                });
            }
        }

        return chains;
    },

    /**
     * Calculate total peer influence across all adjacent seat pairs
     */
    calcTotalInfluence(seats) {
        // Use custom algorithm if available, otherwise use enhanced built-in
        if (this._customAlgorithm && typeof this._customAlgorithm.peerInfluence === 'function') {
            return this._calcWithCustomAlgo(seats);
        }
        let total = 0;
        const checked = new Set();
        seats.forEach(s => {
            if (!s.student) return;
            this.getNeighbors(s).forEach(n => {
                if (!n.student) return;
                const key = [Math.min(s.student.id, n.student.id), Math.max(s.student.id, n.student.id)].join('-');
                if (checked.has(key)) return;
                checked.add(key);
                total += this.enhancedPeerInfluence(s.student, n.student, s, n);
            });
        });
        // Add row-level balance bonus
        total += this.calcRowBalance(seats);
        // Add lunch clustering penalty
        total += this.calcLunchPenalty(seats);
        return total;
    },

    _calcWithCustomAlgo(seats) {
        let total = 0;
        const checked = new Set();
        const context = { seats, settings: state.settings, rows: state.rows, cols: state.cols, blacklist: state.blacklist, whitelist: state.whitelist };
        seats.forEach(s => {
            if (!s.student) return;
            this.getNeighbors(s).forEach(n => {
                if (!n.student) return;
                const key = [Math.min(s.student.id, n.student.id), Math.max(s.student.id, n.student.id)].join('-');
                if (checked.has(key)) return;
                checked.add(key);
                total += this._customAlgorithm.peerInfluence(s.student, n.student, context);
            });
        });
        return total;
    },

    enhancedPeerInfluence(s1, s2, seat1, seat2) {
        let score = CompositeEval.peerInfluence(s1, s2);

        // Note: Academic balance bonus removed to avoid overlap with peerInfluence()

        // Penalty: too many lunch students adjacent (exclude each other to avoid double counting)
        if (s1.lunch && s2.lunch) {
            const n1 = this.getNeighbors(seat1).filter(n => n.student?.lunch && n.student.id !== s2.id).length;
            const n2 = this.getNeighbors(seat2).filter(n => n.student?.lunch && n.student.id !== s1.id).length;
            if (n1 >= 3 || n2 >= 3) score -= 10; // Too clustered
        }

        // Bonus: position diversity in same row
        if (seat1.row === seat2.row && s1.position && s2.position && s1.position !== s2.position) {
            score += 5;
        }

        // Relationship influence
        score += this.calcRelationshipInfluence(s1, s2);

        return score;
    },

    calcRowBalance(seats) {
        let bonus = 0;
        // Build a lookup map for seats passed in (for simulation support)
        const seatMap = new Map();
        seats.forEach(s => {
            if (s.type === 'normal' && s.row >= 0 && s.col >= 0) {
                seatMap.set(`${s.row}-${s.col}`, s);
            }
        });
        
        for (let r = 0; r < state.rows; r++) {
            const rowStudents = [];
            for (let c = 0; c < state.cols; c++) {
                const s = seatMap.get(`${r}-${c}`) || state.seats[r * state.cols + c];
                if (s?.student) {
                    const avg = CompositeEval.getAvgScore(s.student);
                    if (avg !== null) rowStudents.push(avg);
                }
            }
            if (rowStudents.length >= 2) {
                const mean = rowStudents.reduce((a, b) => a + b, 0) / rowStudents.length;
                const variance = rowStudents.reduce((a, b) => a + (b - mean) ** 2, 0) / rowStudents.length;
                if (variance > 200) bonus += 10; // Good spread of high/low in row
            }
        }
        return bonus;
    },

    calcLunchPenalty(seats) {
        let penalty = 0;
        seats.forEach(s => {
            if (!s.student?.lunch) return;
            const lunchNeighbors = this.getNeighbors(s).filter(n => n.student?.lunch).length;
            if (lunchNeighbors >= 4) penalty -= 15; // Heavy lunch clustering
            else if (lunchNeighbors >= 3) penalty -= 8;
        });
        return penalty;
    },

    /**
     * Get neighboring seats (up, down, left, right, diagonal)
     */
    getNeighbors(seat) {
        if (seat.type !== 'normal') return [];
        const neighbors = [];
        const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
        dirs.forEach(([dr, dc]) => {
            const r = seat.row + dr, c = seat.col + dc;
            if (r >= 0 && r < state.rows && c >= 0 && c < state.cols) {
                neighbors.push(state.seats[r * state.cols + c]);
            }
        });
        return neighbors;
    },

    showRecommendations() {
        const panel = document.getElementById('recommendPanel');
        const content = document.getElementById('recommendContent');
        // Show panel immediately with loading state
        content.innerHTML = '<div class="recommend-empty">🔄 正在分析座位安排...</div>';
        panel.classList.add('visible');
        Toast.info('正在分析座位安排...');
        // Use setTimeout to allow UI to update before heavy computation
        setTimeout(() => {
            try {
                this.generateRecommendations();
            } catch (e) {
                console.error('智能推荐生成失败:', e);
                Toast.error('智能推荐生成失败：' + (e.message || '未知错误'));
                content.innerHTML = '<div class="recommend-empty">❌ 分析失败，请查看控制台</div>';
                return;
            }
            const hasSwapRecs = this._recommendations.length > 0;
            const hasTutoring = (this._tutoringChains || []).length > 0;
            if (!hasSwapRecs && !hasTutoring) {
                content.innerHTML = '<div class="recommend-empty">🎉 当前座位安排已较合理，暂无推荐调整</div>';
                Toast.info('当前座位安排已较合理');
                return;
            }
            this.renderRecommendations();
            const total = this._recommendations.length + (this._tutoringChains || []).length;
            Toast.success(`找到 ${total} 条优化建议`);
        }, 50);
    },

    renderRecommendations() {
        const content = document.getElementById('recommendContent');
        const priorityLabels = { high: '强烈建议', medium: '建议调整', low: '可选优化' };
        const hasSwapRecs = this._recommendations.length > 0;
        const hasTutoring = (this._tutoringChains || []).length > 0;

        if (!hasSwapRecs && !hasTutoring) {
            content.innerHTML = '<div class="recommend-empty">🎉 当前座位安排已较合理，暂无推荐调整</div>';
            return;
        }

        let html = '';

        // Regular swap recommendations
        if (hasSwapRecs) {
            html += this._recommendations.map((rec, i) => {
                // Render factor badges if available
                let factorsHtml = '';
                if (rec.factors && rec.factors.length > 0) {
                    factorsHtml = '<div class="recommend-factors">' +
                        rec.factors.map(f => {
                            const cls = f.type === 'relationship' ? 'factor-badge relationship' :
                                       (f.score < 0 || f.type === 'negative') ? 'factor-badge negative' : 'factor-badge positive';
                            return `<span class="${cls}">${f.icon} ${f.label}</span>`;
                        }).join('') + '</div>';
                }
                return `
            <div class="recommend-card" data-idx="${i}" data-seat1-row="${rec.seat1.row}" data-seat1-col="${rec.seat1.col}" data-seat2-row="${rec.seat2.row}" data-seat2-col="${rec.seat2.col}" style="${rec.applied ? 'opacity:0.5;' : ''}">
                <div class="recommend-card-header">
                    <span class="recommend-card-title">推荐 #${i + 1}</span>
                    <span class="recommend-card-badge ${rec.priority}">${priorityLabels[rec.priority]} · 良性影响+${rec.improvement}</span>
                </div>
                ${factorsHtml}
                <div class="recommend-swap">
                    <span class="seat-chip">${escapeHtml(rec.student1.name)} → ${this.seatLabel(rec.seat1)}</span>
                    <span class="arrow">⇄</span>
                    <span class="seat-chip">${escapeHtml(rec.student2.name)} → ${this.seatLabel(rec.seat2)}</span>
                </div>
                <div class="recommend-actions">
                    ${rec.applied ? '<span style="color:var(--success);font-size:12px;">✓ 已采纳</span>' : `
                    <button class="btn btn-ghost btn-sm" data-action="skip" data-idx="${i}">跳过</button>
                    <button class="btn btn-primary btn-sm" data-action="accept" data-idx="${i}">采纳</button>
                    `}
                </div>
            </div>
        `;
            }).join('');
        }

        // [FEATURE] 学霸帮扶链推荐
        if (hasTutoring) {
            html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--glass-border);"><div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">📚 学霸帮扶链</div></div>';
            html += this._tutoringChains.map((chain, i) => `
            <div class="recommend-card" data-idx="${this._recommendations.length + i}" data-tutor-row="${chain.tutorSeat.row}" data-tutor-col="${chain.tutorSeat.col}" data-tutee-row="${chain.tuteeSeat.row}" data-tutee-col="${chain.tuteeSeat.col}" data-tutoring-idx="${i}" style="border-left:3px solid var(--info);${chain.applied ? 'opacity:0.5;' : ''}">
                <div class="recommend-card-header">
                    <span class="recommend-card-title">帮扶 #${i + 1}</span>
                    <span class="recommend-card-badge medium">成绩差 ${chain.scoreDiff} 分</span>
                </div>
                <div class="recommend-reason">${chain.reason}</div>
                <div class="recommend-swap">
                    <span class="seat-chip" style="background:rgba(175,82,222,0.1);">🎓 ${chain.tutor.name}(${CompositeEval.getAvgScore(chain.tutor) || chain.tutor.score}分)</span>
                    <span class="arrow">→</span>
                    <span class="seat-chip" style="background:rgba(255,149,0,0.1);">📖 ${chain.tutee.name}(${CompositeEval.getAvgScore(chain.tutee) || chain.tutee.score}分)</span>
                </div>
                <div class="recommend-actions">
                    ${chain.applied ? '<span style="color:var(--success);font-size:12px;">✓ 已采纳</span>' : `
                    <button class="btn btn-ghost btn-sm" data-action="skip-tutoring" data-tutoring-idx="${i}">跳过</button>
                    <button class="btn btn-primary btn-sm" data-action="accept-tutoring" data-tutoring-idx="${i}">采纳</button>
                    `}
                </div>
            </div>
        `).join('');
        }

        content.innerHTML = html;
        // Hover to highlight seats
        content.querySelectorAll('.recommend-card:not([style*="opacity"])').forEach(card => {
            card.addEventListener('mouseenter', () => {
                const tutoringIdx = card.dataset.tutoringIdx;
                if (tutoringIdx !== undefined) {
                    const chain = this._tutoringChains[parseInt(tutoringIdx)];
                    if (!chain || chain.applied) return;
                    this.clearRecommendHighlights();
                    this.highlightSeat(chain.tutorSeat);
                    this.highlightSeat(chain.tuteeSeat);
                    card.classList.add('hovering');
                } else {
                    const idx = parseInt(card.dataset.idx);
                    const rec = this._recommendations[idx];
                    if (!rec || rec.applied) return;
                    this.clearRecommendHighlights();
                    this.highlightSeat(rec.seat1);
                    this.highlightSeat(rec.seat2);
                    card.classList.add('hovering');
                    // Highlight related nodes in graph
                    if (typeof RelGraph !== 'undefined' && document.getElementById('relGraphModal')?.classList.contains('active')) {
                        RelGraph.highlightRecommendNodes([rec.student1.id, rec.student2.id], 2000);
                    }
                }
            });
            card.addEventListener('mouseleave', () => {
                this.clearRecommendHighlights();
                card.classList.remove('hovering');
            });
        });
        content.querySelectorAll('[data-action="accept"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.acceptRecommendation(parseInt(btn.dataset.idx)); });
        });
        content.querySelectorAll('[data-action="skip"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.skipRecommendation(parseInt(btn.dataset.idx)); });
        });
        content.querySelectorAll('[data-action="accept-tutoring"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.acceptTutoringChain(parseInt(btn.dataset.tutoringIdx)); });
        });
        content.querySelectorAll('[data-action="skip-tutoring"]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.skipTutoringChain(parseInt(btn.dataset.tutoringIdx)); });
        });
    },

    highlightSeat(seat) {
        const el = this.getSeatElement(seat);
        if (el) el.classList.add('recommend-highlight');
    },
    clearRecommendHighlights() {
        document.querySelectorAll('.recommend-highlight').forEach(el => el.classList.remove('recommend-highlight'));
    },

    acceptRecommendation(idx) {
        const rec = this._recommendations[idx];
        if (!rec || rec.applied) return;
        this.clearRecommendHighlights();
        this.doSwap(rec.seat1, rec.seat2);
        rec.applied = true;
        Toast.success(`已采纳：${rec.student1.name} ↔ ${rec.student2.name}`);
        addLog('🧠', `智能推荐：${rec.student1.name} ↔ ${rec.student2.name}`);
        this.renderRecommendations();
        // Refresh graph if open
        if (typeof RelGraph !== 'undefined' && document.getElementById('relGraphModal')?.classList.contains('active')) {
            RelGraph.buildGraph();
            RelGraph.draw();
            RelGraph.renderStats();
        }
    },

    skipRecommendation(idx) {
        const rec = this._recommendations[idx];
        if (!rec) return;
        rec.applied = true; // Mark as handled (skipped)
        this.renderRecommendations();
    },

    acceptTutoringChain(idx) {
        const chain = this._tutoringChains[idx];
        if (!chain || chain.applied) return;
        // For 'tutoring' type: swap tutor and tutee seats to make them adjacent
        // For 'tutoring-suggest' type: suggest moving, mark as applied
        if (chain.type === 'tutoring') {
            this.clearRecommendHighlights();
            this.doSwap(chain.tutorSeat, chain.tuteeSeat);
            chain.applied = true;
            const tName = chain.tutor.name;
            const teName = chain.tutee.name;
            Toast.success(`已采纳帮扶：${tName} ↔ ${teName}（同列相邻）`);
            addLog('📚', `学霸帮扶链：${tName} ↔ ${teName}`);
        } else {
            chain.applied = true;
            Toast.info(`已记录建议：${chain.tutor.name} 帮扶 ${chain.tutee.name}`);
        }
        this.renderRecommendations();
    },

    skipTutoringChain(idx) {
        const chain = this._tutoringChains[idx];
        if (!chain) return;
        chain.applied = true;
        this.renderRecommendations();
    },

    applyAllRecommendations() {
        let applied = 0;
        this._recommendations.forEach((rec, i) => {
            if (!rec.applied) {
                this.doSwap(rec.seat1, rec.seat2);
                rec.applied = true;
                applied++;
                addLog('🧠', `智能推荐：${rec.student1.name} ↔ ${rec.student2.name}`);
            }
        });
        (this._tutoringChains || []).forEach((chain) => {
            if (!chain.applied && chain.type === 'tutoring') {
                this.doSwap(chain.tutorSeat, chain.tuteeSeat);
                chain.applied = true;
                applied++;
                addLog('📚', `学霸帮扶链：${chain.tutor.name} ↔ ${chain.tutee.name}`);
            } else if (!chain.applied) {
                chain.applied = true;
            }
        });
        this.renderRecommendations();
        if (applied > 0) Toast.success(`已采纳 ${applied} 条推荐`);
        else Toast.info('所有推荐已处理');
    },

    autoOptimizeSeats() {
        if (!confirm('一键优化将根据关系、成绩、性格自动调整所有座位，是否继续？')) return;
        const allSeated = [...state.seats, state.platformLeft, state.platformRight].filter(s => s.student && !s.disabled);
        if (allSeated.length < 2) { Toast.warning('座位数据不足'); return; }

        let totalImprovement = 0;
        let swapCount = 0;
        const maxIterations = 50;

        for (let iter = 0; iter < maxIterations; iter++) {
            let bestImprovement = 0;
            let bestSwap = null;
            const currentScore = this.calcTotalInfluence(allSeated);

            for (let i = 0; i < allSeated.length; i++) {
                for (let j = i + 1; j < allSeated.length; j++) {
                    const s1 = allSeated[i], s2 = allSeated[j];
                    if (s1.student?.pinned || s2.student?.pinned) continue;

                    const orig1 = s1.student, orig2 = s2.student;
                    s1.student = orig2; s2.student = orig1;
                    const newScore = this.calcTotalInfluence(allSeated);
                    const improvement = newScore - currentScore;
                    s1.student = orig1; s2.student = orig2;

                    if (improvement > bestImprovement) {
                        bestImprovement = improvement;
                        bestSwap = { s1, s2 };
                    }
                }
            }

            if (bestSwap && bestImprovement > 0) {
                this.doSwap(bestSwap.s1, bestSwap.s2);
                totalImprovement += bestImprovement;
                swapCount++;
            } else {
                break;
            }
        }

        if (swapCount > 0) {
            Toast.success(`一键优化完成：执行了 ${swapCount} 次交换，良性影响提升 ${Math.round(totalImprovement)} 分`);
            addLog('⚡', `一键优化座位：${swapCount}次交换，+${Math.round(totalImprovement)}分`);
            // Refresh graph if open
            if (typeof RelGraph !== 'undefined' && document.getElementById('relGraphModal')?.classList.contains('active')) {
                RelGraph.buildGraph();
                RelGraph.draw();
                RelGraph.renderStats();
            }
        } else {
            Toast.info('当前座位安排已较合理，无需优化');
        }
    },

    // ==================== Relationship Network ====================
    getRelationshipBetween(s1, s2) {
        if (!s1 || !s2) return null;
        const id1 = s1.id || s1.studentId;
        const id2 = s2.id || s2.studentId;
        const rel = state.relationships.find(r =>
            (r.student1Id === id1 && r.student2Id === id2) ||
            (r.student1Id === id2 && r.student2Id === id1)
        );
        if (!rel) return null;
        const preset = state.relationshipPresets.find(p => p.type === rel.type);
        return { ...rel, typeLabel: preset ? preset.label : rel.type };
    },
    calcRelationshipInfluence(s1, s2) {
        const rel = this.getRelationshipBetween(s1, s2);
        if (!rel) return 0;
        return rel.score;
    },
    getRelationshipPresetLabel(type) {
        const preset = state.relationshipPresets.find(p => p.type === type);
        return preset ? preset.label : type;
    },
    getRelationshipScoreColor(score) {
        if (score > 0) return 'rel-score-positive';
        if (score < 0) return 'rel-score-negative';
        return '';
    },
    getRelationshipCardClass(score) {
        if (score > 0) return 'rel-card-positive';
        if (score < 0) return 'rel-card-negative';
        return 'rel-card-neutral';
    },
    renderRelationshipPanel() {
        const content = document.getElementById('spRelationshipsContent');
        if (!content) return;
        const rels = state.relationships || [];
        if (rels.length === 0) {
            content.innerHTML = '<div class="rel-empty">暂无关系数据<br><span style="font-size:11px;color:var(--text-tertiary);">点击右上角 × 关闭面板，使用 More Menu 或 Ctrl+K 打开关系管理</span></div>';
            return;
        }
        let html = '<div style="display:flex;gap:4px;margin-bottom:8px;"><button class="btn btn-primary btn-sm" id="relOpenManagerBtn" style="flex:1;">🔗 管理关系</button><button class="btn btn-ghost btn-sm" id="relOpenGraphBtn" style="flex:0;">🕸️</button></div>';
        html += '<div class="rel-grid">';
        rels.forEach(rel => {
            const s1 = state.students.find(s => s.id === rel.student1Id);
            const s2 = state.students.find(s => s.id === rel.student2Id);
            if (!s1 || !s2) return;
            const label = this.getRelationshipPresetLabel(rel.type);
            const scoreColor = this.getRelationshipScoreColor(rel.score);
            const cardClass = this.getRelationshipCardClass(rel.score);
            html += `<div class="rel-card ${cardClass} rel-sidebar-card">
                <span class="rel-student-name">${escapeHtml(s1.name)}</span>
                <span class="rel-type-badge ${rel.score > 0 ? 'rel-type-positive' : rel.score < 0 ? 'rel-type-negative' : ''}">${label}</span>
                <span class="rel-student-name">${escapeHtml(s2.name)}</span>
                <span class="rel-score ${scoreColor}">${rel.score > 0 ? '+' : ''}${rel.score}</span>
            </div>`;
        });
        html += '</div>';
        content.innerHTML = html;
        document.getElementById('relOpenManagerBtn')?.addEventListener('click', () => this.openRelationshipModal());
        document.getElementById('relOpenGraphBtn')?.addEventListener('click', () => RelGraph.open());
    },
    openRelationshipModal(editId) {
        // Open the integrated modal
        RelGraph.open();
        // If editing, pre-fill the form after a short delay
        if (editId) {
            setTimeout(() => {
                const rel = state.relationships.find(r => r.id === editId);
                if (rel) {
                    const s1 = state.students.find(s => s.id === rel.student1Id);
                    const s2 = state.students.find(s => s.id === rel.student2Id);
                    const s1Input = document.getElementById('relStudent1Input');
                    const s2Input = document.getElementById('relStudent2Input');
                    const s1IdEl = document.getElementById('relStudent1Id');
                    const s2IdEl = document.getElementById('relStudent2Id');
                    const typeSelect = document.getElementById('relTypeSelect');
                    const scoreSlider = document.getElementById('relScoreSlider');
                    const scoreInput = document.getElementById('relScoreInput');
                    const editIdEl = document.getElementById('relEditId');
                    const titleEl = document.getElementById('relFormTitle');
                    if (s1) { s1Input.value = s1.name; s1IdEl.textContent = s1.id; }
                    if (s2) { s2Input.value = s2.name; s2IdEl.textContent = s2.id; }
                    typeSelect.value = rel.type;
                    scoreSlider.value = rel.score;
                    scoreInput.value = rel.score;
                    editIdEl.textContent = rel.id;
                    if (titleEl) titleEl.textContent = '✏️ 编辑关系';
                }
            }, 100);
        }
    },
    renderRelTypeOptions() {
        const select = document.getElementById('relTypeSelect');
        if (!select) return;
        select.innerHTML = state.relationshipPresets.map(p =>
            `<option value="${p.type}">${p.label} (${p.defaultScore > 0 ? '+' : ''}${p.defaultScore})</option>`
        ).join('');

        const filter = document.getElementById('relTypeFilter');
        if (filter) {
            filter.innerHTML = '<option value="all">全部类型</option>' +
                state.relationshipPresets.map(p =>
                    `<option value="${p.type}">${p.label}</option>`
                ).join('');
        }
    },
    renderRelationshipGrid() {
        const grid = document.getElementById('relGrid');
        if (!grid) return;
        const rels = this.filteredRelationships();

        if (rels.length === 0) {
            grid.innerHTML = '<div class="rel-empty">暂无关系数据，请在上方表单添加</div>';
            return;
        }

        let html = '';
        rels.forEach(rel => {
            const s1 = state.students.find(s => s.id === rel.student1Id);
            const s2 = state.students.find(s => s.id === rel.student2Id);
            if (!s1 || !s2) return;
            const label = this.getRelationshipPresetLabel(rel.type);
            const scoreColor = this.getRelationshipScoreColor(rel.score);
            const cardClass = this.getRelationshipCardClass(rel.score);
            html += `<div class="rel-card ${cardClass}">
                <span class="rel-student-name">${escapeHtml(s1.name)}</span>
                <span class="rel-type-badge ${rel.score > 0 ? 'rel-type-positive' : rel.score < 0 ? 'rel-type-negative' : ''}">${label}</span>
                <span class="rel-student-name">${escapeHtml(s2.name)}</span>
                <span class="rel-score ${scoreColor}">${rel.score > 0 ? '+' : ''}${rel.score}</span>
                <div class="rel-actions">
                    <button class="btn btn-ghost btn-sm rel-edit-btn" data-rel-id="${rel.id}">✏️</button>
                    <button class="btn btn-ghost btn-sm rel-del-btn" data-rel-id="${rel.id}" style="color:var(--danger);">🗑️</button>
                </div>
            </div>`;
        });
        grid.innerHTML = html;

        grid.querySelectorAll('.rel-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => this.openRelationshipModal(btn.dataset.relId));
        });
        grid.querySelectorAll('.rel-del-btn').forEach(btn => {
            btn.addEventListener('click', () => this.deleteRelationship(btn.dataset.relId));
        });
    },
    filteredRelationships() {
        const rels = state.relationships || [];
        const search = (document.getElementById('relSearchInput')?.value || '').toLowerCase().trim();
        const typeFilter = document.getElementById('relTypeFilter')?.value || 'all';
        const signFilter = document.getElementById('relSignFilter')?.value || 'all';

        return rels.filter(rel => {
            const s1 = state.students.find(s => s.id === rel.student1Id);
            const s2 = state.students.find(s => s.id === rel.student2Id);
            if (!s1 || !s2) return false;
            if (search && !s1.name.toLowerCase().includes(search) && !s2.name.toLowerCase().includes(search)) return false;
            if (typeFilter !== 'all' && rel.type !== typeFilter) return false;
            if (signFilter === 'positive' && rel.score <= 0) return false;
            if (signFilter === 'negative' && rel.score >= 0) return false;
            return true;
        });
    },
    saveRelationship() {
        const s1Id = parseInt(document.getElementById('relStudent1Id').textContent);
        const s2Id = parseInt(document.getElementById('relStudent2Id').textContent);
        const type = document.getElementById('relTypeSelect').value;
        const score = parseInt(document.getElementById('relScoreInput').value) || 0;
        const editId = document.getElementById('relEditId').textContent;

        if (!s1Id || !s2Id) { Toast.warning('请选择两名学生'); return; }
        if (s1Id === s2Id) { Toast.warning('不能选择同一名学生'); return; }

        // Check for duplicates (skip self and skip current edit)
        const dup = state.relationships.find(r =>
            r.id !== editId &&
            ((r.student1Id === s1Id && r.student2Id === s2Id) ||
             (r.student1Id === s2Id && r.student2Id === s1Id))
        );
        if (dup) { Toast.warning('这两个学生之间已存在关系'); return; }

        if (editId) {
            const rel = state.relationships.find(r => r.id === editId);
            if (rel) { rel.type = type; rel.score = score; }
        } else {
            state.relationships.push({
                id: 'rel_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                student1Id: s1Id, student2Id: s2Id, type, score
            });
        }

        saveConfig();
        this.renderRelationshipGrid();
        this.renderRelationshipPanel();
        Toast.success(editId ? '已更新关系' : '已添加关系');

        // Reset form
        document.getElementById('relStudent1Input').value = '';
        document.getElementById('relStudent2Input').value = '';
        document.getElementById('relStudent1Id').textContent = '';
        document.getElementById('relStudent2Id').textContent = '';
        document.getElementById('relEditId').textContent = '';
        document.getElementById('relTypeSelect').value = state.relationshipPresets[0].type;
        document.getElementById('relScoreSlider').value = state.relationshipPresets[0].defaultScore;
        document.getElementById('relScoreInput').value = state.relationshipPresets[0].defaultScore;
        const titleEl = document.getElementById('relFormTitle');
        if (titleEl) titleEl.textContent = '➕ 添加关系';
        // Refresh the graph
        this._refreshRelGraph();
    },
    deleteRelationship(id) {
        if (!confirm('确认删除该关系？')) return;
        state.relationships = state.relationships.filter(r => r.id !== id);
        saveConfig();
        this.renderRelationshipGrid();
        this.renderRelationshipPanel();
        Toast.success('已删除关系');
        this._refreshRelGraph();
    },
    clearAllRelationships() {
        if (!confirm('确认清空所有关系数据？此操作不可撤销！')) return;
        state.relationships = [];
        saveConfig();
        this.renderRelationshipGrid();
        this.renderRelationshipPanel();
        Toast.success('已清空所有关系');
        this._refreshRelGraph();
    },
    _refreshRelGraph() {
        if (typeof RelGraph !== 'undefined' && document.getElementById('relGraphModal')?.classList.contains('active')) {
            RelGraph.buildGraph();
            RelGraph.draw();
            RelGraph.renderStats();
        }
    },
    exportRelationships() {
        if (!state.relationships || state.relationships.length === 0) {
            Toast.warning('暂无关系数据可导出');
            return;
        }
        const data = { relationships: state.relationships };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.download = `关系网络_${this.getTimestamp()}.json`;
        link.href = URL.createObjectURL(blob); link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        Toast.success('已导出关系网络');
    },
    importRelationships() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (!data.relationships || !Array.isArray(data.relationships)) {
                        Toast.error('无效的关系数据文件');
                        return;
                    }
                    const before = state.relationships.length;
                    data.relationships.forEach(rel => {
                        if (rel.student1Id && rel.student2Id && rel.type) {
                            // Avoid duplicates
                            const dup = state.relationships.find(r =>
                                (r.student1Id === rel.student1Id && r.student2Id === rel.student2Id) ||
                                (r.student1Id === rel.student2Id && r.student2Id === rel.student1Id)
                            );
                            if (!dup) {
                                state.relationships.push({
                                    id: 'rel_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                                    student1Id: rel.student1Id, student2Id: rel.student2Id,
                                    type: rel.type, score: rel.score || 0
                                });
                            }
                        }
                    });
                    saveConfig();
                    this.renderRelationshipGrid();
                    this.renderRelationshipPanel();
                    this._refreshRelGraph();
                    Toast.success(`导入完成：新增 ${state.relationships.length - before} 条关系`);
                } catch (err) {
                    Toast.error('文件解析失败：' + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },
    _relStudentSearchTerm: '',
    _relActiveInput: null,
    initRelStudentSearch(inputId, hiddenId) {
        const input = document.getElementById(inputId);
        const hidden = document.getElementById(hiddenId);
        if (!input || !hidden) return;

        const dropdown = document.createElement('div');
        dropdown.className = 'rel-student-dropdown';
        dropdown.id = inputId + 'Dropdown';
        input.parentNode.style.position = 'relative';
        input.parentNode.appendChild(dropdown);

        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            if (!q) { dropdown.style.display = 'none'; hidden.textContent = ''; return; }

            const matches = state.students.filter(s =>
                s.name.toLowerCase().includes(q) || (s.pinyin && s.pinyin.toLowerCase().includes(q))
            ).slice(0, 10);

            if (matches.length === 0) { dropdown.style.display = 'none'; return; }

            dropdown.innerHTML = matches.map((s, i) =>
                `<div class="dropdown-item ${i === 0 ? 'active' : ''}" data-student-id="${s.id}">${escapeHtml(s.name)}${s.score !== null && s.score !== undefined ? ` (${s.score}分)` : ''}</div>`
            ).join('');
            dropdown.style.display = 'block';

            dropdown.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    input.value = item.textContent.split(' (')[0];
                    hidden.textContent = item.dataset.studentId;
                    dropdown.style.display = 'none';
                });
            });
        });

        input.addEventListener('blur', () => {
            setTimeout(() => { dropdown.style.display = 'none'; }, 200);
        });

        input.addEventListener('focus', () => {
            if (dropdown.children.length > 0) dropdown.style.display = 'block';
        });

        input.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.dropdown-item');
            if (!items.length) return;
            let idx = Array.from(items).findIndex(el => el.classList.contains('active'));
            if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); }
            else if (e.key === 'Enter') { e.preventDefault(); if (idx >= 0) items[idx].click(); return; }
            else return;
            items.forEach(el => el.classList.remove('active'));
            items[idx].classList.add('active');
        });
    },

    // ==================== Custom Algorithm Management ====================
    renderCustomAlgoList() {
        const container = document.getElementById('customAlgoList');
        const display = document.getElementById('currentAlgoDisplay');
        if (!container) return;
        const algos = this._customAlgorithms || {};
        const algoNames = Object.keys(algos);
        if (algoNames.length === 0) {
            container.innerHTML = '<span style="color:var(--text-tertiary);">暂无自定义算法</span>';
            if (display) display.textContent = '内置算法 (CompositeEval)';
            return;
        }
        container.innerHTML = algoNames.map(name => {
            const algo = algos[name];
            const isActive = this._customAlgorithm?.name === name;
            return `<div class="algo-import-card ${isActive ? 'algo-import-active' : ''}" data-algo-name="${name}">
                <div><div class="algo-import-name">${escapeHtml(algo.name)} <span style="font-size:10px;color:var(--text-tertiary);">v${escapeHtml(algo.version || '1.0')}</span></div><div class="algo-import-desc">${escapeHtml(algo.description || '')}</div></div>
                <div style="display:flex;gap:4px;align-items:center;">
                    ${isActive ? '<span class="detail-badge positive">使用中</span>' : `<button class="btn btn-ghost btn-sm" data-activate-algo="${name}">激活</button>`}
                    <button class="btn btn-danger btn-icon btn-sm" data-remove-algo="${name}" style="width:24px;height:24px;min-width:24px;font-size:10px;">✕</button>
                </div>
            </div>`;
        }).join('');
        container.querySelectorAll('[data-activate-algo]').forEach(btn => {
            btn.addEventListener('click', () => {
                this._customAlgorithm = algos[btn.dataset.activateAlgo];
                Toast.success(`已切换到算法: ${btn.dataset.activateAlgo}`);
                this.renderCustomAlgoList();
            });
        });
        container.querySelectorAll('[data-remove-algo]').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.removeAlgo;
                delete algos[name];
                if (this._customAlgorithm?.name === name) this._customAlgorithm = null;
                this.renderCustomAlgoList();
                Toast.success(`已移除算法: ${name}`);
            });
        });
        if (display) display.textContent = this._customAlgorithm ? `自定义: ${this._customAlgorithm.name}` : '内置算法 (CompositeEval)';
    },

    _downloadAlgoTemplate() {
        const tpl = `// 座位编排系统 - 自定义推荐算法模板
// 导入方式：智能推荐面板 → 🧬 自定义算法 → 导入算法文件

const CustomAlgorithm = {
    name: "我的自定义算法",
    version: "1.0.0",
    description: "自定义座位推荐算法",

    /**
     * 计算两名学生的良性影响分 (核心方法)
     * @param {Object} s1 - 学生对象 { name, gender, lunch, scores, personality, hobbies, position }
     * @param {Object} s2 - 学生对象
     * @param {Object} context - { seats, settings, rows, cols }
     * @returns {number} 分数越高表示越应该坐在一起
     */
    peerInfluence(s1, s2, context) {
        let score = 0;

        // 示例：学业互补
        const avg1 = Object.values(s1.scores || {}).reduce((a,b) => a+b, 0) / Math.max(1, Object.keys(s1.scores || {}).length);
        const avg2 = Object.values(s2.scores || {}).reduce((a,b) => a+b, 0) / Math.max(1, Object.keys(s2.scores || {}).length);
        const diff = Math.abs(avg1 - avg2);
        if (diff > 15 && diff < 40) score += 20;
        else if (diff <= 15) score += 10;

        // 示例：性格互补
        if (s1.personality === '外向' && s2.personality === '内向') score += 15;
        else if (s1.personality === '内向' && s2.personality === '外向') score += 15;

        // 在此添加你的自定义逻辑...
        return score;
    },

    /**
     * 生成互换推荐 (可选，不实现则使用内置逻辑)
     * @param {Array} seatedStudents - [{student, seat}]
     * @param {Object} context
     * @returns {Array} [{seat1, seat2, reason, priority}]
     */
    generateRecommendations(seatedStudents, context) {
        return [];
    },

    /**
     * 计算学生综合评分 (可选，用于热力图)
     * @param {Object} student
     * @returns {number} 0-100
     */
    getScore(student) {
        return 50;
    }
};

AlgorithmRegistry.register(CustomAlgorithm);
`;
        const blob = new Blob([tpl], { type: 'text/javascript;charset=utf-8' });
        const link = document.createElement('a');
        link.download = '自定义推荐算法模板.js';
        link.href = URL.createObjectURL(blob); link.click();
        Toast.success('算法模板已下载');
    },

    // ==================== [FEATURE] Monte Carlo Simulation v2 ====================
    // --- Simulation Worker (inline Blob URL) ---
    _createSimWorker() {
        const workerCode = `
            'use strict';
            let _state = null;
            let _cancelled = false;

            self.onmessage = function(e) {
                const msg = e.data;
                if (msg.type === 'init') {
                    _state = msg.state;
                    _cancelled = false;
                } else if (msg.type === 'cancel') {
                    _cancelled = true;
                } else if (msg.type === 'run') {
                    _cancelled = false;
                    runBatch(msg.startIdx, msg.count, msg.seed);
                }
            };

            // Seeded PRNG (xoshiro128**)
            function makeRNG(seed) {
                let s = [seed, seed ^ 0x5DEECE66D, seed ^ 0xBB20B4600, seed ^ 0xD4B6D800];
                if (s[0] === 0) s[0] = 1;
                return function() {
                    const result = (s[1] * 5) | 0;
                    const t = s[1] << 9;
                    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
                    s[2] ^= t;
                    s[3] = (s[3] << 11) | (s[3] >>> 21);
                    return (result >>> 0) / 4294967296;
                };
            }

            function runBatch(startIdx, count, seed) {
                const st = _state;
                if (!st || !st.students || !st.seats) {
                    self.postMessage({ type: 'error', message: 'Invalid state' });
                    return;
                }
                const students = st.students;
                const seats = st.seats;
                const rows = st.rows, cols = st.cols;
                const platformLeft = st.platformLeft;
                const platformRight = st.platformRight;
                const drawOrder = st.drawOrder;
                const blacklist = st.blacklist || [];
                const whitelist = st.whitelist || [];
                const settings = st.settings || {};
                const includePlatform = st.includePlatform !== false;
                const rng = makeRNG(seed + startIdx);

                const seatFreq = {};
                seats.forEach((s, i) => { seatFreq[i] = {}; });
                if (includePlatform) {
                    seatFreq['pl'] = {};
                    seatFreq['pr'] = {};
                }
                const pairFreq = {};

                for (let sim = 0; sim < count; sim++) {
                    if (_cancelled) {
                        self.postMessage({ type: 'cancelled', processed: sim });
                        return;
                    }
                    // Reset for this sim
                    const remaining = students.map(s => ({ ...s }));
                    const drawn = [];
                    const simSeats = seats.map(s => ({ ...s, student: null }));
                    let pL = { ...platformLeft, student: null };
                    let pR = { ...platformRight, student: null };
                    let drawIdx = 0;

                    // Build draw order
                    const simDrawOrder = [];
                    if (includePlatform && !pR.disabled) simDrawOrder.push({ seat: pR, type: 'pr' });
                    if (includePlatform && !pL.disabled) simDrawOrder.push({ seat: pL, type: 'pl' });
                    simSeats.forEach((s, i) => { if (!s.disabled) simDrawOrder.push({ seat: s, type: 'normal', idx: i }); });

                    while (remaining.length > 0 && drawIdx < simDrawOrder.length) {
                        const entry = simDrawOrder[drawIdx];
                        const target = entry.seat;

                        // Calculate probabilities
                        const probs = {};
                        remaining.forEach(s => { probs[s.id] = 1; });

                        // Apply blacklist
                        if (settings.antiCluster) {
                            const drawnSeats = [];
                            simSeats.forEach((s, i) => { if (s.student) drawnSeats.push({ student: s.student, row: s.row, col: s.col, idx: i }); });
                            if (pL.student) drawnSeats.push({ student: pL.student, row: pL.row, col: pL.col, idx: 'pl' });
                            if (pR.student) drawnSeats.push({ student: pR.student, row: pR.row, col: pR.col, idx: 'pr' });

                            blacklist.forEach(group => {
                                const cleanGroup = group.map(g => g.replace(/^\\*/, '').replace(/^[（(]/, '').replace(/[）)]$/, ''));
                                const drawnInGroup = cleanGroup.filter(name => drawnSeats.some(s => s.student.name === name));
                                if (drawnInGroup.length === 0) return;
                                const anchor = drawnInGroup[0];
                                const anchorSeat = drawnSeats.find(s => s.student.name === anchor);
                                if (!anchorSeat) return;
                                remaining.forEach(student => {
                                    if (!cleanGroup.includes(student.name)) return;
                                    const dist = Math.abs(anchorSeat.row - target.row) + Math.abs(anchorSeat.col - target.col);
                                    if (dist <= (settings.blacklistRadius || 2)) {
                                        probs[student.id] *= Math.max(0.001, 1 - (settings.blacklistPenalty || 95) / 100);
                                    }
                                });
                            });

                            // Apply whitelist
                            whitelist.forEach(group => {
                                const cleanGroup = group.map(g => g.replace(/^\\*/, '').replace(/^[（(]/, '').replace(/[）)]$/, ''));
                                const drawnInGroup = cleanGroup.filter(name => drawnSeats.some(s => s.student.name === name));
                                if (drawnInGroup.length === 0) return;
                                remaining.forEach(student => {
                                    if (!cleanGroup.includes(student.name)) return;
                                    let bestBonus = 0;
                                    drawnInGroup.forEach(dn => {
                                        const ds = drawnSeats.find(s => s.student.name === dn);
                                        if (!ds) return;
                                        const rowDiff = Math.abs(ds.row - target.row);
                                        const colDiff = Math.abs(ds.col - target.col);
                                        let bonus = 0;
                                        if (rowDiff === 0 && colDiff === 1) bonus = (settings.whitelistDeskBonus || 200) / 100;
                                        else if (rowDiff === 1 && colDiff === 0) bonus = (settings.whitelistFrontBackBonus || 120) / 100;
                                        else if (rowDiff === 1 && colDiff === 1) bonus = (settings.whitelistDiagonalBonus || 60) / 100;
                                        else if (Math.abs(ds.row - target.row) + Math.abs(ds.col - target.col) <= 5) bonus = (settings.whitelistFallbackBonus || 150) / 100;
                                        bestBonus = Math.max(bestBonus, bonus);
                                    });
                                    if (bestBonus > 0) probs[student.id] *= Math.pow(1 + bestBonus, 3);
                                });
                            });
                        }

                        // Clamp and normalize
                        let total = 0;
                        remaining.forEach(s => { probs[s.id] = Math.max(probs[s.id], 0.001); total += probs[s.id]; });
                        remaining.forEach(s => { probs[s.id] /= total; });

                        // Weighted random pick
                        let r = rng();
                        let cumulative = 0;
                        let picked = remaining[remaining.length - 1];
                        for (let i = 0; i < remaining.length; i++) {
                            cumulative += probs[remaining[i].id];
                            if (r <= cumulative) { picked = remaining[i]; break; }
                        }

                        // Place student
                        target.student = picked;
                        const rIdx = remaining.findIndex(s => s.id === picked.id);
                        if (rIdx >= 0) remaining.splice(rIdx, 1);
                        drawn.push(picked);
                        drawIdx++;

                        // Record frequency
                        if (entry.type === 'normal') {
                            seatFreq[entry.idx][picked.id] = (seatFreq[entry.idx][picked.id] || 0) + 1;
                        } else {
                            seatFreq[entry.type][picked.id] = (seatFreq[entry.type][picked.id] || 0) + 1;
                        }
                    }

                    // Record adjacent pairs
                    for (let i = 0; i < simSeats.length; i++) {
                        const s = simSeats[i];
                        if (!s.student) continue;
                        const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
                        for (const [dr, dc] of dirs) {
                            const nr = s.row + dr, nc = s.col + dc;
                            if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                                const n = simSeats[nr * cols + nc];
                                if (n && n.student) {
                                    const key = Math.min(s.student.id, n.student.id) + '-' + Math.max(s.student.id, n.student.id);
                                    pairFreq[key] = (pairFreq[key] || 0) + 1;
                                }
                            }
                        }
                    }
                    // Platform neighbors
                    if (includePlatform) {
                        [{ seat: pL, type: 'pl' }, { seat: pR, type: 'pr' }].forEach(p => {
                            if (!p.seat.student) return;
                            simSeats.forEach(s => {
                                if (!s.student) return;
                                if (Math.abs(s.row - p.seat.row) <= 1 && Math.abs(s.col - p.seat.col) <= 1) {
                                    const key = Math.min(p.seat.student.id, s.student.id) + '-' + Math.max(p.seat.student.id, s.student.id);
                                    pairFreq[key] = (pairFreq[key] || 0) + 1;
                                }
                            });
                        });
                    }
                }

                self.postMessage({
                    type: 'batch_done',
                    seatFreq: seatFreq,
                    pairFreq: pairFreq,
                    processed: count
                });
            }
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    },

    // --- Progress Panel ---
    _simProgressPanel: null,
    _simCancelled: false,
    _simWorker: null,

    _createProgressPanel() {
        // Remove existing panel if any
        if (this._simProgressPanel) { this._simProgressPanel.remove(); this._simProgressPanel = null; }

        const panel = document.createElement('div');
        panel.className = 'sim-progress-panel';
        panel.innerHTML = `
            <div class="spp-header">
                <span class="spp-title">🧪 蒙特卡洛预演</span>
                <button class="spp-close" id="sppClose">✕</button>
            </div>
            <div class="spp-body">
                <div class="spp-ring-container">
                    <svg class="spp-ring" viewBox="0 0 80 80">
                        <circle class="spp-ring-bg" cx="40" cy="40" r="34" />
                        <circle class="spp-ring-fg" id="sppRingFg" cx="40" cy="40" r="34" />
                    </svg>
                    <span class="spp-ring-text" id="sppRingText">0%</span>
                </div>
                <div class="spp-info">
                    <div class="spp-row"><span>进度</span><span id="sppProgress">0 / 0</span></div>
                    <div class="spp-row"><span>已用时间</span><span id="sppElapsed">0s</span></div>
                    <div class="spp-row"><span>预计剩余</span><span id="sppETA">计算中...</span></div>
                </div>
                <div class="spp-alerts" id="sppAlerts"></div>
                <button class="btn btn-danger btn-sm spp-cancel" id="sppCancel">⏹ 取消模拟</button>
            </div>
        `;
        document.body.appendChild(panel);
        this._simProgressPanel = panel;

        // Make draggable
        makeDraggable(panel);

        // Close button
        panel.querySelector('#sppClose').addEventListener('click', () => {
            if (this._simWorker) { this._simCancelled = true; this._simWorker.postMessage({ type: 'cancel' }); }
            panel.remove();
            this._simProgressPanel = null;
        });
        panel.querySelector('#sppCancel').addEventListener('click', () => {
            this._simCancelled = true;
            if (this._simWorker) this._simWorker.postMessage({ type: 'cancel' });
            document.getElementById('sppCancel').textContent = '⏹ 正在取消...';
            document.getElementById('sppCancel').disabled = true;
        });

        return panel;
    },

    _updateProgress(completed, total, startTime) {
        const pct = Math.round(completed / total * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = completed / elapsed;
        const remaining = total - completed;
        const eta = rate > 0 ? Math.ceil(remaining / rate) : 0;

        const ring = document.getElementById('sppRingFg');
        if (ring) {
            const circumference = 2 * Math.PI * 34;
            ring.style.strokeDasharray = circumference;
            ring.style.strokeDashoffset = circumference * (1 - completed / total);
        }
        const ringText = document.getElementById('sppRingText');
        if (ringText) ringText.textContent = pct + '%';
        const progEl = document.getElementById('sppProgress');
        if (progEl) progEl.textContent = `${completed} / ${total}`;
        const elapsedEl = document.getElementById('sppElapsed');
        if (elapsedEl) elapsedEl.textContent = elapsed < 60 ? Math.round(elapsed) + 's' : Math.floor(elapsed / 60) + 'm ' + Math.round(elapsed % 60) + 's';
        const etaEl = document.getElementById('sppETA');
        if (etaEl) {
            if (completed >= total) etaEl.textContent = '完成！';
            else if (eta < 60) etaEl.textContent = eta + 's';
            else etaEl.textContent = Math.floor(eta / 60) + 'm ' + (eta % 60) + 's';
        }
    },

    _updateAlerts(pairFreq, numSim) {
        const alertsEl = document.getElementById('sppAlerts');
        if (!alertsEl) return;
        // Find top 3 most frequent adjacent pairs
        const pairs = Object.entries(pairFreq)
            .map(([key, count]) => {
                const [id1, id2] = key.split('-').map(Number);
                const s1 = state.students.find(s => s.id === id1);
                const s2 = state.students.find(s => s.id === id2);
                return { s1, s2, count, pct: Math.round(count / numSim * 100) };
            })
            .filter(p => p.s1 && p.s2)
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);

        if (pairs.length === 0) { alertsEl.innerHTML = ''; return; }

        alertsEl.innerHTML = '<div class="spp-alert-title">⚡ 高频相邻配对</div>' +
            pairs.map(p => `<div class="spp-alert-item">${escapeHtml(p.s1.name)} ↔ ${escapeHtml(p.s2.name)} <span class="spp-alert-pct">${p.pct}%</span></div>`).join('');
    },

    // --- Configuration Panel ---
    _showSimConfig() {
        return new Promise((resolve) => {
            const modal = document.getElementById('statsModal');
            const content = document.getElementById('statsContent');
            const platformSeats = [state.platformLeft, state.platformRight].filter(s => !s.disabled && state['show' + (s.type === 'platform-left' ? 'PlatformLeft' : 'PlatformRight')]).length;
            const normalSeats = state.seats.filter(s => !s.disabled).length;
            const totalSeats = normalSeats + platformSeats;
            const studentCount = state.students.length;
            const isLarge = studentCount > 100 || totalSeats > 200;
            const defaultSims = isLarge ? 200 : 1000;

            content.innerHTML = `
                <div class="sim-config">
                    <div class="sim-config-section">
                        <h4>📊 模拟参数</h4>
                        <div class="form-group" style="margin-bottom:12px;">
                            <label class="form-label">模拟次数</label>
                            <div class="btn-group" style="margin-bottom:6px;">
                                <button class="btn btn-secondary btn-sm sim-count-btn" data-count="100">100</button>
                                <button class="btn btn-secondary btn-sm sim-count-btn" data-count="500">500</button>
                                <button class="btn btn-secondary btn-sm sim-count-btn${defaultSims===1000?' active':''}" data-count="1000">1000</button>
                                <button class="btn btn-secondary btn-sm sim-count-btn" data-count="5000">5000</button>
                            </div>
                            <input type="number" class="form-input" id="simCountInput" value="${defaultSims}" min="10" max="50000" placeholder="自定义次数">
                            ${isLarge ? '<div class="form-hint" style="color:var(--warning);">⚠️ 检测到大规模数据 (' + studentCount + '人/' + totalSeats + '座)，已自动降低默认次数。</div>' : ''}
                        </div>
                        <div class="form-group" style="margin-bottom:12px;">
                            <label class="form-label">随机种子 (可选，留空则随机)</label>
                            <input type="number" class="form-input" id="simSeedInput" value="" placeholder="如 42 用于重现结果">
                        </div>
                        <div class="form-checkbox">
                            <input type="checkbox" id="simIncludePlatform" checked>
                            <label for="simIncludePlatform">包含讲台座位 (${platformSeats}个)</label>
                        </div>
                    </div>
                    <div class="sim-config-section">
                        <h4>ℹ️ 当前布局</h4>
                        <div class="sim-config-info">
                            <span>学生: ${studentCount}人</span>
                            <span>普通座位: ${normalSeats}个</span>
                            <span>讲台座位: ${platformSeats}个</span>
                            <span>黑名单规则: ${state.blacklist.length}组</span>
                            <span>白名单规则: ${state.whitelist.length}组</span>
                        </div>
                    </div>
                </div>
            `;

            // Quick count buttons
            content.querySelectorAll('.sim-count-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    content.querySelectorAll('.sim-count-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    document.getElementById('simCountInput').value = btn.dataset.count;
                });
            });

            modal.classList.add('active');

            // Override the modal's existing footer buttons or add new ones
            const footer = modal.querySelector('.modal-footer');
            const oldFooterHTML = footer ? footer.innerHTML : '';
            if (footer) {
                footer.innerHTML = `<button class="btn btn-secondary" id="simConfigCancel">取消</button><button class="btn btn-primary" id="simConfigStart">🚀 开始预演</button>`;
                document.getElementById('simConfigCancel').addEventListener('click', () => {
                    modal.classList.remove('active');
                    if (footer) footer.innerHTML = oldFooterHTML;
                    resolve(null);
                });
                document.getElementById('simConfigStart').addEventListener('click', () => {
                    const count = parseInt(document.getElementById('simCountInput').value) || defaultSims;
                    const seed = parseInt(document.getElementById('simSeedInput').value) || Math.floor(Math.random() * 1000000);
                    const includePlatform = document.getElementById('simIncludePlatform').checked;
                    modal.classList.remove('active');
                    if (footer) footer.innerHTML = oldFooterHTML;
                    resolve({ count: Math.min(Math.max(count, 10), 50000), seed, includePlatform });
                });
            } else {
                resolve({ count: defaultSims, seed: Math.floor(Math.random() * 1000000), includePlatform: true });
            }
        });
    },

    // --- Main Simulation Runner ---
    async runMonteCarloSimulation(numSimulations, options = {}) {
        // Show config panel if no explicit count
        if (!numSimulations) {
            const config = await this._showSimConfig();
            if (!config) return;
            numSimulations = config.count;
            options = config;
        }

        const totalSims = numSimulations;
        const seed = options.seed || Math.floor(Math.random() * 1000000);
        const includePlatform = options.includePlatform !== false;

        // Terminate any existing simulation worker before starting a new one
        if (this._simWorker) { this._simWorker.terminate(); this._simWorker = null; }
        // Create progress panel
        this._simCancelled = false;
        this._createProgressPanel();

        // Serialize state for worker
        const serializedState = {
            students: state.students.map(s => ({ id: s.id, name: s.name, gender: s.gender, lunch: s.lunch })),
            seats: state.seats.map(s => ({ row: s.row, col: s.col, disabled: s.disabled, number: s.number })),
            rows: state.rows,
            cols: state.cols,
            platformLeft: { row: state.platformLeft.row, col: state.platformLeft.col, disabled: state.platformLeft.disabled },
            platformRight: { row: state.platformRight.row, col: state.platformRight.col, disabled: state.platformRight.disabled },
            drawOrder: state.drawOrder.map(s => ({ row: s.row, col: s.col, type: s.type, disabled: s.disabled })),
            blacklist: state.blacklist,
            whitelist: state.whitelist,
            settings: { ...state.settings },
            includePlatform: includePlatform
        };

        // Create worker
        try {
            this._simWorker = this._createSimWorker();
        } catch (err) {
            Toast.error('无法创建模拟 Worker: ' + err.message);
            if (this._simProgressPanel) { this._simProgressPanel.remove(); this._simProgressPanel = null; }
            return;
        }

        const worker = this._simWorker;
        const startTime = Date.now();
        const mergedSeatFreq = {};
        const mergedPairFreq = {};
        let completed = 0;

        // Chunk config
        const CHUNK_SIZE = Math.max(10, Math.min(50, Math.ceil(totalSims / 20)));
        const chunks = [];
        for (let i = 0; i < totalSims; i += CHUNK_SIZE) {
            chunks.push({ startIdx: i, count: Math.min(CHUNK_SIZE, totalSims - i) });
        }
        let chunkIdx = 0;

        return new Promise((resolve) => {
            worker.onmessage = (e) => {
                const msg = e.data;
                if (msg.type === 'batch_done') {
                    // Merge results
                    Object.entries(msg.seatFreq).forEach(([idx, freq]) => {
                        if (!mergedSeatFreq[idx]) mergedSeatFreq[idx] = {};
                        Object.entries(freq).forEach(([sid, count]) => {
                            mergedSeatFreq[idx][sid] = (mergedSeatFreq[idx][sid] || 0) + count;
                        });
                    });
                    Object.entries(msg.pairFreq).forEach(([key, count]) => {
                        mergedPairFreq[key] = (mergedPairFreq[key] || 0) + count;
                    });
                    completed += msg.processed;

                    // Update progress
                    this._updateProgress(completed, totalSims, startTime);
                    this._updateAlerts(mergedPairFreq, completed);

                    // Send next chunk or finish
                    chunkIdx++;
                    if (chunkIdx < chunks.length && !this._simCancelled) {
                        const chunk = chunks[chunkIdx];
                        worker.postMessage({ type: 'run', startIdx: chunk.startIdx, count: chunk.count, seed: seed });
                    } else {
                        // Done
                        worker.terminate();
                        this._simWorker = null;
                        this._onSimulationComplete(mergedSeatFreq, mergedPairFreq, completed, startTime, resolve);
                    }
                } else if (msg.type === 'cancelled') {
                    completed += msg.processed;
                    worker.terminate();
                    this._simWorker = null;
                    Toast.info(`模拟已取消，已完成 ${completed} 次`);
                    if (completed > 0) {
                        this._onSimulationComplete(mergedSeatFreq, mergedPairFreq, completed, startTime, resolve);
                    } else {
                        if (this._simProgressPanel) { this._simProgressPanel.remove(); this._simProgressPanel = null; }
                        resolve(null);
                    }
                } else if (msg.type === 'error') {
                    worker.terminate();
                    this._simWorker = null;
                    Toast.error('模拟 Worker 错误: ' + msg.message);
                    if (this._simProgressPanel) { this._simProgressPanel.remove(); this._simProgressPanel = null; }
                    resolve(null);
                }
            };

            worker.onerror = (err) => {
                worker.terminate();
                this._simWorker = null;
                Toast.error('模拟 Worker 崩溃: ' + (err.message || '未知错误'));
                if (completed > 0) {
                    Toast.warning('已保留部分结果 (' + completed + ' 次)');
                    this._onSimulationComplete(mergedSeatFreq, mergedPairFreq, completed, startTime, resolve);
                } else {
                    if (this._simProgressPanel) { this._simProgressPanel.remove(); this._simProgressPanel = null; }
                    resolve(null);
                }
            };

            // Init and start first chunk
            worker.postMessage({ type: 'init', state: serializedState });
            const firstChunk = chunks[0];
            worker.postMessage({ type: 'run', startIdx: firstChunk.startIdx, count: firstChunk.count, seed: seed });
        });
    },

    _onSimulationComplete(seatFreq, pairFreq, numSim, startTime, resolve) {
        // Close progress panel
        if (this._simProgressPanel) {
            const cancelBtn = document.getElementById('sppCancel');
            if (cancelBtn) { cancelBtn.textContent = '✅ 完成'; cancelBtn.disabled = true; }
            setTimeout(() => {
                if (this._simProgressPanel) { this._simProgressPanel.remove(); this._simProgressPanel = null; }
            }, 2000);
        }

        // Process pair data
        const allPairs = [];
        Object.entries(pairFreq).forEach(([key, count]) => {
            const [id1, id2] = key.split('-').map(Number);
            const s1 = state.students.find(s => s.id === id1);
            const s2 = state.students.find(s => s.id === id2);
            if (s1 && s2) {
                allPairs.push({ s1, s2, count, probability: count / numSim });
            }
        });
        allPairs.sort((a, b) => b.count - a.count);

        // Compute seat entropy
        const seatEntropy = {};
        Object.entries(seatFreq).forEach(([idx, freq]) => {
            const total = Object.values(freq).reduce((a, b) => a + b, 0);
            if (total === 0) { seatEntropy[idx] = 0; return; }
            let entropy = 0;
            Object.values(freq).forEach(c => {
                const p = c / total;
                if (p > 0) entropy -= p * Math.log2(p);
            });
            seatEntropy[idx] = entropy;
        });

        // Gini coefficient for seat concentration
        const maxPercents = {};
        Object.entries(seatFreq).forEach(([idx, freq]) => {
            const total = Object.values(freq).reduce((a, b) => a + b, 0);
            if (total === 0) return;
            maxPercents[idx] = Math.max(...Object.values(freq)) / total;
        });
        const maxPctValues = Object.values(maxPercents);
        const gini = maxPctValues.length > 0 ? this._calcGini(maxPctValues) : 0;

        // Generate suggestions
        const suggestions = this._generateSuggestions(allPairs, numSim);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Show dashboard
        this._showMonteCarloDashboard(seatFreq, seatEntropy, allPairs, numSim, elapsed, gini, suggestions);
        Toast.success(`预演完成！${numSim} 次模拟，耗时 ${elapsed}s`);
        resolve && resolve({ seatFreq, pairFreq: allPairs, numSim, seatEntropy, gini, suggestions });
    },

    _calcGini(values) {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const n = sorted.length;
        const mean = sorted.reduce((a, b) => a + b, 0) / n;
        if (mean === 0) return 0;
        let sumDiff = 0;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                sumDiff += Math.abs(sorted[i] - sorted[j]);
            }
        }
        return sumDiff / (2 * n * n * mean);
    },

    _generateSuggestions(pairs, numSim) {
        const suggestions = [];
        // High-frequency adjacent pairs that might need blacklist
        const highFreqPairs = pairs.filter(p => p.probability > 0.3).slice(0, 5);
        highFreqPairs.forEach(p => {
            const inBlacklist = state.blacklist.some(group => {
                const names = group.map(g => g.replace(/^\*/, '').replace(/^[（(]/, '').replace(/[）)]$/, ''));
                return names.includes(p.s1.name) && names.includes(p.s2.name);
            });
            if (!inBlacklist) {
                suggestions.push({
                    type: 'blacklist',
                    priority: p.probability > 0.5 ? 'high' : 'medium',
                    text: `${p.s1.name} 和 ${p.s2.name} 在 ${Math.round(p.probability * 100)}% 的模拟中相邻`,
                    action: `建议将 ${p.s1.name} ${p.s2.name} 加入黑名单`,
                    group: [p.s1.name, p.s2.name]
                });
            }
        });

        // Unlikely pairs that might benefit from whitelist
        const lowFreqPairs = pairs.filter(p => p.probability < 0.02 && p.probability > 0).slice(-3);
        lowFreqPairs.forEach(p => {
            const inWhitelist = state.whitelist.some(group => {
                const names = group.map(g => g.replace(/^\*/, '').replace(/^[（(]/, '').replace(/[）)]$/, ''));
                return names.includes(p.s1.name) && names.includes(p.s2.name);
            });
            if (!inWhitelist) {
                suggestions.push({
                    type: 'whitelist',
                    priority: 'low',
                    text: `${p.s1.name} 和 ${p.s2.name} 仅在 ${Math.round(p.probability * 100)}% 的模拟中相邻`,
                    action: `若希望同座，可加入白名单`,
                    group: [p.s1.name, p.s2.name]
                });
            }
        });

        return suggestions;
    },

    // --- Dashboard ---
    _showMonteCarloDashboard(seatFreq, seatEntropy, allPairs, numSim, elapsed, gini, suggestions) {
        const modal = document.getElementById('statsModal');
        const content = document.getElementById('statsContent');

        // Top metrics
        const mostLikely = allPairs[0];
        const leastLikely = allPairs.filter(p => p.count > 0).slice(-1)[0] || allPairs[allPairs.length - 1];

        // Tab structure
        let html = `
            <div class="mc-dashboard">
                <div class="mc-metrics">
                    <div class="mc-metric-card"><div class="mc-metric-value">${numSim}</div><div class="mc-metric-label">模拟次数</div></div>
                    <div class="mc-metric-card"><div class="mc-metric-value">${elapsed}s</div><div class="mc-metric-label">耗时</div></div>
                    <div class="mc-metric-card"><div class="mc-metric-value">${mostLikely ? Math.round(mostLikely.probability * 100) + '%' : '-'}</div><div class="mc-metric-label">最高相邻率</div></div>
                    <div class="mc-metric-card"><div class="mc-metric-value">${(gini * 100).toFixed(1)}%</div><div class="mc-metric-label">集中度(Gini)</div></div>
                </div>
                <div class="mc-tabs">
                    <button class="mc-tab active" data-tab="heatmap">🗺️ 座位热力图</button>
                    <button class="mc-tab" data-tab="matrix">📊 关联矩阵</button>
                    <button class="mc-tab" data-tab="pairs">🔗 配对分析</button>
                    <button class="mc-tab" data-tab="suggest">💡 智能建议</button>
                </div>
                <div class="mc-tab-content" id="mcTabHeatmap">${this._buildHeatmapTab(seatFreq, seatEntropy, numSim)}</div>
                <div class="mc-tab-content" id="mcTabMatrix" style="display:none;">${this._buildMatrixTab(seatFreq, numSim)}</div>
                <div class="mc-tab-content" id="mcTabPairs" style="display:none;">${this._buildPairsTab(allPairs, numSim)}</div>
                <div class="mc-tab-content" id="mcTabSuggest" style="display:none;">${this._buildSuggestTab(suggestions)}</div>
            </div>
        `;

        content.innerHTML = html;
        modal.classList.add('active');

        // Tab switching
        content.querySelectorAll('.mc-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                content.querySelectorAll('.mc-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                content.querySelectorAll('.mc-tab-content').forEach(c => c.style.display = 'none');
                const tabName = tab.dataset.tab;
                const targetId = 'mcTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
                const target = document.getElementById(targetId);
                if (target) target.style.display = '';
            });
        });

        // Matrix cell click highlight
        content.addEventListener('click', e => {
            const cell = e.target.closest('.mc-matrix-cell');
            if (cell) {
                content.querySelectorAll('.mc-matrix-cell.highlight').forEach(c => c.classList.remove('highlight'));
                cell.classList.add('highlight');
            }
        });

        // Apply suggestion buttons
        content.querySelectorAll('.mc-suggest-apply').forEach(btn => {
            btn.addEventListener('click', () => {
                const group = btn.dataset.group;
                const type = btn.dataset.type;
                if (type === 'blacklist') {
                    const textarea = document.getElementById('blacklist');
                    if (textarea) {
                        const current = textarea.value.trim();
                        textarea.value = current ? current + '\n' + group : group;
                        textarea.dispatchEvent(new Event('input'));
                        Toast.success('已添加到黑名单');
                    }
                } else if (type === 'whitelist') {
                    const textarea = document.getElementById('whitelist');
                    if (textarea) {
                        const current = textarea.value.trim();
                        textarea.value = current ? current + '\n' + group : group;
                        textarea.dispatchEvent(new Event('input'));
                        Toast.success('已添加到白名单');
                    }
                }
            });
        });

        // Pairs sort handler
        const pairsSortSelect = document.getElementById('mcPairsSort');
        const pairsListEl = document.getElementById('mcPairsList');
        if (pairsSortSelect && pairsListEl) {
            const renderPairsSorted = (pairs, order) => {
                const sorted = [...pairs];
                if (order === 'asc') sorted.sort((a, b) => a.probability - b.probability);
                else sorted.sort((a, b) => b.probability - a.probability);
                pairsListEl.innerHTML = sorted.slice(0, 50).map(p => {
                    const pct = Math.round(p.probability * 100);
                    const barColor = pct > 50 ? 'var(--danger)' : pct > 20 ? 'var(--warning)' : 'var(--success)';
                    return `<div class="mc-pair-item">
                        <span class="mc-pair-names">${escapeHtml(p.s1.name)} ↔ ${escapeHtml(p.s2.name)}</span>
                        <div class="mc-pair-bar-track"><div class="mc-pair-bar-fill" style="width:${Math.max(pct, 2)}%;background:${barColor};"></div></div>
                        <span class="mc-pair-pct">${pct}% (${p.count}次)</span>
                    </div>`;
                }).join('');
            };
            pairsSortSelect.addEventListener('change', () => {
                renderPairsSorted(allPairs, pairsSortSelect.value);
            });
        }
    },

    _buildHeatmapTab(seatFreq, seatEntropy, numSim) {
        let html = '<div class="mc-heatmap">';
        html += '<div class="mc-heatmap-legend"><span class="mc-hl-item"><span class="mc-hl-dot" style="background:#34C759;"></span>低熵(确定)</span><span class="mc-hl-item"><span class="mc-hl-dot" style="background:#8E8E93;"></span>高熵(多样)</span></div>';
        html += '<div class="mc-heatmap-grid" style="display:grid;grid-template-columns:repeat(' + state.cols + ',1fr);gap:4px;">';

        for (let row = 0; row < state.rows; row++) {
            for (let col = 0; col < state.cols; col++) {
                const idx = row * state.cols + col;
                const seat = state.seats[idx];
                if (seat.disabled) {
                    html += '<div class="mc-heatmap-cell disabled"></div>';
                    continue;
                }
                const freq = seatFreq[idx] || {};
                const total = Object.values(freq).reduce((a, b) => a + b, 0);
                const entropy = seatEntropy[idx] || 0;
                const maxEntropy = Math.log2(Math.max(state.students.length, 2));
                const normEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

                // Color: low entropy = green, high entropy = gray
                const r = Math.round(52 + (142 - 52) * normEntropy);
                const g = Math.round(199 + (142 - 199) * normEntropy);
                const b = Math.round(89 + (147 - 89) * normEntropy);
                const bgColor = `rgb(${r},${g},${b})`;

                // Top student for this seat
                const topEntry = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
                const topStudent = topEntry ? state.students.find(s => s.id === parseInt(topEntry[0])) : null;
                const topPct = topEntry && total > 0 ? Math.round(topEntry[1] / total * 100) : 0;

                html += `<div class="mc-heatmap-cell" style="background:${bgColor};color:white;" title="座位${seat.number}\n熵值: ${entropy.toFixed(2)}\n${topStudent ? escapeHtml(topStudent.name) + ' ' + topPct + '%' : '无数据'}">
                    <div class="mc-hc-num">${seat.number}</div>
                    <div class="mc-hc-name">${topStudent ? escapeHtml(topStudent.name) : '-'}</div>
                    <div class="mc-hc-pct">${topPct}%</div>
                </div>`;
            }
        }
        html += '</div></div>';
        return html;
    },

    _buildMatrixTab(seatFreq, numSim) {
        // Show top students (rows) x top seats (columns) matrix
        const students = state.students.slice(0, 30); // Limit for display
        const seats = state.seats.filter(s => !s.disabled).slice(0, 20);

        let html = '<div class="mc-matrix-wrapper">';
        html += '<div class="mc-matrix-scroll">';
        html += '<table class="mc-matrix-table"><thead><tr><th class="mc-matrix-corner">学生\\座位</th>';
        seats.forEach(s => { html += `<th class="mc-matrix-header">${s.number}</th>`; });
        html += '</tr></thead><tbody>';

        students.forEach(student => {
            html += `<tr><td class="mc-matrix-row-header">${escapeHtml(student.name)}</td>`;
            seats.forEach(seat => {
                const freq = seatFreq[state.seats.indexOf(seat)] || {};
                const count = freq[student.id] || 0;
                const pct = numSim > 0 ? count / numSim : 0;
                const opacity = Math.min(pct * 3, 1); // Scale for visibility
                const bg = pct > 0.01 ? `rgba(0,122,255,${opacity})` : 'transparent';
                html += `<td class="mc-matrix-cell" style="background:${bg};" title="${escapeHtml(student.name)} → ${seat.number}号: ${(pct * 100).toFixed(1)}%">${pct > 0.01 ? (pct * 100).toFixed(0) + '%' : ''}</td>`;
            });
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        if (state.students.length > 30) html += `<div class="form-hint" style="margin-top:8px;">显示前 30 名学生 / ${state.students.length} 人</div>`;
        if (state.seats.filter(s => !s.disabled).length > 20) html += `<div class="form-hint">显示前 20 个座位 / ${state.seats.filter(s => !s.disabled).length} 个</div>`;
        html += '</div>';
        return html;
    },

    _buildPairsTab(allPairs, numSim) {
        let html = '<div class="mc-pairs">';
        html += '<div class="mc-pairs-controls">';
        html += '<select id="mcPairsSort" class="form-input" style="width:auto;font-size:12px;">';
        html += '<option value="desc">相邻率 从高到低</option>';
        html += '<option value="asc">相邻率 从低到高</option>';
        html += '</select>';
        html += `<span class="form-hint" style="margin-left:8px;">共 ${allPairs.length} 个配对</span>`;
        html += '</div>';
        html += '<div class="mc-pairs-list" id="mcPairsList">';

        const renderPairs = (pairs) => {
            return pairs.map(p => {
                const pct = Math.round(p.probability * 100);
                const barColor = pct > 50 ? 'var(--danger)' : pct > 20 ? 'var(--warning)' : 'var(--success)';
                return `<div class="mc-pair-item">
                    <span class="mc-pair-names">${escapeHtml(p.s1.name)} ↔ ${escapeHtml(p.s2.name)}</span>
                    <div class="mc-pair-bar-track"><div class="mc-pair-bar-fill" style="width:${Math.max(pct, 2)}%;background:${barColor};"></div></div>
                    <span class="mc-pair-pct">${pct}% (${p.count}次)</span>
                </div>`;
            }).join('');
        };

        html += renderPairs(allPairs.slice(0, 50));
        html += '</div>';
        if (allPairs.length > 50) html += `<div class="form-hint" style="margin-top:8px;">显示前 50 个配对 / ${allPairs.length} 个</div>`;
        html += '</div>';
        return html;
    },

    _buildSuggestTab(suggestions) {
        if (suggestions.length === 0) {
            return '<div class="mc-suggest-empty">🎉 当前布局表现良好，暂无调整建议。</div>';
        }
        let html = '<div class="mc-suggestions">';
        suggestions.forEach((s, i) => {
            const icon = s.type === 'blacklist' ? '🚫' : '🔗';
            const badgeClass = s.priority === 'high' ? 'high' : s.priority === 'medium' ? 'medium' : 'low';
            const badgeText = s.priority === 'high' ? '高' : s.priority === 'medium' ? '中' : '低';
            html += `<div class="mc-suggest-item">
                <div class="mc-suggest-header">
                    <span class="mc-suggest-icon">${icon}</span>
                    <span class="mc-suggest-badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="mc-suggest-text">${escapeHtml(s.text)}</div>
                <div class="mc-suggest-action">${escapeHtml(s.action)}</div>
                <button class="btn btn-primary btn-sm mc-suggest-apply" data-type="${s.type}" data-group="${escapeHtml(s.group.join(' '))}">应用</button>
            </div>`;
        });
        html += '</div>';
        return html;
    },

    // ==================== Pool Search Dropdown ====================
    renderPoolSearchDropdown(query) {
        const dropdown = document.getElementById('poolSearchDropdown');
        if (!dropdown) return;
        if (!query) { dropdown.classList.remove('open'); dropdown.style.top = ''; dropdown.style.left = ''; dropdown.style.width = ''; return; }

        // [FIX] Position dropdown with fixed coords to escape overflow:hidden
        const input = document.getElementById('poolSearch');
        if (input) {
            const rect = input.getBoundingClientRect();
            dropdown.style.top = (rect.bottom + 4) + 'px';
            dropdown.style.left = rect.left + 'px';
            dropdown.style.width = rect.width + 'px';
        }

        // [FIX #4] Use unified matchStudent
        const q = query.toLowerCase();
        const students = state.remainingStudents.filter(s => matchStudent(s, q)).slice(0, 10);

        if (students.length === 0) { dropdown.classList.remove('open'); return; }

        dropdown.innerHTML = students.map(s => {
            const meta = [];
            meta.push(s.gender === 'male' ? '♂' : '♀');
            if (s.lunch) meta.push('💤');
            const avg = CompositeEval.getAvgScore(s);
            if (avg !== null) meta.push(`📊${avg}`);
            if (s.personality) meta.push(s.personality);
            if (s.position) meta.push(s.position);
            return `<div class="smart-search-item" data-student-id="${s.id}"><span>${escapeHtml(s.name)}</span><span class="match-hint">${meta.join(' ')}</span></div>`;
        }).join('');

        dropdown.classList.add('open');
        dropdown.querySelectorAll('.smart-search-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.dataset.studentId);
                const student = state.remainingStudents.find(s => s.id === id);
                if (student) this.showStudentDetailFromPool(student);
                dropdown.classList.remove('open');
                document.getElementById('poolSearch').value = '';
            });
        });
    },

    showStudentDetailFromPool(student) {
        const modal = document.getElementById('studentDetailModal');
        document.getElementById('studentDetailName').textContent = `${student.name} 的详细信息`;

        let html = '';
        html += `<div class="detail-section"><div class="detail-section-title">👤 基本信息</div><div class="detail-grid">`;
        html += `<div class="detail-item"><span class="detail-item-label">姓名</span><span class="detail-item-value">${escapeHtml(student.name)}</span></div>`;
        html += `<div class="detail-item"><span class="detail-item-label">性别</span><span class="detail-item-value">${student.gender === 'male' ? '♂ 男' : '♀ 女'}</span></div>`;
        html += `<div class="detail-item"><span class="detail-item-label">午休</span><span class="detail-item-value">${student.lunch ? '💤 是' : '否'}</span></div>`;
        html += `<div class="detail-item"><span class="detail-item-label">状态</span><span class="detail-item-value">⏳ 待抽取</span></div>`;
        if (student.personality) html += `<div class="detail-item"><span class="detail-item-label">性格</span><span class="detail-item-value">${escapeHtml(student.personality)}</span></div>`;
        if (student.position) html += `<div class="detail-item"><span class="detail-item-label">职务</span><span class="detail-item-value">${escapeHtml(student.position)}</span></div>`;
        if (student.hobbies?.length > 0) html += `<div class="detail-item" style="grid-column:1/-1;"><span class="detail-item-label">爱好</span><span class="detail-item-value">${student.hobbies.map(h => escapeHtml(h)).join(' / ')}</span></div>`;
        html += `</div></div>`;

        const scores = student.scores || {};
        const scoreEntries = Object.entries(scores).filter(([k, v]) => v !== null && v !== undefined);
        if (scoreEntries.length > 0) {
            html += `<div class="detail-section"><div class="detail-section-title">📊 各科成绩</div>`;
            scoreEntries.forEach(([subj, score]) => {
                const color = score >= 90 ? 'var(--success)' : score >= 80 ? 'var(--primary)' : score >= 70 ? 'var(--warning)' : score >= 60 ? '#FF9500' : 'var(--danger)';
                html += `<div class="detail-score-bar"><span class="detail-score-label">${subj}</span><div class="detail-score-track"><div class="detail-score-fill" style="width:${score}%;background:${color};">${score}</div></div></div>`;
            });
            html += `</div>`;
        }

        const compositeScore = CompositeEval.getScore(student);
        const avgScore = CompositeEval.getAvgScore(student);
        html += `<div class="detail-section"><div class="detail-section-title">🏆 综合评价</div>`;
        html += `<div class="detail-grid">`;
        html += `<div class="detail-item"><span class="detail-item-label">综合评分</span><span class="detail-item-value" style="color:var(--primary);font-size:16px;">${compositeScore}</span></div>`;
        html += `<div class="detail-item"><span class="detail-item-label">平均成绩</span><span class="detail-item-value">${avgScore ?? 'N/A'}</span></div>`;
        html += `</div></div>`;

        document.getElementById('studentDetailContent').innerHTML = html;
        modal.classList.add('active');
        document.getElementById('closeStudentDetail').onclick = () => modal.classList.remove('active');
        document.getElementById('closeStudentDetailBtn').onclick = () => modal.classList.remove('active');
        document.getElementById('locateStudentBtn').style.display = 'none';
        document.getElementById('locateStudentBtn').onclick = () => modal.classList.remove('active');
        // [FIX #8] Edit button handler for pool students
        document.getElementById('editStudentBtn').style.display = '';
        document.getElementById('editStudentBtn').onclick = () => {
            const content = document.getElementById('studentDetailContent');
            const editHtml = `<div class="detail-section"><div class="detail-section-title">✏️ 编辑信息</div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">姓名</label><input class="form-input" id="editName" value="${escapeHtml(student.name)}"></div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">性别</label><select class="form-input" id="editGender"><option value="male" ${student.gender==='male'?'selected':''}>♂ 男</option><option value="female" ${student.gender==='female'?'selected':''}>♀ 女</option></select></div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">午休</label><select class="form-input" id="editLunch"><option value="true" ${student.lunch?'selected':''}>是</option><option value="false" ${!student.lunch?'selected':''}>否</option></select></div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">性格</label><input class="form-input" id="editPersonality" value="${escapeHtml(student.personality||'')}"></div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">职务</label><input class="form-input" id="editPosition" value="${escapeHtml(student.position||'')}"></div>
                <div class="form-group" style="margin-bottom:8px;"><label class="form-label">爱好 (逗号分隔)</label><input class="form-input" id="editHobbies" value="${escapeHtml((student.hobbies||[]).join(','))}"></div>
                <button class="btn btn-primary" id="saveEditBtn" style="margin-top:8px;">💾 保存</button>
            </div>`;
            content.innerHTML = editHtml;
            document.getElementById('editStudentBtn').style.display = 'none';
            document.getElementById('saveEditBtn').onclick = () => {
                student.name = document.getElementById('editName').value.trim() || student.name;
                student.gender = document.getElementById('editGender').value;
                student.lunch = document.getElementById('editLunch').value === 'true';
                student.personality = document.getElementById('editPersonality').value.trim() || null;
                student.position = document.getElementById('editPosition').value.trim() || null;
                const hobbiesStr = document.getElementById('editHobbies').value.trim();
                student.hobbies = hobbiesStr ? hobbiesStr.split(',').map(h => h.trim()).filter(h => h) : [];
                this.renderPool();
                modal.classList.remove('active');
                Toast.success('学生信息已更新');
            };
        };
    },

    // ==================== Full Student Search ====================
    _fullSearchFilter: 'all',
    performFullStudentSearch(query, filter) {
        const results = document.getElementById('fullSearchResults');
        if (!results) return;

        const allStudents = state.students;
        if (!query && filter === 'all') {
            results.innerHTML = '<div class="pool-empty">输入关键词搜索全部学生</div>';
            return;
        }

        // [FEATURE #8] Parse advanced query syntax
        const parsed = parseQuery(query || '');
        const textQ = parsed.text;
        const filters = parsed.filters;

        let filtered = allStudents;

        // Apply status filter
        if (filter === 'seated') {
            filtered = filtered.filter(s => state.drawnStudents.some(d => d.id === s.id));
        } else if (filter === 'pending') {
            filtered = filtered.filter(s => state.remainingStudents.some(r => r.id === s.id));
        } else if (filter === 'pinned') {
            filtered = filtered.filter(s => s.pinned);
        } else if (filter === 'male') {
            filtered = filtered.filter(s => s.gender === 'male');
        } else if (filter === 'female') {
            filtered = filtered.filter(s => s.gender === 'female');
        }

        // [FIX #4] Apply search query using matchStudent
        if (textQ) {
            filtered = filtered.filter(s => matchStudent(s, textQ));
        }

        // [FEATURE #8] Apply parsed filters
        if (filters.gender) {
            const g = filters.gender === '男' || filters.gender === 'male' ? 'male' : 'female';
            filtered = filtered.filter(s => s.gender === g);
        }
        if (filters.lunch) {
            const want = filters.lunch === '是' || filters.lunch === 'yes' || filters.lunch === '1';
            filtered = filtered.filter(s => s.lunch === want);
        }
        if (filters.personality) {
            filtered = filtered.filter(s => s.personality === filters.personality);
        }
        if (filters.position) {
            filtered = filtered.filter(s => s.position && s.position.includes(filters.position));
        }
        if (filters.scoreAbove) {
            const min = parseInt(filters.scoreAbove);
            filtered = filtered.filter(s => { const avg = CompositeEval.getAvgScore(s); return avg !== null && avg > min; });
        }
        if (filters.scoreBelow) {
            const max = parseInt(filters.scoreBelow);
            filtered = filtered.filter(s => { const avg = CompositeEval.getAvgScore(s); return avg !== null && avg < max; });
        }

        if (filtered.length === 0) {
            results.innerHTML = '<div class="pool-empty">未找到匹配的学生</div>';
            return;
        }

        // [FEATURE #23] Virtual scrolling / load more for large result sets
        const PAGE_SIZE = 30;
        const limited = filtered.slice(0, PAGE_SIZE);

        results.innerHTML = limited.map(s => {
            const isSeated = state.drawnStudents.some(d => d.id === s.id);
            const seat = isSeated ? [...state.seats, state.platformLeft, state.platformRight].find(ss => ss.student?.id === s.id) : null;
            const statusBadge = isSeated
                ? `<span class="fsi-badge seated">🪑 ${seat ? this.seatLabel(seat) : '已排座'}</span>`
                : '<span class="fsi-badge pending">⏳ 待抽取</span>';

            const meta = [];
            meta.push(s.gender === 'male' ? '♂' : '♀');
            if (s.lunch) meta.push('💤');
            if (s.personality) meta.push(escapeHtml(s.personality));
            if (s.position) meta.push(escapeHtml(s.position));

            const avg = CompositeEval.getAvgScore(s);
            const scoreStr = avg !== null ? `📊${avg}` : '';

            return `<div class="full-search-item" data-student-id="${s.id}" data-seated="${isSeated}">
                <div class="fsi-left">
                    <div>
                        <div class="fsi-name">${escapeHtml(s.name)}${s.pinned ? ' 📌' : ''}</div>
                        <div class="fsi-meta">
                            ${meta.map(m => `<span class="fsi-badge">${m}</span>`).join('')}
                            ${scoreStr ? `<span class="fsi-badge">${scoreStr}</span>` : ''}
                        </div>
                    </div>
                </div>
                ${statusBadge}
            </div>`;
        }).join('');

        if (filtered.length > PAGE_SIZE) {
            const loadMore = document.createElement('div');
            loadMore.className = 'pool-empty';
            loadMore.style.cursor = 'pointer';
            loadMore.textContent = `显示前 ${PAGE_SIZE} 条，共 ${filtered.length} 条结果 — 点击加载更多`;
            loadMore.addEventListener('click', () => {
                const nextBatch = filtered.slice(PAGE_SIZE, PAGE_SIZE * 2);
                nextBatch.forEach(s => {
                    const isSeated = state.drawnStudents.some(d => d.id === s.id);
                    const seat = isSeated ? [...state.seats, state.platformLeft, state.platformRight].find(ss => ss.student?.id === s.id) : null;
                    const statusBadge = isSeated ? `<span class="fsi-badge seated">🪑 ${seat ? this.seatLabel(seat) : '已排座'}</span>` : '<span class="fsi-badge pending">⏳ 待抽取</span>';
                    const meta = [s.gender === 'male' ? '♂' : '♀'];
                    if (s.lunch) meta.push('💤');
                    if (s.personality) meta.push(escapeHtml(s.personality));
                    if (s.position) meta.push(escapeHtml(s.position));
                    const avg = CompositeEval.getAvgScore(s);
                    const scoreStr = avg !== null ? `📊${avg}` : '';
                    const item = document.createElement('div');
                    item.className = 'full-search-item';
                    item.dataset.studentId = s.id;
                    item.dataset.seated = isSeated ? 'true' : 'false';
                    item.innerHTML = `<div class="fsi-left"><div><div class="fsi-name">${escapeHtml(s.name)}${s.pinned ? ' 📌' : ''}</div><div class="fsi-meta">${meta.map(m => `<span class="fsi-badge">${m}</span>`).join('')}${scoreStr ? `<span class="fsi-badge">${scoreStr}</span>` : ''}</div></div></div>${statusBadge}`;
                    results.insertBefore(item, loadMore);
                    item.addEventListener('click', () => {
                        if (isSeated) { const st = [...state.seats, state.platformLeft, state.platformRight].find(ss => ss.student?.id === s.id); if (st) this.showStudentInfo(st); }
                        else this.showStudentDetailFromPool(s);
                    });
                });
                loadMore.remove();
            });
            results.appendChild(loadMore);
        }

        // Bind click handlers
        results.querySelectorAll('.full-search-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = parseInt(item.dataset.studentId);
                const student = allStudents.find(s => s.id === id);
                if (!student) return;
                const isSeated = item.dataset.seated === 'true';
                if (isSeated) {
                    const seat = [...state.seats, state.platformLeft, state.platformRight].find(ss => ss.student?.id === id);
                    if (seat) this.showStudentInfo(seat);
                } else {
                    this.showStudentDetailFromPool(student);
                }
            });
            // [FEATURE] Double-click to locate seat or place student
            item.addEventListener('dblclick', () => {
                const id = parseInt(item.dataset.studentId);
                const student = allStudents.find(s => s.id === id);
                if (!student) return;
                const isSeated = item.dataset.seated === 'true';
                if (isSeated) {
                    // Scroll to and highlight the seat
                    const seat = [...state.seats, state.platformLeft, state.platformRight].find(ss => ss.student?.id === id);
                    if (seat && seat.element) {
                        seat.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        seat.element.classList.add('selected');
                        setTimeout(() => seat.element.classList.remove('selected'), 2000);
                        Toast.info(`${student.name} 的座位已定位`);
                    }
                } else {
                    // Try to place student in selected empty seat
                    if (state.selectedPoolStudent !== null) {
                        // Already in pool-select mode, just confirm
                        Toast.info('请点击空座位落座');
                    } else {
                        // Auto-select this student and highlight empty seats
                        state.selectedPoolStudent = student.id;
                        document.querySelectorAll('.seat:not(.disabled)').forEach(s => {
                            if (!state.seats.find(ss => ss.element === s)?.student) s.classList.add('pool-target');
                        });
                        document.getElementById('poolClickHint')?.classList.add('visible');
                        Toast.info(`${student.name} 已选中，请点击空座位落座`);
                    }
                }
            });
        });
    },

    // ==================== Export with timestamp ====================
    getTimestamp() {
        const d = new Date();
        return `${d.getFullYear()}${(d.getMonth()+1).toString().padStart(2,'0')}${d.getDate().toString().padStart(2,'0')}_${d.getHours().toString().padStart(2,'0')}${d.getMinutes().toString().padStart(2,'0')}`;
    },

    // ==================== Help Modal Tab Switching ====================
    openHelpTab(tabName) {
        document.getElementById('helpModal').classList.add('active');
        document.querySelectorAll('#helpTabBar .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
        document.querySelectorAll('#helpModal .tab-content').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tabName));
        if (tabName === 'algorithm') CompositeEval.renderExplanation();
    },

    // ==================== Performance Mode ====================
    showPerfModeModal() {
        const modal = document.getElementById('perfModeModal');
        const resultEl = document.getElementById('perfDetectResult');
        const optionsEl = document.getElementById('perfModeOptions');
        const confirmBtn = document.getElementById('perfModeConfirm');
        
        // Show detecting state
        resultEl.innerHTML = '<p style="font-size:14px;color:var(--text-secondary);">正在检测您的电脑配置...</p>';
        optionsEl.style.display = 'none';
        confirmBtn.style.display = 'none';
        modal.classList.add('active');
        
        // Simulate detection delay
        setTimeout(() => {
            const info = HardwareDetector.calculateScore();
            state.hardwareInfo = info;
            const recommendMode = HardwareDetector.recommendMode();
            
            // Show detection result
            resultEl.innerHTML = `
                <p style="font-size:14px;color:var(--text-primary);margin-bottom:12px;font-weight:600;">
                    检测到您的电脑配置：
                </p>
                <div class="perf-hardware-info">
                    <div class="perf-hw-item">
                        <div class="perf-hw-value">${info.cpu}核</div>
                        <div class="perf-hw-label">CPU核心</div>
                    </div>
                    <div class="perf-hw-item">
                        <div class="perf-hw-value">${info.memory}GB</div>
                        <div class="perf-hw-label">设备内存</div>
                    </div>
                    <div class="perf-hw-item">
                        <div class="perf-hw-value">${info.score}分</div>
                        <div class="perf-hw-label">性能评分</div>
                    </div>
                </div>
                <div style="text-align:center;margin-bottom:8px;">
                    <span class="perf-recommend-badge">
                        推荐使用【${recommendMode === 'low' ? '流畅' : recommendMode === 'high' ? '高质量' : '平衡'}模式】
                    </span>
                </div>
            `;
            
            // Show mode options
            optionsEl.style.display = 'block';
            confirmBtn.style.display = 'inline-flex';
            
            // Default select recommended mode
            document.querySelectorAll('.perf-mode-card').forEach(card => {
                card.classList.toggle('selected', card.dataset.mode === recommendMode);
            });
            
            // Bind click events
            document.querySelectorAll('.perf-mode-card').forEach(card => {
                card.addEventListener('click', () => {
                    document.querySelectorAll('.perf-mode-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                });
            });
            
            // Confirm button
            confirmBtn.onclick = () => {
                const selected = document.querySelector('.perf-mode-card.selected');
                if (!selected) return;
                const mode = selected.dataset.mode;
                const remember = document.getElementById('perfRememberChoice').checked;
                
                this.applyPerformanceMode(mode);
                
                if (remember) {
                    state.settings.performanceMode = mode;
                    saveConfig();
                }
                
                modal.classList.remove('active');
                Toast.success(`已切换到${mode === 'low' ? '流畅' : mode === 'high' ? '高质量' : '平衡'}模式`);
            };
        }, 800);
    },

    applyPerformanceMode(mode) {
        const body = document.body;
        body.classList.remove('perf-low', 'perf-medium', 'perf-high');
        body.classList.add(`perf-${mode}`);
        
        // Adjust JS parameters based on mode
        const configs = {
            low: {
                drawAnimationDuration: 100,
                autoDrawInterval: 600,
                demoSpeed: 400
            },
            medium: {
                drawAnimationDuration: 400,
                autoDrawInterval: 800,
                demoSpeed: 600
            },
            high: {
                drawAnimationDuration: 600,
                autoDrawInterval: 800,
                demoSpeed: 600
            }
        };
        
        const config = configs[mode] || configs.medium;
        Object.assign(state.settings, config);
    },

    changePerformanceMode(mode) {
        this.applyPerformanceMode(mode);
        state.settings.performanceMode = mode;
        saveConfig();
        Toast.success(`已切换到${mode === 'low' ? '流畅' : mode === 'high' ? '高质量' : '平衡'}模式`);
    },

    // ==================== Apply Settings ====================
    applyGlobalSettings() {
        const s = state.settings;
        document.getElementById('screenshotBgColor').value = s.screenshotBgColor;
        document.getElementById('screenshotBgColorText').value = s.screenshotBgColor;
        document.getElementById('screenshotTransparentBg').checked = s.screenshotTransparentBg;
        document.getElementById('lunchUnderlineColor').value = s.lunchUnderlineColor;
        document.getElementById('lunchUnderlineColorText').value = s.lunchUnderlineColor;
        document.getElementById('seatFontSize').value = s.seatFontSize;
        document.getElementById('drawAnimationDuration').value = s.drawAnimationDuration;
        document.getElementById('exportIncludeGender').checked = s.exportIncludeGender;
        document.getElementById('exportIncludeLunch').checked = s.exportIncludeLunch;
        document.getElementById('exportIncludeSeatNumber').checked = s.exportIncludeSeatNumber;
        document.getElementById('enableDragDrop').checked = s.enableDragDrop;
        document.getElementById('enableClickSwap').checked = s.enableClickSwap;
        document.getElementById('showProbabilityByDefault').checked = s.showProbabilityByDefault;
        // Sync inline auto-draw interval
        const inlineInput = document.getElementById('autoDrawIntervalInline');
        if (inlineInput) inlineInput.value = s.autoDrawInterval || 800;
        const pluginIntervalInput = document.getElementById('autoDrawIntervalPlugin');
        if (pluginIntervalInput) pluginIntervalInput.value = s.autoDrawInterval || 800;
        document.getElementById('blacklistPenalty').value = s.blacklistPenalty;
        document.getElementById('blacklistRadius').value = s.blacklistRadius;
        document.getElementById('whitelistDeskBonus').value = s.whitelistDeskBonus;
        document.getElementById('whitelistFrontBackBonus').value = s.whitelistFrontBackBonus;
        document.getElementById('whitelistDiagonalBonus').value = s.whitelistDiagonalBonus;
        document.getElementById('whitelistFallbackBonus').value = s.whitelistFallbackBonus;
        // Sync performance mode
        const perfModeSelect = document.getElementById('performanceMode');
        if (perfModeSelect) perfModeSelect.value = s.performanceMode || 'auto';
        // Sync quick info bar visibility
        const qi = s.quickInfoItems || {};
        if (document.getElementById('qiShowLayout')) document.getElementById('qiShowLayout').checked = qi.layout !== false;
        if (document.getElementById('qiShowTotal')) document.getElementById('qiShowTotal').checked = qi.total !== false;
        if (document.getElementById('qiShowDrawn')) document.getElementById('qiShowDrawn').checked = qi.drawn !== false;
        if (document.getElementById('qiShowRemaining')) document.getElementById('qiShowRemaining').checked = qi.remaining !== false;
        if (document.getElementById('qiShowMale')) document.getElementById('qiShowMale').checked = qi.male !== false;
        if (document.getElementById('qiShowFemale')) document.getElementById('qiShowFemale').checked = qi.female !== false;
        if (document.getElementById('qiShowLunch')) document.getElementById('qiShowLunch').checked = qi.lunch !== false;
        this.applyQuickInfoVisibility();
        // Sync demo speed slider
        const demoSpeedInput = document.getElementById('demoSpeed');
        const demoSpeedVal = document.getElementById('demoSpeedVal');
        if (demoSpeedInput) demoSpeedInput.value = s.demoSpeed || 600;
        if (demoSpeedVal) demoSpeedVal.textContent = s.demoSpeed || 600;
    },

    setButtonLoading(id, loading) {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (loading) { btn.dataset.origText = btn.innerHTML; btn.innerHTML = '<span class="loading-spinner"></span>'; btn.disabled = true; }
        else { btn.innerHTML = btn.dataset.origText || btn.innerHTML; btn.disabled = false; }
    },

    // ==================== Events ====================
    bindEvents() {
        // Theme
        document.getElementById('themeToggle').addEventListener('click', () => {
            document.body.classList.toggle('dark');
            const d = document.body.classList.contains('dark');
            document.getElementById('themeToggle').textContent = d ? '☀️' : '🌙';
            Toast.success(`${d ? '深色' : '浅色'}模式`);
        });
        // Sidebar tabs
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById('pane-' + tab.dataset.tab)?.classList.add('active');
            });
        });
        // Panel collapse (using grid-template-rows trick)
        document.querySelectorAll('.panel-header').forEach(header => {
            header.addEventListener('click', () => header.parentElement.classList.toggle('collapsed'));
        });
        // Probability panel - single toggle via button only
        document.getElementById('probToggleBtn').addEventListener('click', () => document.getElementById('probabilityContent').classList.toggle('prob-collapsed'));
        // Close panels
        document.getElementById('closeProbability').addEventListener('click', () => document.getElementById('probabilityPanel').style.display = 'none');
        // Undo/Redo buttons
        document.getElementById('undoBtn').addEventListener('click', () => UndoManager.undo());
        document.getElementById('redoBtn').addEventListener('click', () => UndoManager.redo());
        // Context menu: seat
        document.getElementById('seatContextMenu').addEventListener('click', e => {
            const action = e.target.dataset.action;
            if (!action) return;
            const menu = document.getElementById('seatContextMenu');
            const seat = menu.dataset.seatType === 'normal' ? state.seats[parseInt(menu.dataset.seatIndex)] : (menu.dataset.seatType === 'platform-left' ? state.platformLeft : state.platformRight);
            if (!seat) return;
            switch (action) {
                case 'swap': state.swapMode = true; state.selectedSeat = seat; seat.element.classList.add('selected'); Toast.info('请点击另一个座位完成互换'); break;
                case 'moveToPool': case 'clearSeat': this.clearSeat(seat); break;
                case 'toggleLunch': this.toggleLunch(seat); break;
                case 'disableSeat': this.disableSeat(seat); break;
                case 'enableSeat': this.enableSeat(seat); break;
                case 'togglePin': this.togglePin(seat); break;
                case 'viewInfo': this.showStudentInfo(seat); break;
            }
            menu.style.display = 'none';
        });
        // Context menu: column
        document.getElementById('columnContextMenu').addEventListener('click', e => {
            const action = e.target.dataset.action;
            if (!action) return;
            const col = parseInt(document.getElementById('columnContextMenu').dataset.col);
            if (action === 'disableColumn') this.disableColumn(col);
            else if (action === 'enableColumn') this.enableColumn(col);
            document.getElementById('columnContextMenu').style.display = 'none';
        });
        // Layout templates
        document.querySelectorAll('[data-tpl]').forEach(btn => {
            btn.addEventListener('click', () => {
                const [r, c] = btn.dataset.tpl.split(',').map(Number);
                document.getElementById('rows').value = r;
                document.getElementById('cols').value = c;
            });
        });
        // Apply layout
        document.getElementById('applyLayout').addEventListener('click', () => {
            const rows = parseInt(document.getElementById('rows').value);
            const cols = parseInt(document.getElementById('cols').value);
            const errEl = document.getElementById('layoutError');
            if (!rows || rows < 1 || rows > 20 || !cols || cols < 1 || cols > 20) {
                errEl.classList.add('visible');
                document.getElementById(rows < 1 || rows > 20 ? 'rows' : 'cols').classList.add('error');
                Toast.error('排数和列数必须在 1-20 之间');
                return;
            }
            errEl.classList.remove('visible');
            document.getElementById('rows').classList.remove('error');
            document.getElementById('cols').classList.remove('error');
            state.rows = rows; state.cols = cols;
            state.settings.numberingMode = document.getElementById('numberingMode').value;
            state.showPlatformLeft = document.getElementById('showPlatformLeft').checked;
            state.showPlatformRight = document.getElementById('showPlatformRight').checked;
            state.platformLeft.disabled = !state.showPlatformLeft;
            state.platformRight.disabled = !state.showPlatformRight;
            this.renderClassroom();
            this.resetDraw();
            addLog('🏫', `布局设置为 ${rows}×${cols}`);
            Toast.success('布局已应用');
        });
        // Fill example
        document.getElementById('fillExample').addEventListener('click', () => {
            const names = [
                '张三,男,1,85,92,78,88,76,90,82,85,88,外向,篮球/绘画,班长',
                '李四,女,0,92,88,95,90,85,88,92,90,95,内向,阅读/音乐,学习委员',
                '王五,男,0,78,65,72,80,68,75,70,72,78,中性,篮球,体育委员',
                '赵六,女,1,88,91,85,82,90,86,88,85,82,外向,绘画/舞蹈,文艺委员',
                '孙七,男,0,65,58,70,60,55,62,58,65,60,内向,阅读,',
                '周八,女,1,91,95,88,92,90,85,88,91,92,外向,音乐/篮球,课代表',
                '吴九,男,0,73,80,68,75,82,70,78,73,75,中性,运动,小组长',
                '郑十,女,0,82,76,90,85,78,88,82,80,85,内向,阅读/绘画,',
                '钱十一,男,1,95,98,92,96,94,90,95,98,96,外向,篮球/编程,班长',
                '冯十二,女,0,68,72,65,70,65,68,72,68,70,中性,音乐,',
                '陈十三,男,0,77,83,75,80,78,82,75,77,80,内向,阅读/运动,劳动委员',
                '褚十四,女,1,84,79,88,82,85,80,78,84,82,外向,舞蹈/绘画,',
                '卫十五,男,0,90,87,85,88,92,86,90,87,88,中性,编程/篮球,',
                '蒋十六,女,0,72,68,76,75,70,72,68,72,75,内向,音乐/阅读,'
            ];
            document.getElementById('studentsText').value = names.join('\n');
            Toast.info('已填入 14 名示例学生（含9科成绩、性格、爱好、职务）');
        });
        // Import text
        document.getElementById('importText').addEventListener('click', () => {
            const text = document.getElementById('studentsText').value.trim();
            if (!text) { Toast.warning('请输入学生名单'); return; }
            const oldStudents = [...state.students];
            state.students = [];
            let errors = 0;
            const subjects = state.subjects;
            text.split('\n').forEach((line, i) => {
                const parts = line.split(',').map(s => s.trim());
                if (parts[0]) {
                    // Parse multi-subject scores
                    const scores = {};
                    subjects.forEach((subj, si) => {
                        const val = parts[3 + si];
                        if (val !== undefined && val !== '') {
                            const num = parseFloat(val);
                            if (!isNaN(num)) {
                                const maxScore = state.subjectMaxScores[subj] || 100;
                                scores[subj] = clamp(num, 0, maxScore);
                                if (num < 0 || num > maxScore) errors++;
                            }
                        }
                    });
                    // Legacy single score = average of all subjects
                    const scoreVals = Object.values(scores);
                    const avgScore = scoreVals.length > 0 ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length) : null;

                    // Parse personality, hobbies, position
                    const pIdx = 3 + subjects.length;
                    const personality = parts[pIdx] || null;
                    const hobbiesStr = parts[pIdx + 1] || '';
                    const hobbies = hobbiesStr ? hobbiesStr.split('/').map(h => h.trim()).filter(Boolean) : [];
                    const position = parts[pIdx + 2] || null;

                    state.students.push({
                        id: i, name: parts[0],
                        gender: parts[1] === state.settings.maleMapping ? 'male' : 'female',
                        lunch: String(parts[2]).trim() === '1',
                        score: avgScore,
                        scores: scores,
                        personality: state.personalityTypes.includes(personality) ? personality : null,
                        hobbies: hobbies,
                        position: state.classPositions.includes(position) ? position : null,
                        pinned: false
                    });
                }
            });
            if (errors > 0) Toast.warning(`有 ${errors} 个成绩值超出范围，已自动修正`);
            this.resetDraw();
            this.checkStaleListEntries();
            addLog('📝', `文本导入 ${state.students.length} 名学生`);
            Toast.success(`导入 ${state.students.length} 名学生`);
        });
        // Clear students
        document.getElementById('clearStudents').addEventListener('click', () => {
            if (!confirm('确定清空所有学生名单？')) return;
            state.students = [];
            document.getElementById('studentsText').value = '';
            this.resetDraw();
            Toast.success('学生名单已清空');
            addLog('🗑️', '清空学生名单');
        });
        // Excel import
        document.getElementById('importExcel').addEventListener('click', () => document.getElementById('excelFile').click());
        document.getElementById('excelFile').addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            this.setButtonLoading('importExcel', true);
            const reader = new FileReader();
            reader.onload = ev => {
                try {
                    const data = new Uint8Array(ev.target.result);
                    const wb = XLSX.read(data, { type: 'array' });
                    const sheet = wb.Sheets[wb.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                    state.students = [];
                    let errors = 0;
                    const subjects = state.subjects;
                    const header = json[0] || [];
                    // Try to match column headers to subjects
                    const subjectColMap = {};
                    subjects.forEach(subj => {
                        const idx = header.findIndex(h => String(h).trim() === subj);
                        if (idx >= 0) subjectColMap[subj] = idx;
                    });
                    const hasHeaderMatch = Object.keys(subjectColMap).length > 0;

                    json.slice(1).forEach((row, i) => {
                        if (row[0]) {
                            // Parse scores
                            const scores = {};
                            if (hasHeaderMatch) {
                                // Use header-mapped columns
                                Object.entries(subjectColMap).forEach(([subj, colIdx]) => {
                                    const val = row[colIdx];
                                    if (val !== undefined && val !== '') {
                                        const num = parseFloat(val);
                                        if (!isNaN(num)) { const ms = state.subjectMaxScores[subj] || 100; scores[subj] = clamp(num, 0, ms); if (num < 0 || num > ms) errors++; }
                                    }
                                });
                            } else {
                                // Fallback: columns 3 onwards are scores in order
                                subjects.forEach((subj, si) => {
                                    const val = row[3 + si];
                                    if (val !== undefined && val !== '') {
                                        const num = parseFloat(val);
                                        if (!isNaN(num)) { const ms = state.subjectMaxScores[subj] || 100; scores[subj] = clamp(num, 0, ms); if (num < 0 || num > ms) errors++; }
                                    }
                                });
                            }
                            const scoreVals = Object.values(scores);
                            const avgScore = scoreVals.length > 0 ? Math.round(scoreVals.reduce((a, b) => a + b, 0) / scoreVals.length) : null;

                            // Parse extended fields
                            const pIdx = hasHeaderMatch ? header.findIndex(h => String(h).trim() === '性格') : 3 + subjects.length;
                            const hIdx = hasHeaderMatch ? header.findIndex(h => String(h).trim() === '爱好') : pIdx + 1;
                            const posIdx = hasHeaderMatch ? header.findIndex(h => String(h).trim() === '职务') : hIdx + 1;
                            const personality = pIdx >= 0 ? String(row[pIdx] || '').trim() : null;
                            const hobbiesStr = hIdx >= 0 ? String(row[hIdx] || '').trim() : '';
                            const hobbies = hobbiesStr ? hobbiesStr.split('/').map(h => h.trim()).filter(Boolean) : [];
                            const position = posIdx >= 0 ? String(row[posIdx] || '').trim() : null;

                            state.students.push({
                                id: i, name: String(row[0] || '').trim(),
                                gender: String(row[1]).trim() === state.settings.maleMapping ? 'male' : 'female',
                                lunch: row[2] == 1 || String(row[2]).trim() === '1',
                                score: avgScore,
                                scores: scores,
                                personality: state.personalityTypes.includes(personality) ? personality : null,
                                hobbies: hobbies,
                                position: state.classPositions.includes(position) ? position : null,
                                pinned: false
                            });
                        }
                    });
                    if (errors > 0) Toast.warning(`有 ${errors} 个成绩值超出范围，已自动修正`);
                    this.resetDraw();
                    this.checkStaleListEntries();
                    addLog('📂', `Excel导入 ${state.students.length} 名学生`);
                    Toast.success(`导入 ${state.students.length} 名学生`);
                } catch (err) { Toast.error('导入失败'); console.error(err); }
                finally { this.setButtonLoading('importExcel', false); e.target.value = ''; }
            };
            reader.readAsArrayBuffer(file);
        });
        // Student pool filter/search
        document.querySelectorAll('.pool-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.pool-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                state.poolFilter = btn.dataset.filter;
                this.renderPool();
            });
        });
        document.getElementById('poolSearch').addEventListener('input', debounce(e => {
            state.poolSearch = e.target.value.trim();
            this.renderPool();
            this.renderPoolSearchDropdown(e.target.value.trim());
        }, 200));
        document.getElementById('poolSearch').addEventListener('focus', e => {
            if (e.target.value.trim()) this.renderPoolSearchDropdown(e.target.value.trim());
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.pool-search')) {
                document.getElementById('poolSearchDropdown')?.classList.remove('open');
            }
        });
        // Full student search
        document.getElementById('fullStudentSearch')?.addEventListener('input', debounce(e => {
            this.performFullStudentSearch(e.target.value.trim(), this._fullSearchFilter);
        }, 200));
        document.getElementById('fullStudentSearch')?.addEventListener('focus', e => {
            if (e.target.value.trim()) this.performFullStudentSearch(e.target.value.trim(), this._fullSearchFilter);
        });
        document.querySelectorAll('#fullSearchFilters .pool-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#fullSearchFilters .pool-filter').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._fullSearchFilter = btn.dataset.filter;
                const query = document.getElementById('fullStudentSearch')?.value?.trim() || '';
                this.performFullStudentSearch(query, this._fullSearchFilter);
            });
        });
        // Blacklist/Whitelist import
        const setupListImport = (btnId, fileId, listKey, textareaId) => {
            document.getElementById(btnId).addEventListener('click', () => document.getElementById(fileId).click());
            document.getElementById(fileId).addEventListener('change', e => {
                const file = e.target.files[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                    try {
                        const data = new Uint8Array(ev.target.result);
                        const wb = XLSX.read(data, { type: 'array' });
                        const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
                        state[listKey] = [];
                        json.forEach(row => {
                            const group = row.filter(c => c && c.toString().trim()).map(c => c.toString().trim());
                            if (group.length >= 2) state[listKey].push(group);
                        });
                        document.getElementById(textareaId).value = state[listKey].map(g => g.join(' ')).join('\n');
                        Toast.success(`导入 ${state[listKey].length} 组`);
                    } catch (err) { Toast.error('导入失败'); }
                    finally { e.target.value = ''; }
                };
                reader.readAsText(file);
            });
        };
        setupListImport('importBlacklist', 'blacklistFile', 'blacklist', 'blacklist');
        setupListImport('importWhitelist', 'whitelistFile', 'whitelist', 'whitelist');
        document.getElementById('clearBlacklist').addEventListener('click', () => { state.blacklist = []; document.getElementById('blacklist').value = ''; Toast.success('已清空'); });
        document.getElementById('clearWhitelist').addEventListener('click', () => { state.whitelist = []; document.getElementById('whitelist').value = ''; Toast.success('已清空'); });
        // Draw
        document.getElementById('drawNext').addEventListener('click', () => {
            const seat = this.doDrawNext();
            if (seat) Toast.success(`${state.drawnStudents[state.drawnStudents.length - 1].name} → ${this.seatLabel(seat)}`);
        });
        document.getElementById('autoDraw').addEventListener('click', () => this.startAutoDraw());
        document.getElementById('stopAutoDraw').addEventListener('click', () => this.stopAutoDraw());
        document.getElementById('resetDraw').addEventListener('click', () => { if (confirm('确定重置抽取？')) this.resetDraw(); });
        // View dropdown menu
        document.getElementById('viewMenuBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            const dd = document.getElementById('viewDropdown');
            dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
        });
        // Heatmap
        document.getElementById('toggleHeatmap').addEventListener('click', () => {
            document.getElementById('viewDropdown').style.display = 'none';
            state.heatmapVisible = !state.heatmapVisible;
            const legend = document.getElementById('heatmapLegend');
            if (state.heatmapVisible) {
                this.renderHeatmap(); legend.style.display = 'flex';
                document.getElementById('toggleHeatmap').textContent = '🔥 关闭热力图';
                this.updateHeatmapSubjectVisibility();
            } else {
                this.clearHeatmap(); legend.style.display = 'none';
                document.getElementById('toggleHeatmap').textContent = '🔥 热力图';
            }
        });
        document.getElementById('closeHeatmap').addEventListener('click', () => { state.heatmapVisible = false; this.clearHeatmap(); document.getElementById('heatmapLegend').style.display = 'none'; document.getElementById('toggleHeatmap').textContent = '🔥 热力图'; });
        // Heatmap type selector
        document.getElementById('heatmapTypeSelector').addEventListener('click', e => {
            const btn = e.target.closest('.heatmap-type-btn');
            if (!btn) return;
            document.querySelectorAll('.heatmap-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.heatmapType = btn.dataset.type;
            this.updateHeatmapSubjectVisibility();
            this.updateHeatmapLegendLabels();
            if (state.heatmapVisible) this.renderHeatmap();
        });
        // Heatmap subject select
        document.getElementById('heatmapSubjectSelect').addEventListener('change', () => {
            if (state.heatmapType === 'subject') this.updateHeatmapLegendLabels();
            if (state.heatmapVisible) this.renderHeatmap();
        });
        // Stats
        document.getElementById('viewStats').addEventListener('click', () => { document.getElementById('viewDropdown').style.display = 'none'; this.showStats(); });
        // Podium view toggle from view dropdown
        document.getElementById('viewTogglePerspective').addEventListener('click', () => { document.getElementById('viewDropdown').style.display = 'none'; this.togglePerspective(); });
        document.getElementById('closeStatsModal').addEventListener('click', () => document.getElementById('statsModal').classList.remove('active'));
        document.getElementById('closeStatsBtn').addEventListener('click', () => document.getElementById('statsModal').classList.remove('active'));
        // Batch mode
        document.getElementById('batchCancel').addEventListener('click', () => this.exitBatchMode());
        document.getElementById('batchClear').addEventListener('click', () => {
            state.batchSeats.forEach(s => this.clearSeat(s));
            this.exitBatchMode();
        });
        document.getElementById('batchDisable').addEventListener('click', () => {
            state.batchSeats.forEach(s => this.disableSeat(s));
            this.exitBatchMode();
        });
        document.getElementById('batchLunch').addEventListener('click', () => {
            state.batchSeats.forEach(s => this.toggleLunch(s));
            this.exitBatchMode();
        });
        // Export seats
        document.getElementById('exportSeats').addEventListener('click', () => {
            document.getElementById('exportDropdown').style.display = 'none';
            // [AUDIT-2] Export empty state check
            const hasSeated = state.seats.some(s => s.student) || state.platformLeft.student || state.platformRight.student;
            if (!hasSeated && state.remainingStudents.length === 0) {
                Toast.warning('没有学生数据可导出');
                return;
            }
            const wb = XLSX.utils.book_new();
            const header = [];
            if (state.settings.exportIncludeSeatNumber) header.push('座位号');
            header.push('姓名');
            if (state.settings.exportIncludeGender) header.push('性别');
            if (state.settings.exportIncludeLunch) header.push('是否午休');
            // [FEATURE #18] Full data export option
            const fullData = document.getElementById('exportFullData')?.checked;
            if (fullData) {
                state.subjects.forEach(s => header.push(s));
                header.push('平均成绩', '综合评分', '性格', '爱好', '职务', '状态');
            } else {
                header.push('成绩');
            }
            const data = [header];
            const allSeats = [...state.drawOrder].sort((a, b) => a.number - b.number);
            allSeats.forEach(seat => {
                if (!seat.student) return;
                const row = [];
                if (state.settings.exportIncludeSeatNumber) {
                    row.push(seat.type === 'platform-left' ? '讲台左' : seat.type === 'platform-right' ? '讲台右' : seat.number);
                }
                row.push(seat.student.name);
                if (state.settings.exportIncludeGender) row.push(seat.student.gender === 'male' ? '男' : '女');
                if (state.settings.exportIncludeLunch) row.push(seat.student.lunch ? '是' : '否');
                if (fullData) {
                    state.subjects.forEach(subj => row.push(seat.student.scores?.[subj] ?? ''));
                    row.push(seat.student.score ?? '');
                    row.push(CompositeEval.getScore(seat.student));
                    row.push(seat.student.personality || '');
                    row.push((seat.student.hobbies || []).join('/'));
                    row.push(seat.student.position || '');
                    row.push(seat.student.pinned ? '📌 已固定' : '已排座');
                } else {
                    row.push(seat.student.score ?? '');
                }
                data.push(row);
            });
            // [FEATURE #18] Also export remaining students if full data
            if (fullData) {
                state.remainingStudents.forEach(s => {
                    const row = ['', s.name, s.gender === 'male' ? '男' : '女', s.lunch ? '是' : '否'];
                    state.subjects.forEach(subj => row.push(s.scores?.[subj] ?? ''));
                    row.push(s.score ?? '', CompositeEval.getScore(s), s.personality || '', (s.hobbies || []).join('/'), s.position || '', '⏳ 待抽取');
                    data.push(row);
                });
            }
            let exportData = { data };
            Object.keys(state.plugins).forEach(pn => {
                const result = PluginManager.call(pn, 'beforeExport', exportData);
                if (result) exportData = result;
            });
            const ws = XLSX.utils.aoa_to_sheet(exportData.data);
            XLSX.utils.book_append_sheet(wb, ws, '座位表');
            XLSX.writeFile(wb, `座位表_${this.getTimestamp()}.xlsx`);
            Toast.success(fullData ? '完整数据已导出' : '座位表已导出');
            addLog('📤', fullData ? '导出完整数据 Excel' : '导出座位表 Excel');
        });
        // Export screenshot - now uses preview modal (handled above)
        // document.getElementById('exportScreenshot') event is bound in the new preview section above
        // Settings modal
        document.getElementById('globalSettingsBtn').addEventListener('click', () => {
            this.updateStats(); // Refresh stats when opening
            document.getElementById('settingsModal').classList.add('active');
        });
        document.getElementById('closeSettingsModal').addEventListener('click', () => document.getElementById('settingsModal').classList.remove('active'));
        // Settings tab switching
        document.getElementById('settingsTabBar').addEventListener('click', e => {
            const btn = e.target.closest('.tab-btn'); if (!btn) return;
            document.querySelectorAll('#settingsTabBar .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('#settingsModal .tab-content').forEach(t => t.classList.remove('active'));
            document.getElementById('stab-' + btn.dataset.stab)?.classList.add('active');
        });
        document.getElementById('clearCacheBtn').addEventListener('click', () => { document.getElementById('settingsModal').classList.remove('active'); document.getElementById('clearCacheModal').classList.add('active'); });
        document.getElementById('closeClearCacheModal').addEventListener('click', () => document.getElementById('clearCacheModal').classList.remove('active'));
        document.getElementById('cancelClearCache').addEventListener('click', () => document.getElementById('clearCacheModal').classList.remove('active'));
        document.getElementById('confirmClearCache').addEventListener('click', () => {
            if (!confirm('确定要清除选中的数据吗？此操作不可恢复！')) return;
            if (document.getElementById('clearAllData').checked) { localStorage.removeItem('seatArrangerConfig'); location.reload(); }
            else {
                if (document.getElementById('clearHistory').checked) state.history = [];
                if (document.getElementById('clearPlugins').checked) { state.plugins = {}; PluginManager.renderPluginsList(); }
                saveConfig(); Toast.success('缓存已清除');
            }
            document.getElementById('clearCacheModal').classList.remove('active');
        });
        // Color sync
        ['screenshotBgColor','lunchUnderlineColor'].forEach(prefix => {
            const color = document.getElementById(prefix);
            const text = document.getElementById(prefix + 'Text');
            color.addEventListener('input', () => text.value = color.value);
            text.addEventListener('input', () => { try { color.value = text.value; } catch(e) {} });
        });
        // Save settings
        document.getElementById('saveSettings').addEventListener('click', () => {
            const s = state.settings;
            s.screenshotBgColor = document.getElementById('screenshotBgColor').value;
            s.screenshotTransparentBg = document.getElementById('screenshotTransparentBg').checked;
            s.lunchUnderlineColor = document.getElementById('lunchUnderlineColor').value;
            s.seatFontSize = parseInt(document.getElementById('seatFontSize').value) || 13;
            s.drawAnimationDuration = parseInt(document.getElementById('drawAnimationDuration').value) || 400;
            s.exportIncludeGender = document.getElementById('exportIncludeGender').checked;
            s.exportIncludeLunch = document.getElementById('exportIncludeLunch').checked;
            s.exportIncludeSeatNumber = document.getElementById('exportIncludeSeatNumber').checked;
            s.enableDragDrop = document.getElementById('enableDragDrop').checked;
            s.enableClickSwap = document.getElementById('enableClickSwap').checked;
            s.showProbabilityByDefault = document.getElementById('showProbabilityByDefault').checked;
            s.autoDrawInterval = parseInt(document.getElementById('autoDrawIntervalInline').value) || parseInt(document.getElementById('autoDrawIntervalPlugin')?.value) || 800;
            s.demoSpeed = parseInt(document.getElementById('demoSpeed')?.value) || 600;
            s.blacklistPenalty = clamp(parseInt(document.getElementById('blacklistPenalty').value) || 95, 0, 100);
            s.blacklistRadius = clamp(parseInt(document.getElementById('blacklistRadius').value) || 2, 1, 10);
            s.whitelistDeskBonus = clamp(parseInt(document.getElementById('whitelistDeskBonus').value) || 200, 0, 999);
            s.whitelistFrontBackBonus = clamp(parseInt(document.getElementById('whitelistFrontBackBonus').value) || 120, 0, 999);
            s.whitelistDiagonalBonus = clamp(parseInt(document.getElementById('whitelistDiagonalBonus').value) || 60, 0, 999);
            s.whitelistFallbackBonus = clamp(parseInt(document.getElementById('whitelistFallbackBonus').value) || 150, 0, 999);
            // Save performance mode
            const newPerfMode = document.getElementById('performanceMode')?.value || 'auto';
            if (newPerfMode !== s.performanceMode) {
                this.changePerformanceMode(newPerfMode);
            }
            s.performanceMode = newPerfMode;
            // Quick info bar visibility
            s.quickInfoItems = {
                layout: document.getElementById('qiShowLayout')?.checked !== false,
                total: document.getElementById('qiShowTotal')?.checked !== false,
                drawn: document.getElementById('qiShowDrawn')?.checked !== false,
                remaining: document.getElementById('qiShowRemaining')?.checked !== false,
                male: document.getElementById('qiShowMale')?.checked !== false,
                female: document.getElementById('qiShowFemale')?.checked !== false,
                lunch: document.getElementById('qiShowLunch')?.checked !== false,
            };
            if (s.theme) this.applyTheme(s.theme);
            if (s.accentColor) this.applyAccentColor(s.accentColor);
            this.applyGlobalSettings();
            state.seats.forEach(seat => this.updateSeatDisplay(seat));
            this.updateSeatDisplay(state.platformLeft); this.updateSeatDisplay(state.platformRight);
            this.updateProbabilityPanel();
            document.getElementById('settingsModal').classList.remove('active');
            Toast.success('设置已保存');
            saveConfig();
        });
        // Reset settings
        document.getElementById('resetSettings').addEventListener('click', () => {
            if (!confirm('确定恢复默认设置？')) return;
            state.settings = {
                numberingMode:'horizontal-snake', maleMapping:'男', femaleMapping:'女',
                blacklistPenalty:95, blacklistRadius:2, whitelistDeskBonus:200, whitelistFrontBackBonus:120,
                whitelistDiagonalBonus:60, whitelistFallbackBonus:150, drawMode:'predictable',
                genderBalance:true, antiCluster:true, lunchUnderlineColor:'#007AFF', seatFontSize:13,
                drawAnimationDuration:400, screenshotBgColor:'#ffffff', screenshotTransparentBg:false,
                exportIncludeGender:true, exportIncludeLunch:true, exportIncludeSeatNumber:true,
                enableDragDrop:true, enableClickSwap:true, showStatsByDefault:true, showProbabilityByDefault:true,
                autoDrawInterval:800, theme:'', accentColor:'#007AFF', demoSpeed:600,
                performanceMode:'auto',
                quickInfoItems: { layout:true, total:true, drawn:true, remaining:true, male:true, female:true, lunch:true },
                weights: { academic: 60, personality: 15, hobby: 10, position: 10, gender: 5 }
            };
            this.applyPerformanceMode(state.settings.performanceMode);
            this.applyGlobalSettings(); this.renderClassroom(); this.resetDraw();
            document.getElementById('settingsModal').classList.remove('active');
            Toast.success('已恢复默认设置');
        });
        // Plugin settings
        document.getElementById('closePluginSettingsModal').addEventListener('click', () => document.getElementById('pluginSettingsModal').classList.remove('active'));
        document.getElementById('savePluginSettings').addEventListener('click', () => {
            if (currentEditingPlugin && state.plugins[currentEditingPlugin]?.saveSettings) state.plugins[currentEditingPlugin].saveSettings();
            document.getElementById('pluginSettingsModal').classList.remove('active');
            Toast.success('插件设置已保存');
        });
        // Import plugin
        document.getElementById('importPlugin').addEventListener('click', () => document.getElementById('pluginFile').click());
        document.getElementById('pluginFile').addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                const code = ev.target.result;
                try {
                    // Security scan
                    const report = SecuritySandbox.scan(code);
                    if (report.riskLevel === 'critical') {
                        Toast.error('插件安全检测未通过：包含高危代码，已阻止导入');
                        addLog('🛡️', `安全拦截: ${file.name} (危险级别: ${report.riskLevel})`);
                        e.target.value = '';
                        return;
                    }
                    // Load with sandbox
                    const safePluginManager = { register: (n, p) => {
                        p.securityStatus = report.safe ? 'ok' : 'risk';
                        p.securityReport = report;
                        if (report.blockedAPIs?.length > 0) {
                            p.status = 'warn';
                            p.securityStatus = 'risk';
                        }
                        PluginManager.register(n, p);
                    }};
                    const safeConsole = { log: console.log, error: console.error, warn: console.warn };
                    const fn = new Function('PluginManager', 'console', 'state', code);
                    fn(safePluginManager, safeConsole, null);

                    if (report.riskLevel !== 'safe') {
                        Toast.warning(`插件已导入，但检测到潜在风险（${report.warnings?.join(', ') || '详见安全面板'}）`);
                        addLog('⚠️', `风险插件导入: ${file.name}`);
                    } else {
                        Toast.success('插件导入成功');
                    }
                    SecuritySandbox.renderReport();
                    ModuleRegistry.renderList();
                } catch (err) { console.error('插件导入失败', err); Toast.error('插件导入失败: ' + err.message); }
                finally { e.target.value = ''; }
            };
            reader.readAsText(file);
        });
        // Help modal
        document.getElementById('helpBtn').addEventListener('click', () => document.getElementById('helpModal').classList.add('active'));
        document.getElementById('closeHelpModal').addEventListener('click', () => document.getElementById('helpModal').classList.remove('active'));
        document.getElementById('closeHelpBtn').addEventListener('click', () => document.getElementById('helpModal').classList.remove('active'));
        document.getElementById('helpTabBar').addEventListener('click', e => {
            const btn = e.target.closest('.tab-btn'); if (!btn) return;
            document.querySelectorAll('#helpTabBar .tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('#helpModal .tab-content').forEach(t => t.classList.remove('active'));
            document.getElementById('tab-' + btn.dataset.tab)?.classList.add('active');
            // Render algorithm weight bars when switching to algorithm tab
            if (btn.dataset.tab === 'algorithm') CompositeEval.renderExplanation();
        });
        // Export/Import config
        const exportConfigBtn = document.getElementById('exportConfig');
        if (exportConfigBtn) exportConfigBtn.addEventListener('click', () => {
            const config = {
                rows: state.rows, cols: state.cols,
                platformLeft: { disabled: state.platformLeft.disabled, student: state.platformLeft.student },
                platformRight: { disabled: state.platformRight.disabled, student: state.platformRight.student },
                showPlatformLeft: state.showPlatformLeft, showPlatformRight: state.showPlatformRight,
                students: state.students, blacklist: state.blacklist, whitelist: state.whitelist,
                settings: state.settings,
                seats: state.seats.map(s => ({ number: s.number, row: s.row, col: s.col, disabled: s.disabled, student: s.student })),
                history: state.history, plugins: state.plugins
            };
            const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
            const link = document.createElement('a');
            link.download = `座位配置_${this.getTimestamp()}.json`;
            link.href = URL.createObjectURL(blob); link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            Toast.success('配置包已导出'); addLog('📤', '导出配置包');
        });
        const importConfigBtn = document.getElementById('importConfig');
        const configFileInput = document.getElementById('configFile');
        if (importConfigBtn && configFileInput) {
            importConfigBtn.addEventListener('click', () => configFileInput.click());
            configFileInput.addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            this.setButtonLoading('importConfig', true);
            const reader = new FileReader();
            reader.onload = ev => {
                try {
                    const config = JSON.parse(ev.target.result);
                    // [FIX] Safe restore with seat count validation
                    if (config.rows) state.rows = clamp(config.rows, 1, 20);
                    if (config.cols) state.cols = clamp(config.cols, 1, 20);
                    if (config.showPlatformLeft !== undefined) state.showPlatformLeft = config.showPlatformLeft;
                    if (config.showPlatformRight !== undefined) state.showPlatformRight = config.showPlatformRight;
                    if (config.platformLeft) { state.platformLeft.disabled = config.platformLeft.disabled; state.platformLeft.student = config.platformLeft.student; }
                    if (config.platformRight) { state.platformRight.disabled = config.platformRight.disabled; state.platformRight.student = config.platformRight.student; }
                    if (config.students) state.students = config.students;
                    if (config.blacklist) state.blacklist = config.blacklist;
                    if (config.whitelist) state.whitelist = config.whitelist;
                    if (config.history) state.history = config.history;
                    if (config.settings) {
                        // [FIX #20] Version compatibility: fill missing fields with defaults
                        const defaults = {
                            numberingMode:'horizontal-snake', maleMapping:'男', femaleMapping:'女',
                            blacklistPenalty:95, blacklistRadius:2, whitelistDeskBonus:200, whitelistFrontBackBonus:120,
                            whitelistDiagonalBonus:60, whitelistFallbackBonus:150, drawMode:'predictable',
                            genderBalance:true, antiCluster:true, lunchUnderlineColor:'#007AFF', seatFontSize:13,
                            drawAnimationDuration:400, screenshotBgColor:'#ffffff', screenshotTransparentBg:false,
                            exportIncludeGender:true, exportIncludeLunch:true, exportIncludeSeatNumber:true,
                            enableDragDrop:true, enableClickSwap:true, showStatsByDefault:true, showProbabilityByDefault:true,
                            autoDrawInterval:800, theme:'', accentColor:'#007AFF', demoSpeed:600,
                            quickInfoItems: { layout:true, total:true, drawn:true, remaining:true, male:true, female:true, lunch:true },
                            weights: { academic: 60, personality: 15, hobby: 10, position: 10, gender: 5 }
                        };
                        state.settings = { ...defaults, ...config.settings };
                        // Ensure nested objects are merged properly
                        if (config.settings.quickInfoItems) state.settings.quickInfoItems = { ...defaults.quickInfoItems, ...config.settings.quickInfoItems };
                        if (config.settings.weights) state.settings.weights = { ...defaults.weights, ...config.settings.weights };
                    }
                    if (config.plugins) {
                        // [FIX] Re-init plugins on import
                        Object.entries(config.plugins).forEach(([name, plugin]) => {
                            if (!state.plugins[name]) {
                                state.plugins[name] = plugin;
                                if (plugin.init) try { plugin.init(); } catch(e) {}
                            }
                        });
                        PluginManager.renderPluginsList();
                    }
                    document.getElementById('rows').value = state.rows;
                    document.getElementById('cols').value = state.cols;
                    document.getElementById('numberingMode').value = state.settings.numberingMode;
                    document.getElementById('showPlatformLeft').checked = state.showPlatformLeft;
                    document.getElementById('showPlatformRight').checked = state.showPlatformRight;
                    document.getElementById('blacklist').value = state.blacklist.map(g => g.join(' ')).join('\n');
                    document.getElementById('whitelist').value = state.whitelist.map(g => g.join(' ')).join('\n');
                    this.applyGlobalSettings();
                    this.renderClassroom();
                    // Restore disabled/student - [FIX] validate seat count
                    if (config.seats) {
                        const savedCount = config.seats.length;
                        const currentCount = state.seats.length;
                        if (savedCount !== currentCount) Toast.warning(`座位数不匹配(保存:${savedCount} 当前:${currentCount})，部分座位数据可能丢失`);
                        config.seats.forEach((saved, i) => {
                            if (state.seats[i]) {
                                state.seats[i].disabled = saved.disabled;
                                state.seats[i].student = saved.student;
                                this.updateSeatDisplay(state.seats[i]);
                            }
                        });
                        this.checkAisles(); this.generateDrawOrder();
                    }
                    // Restore draw state
                    state.drawnStudents = []; state.remainingStudents = []; state.currentDrawIndex = 0;
                    [...state.seats, state.platformLeft, state.platformRight].forEach(s => { if (s.student) state.drawnStudents.push(s.student); });
                    state.students.forEach(s => { if (!state.drawnStudents.some(d => d.id === s.id)) state.remainingStudents.push(s); });
                    while (state.currentDrawIndex < state.drawOrder.length) {
                        const s = state.drawOrder[state.currentDrawIndex];
                        if (!s.student && !s.disabled) break;
                        state.currentDrawIndex++;
                    }
                    this.updateStats(); this.updateProbabilityPanel(); this.renderPool();
                    addLog('📥', '导入配置包'); Toast.success('配置导入成功');
                } catch (err) { Toast.error('导入失败: ' + err.message); console.error(err); }
                finally { this.setButtonLoading('importConfig', false); e.target.value = ''; }
            };
            reader.readAsText(file);
        });
        }
        // Export/Import log
        const exportLogBtn = document.getElementById('exportLog');
        if (exportLogBtn) exportLogBtn.addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(state.history, null, 2)], { type: 'application/json' });
            const link = document.createElement('a');
            link.download = `历史日志_${this.getTimestamp()}.json`;
            link.href = URL.createObjectURL(blob); link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            Toast.success('历史日志已导出');
        });
        const importLogBtn = document.getElementById('importLog');
        const logFileInput = document.getElementById('logFile');
        if (importLogBtn && logFileInput) {
            importLogBtn.addEventListener('click', () => logFileInput.click());
            logFileInput.addEventListener('change', e => {
                const file = e.target.files[0]; if (!file) return;
                this.setButtonLoading('importLog', true);
                const reader = new FileReader();
                reader.onload = ev => {
                    try { state.history = JSON.parse(ev.target.result); Toast.success('历史日志导入成功'); }
                    catch (err) { Toast.error('导入失败'); }
                    finally { this.setButtonLoading('importLog', false); e.target.value = ''; }
                };
                reader.readAsText(file);
            });
        }
        // Clear log
        document.getElementById('clearLog').addEventListener('click', () => { opLogs.length = 0; renderLogList(); Toast.success('日志已清空'); });
        // Blacklist/Whitelist text input
        const saveBlacklist = debounce(() => {
            state.blacklist = document.getElementById('blacklist').value.trim().split('\n')
                .filter(l => l.trim() && !l.trim().startsWith('#'))
                .map(l => l.trim().split(/\s+/).map(n => {
                    // [FIX #7] Parse anchor markers: *name or (name) or （name）
                    n = n.trim();
                    // Keep marker for algorithm to parse
                    return n;
                }));
        }, 500);
        const saveWhitelist = debounce(() => {
            state.whitelist = document.getElementById('whitelist').value.trim().split('\n')
                .filter(l => l.trim() && !l.trim().startsWith('#'))
                .map(l => l.trim().split(/\s+/).map(n => n.trim()));
        }, 500);
        document.getElementById('blacklist').addEventListener('input', saveBlacklist);
        document.getElementById('whitelist').addEventListener('input', saveWhitelist);
        // Draw settings
        document.getElementById('drawMode').addEventListener('change', () => { state.settings.drawMode = document.getElementById('drawMode').value; this.updateProbabilityPanel(); });
        document.getElementById('genderBalance').addEventListener('change', () => { state.settings.genderBalance = document.getElementById('genderBalance').checked; });
        document.getElementById('antiCluster').addEventListener('change', () => { state.settings.antiCluster = document.getElementById('antiCluster').checked; });
        document.getElementById('maleMapping').addEventListener('change', () => { state.settings.maleMapping = document.getElementById('maleMapping').value; });
        document.getElementById('femaleMapping').addEventListener('change', () => { state.settings.femaleMapping = document.getElementById('femaleMapping').value; });
        // [FEATURE #22] Keyboard shortcuts extracted to bindKeyboardShortcuts
        this.bindKeyboardShortcuts();
        // Click empty to deselect
        document.addEventListener('click', e => {
            if (!e.target.closest('.seat,.platform-side-seat,.context-menu,.batch-toolbar,.student-info-popup')) this.clearSelection();
        });
        // Modal overlay click to close
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('active'); });
        });
        // Perspective toggle
        document.getElementById('togglePerspective').addEventListener('click', () => this.togglePerspective());
        // Export dropdown menu
        document.getElementById('exportMenuBtn').addEventListener('click', (e) => {
            e.stopPropagation();
            const dd = document.getElementById('exportDropdown');
            dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
        });
        document.addEventListener('click', () => { document.getElementById('exportDropdown').style.display = 'none'; document.getElementById('viewDropdown').style.display = 'none'; document.getElementById('recommendDropdown').style.display = 'none'; });
        // Screenshot preview
        document.getElementById('exportScreenshot').addEventListener('click', () => {
            document.getElementById('exportDropdown').style.display = 'none';
            this.showPreviewModal();
        });
        document.getElementById('closePreviewModal').addEventListener('click', () => document.getElementById('previewModal').classList.remove('active'));
        document.getElementById('generatePreview').addEventListener('click', () => this.generatePreview());
        document.getElementById('downloadPreview').addEventListener('click', () => this.downloadPreview());
        // Print
        document.getElementById('printSeats').addEventListener('click', () => {
            document.getElementById('exportDropdown').style.display = 'none';
            this.printSeats();
        });
        // [FEATURE] 家长会视图
        document.getElementById('exportParentView')?.addEventListener('click', () => {
            document.getElementById('exportDropdown').style.display = 'none';
            this.printParentView();
        });
        // Theme switching
        document.querySelectorAll('.theme-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => this.applyTheme(swatch.dataset.theme));
        });
        // Accent color
        document.querySelectorAll('.accent-dot').forEach(dot => {
            dot.addEventListener('click', () => this.applyAccentColor(dot.dataset.color));
        });
        // Smart recommendation dropdown
        document.getElementById('smartRecommend').addEventListener('click', (e) => {
            e.stopPropagation();
            const dd = document.getElementById('recommendDropdown');
            dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
        });
        document.getElementById('smartRecommendAction').addEventListener('click', () => {
            document.getElementById('recommendDropdown').style.display = 'none';
            this.showRecommendations();
        });
        document.getElementById('customAlgoAction').addEventListener('click', () => {
            document.getElementById('recommendDropdown').style.display = 'none';
            document.getElementById('customAlgoModal').classList.add('active');
            this.renderCustomAlgoList();
        });
        document.getElementById('closeRecommendPanel').addEventListener('click', () => { this.clearRecommendHighlights(); document.getElementById('recommendPanel').classList.remove('visible'); });
        document.getElementById('closeRecommendBtn').addEventListener('click', () => { this.clearRecommendHighlights(); document.getElementById('recommendPanel').classList.remove('visible'); });
        document.getElementById('applyAllRecommend').addEventListener('click', () => this.applyAllRecommendations());
        document.getElementById('autoOptimizeBtn')?.addEventListener('click', () => this.autoOptimizeSeats());
        // Algorithm explanation
        // algoExplain button removed — 运行逻辑 accessible from 操作指南 tab
        // document.getElementById('algoExplain').addEventListener('click', () => { CompositeEval.renderExplanation(); this.openHelpTab('algorithm'); });
        // (algoModal handlers removed — content moved to guide)
        // Subject management
        document.getElementById('addSubjectBtn').addEventListener('click', () => {
            const input = document.getElementById('newSubjectInput');
            const name = input.value.trim();
            if (!name) return;
            if (state.subjects.includes(name)) { Toast.warning('科目已存在'); return; }
            state.subjects.push(name);
            input.value = '';
            this.renderSubjectTabs();
            this.updateHeatmapSubjectSelect();
            // Update textarea placeholder with new subject columns
            const ta = document.getElementById('studentsText');
            if (ta) {
                const subjects = state.subjects.join(',');
                ta.placeholder = `张三,男,1,${state.subjects.map(() => '85').join(',')},外向,篮球/绘画,班长\n李四,女,0,${state.subjects.map(() => '92').join(',')},内向,阅读,`;
            }
            Toast.success(`已添加科目: ${name}`);
        });
        // Input validation
        ['rows','cols'].forEach(id => {
            document.getElementById(id).addEventListener('input', e => {
                const v = parseInt(e.target.value);
                if (v && v >= 1 && v <= 20) { e.target.classList.remove('error'); document.getElementById('layoutError').classList.remove('visible'); }
            });
        });
        // Template download handlers
        const downloadFile = (filename, content, type) => {
            const blob = new Blob([content], { type });
            const link = document.createElement('a');
            link.download = filename;
            link.href = URL.createObjectURL(blob);
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        };
        document.getElementById('downloadTextTemplate')?.addEventListener('click', () => {
            const subjects = state.subjects.join(',');
            const tpl = `# 座位编排系统 - 学生名单模板
# 格式：姓名,性别,午休,${subjects},性格,爱好,职务
# 性别：${state.settings.maleMapping}/${state.settings.femaleMapping}  午休：1=是 0=否
# 性格：外向/内向/中性  爱好：用/分隔  职务：班长/副班长/学习委员/体育委员/文艺委员/劳动委员/小组长/课代表
# 可省略性格、爱好、职务列（逗号留空即可）
张三,${state.settings.maleMapping},1,85,92,78,88,76,90,82,85,88,外向,篮球/绘画,班长
李四,${state.settings.femaleMapping},0,92,88,95,90,85,88,92,90,95,内向,阅读/音乐,学习委员
王五,${state.settings.maleMapping},0,78,65,72,80,68,75,70,72,78,中性,篮球,体育委员
赵六,${state.settings.femaleMapping},1,88,91,85,82,90,86,88,85,82,外向,绘画/舞蹈,文艺委员
孙七,${state.settings.maleMapping},0,65,58,70,60,55,62,58,65,60,内向,阅读,`;
            downloadFile('学生名单模板.txt', tpl, 'text/plain;charset=utf-8');
            Toast.success('文本模板已下载');
        });
        document.getElementById('downloadExcelTemplate')?.addEventListener('click', () => {
            const subjects = state.subjects;
            const header = ['姓名', '性别', '午休', ...subjects, '性格', '爱好', '职务'];
            const rows = [
                ['张三', state.settings.maleMapping, 1, 85, 92, 78, 88, 76, 90, 82, 85, 88, '外向', '篮球/绘画', '班长'],
                ['李四', state.settings.femaleMapping, 0, 92, 88, 95, 90, 85, 88, 92, 90, 95, '内向', '阅读/音乐', '学习委员'],
                ['王五', state.settings.maleMapping, 0, 78, 65, 72, 80, 68, 75, 70, 72, 78, '中性', '篮球', '体育委员'],
                ['赵六', state.settings.femaleMapping, 1, 88, 91, 85, 82, 90, 86, 88, 85, 82, '外向', '绘画/舞蹈', '文艺委员'],
                ['孙七', state.settings.maleMapping, 0, 65, 58, 70, 60, 55, 62, 58, 65, 60, '内向', '阅读', ''],
            ];
            const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, '学生名单');
            XLSX.writeFile(wb, '学生名单模板.xlsx');
            Toast.success('Excel 模板已下载');
        });
        document.getElementById('downloadBlacklistTemplate')?.addEventListener('click', () => {
            const tpl = `# 黑名单模板 - 同组学生会被尽量分开坐
# 每行一组，空格分隔学生姓名
张三 李四
王五 赵六`;
            downloadFile('黑名单模板.txt', tpl, 'text/plain;charset=utf-8');
            Toast.success('黑名单模板已下载');
        });
        document.getElementById('downloadWhitelistTemplate')?.addEventListener('click', () => {
            const tpl = `# 白名单模板 - 同组学生会被尽量安排坐在一起
# 每行一组，空格分隔学生姓名
小明 小红
小刚 小丽`;
            downloadFile('白名单模板.txt', tpl, 'text/plain;charset=utf-8');
            Toast.success('白名单模板已下载');
        });
        document.getElementById('downloadAiDocFromGuide')?.addEventListener('click', () => {
            const doc = generateAiDevDoc();
            downloadFile(`座位编排系统_AI插件开发文档_v${ModuleRegistry.systemVersion}.md`, doc, 'text/markdown;charset=utf-8');
            Toast.success('AI 开发文档已下载');
        });
        document.getElementById('downloadPluginTplFromGuide')?.addEventListener('click', () => {
            downloadFile('plugin-template.js', PluginManager.getBlankTemplate(), 'text/javascript;charset=utf-8');
            Toast.success('空白插件模板已下载');
        });
        // Custom algorithm modal
        document.getElementById('openCustomAlgo')?.addEventListener('click', () => {
            document.getElementById('customAlgoModal').classList.add('active');
            this.renderCustomAlgoList();
        });
        document.getElementById('closeCustomAlgo')?.addEventListener('click', () => document.getElementById('customAlgoModal').classList.remove('active'));
        document.getElementById('closeCustomAlgoBtn')?.addEventListener('click', () => document.getElementById('customAlgoModal').classList.remove('active'));
        document.getElementById('importCustomAlgo')?.addEventListener('click', () => document.getElementById('customAlgoFile').click());
        document.getElementById('customAlgoFile')?.addEventListener('change', e => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                try {
                    const code = ev.target.result;
                    const report = SecuritySandbox.scan(code);
                    if (report.riskLevel === 'critical') { Toast.error('算法安全检测未通过'); e.target.value = ''; return; }
                    const fn = new Function('AlgorithmRegistry', 'CompositeEval', 'state', code);
                    const registry = {
                        register: (algo) => {
                            if (!algo.name || !algo.peerInfluence) { Toast.error('算法缺少必要字段 (name, peerInfluence)'); return; }
                            if (!this._customAlgorithms) this._customAlgorithms = {};
                            this._customAlgorithms[algo.name] = algo;
                            this._customAlgorithm = algo;
                            Toast.success(`算法 "${algo.name}" 已导入并激活`);
                            addLog('🧬', `导入自定义算法: ${algo.name}`);
                            this.renderCustomAlgoList();
                        }
                    };
                    fn(registry, CompositeEval, state);
                } catch (err) { Toast.error('算法导入失败: ' + err.message); console.error(err); }
                finally { e.target.value = ''; }
            };
            reader.readAsText(file);
        });
        document.getElementById('resetToBuiltinAlgo')?.addEventListener('click', () => {
            this._customAlgorithm = null;
            Toast.success('已恢复内置推荐算法');
            this.renderCustomAlgoList();
        });
        document.getElementById('downloadAlgoTemplate')?.addEventListener('click', () => this._downloadAlgoTemplate());
        document.getElementById('downloadAlgoTemplateFromGuide')?.addEventListener('click', () => this._downloadAlgoTemplate());
        document.getElementById('downloadAiDevDocFromAiAlgo')?.addEventListener('click', () => {
            const doc = generateAiDevDoc();
            const blob = new Blob([doc], { type: 'text/markdown;charset=utf-8' });
            const link = document.createElement('a');
            link.download = `座位编排系统_AI开发文档_v${ModuleRegistry.systemVersion}.md`;
            link.href = URL.createObjectURL(blob); link.click();
            Toast.success('AI 开发文档已下载');
        });
        // [FEATURE #8] Ctrl+K Command Palette
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
                e.preventDefault();
                const overlay = document.getElementById('cmdPalette');
                overlay.classList.toggle('active');
                if (overlay.classList.contains('active')) {
                    const input = document.getElementById('cmdInput');
                    input.value = '';
                    input.focus();
                    this._renderCmdResults('');
                }
            }
        });
        document.getElementById('cmdPalette')?.addEventListener('click', e => {
            if (e.target === document.getElementById('cmdPalette')) document.getElementById('cmdPalette').classList.remove('active');
        });
        document.getElementById('cmdInput')?.addEventListener('input', e => this._renderCmdResults(e.target.value));
        document.getElementById('cmdInput')?.addEventListener('keydown', e => {
            const items = document.querySelectorAll('#cmdResults .cmd-item');
            const highlighted = document.querySelector('#cmdResults .cmd-item.highlighted');
            let idx = Array.from(items).indexOf(highlighted);
            if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('highlighted', i === idx)); items[idx]?.scrollIntoView({ block: 'nearest' }); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); items.forEach((it, i) => it.classList.toggle('highlighted', i === idx)); items[idx]?.scrollIntoView({ block: 'nearest' }); }
            else if (e.key === 'Enter') { e.preventDefault(); if (highlighted) highlighted.click(); else if (items[0]) items[0].click(); }
            else if (e.key === 'Escape') { document.getElementById('cmdPalette').classList.remove('active'); }
        });

        // [FEATURE #15] Touch mode toggle
        document.getElementById('touchModeBtn')?.addEventListener('click', () => {
            document.body.classList.toggle('touch-mode');
            const on = document.body.classList.contains('touch-mode');
            document.getElementById('touchModeBtn').textContent = on ? '🖐️ 标准模式' : '🖐️ 大屏模式';
            try { localStorage.setItem('seatTouchMode', on ? '1' : '0'); } catch(e) {}
            Toast.info(on ? '已开启大屏触控模式' : '已关闭大屏触控模式');
        });
        // Restore touch mode
        try { if (localStorage.getItem('seatTouchMode') === '1') document.body.classList.add('touch-mode'); } catch(e) {}
        // Touch mode sidebar overlay
        document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
            document.querySelector('.sidebar')?.classList.remove('open');
            document.getElementById('sidebarOverlay')?.classList.remove('visible');
        });

        // [FEATURE #11] More menu
        const moreMenuBtn = document.getElementById('moreMenuBtn');
        moreMenuBtn?.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault(); // [FIX] Prevent touch events from interfering
            const mm = document.getElementById('moreMenu');
            mm.classList.toggle('visible');
        });
        document.getElementById('mmReset')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); document.getElementById('resetDraw').click(); });
        document.getElementById('mmExport')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); document.getElementById('exportSeats').click(); });
        document.getElementById('mmStats')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); this.showStats(); });
        document.getElementById('mmPodium')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); this.togglePerspective(); });
        document.getElementById('mmHeatmap')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); document.getElementById('toggleHeatmap').click(); });
        document.getElementById('mmPrint')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); this.printSeats(); });
        document.getElementById('mmGuide')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); document.getElementById('helpBtn').click(); });
        document.getElementById('mmSettings')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); document.getElementById('globalSettingsBtn').click(); });
        document.getElementById('mmMonteCarlo')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); this.runMonteCarloSimulation(); });

        // [FEATURE #12] Side panel
        document.getElementById('closeSidePanel')?.addEventListener('click', () => document.getElementById('sidePanel').classList.remove('visible'));
        const $sptabs = document.querySelectorAll('#sidePanelTabs .side-panel-tab');
        const $spbody = document.querySelectorAll('#sidePanelBody .tab-content');
        $sptabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const sidePanel = document.getElementById('sidePanel');
                sidePanel.classList.add('visible');
                sidePanel.style.transform = '';
                $sptabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                $spbody.forEach(t => t.classList.remove('active'));
                document.getElementById('sp-' + tab.dataset.sptab)?.classList.add('active');
                if (tab.dataset.sptab === 'relationships') this.renderRelationshipPanel();
            });
        });

        // [FEATURE #14] Mobile tab bar - switched to view-based navigation
        document.querySelectorAll('.mobile-tab-item').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation(); // [FIX] Prevent global click handler from closing menus
                document.querySelectorAll('.mobile-tab-item').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                switch (tab.dataset.mtab) {
                    case 'draw': 
                        // Focus on draw action area, scroll to bottom
                        document.querySelector('.bottom-actions')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        break;
                    case 'recommend': 
                        this.showRecommendations(); 
                        break;
                    case 'view': 
                        // Toggle view dropdown for view options
                        document.getElementById('viewDropdown').style.display = 
                            document.getElementById('viewDropdown').style.display === 'none' ? 'block' : 'none';
                        break;
                    case 'more': 
                        document.getElementById('moreMenu').classList.toggle('visible'); 
                        break;
                }
            });
        });

        // [FEATURE #19] Sync auto-draw interval inputs
        document.getElementById('autoDrawIntervalPlugin')?.addEventListener('input', e => {
            const val = e.target.value;
            const inline = document.getElementById('autoDrawIntervalInline');
            if (inline) inline.value = val;
        });

        // Close more menu on outside click
        document.addEventListener('click', e => {
            if (!e.target.closest('#moreMenu') && !e.target.closest('#moreMenuBtn') && !e.target.closest('[data-mtab="more"]')) {
                document.getElementById('moreMenu')?.classList.remove('visible');
            }
        });

        // Student detail modal
        document.getElementById('closeStudentDetail')?.addEventListener('click', () => document.getElementById('studentDetailModal').classList.remove('active'));
        document.getElementById('closeStudentDetailBtn')?.addEventListener('click', () => document.getElementById('studentDetailModal').classList.remove('active'));

        // ==================== Advanced Export/Import Events ====================
        document.getElementById('mmAdvExport')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); AdvExportImport.showExportModal(); });
        document.getElementById('mmAdvImport')?.addEventListener('click', () => { document.getElementById('moreMenu').classList.remove('visible'); AdvExportImport.triggerImport(); });
        document.getElementById('closeAdvExportModal')?.addEventListener('click', () => document.getElementById('advExportModal').classList.remove('active'));
        document.getElementById('cancelAdvExport')?.addEventListener('click', () => document.getElementById('advExportModal').classList.remove('active'));
        document.getElementById('confirmAdvExport')?.addEventListener('click', () => AdvExportImport.doExport());
        document.getElementById('advExportSelectAll')?.addEventListener('click', () => {
            document.querySelectorAll('#advExportGrid input[type="checkbox"]').forEach(cb => { cb.checked = true; cb.closest('.adv-export-item').classList.add('checked'); });
        });
        document.getElementById('advExportDeselectAll')?.addEventListener('click', () => {
            document.querySelectorAll('#advExportGrid input[type="checkbox"]').forEach(cb => { cb.checked = false; cb.closest('.adv-export-item').classList.remove('checked'); });
        });
        document.getElementById('closeAdvImportModal')?.addEventListener('click', () => document.getElementById('advImportModal').classList.remove('active'));
        document.getElementById('cancelAdvImport')?.addEventListener('click', () => document.getElementById('advImportModal').classList.remove('active'));
        document.getElementById('confirmAdvImport')?.addEventListener('click', () => AdvExportImport.doImport());

        // ==================== Import Display Option Events ====================
        document.getElementById('closeImportDisplayOption')?.addEventListener('click', () => {
            document.getElementById('importDisplayOptionModal').classList.remove('active');
        });
        document.getElementById('cancelImportDisplayOption')?.addEventListener('click', () => {
            document.getElementById('importDisplayOptionModal').classList.remove('active');
        });
        document.getElementById('confirmImportDisplayOption')?.addEventListener('click', () => {
            const modal = document.getElementById('importDisplayOptionModal');
            const selectedOption = modal.querySelector('input[name="importDisplayOption"]:checked')?.value || 'display';
            modal.classList.remove('active');

            if (selectedOption === 'display') {
                // Display mode: seats are already shown, just toast
                Toast.success(`已导入并展示座位数据`);
                addLog('📥', '高级导入: 座位数据已展示');
            } else {
                // Hide mode: clear displayed seats, build pending draw sequence
                const seq = [];
                // Platform seats
                if (state.platformRight.student && !state.platformRight.disabled) {
                    seq.push({ type: 'platform-right', seat: state.platformRight, student: JSON.parse(JSON.stringify(state.platformRight.student)) });
                }
                if (state.platformLeft.student && !state.platformLeft.disabled) {
                    seq.push({ type: 'platform-left', seat: state.platformLeft, student: JSON.parse(JSON.stringify(state.platformLeft.student)) });
                }
                // Normal seats sorted by number
                const occupiedSeats = state.seats.filter(s => s.student && !s.disabled).sort((a, b) => a.number - b.number);
                occupiedSeats.forEach(s => seq.push({ type: 'normal', seat: s, student: JSON.parse(JSON.stringify(s.student)) }));

                // Clear all seat assignments
                state.seats.forEach(s => { s.student = null; UI.updateSeatDisplay(s); });
                state.platformLeft.student = null; UI.updateSeatDisplay(state.platformLeft);
                state.platformRight.student = null; UI.updateSeatDisplay(state.platformRight);

                // Reset draw state
                state.drawnStudents = [];
                state.remainingStudents = [...state.students];
                state.currentDrawIndex = 0;

                // Set pending draw sequence
                state.pendingDrawSequence = seq;

                UI.updateStats(); UI.updateProbabilityPanel(); UI.updateEmptyState(); UI.renderPool();

                Toast.info(`已准备 ${seq.length} 个座位，点击「抽取下一个」或「一键自动抽取」开始演示`);
                addLog('📥', '高级导入: 座位数据已加载为抽取序列');
            }
        });

        // ==================== Demo Mode Events ====================
        document.getElementById('mmDemo')?.addEventListener('click', () => {
            document.getElementById('moreMenu').classList.remove('visible');
            if (DemoMode._running) { DemoMode.stop(); }
            else { DemoMode.start(); }
        });
        document.getElementById('demoPauseBtn')?.addEventListener('click', () => DemoMode.togglePause());
        document.getElementById('demoStopBtn')?.addEventListener('click', () => DemoMode.stop());

        // Demo speed slider
        const demoSpeedInput = document.getElementById('demoSpeed');
        const demoSpeedVal = document.getElementById('demoSpeedVal');
        if (demoSpeedInput) {
            demoSpeedInput.addEventListener('input', () => {
                const val = parseInt(demoSpeedInput.value);
                state.settings.demoSpeed = val;
                if (demoSpeedVal) demoSpeedVal.textContent = val;
            });
        }

        // ==================== Relationship Network Events ====================
        // Modal open/close
        document.getElementById('relSaveBtn')?.addEventListener('click', () => this.saveRelationship());
        // Filter controls
        document.getElementById('relSearchInput')?.addEventListener('input', () => this.renderRelationshipGrid());
        document.getElementById('relTypeFilter')?.addEventListener('change', () => this.renderRelationshipGrid());
        document.getElementById('relSignFilter')?.addEventListener('change', () => this.renderRelationshipGrid());
        // Import / Export / Clear
        document.getElementById('relExportBtn')?.addEventListener('click', () => this.exportRelationships());
        document.getElementById('relImportBtn')?.addEventListener('click', () => this.importRelationships());
        document.getElementById('relClearAllBtn')?.addEventListener('click', () => this.clearAllRelationships());
        // Init student search dropdowns
        this.initRelStudentSearch('relStudent1Input', 'relStudent1Id');
        this.initRelStudentSearch('relStudent2Input', 'relStudent2Id');
        // Relationship Graph events
        document.getElementById('mmRelGraph')?.addEventListener('click', () => {
            document.getElementById('moreMenu').classList.remove('visible');
            RelGraph.open();
        });
        document.getElementById('mmAutoOptimize')?.addEventListener('click', () => {
            document.getElementById('moreMenu').classList.remove('visible');
            this.autoOptimizeSeats();
        });
        document.getElementById('closeRelGraphModal')?.addEventListener('click', () => RelGraph.close());
        document.getElementById('closeRelGraphModalBtn')?.addEventListener('click', () => RelGraph.close());
        document.getElementById('relGraphZoomIn')?.addEventListener('click', () => { RelGraph.scale = Math.min(5, RelGraph.scale * 1.2); RelGraph.draw(); });
        document.getElementById('relGraphZoomOut')?.addEventListener('click', () => { RelGraph.scale = Math.max(0.2, RelGraph.scale / 1.2); RelGraph.draw(); });
        document.getElementById('relGraphReset')?.addEventListener('click', () => { RelGraph.scale = 1; RelGraph.offsetX = 0; RelGraph.offsetY = 0; RelGraph.buildGraph(); RelGraph.start(); });
        document.getElementById('relGraphTypeFilter')?.addEventListener('change', (e) => { RelGraph.typeFilter = e.target.value; RelGraph.buildGraph(); RelGraph.start(); });
        document.getElementById('relGraphSignFilter')?.addEventListener('change', (e) => { RelGraph.signFilter = e.target.value; RelGraph.buildGraph(); RelGraph.start(); });
        document.getElementById('relGraphShowLabels')?.addEventListener('change', (e) => { RelGraph.showLabels = e.target.checked; RelGraph.draw(); });
    },
    // [FEATURE #22] Extracted keyboard shortcuts
    bindKeyboardShortcuts() {
        document.addEventListener('keydown', e => {
            if (e.target.matches('input,textarea,select,[contenteditable]')) return;
            if (e.code === 'Space') { e.preventDefault(); document.getElementById('drawNext').click(); }
            if (e.code === 'Escape') {
                this.clearSelection();
                if (state.batchMode) this.exitBatchMode();
                if (document.getElementById('relGraphModal')?.classList.contains('active')) RelGraph.close();
                document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
                document.getElementById('studentInfoPopup').style.display = 'none';
                if (state.selectedPoolStudent !== null) {
                    state.selectedPoolStudent = null;
                    document.querySelectorAll('.pool-item').forEach(pi => pi.classList.remove('pool-selected'));
                    document.querySelectorAll('.seat').forEach(s => s.classList.remove('pool-target'));
                    document.getElementById('poolClickHint')?.classList.remove('visible');
                }
            }
            if (e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); saveConfig(); Toast.success('已保存'); }
            if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); UndoManager.undo(); }
            if (e.ctrlKey && e.code === 'KeyY') { e.preventDefault(); UndoManager.redo(); }
            if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey) { this.enterBatchMode(); Toast.info('批量模式：点击座位选择，然后批量操作'); }
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
                e.preventDefault();
                this.navigateSeats(e.code);
            }
            if (e.code.startsWith('Digit') && !e.ctrlKey && !e.metaKey) {
                const num = parseInt(e.code.replace('Digit', ''));
                if (num >= 1 && num <= 9) {
                    const targetSeat = state.seats.find(s => s.number === num && !s.disabled);
                    if (targetSeat) {
                        this.clearSelection();
                        state.selectedSeat = targetSeat;
                        targetSeat.element.classList.add('selected');
                        targetSeat.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }
        });
    },

    // [FEATURE #8] Command palette rendering
    _renderCmdResults(query) {
        const container = document.getElementById('cmdResults');
        if (!container) return;
        const commands = [
            { icon: '🎲', label: '抽取下一个学生', hint: '空格键', action: () => document.getElementById('drawNext').click() },
            { icon: '⚡', label: '一键自动抽取', hint: '', action: () => document.getElementById('autoDraw').click() },
            { icon: '🧠', label: '智能推荐', hint: '', action: () => this.showRecommendations() },
            { icon: '🔄', label: '重置抽取', hint: '', action: () => document.getElementById('resetDraw').click() },
            { icon: '📊', label: '查看统计', hint: '', action: () => this.showStats() },
            { icon: '🔥', label: '切换热力图', hint: '', action: () => document.getElementById('toggleHeatmap').click() },
            { icon: '🎓', label: '切换讲台视角', hint: '', action: () => this.togglePerspective() },
            { icon: '📸', label: '截图导出', hint: '', action: () => this.showPreviewModal() },
            { icon: '📖', label: '操作指南', hint: '', action: () => document.getElementById('helpBtn').click() },
            { icon: '⚙️', label: '系统设置', hint: '', action: () => document.getElementById('globalSettingsBtn').click() },
            { icon: '🌙', label: '切换深色/浅色模式', hint: '', action: () => document.getElementById('themeToggle').click() },
            { icon: '🖐️', label: '切换大屏触控模式', hint: '', action: () => document.getElementById('touchModeBtn').click() },
            { icon: '🔗', label: '管理关系网络', hint: 'Ctrl+K', action: () => this.openRelationshipModal() },
            { icon: '🕸️', label: '关系链网图', hint: '', action: () => RelGraph.open() },
        ];
        // Add student matches
        const q = (query || '').toLowerCase();
        if (q) {
            const matched = state.students.filter(s => matchStudent(s, q)).slice(0, 8);
            matched.forEach(s => {
                const isSeated = state.drawnStudents.some(d => d.id === s.id);
                const seat = isSeated ? [...state.seats, state.platformLeft, state.platformRight].find(ss => ss.student?.id === s.id) : null;
                commands.unshift({
                    icon: isSeated ? '🪑' : '⏳',
                    label: `${escapeHtml(s.name)} (${s.gender === 'male' ? '♂' : '♀'})`,
                    hint: isSeated && seat ? `座位 ${this.seatLabel(seat)}` : '待抽取',
                    action: () => { document.getElementById('cmdPalette').classList.remove('active'); if (isSeated && seat) this.showStudentInfo(seat); else this.showStudentDetailFromPool(s); }
                });
            });
        }
        // Filter commands by query
        const filtered = q ? commands.filter(c => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q)) : commands;
        if (filtered.length === 0) { container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-tertiary);">无匹配结果</div>'; return; }
        container.innerHTML = filtered.map((c, i) => `<div class="cmd-item${i === 0 ? ' highlighted' : ''}" data-cmd-idx="${i}"><span class="cmd-item-icon">${c.icon}</span><span class="cmd-item-label">${c.label}</span><span class="cmd-item-hint">${c.hint}</span></div>`).join('');
        container.querySelectorAll('.cmd-item').forEach((item, i) => {
            item.addEventListener('click', () => { document.getElementById('cmdPalette').classList.remove('active'); filtered[i]?.action(); });
        });
    }
};

// ==================== Relationship Network Graph ====================
const RelGraph = {
    canvas: null,
    ctx: null,
    nodes: [],
    edges: [],
    animId: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    hoveredNode: null,
    hoveredEdge: null,
    showLabels: true,
    typeFilter: 'all',
    signFilter: 'all',
    _simRunning: false,
    _frameCount: 0,
    dpr: 1,

    REL_COLORS: {
        lovers: '#FF2D55',
        besties: '#FF6B9D',
        brothers: '#007AFF',
        friends: '#34C759',
        enemies: '#FF3B30',
        chatterbox: '#FF9500',
        disturber: '#FF6600',
        neutral: '#8E8E93',
        custom: '#AF52DE'
    },

    _getEdgeColor(rel) {
        if (rel.type === 'custom') return rel.score >= 0 ? '#34C759' : '#FF3B30';
        return this.REL_COLORS[rel.type] || '#8E8E93';
    },

    buildGraph() {
        const rels = (state.relationships || []).filter(r => {
            const s1 = state.students.find(s => s.id === r.student1Id);
            const s2 = state.students.find(s => s.id === r.student2Id);
            if (!s1 || !s2) return false;
            if (this.typeFilter !== 'all' && r.type !== this.typeFilter) return false;
            if (this.signFilter === 'positive' && r.score <= 0) return false;
            if (this.signFilter === 'negative' && r.score >= 0) return false;
            return true;
        });

        const nodeMap = {};
        const addNode = (student) => {
            if (nodeMap[student.id]) return nodeMap[student.id];
            const existing = this.nodes.find(n => n.id === student.id);
            const node = {
                id: student.id,
                name: student.name,
                gender: student.gender,
                x: existing ? existing.x : (Math.random() - 0.5) * 400,
                y: existing ? existing.y : (Math.random() - 0.5) * 300,
                vx: 0,
                vy: 0,
                radius: 18,
                degree: 0,
                fixed: existing ? existing.fixed : false
            };
            nodeMap[student.id] = node;
            return node;
        };

        this.edges = rels.map(r => {
            const s1 = state.students.find(s => s.id === r.student1Id);
            const s2 = state.students.find(s => s.id === r.student2Id);
            const n1 = addNode(s1);
            const n2 = addNode(s2);
            n1.degree++;
            n2.degree++;
            const preset = state.relationshipPresets.find(p => p.type === r.type);
            return { source: n1, target: n2, type: r.type, score: r.score, label: preset ? preset.label : r.type };
        });

        this.nodes = Object.values(nodeMap);
        this.nodes.forEach(n => { n.radius = 18 + Math.min(n.degree * 3, 20); });
        this.renderLegend();
        this.populateTypeFilter();
        this.renderStats();
    },

    populateTypeFilter() {
        const select = document.getElementById('relGraphTypeFilter');
        if (!select) return;
        const usedTypes = new Set(this.edges.map(e => e.type));
        let html = '<option value="all">全部类型</option>';
        state.relationshipPresets.forEach(p => { if (usedTypes.has(p.type)) html += `<option value="${p.type}">${p.label}</option>`; });
        select.innerHTML = html;
        select.value = this.typeFilter;
    },

    renderLegend() {
        const el = document.getElementById('relGraphLegend');
        if (!el) return;
        const usedTypes = new Set(this.edges.map(e => e.type));
        let html = '';
        state.relationshipPresets.forEach(p => {
            if (!usedTypes.has(p.type)) return;
            html += `<div class="rel-graph-legend-item"><span class="rel-graph-legend-line" style="background:${this.REL_COLORS[p.type] || '#8E8E93'};"></span>${p.label}</div>`;
        });
        el.innerHTML = html;
    },

    simulate() {
        if (this.nodes.length === 0) return;
        const cx = this.canvas.width / (2 * this.dpr);
        const cy = this.canvas.height / (2 * this.dpr);
        const K_rep = 8000, K_spring = 0.005, restLen = 120, K_center = 0.01, damping = 0.85;
        const nodes = this.nodes;

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                let dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
                let dist = Math.sqrt(dx * dx + dy * dy); if (dist < 1) dist = 1;
                const force = K_rep / (dist * dist);
                const fx = (dx / dist) * force, fy = (dy / dist) * force;
                if (!nodes[i].fixed) { nodes[i].vx -= fx; nodes[i].vy -= fy; }
                if (!nodes[j].fixed) { nodes[j].vx += fx; nodes[j].vy += fy; }
            }
        }
        for (const edge of this.edges) {
            let dx = edge.target.x - edge.source.x, dy = edge.target.y - edge.source.y;
            let dist = Math.sqrt(dx * dx + dy * dy); if (dist < 1) dist = 1;
            const force = (dist - restLen) * K_spring;
            const fx = (dx / dist) * force, fy = (dy / dist) * force;
            if (!edge.source.fixed) { edge.source.vx += fx; edge.source.vy += fy; }
            if (!edge.target.fixed) { edge.target.vx -= fx; edge.target.vy -= fy; }
        }
        for (const node of nodes) {
            if (node.fixed) continue;
            node.vx += (cx - node.x) * K_center; node.vy += (cy - node.y) * K_center;
            node.vx *= damping; node.vy *= damping;
            node.x += node.vx; node.y += node.vy;
        }
    },

    draw() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;

        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.translate(w / 2 + this.offsetX, h / 2 + this.offsetY);
        ctx.scale(this.scale, this.scale);
        ctx.translate(-w / 2, -h / 2);

        const isHoveringNode = this.hoveredNode !== null;
        const isHoveringEdge = this.hoveredEdge !== null;
        const highlightIds = new Set();
        if (isHoveringNode) {
            highlightIds.add(this.hoveredNode.id);
            this.edges.forEach(e => {
                if (e.source.id === this.hoveredNode.id || e.target.id === this.hoveredNode.id) {
                    highlightIds.add(e.source.id); highlightIds.add(e.target.id);
                }
            });
        }

        for (const edge of this.edges) {
            const color = this._getEdgeColor(edge);
            const width = Math.max(1.5, Math.abs(edge.score) / 15);
            const isHL = isHoveringNode ? (edge.source.id === this.hoveredNode.id || edge.target.id === this.hoveredNode.id) : isHoveringEdge ? (edge === this.hoveredEdge) : true;
            const edgeAlpha = isHL ? 1 : 0.15;
            ctx.beginPath();
            ctx.moveTo(edge.source.x, edge.source.y);
            ctx.lineTo(edge.target.x, edge.target.y);
            ctx.strokeStyle = color.replace(')', `,${edgeAlpha})`).replace('rgb(', 'rgba(');
            if (!color.startsWith('rgb')) ctx.strokeStyle = isHL ? color : 'rgba(142,142,143,0.15)';
            ctx.lineWidth = isHL ? (isHoveringEdge && edge === this.hoveredEdge ? width + 2 : width) : 1;
            ctx.stroke();

            if (isHL && isHoveringEdge && edge === this.hoveredEdge) {
                const mx = (edge.source.x + edge.target.x) / 2;
                const my = (edge.source.y + edge.target.y) / 2;
                ctx.font = 'bold 11px "PingFang SC","Microsoft YaHei",sans-serif';
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
                ctx.strokeText(edge.label, mx, my - 10);
                ctx.fillStyle = '#fff'; ctx.fillText(edge.label, mx, my - 10);
                ctx.fillStyle = edge.score >= 0 ? '#34C759' : '#FF3B30';
                ctx.strokeText(`${edge.score > 0 ? '+' : ''}${edge.score}`, mx, my + 6);
                ctx.fillText(`${edge.score > 0 ? '+' : ''}${edge.score}`, mx, my + 6);
                ctx.lineJoin = 'miter';
            }
        }

        for (const node of this.nodes) {
            const isHL = !isHoveringNode || highlightIds.has(node.id);
            const isSelf = isHoveringNode && node.id === this.hoveredNode.id;
            const isRecHL = this._recommendHighlightIds && this._recommendHighlightIds.has(node.id);
            const alpha = isHL ? 1 : 0.25;

            ctx.beginPath();
            ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
            if (isRecHL) {
                ctx.fillStyle = '#FFD60A';
            } else if (isSelf) {
                ctx.fillStyle = '#0055CC';
            } else if (node.gender === 'male') {
                ctx.fillStyle = `rgba(0,80,200,${alpha})`;
            } else {
                ctx.fillStyle = `rgba(200,30,70,${alpha})`;
            }
            ctx.fill();
            ctx.strokeStyle = isRecHL ? '#FF6600' : (isSelf ? '#FFD60A' : 'rgba(255,255,255,0.9)');
            ctx.lineWidth = isRecHL ? 4 : (isSelf ? 3 : 2);
            ctx.stroke();

            if (this.showLabels) {
                const fontSize = Math.max(11, Math.min(14, node.radius * 0.65));
                ctx.font = `bold ${fontSize}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                const label = node.name.length > 4 ? node.name.slice(0, 4) + '..' : node.name;
                ctx.strokeStyle = 'rgba(0,0,0,0.7)';
                ctx.lineWidth = 3;
                ctx.lineJoin = 'round';
                ctx.strokeText(label, node.x, node.y);
                ctx.fillStyle = '#fff';
                ctx.fillText(label, node.x, node.y);
                ctx.lineJoin = 'miter';
            }
            if (node.fixed) {
                ctx.fillStyle = '#FFD60A';
                ctx.beginPath(); ctx.arc(node.x + node.radius * 0.6, node.y - node.radius * 0.6, 4, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.restore();
        if (this.nodes.length === 0) {
            ctx.fillStyle = '#8E8E93';
            ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('暂无关系数据，请先在关系管理中添加关系', w / 2, h / 2);
        }
    },

    animate() {
        if (!this._simRunning) return;
        this.simulate(); this.draw();
        this._frameCount++;
        if (this._frameCount > 300) this._simRunning = false;
        this.animId = requestAnimationFrame(() => this.animate());
    },
    start() { this._simRunning = true; this._frameCount = 0; if (this.animId) cancelAnimationFrame(this.animId); this.animate(); },
    stop() { this._simRunning = false; if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; } },

    screenToGraph(sx, sy) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = sx - rect.left, my = sy - rect.top;
        return { x: (mx - rect.width / 2 - this.offsetX) / this.scale + rect.width / 2, y: (my - rect.height / 2 - this.offsetY) / this.scale + rect.height / 2 };
    },
    findNodeAt(gx, gy) {
        for (let i = this.nodes.length - 1; i >= 0; i--) {
            const n = this.nodes[i], dx = gx - n.x, dy = gy - n.y;
            if (dx * dx + dy * dy <= n.radius * n.radius) return n;
        }
        return null;
    },
    findEdgeAt(gx, gy) {
        for (const edge of this.edges) {
            const sx = edge.source.x, sy = edge.source.y, tx = edge.target.x, ty = edge.target.y;
            const lenSq = (tx - sx) * (tx - sx) + (ty - sy) * (ty - sy);
            if (lenSq === 0) continue;
            let t = Math.max(0, Math.min(1, ((gx - sx) * (tx - sx) + (gy - sy) * (ty - sy)) / lenSq));
            const px = sx + t * (tx - sx), py = sy + t * (ty - sy);
            if (Math.sqrt((gx - px) * (gx - px) + (gy - py) * (gy - py)) <= 6) return edge;
        }
        return null;
    },

    showTooltip(screenX, screenY, html) {
        const tip = document.getElementById('relGraphTooltip');
        if (!tip) return;
        const rect = document.getElementById('relGraphCanvasWrapper').getBoundingClientRect();
        let left = screenX - rect.left + 12, top = screenY - rect.top - 10;
        if (left + 220 > rect.width) left = screenX - rect.left - 220;
        if (top < 0) top = 10;
        tip.innerHTML = html; tip.style.display = 'block'; tip.style.left = left + 'px'; tip.style.top = top + 'px';
    },
    hideTooltip() { const tip = document.getElementById('relGraphTooltip'); if (tip) tip.style.display = 'none'; },

    onPointerDown(e) {
        if (!this.canvas) return;
        const { x: gx, y: gy } = this.screenToGraph(e.clientX, e.clientY);
        const node = this.findNodeAt(gx, gy);
        if (node) { this.dragging = node; this.dragOffsetX = gx - node.x; this.dragOffsetY = gy - node.y; this._simRunning = true; this._frameCount = 0; }
        else { this.isPanning = true; this.panStartX = e.clientX; this.panStartY = e.clientY; }
    },
    onPointerMove(e) {
        if (!this.canvas) return;
        if (this.dragging) {
            const { x: gx, y: gy } = this.screenToGraph(e.clientX, e.clientY);
            this.dragging.x = gx - this.dragOffsetX; this.dragging.y = gy - this.dragOffsetY; this.dragging.fixed = true; this.draw(); return;
        }
        if (this.isPanning) {
            this.offsetX += e.clientX - this.panStartX; this.offsetY += e.clientY - this.panStartY;
            this.panStartX = e.clientX; this.panStartY = e.clientY; this.draw(); return;
        }
        const { x: gx, y: gy } = this.screenToGraph(e.clientX, e.clientY);
        const node = this.findNodeAt(gx, gy);
        const prevNode = this.hoveredNode, prevEdge = this.hoveredEdge;
        if (node) {
            this.hoveredNode = node; this.hoveredEdge = null; this.canvas.style.cursor = 'pointer';
            const relCount = this.edges.filter(e => e.source.id === node.id || e.target.id === node.id).length;
            const seat = [...state.seats, state.platformLeft, state.platformRight].find(s => s.student?.id === node.id);
            let html = `<div class="tip-name">${escapeHtml(node.name)} ${node.gender === 'male' ? '♂' : '♀'}</div>`;
            html += `<div class="tip-meta">关系数: ${relCount}${seat ? ' · 座位: ' + UI.seatLabel(seat) : ' · 未入座'}</div>`;
            this.showTooltip(e.clientX, e.clientY, html);
        } else {
            const edge = this.findEdgeAt(gx, gy);
            if (edge) {
                this.hoveredNode = null; this.hoveredEdge = edge; this.canvas.style.cursor = 'pointer';
                const color = this._getEdgeColor(edge);
                let html = `<div class="tip-name">${escapeHtml(edge.source.name)} ↔ ${escapeHtml(edge.target.name)}</div>`;
                html += `<div class="tip-rel"><span style="color:${color};">${edge.label}</span></div>`;
                html += `<div class="tip-meta">分数: <span style="color:${edge.score >= 0 ? '#34C759' : '#FF3B30'};">${edge.score > 0 ? '+' : ''}${edge.score}</span></div>`;
                this.showTooltip(e.clientX, e.clientY, html);
            } else { this.hoveredNode = null; this.hoveredEdge = null; this.canvas.style.cursor = 'grab'; this.hideTooltip(); }
        }
        if (prevNode !== this.hoveredNode || prevEdge !== this.hoveredEdge) this.draw();
    },
    onPointerUp() { if (this.dragging) this.dragging = null; this.isPanning = false; },
    onDblClick(e) {
        const { x: gx, y: gy } = this.screenToGraph(e.clientX, e.clientY);
        const node = this.findNodeAt(gx, gy);
        if (node) { node.fixed = !node.fixed; if (!node.fixed) { this._simRunning = true; this._frameCount = 0; } this.draw(); return; }
        const edge = this.findEdgeAt(gx, gy);
        if (edge) {
            const rel = state.relationships.find(r =>
                (r.student1Id === edge.source.id && r.student2Id === edge.target.id) ||
                (r.student1Id === edge.target.id && r.student2Id === edge.source.id)
            );
            if (rel) UI.openRelationshipModal(rel.id);
        }
    },
    onContextMenu(e) {
        e.preventDefault();
        const { x: gx, y: gy } = this.screenToGraph(e.clientX, e.clientY);
        const node = this.findNodeAt(gx, gy);
        const edge = this.findEdgeAt(gx, gy);
        const menu = document.getElementById('relGraphContextMenu');
        if (!menu) return;

        this._ctxTarget = { node, edge };
        menu.style.display = 'block';
        const wrapper = document.getElementById('relGraphCanvasWrapper');
        const rect = wrapper.getBoundingClientRect();
        let left = e.clientX - rect.left, top = e.clientY - rect.top;
        if (left + 170 > rect.width) left = rect.width - 170;
        if (top + 160 > rect.height) top = rect.height - 160;
        menu.style.left = left + 'px'; menu.style.top = top + 'px';

        const addBtn = document.getElementById('relCtxAddRelation');
        const editBtn = document.getElementById('relCtxEditRelation');
        const delBtn = document.getElementById('relCtxDeleteRelation');
        const fixBtn = document.getElementById('relCtxFixNode');
        const hlBtn = document.getElementById('relCtxHighlightConnected');

        if (node) {
            addBtn.style.display = 'block';
            addBtn.textContent = `➕ 为 ${node.name} 添加关系`;
            fixBtn.style.display = 'block';
            fixBtn.textContent = node.fixed ? '📌 释放节点' : '📌 固定节点';
            hlBtn.style.display = 'block';
            editBtn.style.display = 'none';
            delBtn.style.display = 'none';
        } else if (edge) {
            addBtn.style.display = 'none';
            fixBtn.style.display = 'none';
            hlBtn.style.display = 'none';
            editBtn.style.display = 'block';
            delBtn.style.display = 'block';
        } else {
            menu.style.display = 'none'; return;
        }
    },
    handleCtxAction(action) {
        const target = this._ctxTarget;
        if (!target) return;
        const menu = document.getElementById('relGraphContextMenu');
        if (menu) menu.style.display = 'none';

        if (target.node) {
            if (action === 'addRelation') {
                // Pre-fill the form in the right panel
                const s1Input = document.getElementById('relStudent1Input');
                const s1IdEl = document.getElementById('relStudent1Id');
                const s2Input = document.getElementById('relStudent2Input');
                const titleEl = document.getElementById('relFormTitle');
                if (s1Input) s1Input.value = target.node.name;
                if (s1IdEl) s1IdEl.textContent = target.node.id;
                if (s2Input) s2Input.value = '';
                if (titleEl) titleEl.textContent = '➕ 添加关系';
                // Clear edit state
                const editIdEl = document.getElementById('relEditId');
                if (editIdEl) editIdEl.textContent = '';
                // Focus on student B input
                setTimeout(() => s2Input?.focus(), 50);
            } else if (action === 'fixNode') {
                target.node.fixed = !target.node.fixed;
                if (!target.node.fixed) { this._simRunning = true; this._frameCount = 0; }
                this.draw();
            } else if (action === 'highlightConnected') {
                this._highlightId = target.node.id;
                this.draw();
                setTimeout(() => { this._highlightId = null; this.draw(); }, 3000);
            }
        } else if (target.edge) {
            const rel = state.relationships.find(r =>
                (r.student1Id === target.edge.source.id && r.student2Id === target.edge.target.id) ||
                (r.student1Id === target.edge.target.id && r.student2Id === target.edge.source.id)
            );
            if (action === 'editRelation' && rel) {
                // Pre-fill the form in the right panel
                const s1 = state.students.find(s => s.id === rel.student1Id);
                const s2 = state.students.find(s => s.id === rel.student2Id);
                const s1Input = document.getElementById('relStudent1Input');
                const s2Input = document.getElementById('relStudent2Input');
                const s1IdEl = document.getElementById('relStudent1Id');
                const s2IdEl = document.getElementById('relStudent2Id');
                const typeSelect = document.getElementById('relTypeSelect');
                const scoreSlider = document.getElementById('relScoreSlider');
                const scoreInput = document.getElementById('relScoreInput');
                const editIdEl = document.getElementById('relEditId');
                const titleEl = document.getElementById('relFormTitle');
                if (s1) { s1Input.value = s1.name; s1IdEl.textContent = s1.id; }
                if (s2) { s2Input.value = s2.name; s2IdEl.textContent = s2.id; }
                typeSelect.value = rel.type;
                scoreSlider.value = rel.score;
                scoreInput.value = rel.score;
                editIdEl.textContent = rel.id;
                if (titleEl) titleEl.textContent = '✏️ 编辑关系';
            }
            if (action === 'deleteRelation' && rel) { UI.deleteRelationship(rel.id); this.buildGraph(); this.draw(); this.renderStats(); }
        }
    },
    onWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const oldScale = this.scale;
        this.scale = Math.max(0.2, Math.min(5, this.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
        const ratio = this.scale / oldScale;
        this.offsetX = mx - ratio * (mx - rect.width / 2 - this.offsetX) - rect.width / 2;
        this.offsetY = my - ratio * (my - rect.height / 2 - this.offsetY) - rect.height / 2;
        this.draw();
    },
    resizeCanvas() {
        if (!this.canvas || !this.canvas.parentElement) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * this.dpr; this.canvas.height = rect.height * this.dpr;
        this.canvas.style.width = rect.width + 'px'; this.canvas.style.height = rect.height + 'px';
    },

    open() {
        const modal = document.getElementById('relGraphModal');
        if (!modal) return;
        modal.classList.add('active');
        this.canvas = document.getElementById('relGraphCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.showLabels = document.getElementById('relGraphShowLabels')?.checked !== false;
        this.typeFilter = 'all'; this.signFilter = 'all';
        this.scale = 1; this.offsetX = 0; this.offsetY = 0;
        this.hoveredNode = null; this.hoveredEdge = null; this.dragging = null; this.isPanning = false;
        this.resizeCanvas(); this.buildGraph(); this.start();

        this._onPointerDown = (e) => this.onPointerDown(e);
        this._onPointerMove = (e) => this.onPointerMove(e);
        this._onPointerUp = () => this.onPointerUp();
        this._onDblClick = (e) => this.onDblClick(e);
        this._onWheel = (e) => this.onWheel(e);
        this._onContextMenu = (e) => this.onContextMenu(e);

        this.canvas.addEventListener('mousedown', this._onPointerDown);
        window.addEventListener('mousemove', this._onPointerMove);
        window.addEventListener('mouseup', this._onPointerUp);
        this.canvas.addEventListener('dblclick', this._onDblClick);
        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this.canvas.addEventListener('contextmenu', this._onContextMenu);

        document.addEventListener('click', this._hideCtxMenu = () => {
            const menu = document.getElementById('relGraphContextMenu');
            if (menu) menu.style.display = 'none';
        });
        document.getElementById('relCtxAddRelation')?.addEventListener('click', () => this.handleCtxAction('addRelation'));
        document.getElementById('relCtxEditRelation')?.addEventListener('click', () => this.handleCtxAction('editRelation'));
        document.getElementById('relCtxDeleteRelation')?.addEventListener('click', () => this.handleCtxAction('deleteRelation'));
        document.getElementById('relCtxFixNode')?.addEventListener('click', () => this.handleCtxAction('fixNode'));
        document.getElementById('relCtxHighlightConnected')?.addEventListener('click', () => this.handleCtxAction('highlightConnected'));
        document.getElementById('relGraphExportImg')?.addEventListener('click', () => this.exportImage());

        this.renderStats();
        // Initialize relationship form and grid in right panel
        UI.renderRelTypeOptions();
        UI.renderRelationshipGrid();
        // Reset form title
        const titleEl = document.getElementById('relFormTitle');
        if (titleEl) titleEl.textContent = '➕ 添加关系';
        // Reset form
        const editIdEl = document.getElementById('relEditId');
        if (editIdEl) editIdEl.textContent = '';
        const s1Input = document.getElementById('relStudent1Input');
        const s2Input = document.getElementById('relStudent2Input');
        const s1IdEl = document.getElementById('relStudent1Id');
        const s2IdEl = document.getElementById('relStudent2Id');
        if (s1Input) s1Input.value = '';
        if (s2Input) s2Input.value = '';
        if (s1IdEl) s1IdEl.textContent = '';
        if (s2IdEl) s2IdEl.textContent = '';

        this._onResize = () => { this.resizeCanvas(); this.draw(); };
        window.addEventListener('resize', this._onResize);
    },

    renderStats() {
        const el = document.getElementById('relGraphStats');
        if (!el) return;
        const total = this.edges.length;
        const positive = this.edges.filter(e => e.score > 0).length;
        const negative = this.edges.filter(e => e.score < 0).length;
        const avgScore = total > 0 ? Math.round(this.edges.reduce((s, e) => s + e.score, 0) / total) : 0;
        const topConnected = this.nodes.length > 0 ? [...this.nodes].sort((a, b) => b.degree - a.degree)[0] : null;
        // Calculate health score (0-100)
        const healthScore = this.calcHealthScore();
        const healthColor = healthScore >= 70 ? '#34C759' : healthScore >= 40 ? '#FF9500' : '#FF3B30';
        el.innerHTML = `
            <span class="stat-item">关系总数: <span class="stat-value">${total}</span></span>
            <span class="stat-item" style="color:#34C759;">正向: <span class="stat-value">${positive}</span></span>
            <span class="stat-item" style="color:#FF3B30;">负向: <span class="stat-value">${negative}</span></span>
            <span class="stat-item">平均分: <span class="stat-value">${avgScore > 0 ? '+' : ''}${avgScore}</span></span>
            <span class="stat-item" style="color:${healthColor};">健康度: <span class="stat-value">${healthScore}分</span></span>
            ${topConnected ? `<span class="stat-item">最活跃: <span class="stat-value">${escapeHtml(topConnected.name)}(${topConnected.degree})</span></span>` : ''}
        `;
    },

    calcHealthScore() {
        if (this.edges.length === 0) return 100;
        const total = this.edges.length;
        const positive = this.edges.filter(e => e.score > 0).length;
        const negative = this.edges.filter(e => e.score < 0).length;
        const posRatio = positive / total;
        const negRatio = negative / total;
        // Base score from positive ratio
        let score = Math.round(posRatio * 80);
        // Penalty for negative relationships
        score -= Math.round(negRatio * 30);
        // Bonus for having relationships (engagement)
        const nodeCount = this.nodes.length;
        const studentCount = state.students.length;
        const engagement = studentCount > 0 ? nodeCount / studentCount : 0;
        score += Math.round(engagement * 20);
        return Math.max(0, Math.min(100, score));
    },

    highlightRecommendNodes(ids, duration) {
        if (!ids || ids.length === 0) return;
        this._recommendHighlightIds = new Set(ids);
        this.draw();
        setTimeout(() => { this._recommendHighlightIds = null; this.draw(); }, duration || 2000);
    },

    exportImage() {
        if (!this.canvas) return;
        const link = document.createElement('a');
        link.download = `关系链网图_${new Date().toISOString().slice(0,10)}.png`;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
        Toast.success('关系网图已导出');
    },

    close() {
        this.stop();
        const modal = document.getElementById('relGraphModal');
        if (modal) modal.classList.remove('active');
        if (this.canvas) {
            this.canvas.removeEventListener('mousedown', this._onPointerDown);
            this.canvas.removeEventListener('dblclick', this._onDblClick);
            this.canvas.removeEventListener('wheel', this._onWheel);
            this.canvas.removeEventListener('contextmenu', this._onContextMenu);
        }
        window.removeEventListener('mousemove', this._onPointerMove);
        window.removeEventListener('mouseup', this._onPointerUp);
        window.removeEventListener('resize', this._onResize);
        if (this._hideCtxMenu) document.removeEventListener('click', this._hideCtxMenu);
        const menu = document.getElementById('relGraphContextMenu');
        if (menu) menu.style.display = 'none';
        this.hideTooltip();
    }
};

