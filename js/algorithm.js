// ==================== Algorithm (Bug-fixed) ====================
const Algorithm = {
    pushHistory() {
        const snapshot = [];
        [...state.seats, state.platformLeft, state.platformRight].forEach(s => {
            if (s.student) snapshot.push({ id: s.student.id, name: s.student.name, row: s.row, col: s.col, type: s.type });
        });
        if (snapshot.length > 0) {
            state.history.push(snapshot);
            if (state.history.length > 20) state.history.shift();
        }
    },
    calculateProbabilities() {
        if (state.remainingStudents.length === 0) return [];
        let probabilities = {};
        state.remainingStudents.forEach(s => { probabilities[s.id] = 1; });
        if (state.settings.antiCluster) {
            this.applyBlacklist(probabilities);
            this.applyWhitelist(probabilities);
        }
        this.applyRelationships(probabilities);
        if (state.settings.genderBalance) this.applyGenderBalance(probabilities);
        this.applyHistory(probabilities);
        const nextSeat = state.drawOrder[state.currentDrawIndex] || null;
        Object.keys(state.plugins).forEach(pn => {
            if (PluginManager.isEnabled(pn) && state.plugins[pn].beforeDraw) {
                try {
                    const result = state.plugins[pn].beforeDraw(state.remainingStudents, probabilities, nextSeat);
                    if (result && result.probabilities) probabilities = result.probabilities;
                } catch(e) { console.error(`Plugin ${pn}.beforeDraw error`, e); }
            }
        });
        Object.keys(probabilities).forEach(id => {
            probabilities[id] = Math.max(probabilities[id], 0.001);
        });
        const total = Object.values(probabilities).reduce((a, b) => a + b, 0);
        if (total <= 0) {
            state.remainingStudents.forEach(s => { probabilities[s.id] = 1 / state.remainingStudents.length; });
        } else {
            Object.keys(probabilities).forEach(id => { probabilities[id] = probabilities[id] / total; });
        }
        return Object.entries(probabilities)
            .map(([id, prob]) => ({ student: state.students.find(s => s.id === parseInt(id)), probability: prob }))
            .filter(item => item.student)
            .sort((a, b) => b.probability - a.probability);
    },
    calculateEffectiveDistance(seat1, seat2) {
        if (!seat1 || !seat2) return Infinity;
        if (seat1.type !== 'normal' || seat2.type !== 'normal') return Math.abs(seat1.row - seat2.row) + Math.abs(seat1.col - seat2.col);
        const row1 = seat1.row, col1 = seat1.col, row2 = seat2.row, col2 = seat2.col;
        if (row1 === row2) {
            const minC = Math.min(col1, col2), maxC = Math.max(col1, col2);
            for (let c = minC + 1; c < maxC; c++) {
                const idx = row1 * state.cols + c;
                if (state.seats[idx] && (state.seats[idx].disabled || state.seats[idx].element.classList.contains('aisle'))) return Infinity;
            }
        }
        if (col1 === col2) {
            const minR = Math.min(row1, row2), maxR = Math.max(row1, row2);
            for (let r = minR + 1; r < maxR; r++) {
                const idx = r * state.cols + col1;
                if (state.seats[idx] && (state.seats[idx].disabled || state.seats[idx].element.classList.contains('aisle'))) return Infinity;
            }
        }
        if (row1 !== row2 && col1 !== col2) {
            let path1Blocked = false, path2Blocked = false;
            for (let c = Math.min(col1, col2) + 1; c < Math.max(col1, col2); c++) {
                const idx = row1 * state.cols + c;
                if (state.seats[idx] && (state.seats[idx].disabled || state.seats[idx].element.classList.contains('aisle'))) { path1Blocked = true; break; }
            }
            if (!path1Blocked) {
                for (let r = Math.min(row1, row2) + 1; r < Math.max(row1, row2); r++) {
                    const idx = r * state.cols + col2;
                    if (state.seats[idx] && (state.seats[idx].disabled || state.seats[idx].element.classList.contains('aisle'))) { path1Blocked = true; break; }
                }
            }
            for (let r = Math.min(row1, row2) + 1; r < Math.max(row1, row2); r++) {
                const idx = r * state.cols + col1;
                if (state.seats[idx] && (state.seats[idx].disabled || state.seats[idx].element.classList.contains('aisle'))) { path2Blocked = true; break; }
            }
            if (!path2Blocked) {
                for (let c = Math.min(col1, col2) + 1; c < Math.max(col1, col2); c++) {
                    const idx = row2 * state.cols + c;
                    if (state.seats[idx] && (state.seats[idx].disabled || state.seats[idx].element.classList.contains('aisle'))) { path2Blocked = true; break; }
                }
            }
            if (path1Blocked && path2Blocked) return Infinity;
        }
        return Math.abs(row1 - row2) + Math.abs(col1 - col2);
    },
    applyBlacklist(probabilities) {
        const drawnSeats = [...state.seats, state.platformLeft, state.platformRight].filter(s => s.student && !s.disabled);
        const nextSeat = state.drawOrder[state.currentDrawIndex];
        if (!nextSeat) return;
        const parseName = (raw) => {
            let name = raw;
            let isAnchor = false;
            if (name.startsWith('*')) { isAnchor = true; name = name.slice(1); }
            if ((name.startsWith('(') && name.endsWith(')')) || (name.startsWith('（') && name.endsWith('）'))) {
                isAnchor = true; name = name.slice(1, -1);
            }
            return { name, isAnchor };
        };
        state.blacklist.forEach(group => {
            const parsed = group.map(parseName);
            const cleanGroup = parsed.map(p => p.name);
            const anchorNames = parsed.filter(p => p.isAnchor).map(p => p.name);
            const drawnInGroup = cleanGroup.filter(name => drawnSeats.some(s => s.student.name === name));
            if (drawnInGroup.length === 0) return;
            let anchors;
            if (anchorNames.length > 0) {
                anchors = drawnInGroup.filter(n => anchorNames.includes(n));
                if (anchors.length === 0) return;
            } else {
                const drawOrder = state.drawnStudents.map(s => s.name);
                anchors = [drawnInGroup.sort((a, b) => drawOrder.indexOf(a) - drawOrder.indexOf(b))[0]];
            }
            state.remainingStudents.forEach(student => {
                if (!cleanGroup.includes(student.name)) return;
                let minDist = Infinity;
                anchors.forEach(dn => {
                    const ds = drawnSeats.find(s => s.student.name === dn);
                    if (ds) minDist = Math.min(minDist, this.calculateEffectiveDistance(ds, nextSeat));
                });
                if (minDist <= state.settings.blacklistRadius) {
                    probabilities[student.id] *= Math.max(0.001, 1 - state.settings.blacklistPenalty / 100);
                }
            });
        });
    },
    applyWhitelist(probabilities) {
        const drawnSeats = [...state.seats, state.platformLeft, state.platformRight].filter(s => s.student && !s.disabled);
        const nextSeat = state.drawOrder[state.currentDrawIndex];
        if (!nextSeat || nextSeat.type !== 'normal') return;
        const parseName = (raw) => {
            let name = raw;
            let isAnchor = false;
            if (name.startsWith('*')) { isAnchor = true; name = name.slice(1); }
            if ((name.startsWith('(') && name.endsWith(')')) || (name.startsWith('（') && name.endsWith('）'))) {
                isAnchor = true; name = name.slice(1, -1);
            }
            return { name, isAnchor };
        };
        state.whitelist.forEach(group => {
            const parsed = group.map(parseName);
            const cleanGroup = parsed.map(p => p.name);
            const anchorNames = parsed.filter(p => p.isAnchor).map(p => p.name);
            const drawnInGroup = cleanGroup.filter(name => drawnSeats.some(s => s.student.name === name));
            if (drawnInGroup.length === 0) return;
            let anchorDrawn;
            if (anchorNames.length > 0) {
                anchorDrawn = drawnInGroup.filter(n => anchorNames.includes(n));
                if (anchorDrawn.length === 0) return;
            } else {
                anchorDrawn = drawnInGroup;
            }
            state.remainingStudents.forEach(student => {
                if (!cleanGroup.includes(student.name)) return;
                let bestBonus = 0;
                anchorDrawn.forEach(dn => {
                    const ds = drawnSeats.find(s => s.student.name === dn);
                    if (!ds) return;
                    const dist = this.calculateEffectiveDistance(ds, nextSeat);
                    if (dist === Infinity) return;
                    const rowDiff = Math.abs(ds.row - nextSeat.row);
                    const colDiff = Math.abs(ds.col - nextSeat.col);
                    let bonus = 0;
                    if (rowDiff === 0 && colDiff === 1) bonus = state.settings.whitelistDeskBonus / 100;
                    else if (rowDiff === 1 && colDiff === 0) bonus = state.settings.whitelistFrontBackBonus / 100;
                    else if (rowDiff === 1 && colDiff === 1) bonus = state.settings.whitelistDiagonalBonus / 100;
                    else if (dist <= 5) bonus = state.settings.whitelistFallbackBonus / 100;
                    bestBonus = Math.max(bestBonus, bonus);
                });
                if (bestBonus > 0) {
                    probabilities[student.id] *= Math.pow(1 + bestBonus, 3);
                }
            });
        });
    },
    applyRelationships(probabilities) {
        const drawnSeats = [...state.seats, state.platformLeft, state.platformRight].filter(s => s.student && !s.disabled);
        const nextSeat = state.drawOrder[state.currentDrawIndex];
        if (!nextSeat || !state.relationships || state.relationships.length === 0) return;
        state.remainingStudents.forEach(student => {
            let multiplier = 1;
            drawnSeats.forEach(ds => {
                if (!ds.student) return;
                const rel = UI.getRelationshipBetween(student, ds.student);
                if (!rel) return;
                const dist = this.calculateEffectiveDistance(ds, nextSeat);
                if (dist <= 2) {
                    multiplier *= (1 + rel.score / 100);
                }
            });
            probabilities[student.id] *= multiplier;
        });
    },
    applyGenderBalance(probabilities) {
        const rm = state.remainingStudents.filter(s => s.gender === 'male').length;
        const rf = state.remainingStudents.filter(s => s.gender === 'female').length;
        const total = rm + rf;
        if (total === 0) return;
        const mr = rm / total, fr = rf / total;
        state.remainingStudents.forEach(s => {
            if (s.gender === 'male' && mr > 0.6) probabilities[s.id] *= 0.7;
            else if (s.gender === 'female' && fr > 0.6) probabilities[s.id] *= 0.7;
        });
    },
    applyHistory(probabilities) {
        if (state.history.length === 0) return;
        const recent = state.history.slice(-5);
        state.remainingStudents.forEach(student => {
            let penalty = 0;
            recent.forEach(snapshot => {
                const studentEntry = snapshot.find(h => h.id === student.id);
                if (!studentEntry) return;
                snapshot.forEach(entry => {
                    if (entry.id === student.id) return;
                    const isDrawn = state.drawnStudents.some(d => d.id === entry.id);
                    if (!isDrawn) return;
                    if (this.areAdjacentByRC(studentEntry.row, studentEntry.col, entry.row, entry.col)) {
                        penalty += 0.1;
                    }
                });
            });
            probabilities[student.id] *= Math.max(0.1, 1 - penalty);
        });
    },
    areAdjacentByRC(r1, c1, r2, c2) {
        if (r1 < 0 || r2 < 0) return false;
        return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
    },
    drawStudent() {
        const probabilities = this.calculateProbabilities();
        if (probabilities.length === 0) return null;
        let random = Math.random();
        let cumulative = 0;
        for (let i = 0; i < probabilities.length; i++) {
            cumulative += probabilities[i].probability;
            if (random <= cumulative || i === probabilities.length - 1) {
                const idx = state.remainingStudents.findIndex(s => s.id === probabilities[i].student.id);
                return state.remainingStudents.splice(idx, 1)[0];
            }
        }
        return null; // Safety fallback (unreachable)
    }
};
