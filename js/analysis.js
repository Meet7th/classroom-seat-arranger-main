// ==================== Composite Evaluation Engine ====================
const CompositeEval = {
    getScore(student) {
        if (!student) return 0;
        const w = state.settings.weights;
        let totalWeight = 0, totalScore = 0;

        if (w.academic > 0) {
            const scores = student.scores || {};
            const vals = Object.values(scores).filter(v => v !== null && v !== undefined);
            if (vals.length > 0) {
                const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
                totalScore += avg * w.academic;
                totalWeight += w.academic;
            }
        }

        if (w.personality > 0 && student.personality) {
            const pScore = student.personality === '中性' ? 80 : student.personality === '外向' ? 70 : 65;
            totalScore += pScore * w.personality;
            totalWeight += w.personality;
        }

        if (w.hobby > 0 && student.hobbies && student.hobbies.length > 0) {
            const hScore = Math.min(100, 50 + student.hobbies.length * 10);
            totalScore += hScore * w.hobby;
            totalWeight += w.hobby;
        }

        if (w.position > 0 && student.position) {
            const posScores = { '班长': 95, '副班长': 90, '学习委员': 90, '体育委员': 85, '文艺委员': 85, '劳动委员': 80, '小组长': 75, '课代表': 80 };
            const pScore = posScores[student.position] || 60;
            totalScore += pScore * w.position;
            totalWeight += w.position;
        }

        return totalWeight > 0 ? Math.round(totalScore / totalWeight) : (student.score ?? 0);
    },

    getAvgScore(student) {
        if (!student) return null;
        const scores = student.scores || {};
        const vals = Object.values(scores).filter(v => v !== null && v !== undefined);
        if (vals.length === 0) return student.score || null;
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    },

    getSubjectScore(student, subject) {
        if (!student || !student.scores) return null;
        return student.scores[subject] ?? null;
    },

    peerInfluence(s1, s2) {
        if (!s1 || !s2) return 0;
        let score = 0;

        const avg1 = this.getAvgScore(s1), avg2 = this.getAvgScore(s2);
        if (avg1 !== null && avg2 !== null) {
            const diff = Math.abs(avg1 - avg2);
            if (diff > 15 && diff < 40) score += 20;
            else if (diff <= 15) score += 10;
        }

        if (s1.personality && s2.personality) {
            if (s1.personality === '外向' && s2.personality === '内向') score += 15;
            else if (s1.personality === '内向' && s2.personality === '外向') score += 15;
            else if (s1.personality === '中性' || s2.personality === '中性') score += 8;
        }

        if (s1.hobbies && s2.hobbies) {
            const shared = s1.hobbies.filter(h => s2.hobbies.includes(h));
            score += Math.min(20, shared.length * 8);
        }

        if (s1.position && s2.position && s1.position !== s2.position) score += 10;

        if (s1.gender !== s2.gender) score += 5;

        return score;
    },

    explainPairing(s1, s2, relationship) {
        const factors = [];
        const avg1 = this.getAvgScore(s1), avg2 = this.getAvgScore(s2);

        if (avg1 !== null && avg2 !== null) {
            const diff = Math.abs(avg1 - avg2);
            if (diff > 15) factors.push({ icon: '📊', label: '学业互补', detail: `差${diff}分`, type: 'positive' });
            else factors.push({ icon: '📊', label: '学业同步', detail: `${avg1}/${avg2}`, type: 'positive' });
        }

        if (s1.personality && s2.personality) {
            if ((s1.personality === '外向' && s2.personality === '内向') || (s1.personality === '内向' && s2.personality === '外向'))
                factors.push({ icon: '🧠', label: '性格互补', detail: `${s1.personality}+${s2.personality}`, type: 'positive' });
        }

        if (s1.hobbies && s2.hobbies) {
            const shared = s1.hobbies.filter(h => s2.hobbies.includes(h));
            if (shared.length > 0) factors.push({ icon: '💬', label: '共同爱好', detail: shared.join('/'), type: 'positive' });
        }

        if (s1.position && s2.position && s1.position !== s2.position)
            factors.push({ icon: '👔', label: '职务搭配', detail: `${s1.position}+${s2.position}`, type: 'positive' });

        if (s1.gender !== s2.gender) factors.push({ icon: '⚖️', label: '性别均衡', detail: '男女搭配', type: 'positive' });

        // Add relationship factor if exists
        if (relationship) {
            const preset = state.relationshipPresets.find(p => p.type === relationship.type);
            const label = preset ? preset.label.replace(/[^\u4e00-\u9fa5]/g, '') : relationship.type;
            factors.push({
                icon: relationship.score > 0 ? '💕' : '⚡',
                label: label,
                detail: `${relationship.score > 0 ? '+' : ''}${relationship.score}分`,
                type: 'relationship',
                score: relationship.score
            });
        }

        // Generate summary text for backward compatibility
        const summary = factors.map(f => `${f.label}(${f.detail})`).join(' + ');

        return {
            factors,
            summary: summary || '综合评估后的位置建议',
            text: factors.map(f => `${f.label}：${f.detail}`).join('。')
        };
    },

    renderExplanation() {
        const w = state.settings.weights;
        const container = document.getElementById('algoWeightBars');
        if (!container) return;
        container.innerHTML = `
            <div style="margin-top:12px;">
                <div class="algo-weight-bar"><span class="algo-weight-label">学业成绩</span><div class="algo-weight-track"><div class="algo-weight-fill" style="width:${w.academic}%;background:var(--primary);">${w.academic}%</div></div></div>
                <div class="algo-weight-bar"><span class="algo-weight-label">性格互补</span><div class="algo-weight-track"><div class="algo-weight-fill" style="width:${w.personality}%;background:var(--success);">${w.personality}%</div></div></div>
                <div class="algo-weight-bar"><span class="algo-weight-label">爱好搭配</span><div class="algo-weight-track"><div class="algo-weight-fill" style="width:${w.hobby}%;background:var(--warning);">${w.hobby}%</div></div></div>
                <div class="algo-weight-bar"><span class="algo-weight-label">职务平衡</span><div class="algo-weight-track"><div class="algo-weight-fill" style="width:${w.position}%;background:var(--info);">${w.position}%</div></div></div>
                <div class="algo-weight-bar"><span class="algo-weight-label">性别均衡</span><div class="algo-weight-track"><div class="algo-weight-fill" style="width:${w.gender}%;background:#FF2D55;">${w.gender}%</div></div></div>
            </div>
        `;
    }
};

// ==================== Pinyin Initial Search ====================
let _pinyinMap = null;
function _getPinyinMap() {
    if (!_pinyinMap) {
        _pinyinMap = {
    '阿':'a','爱':'ai','安':'an','昂':'ang','奥':'ao',
    '八':'ba','白':'bai','百':'bai','柏':'bai','班':'ban','半':'ban','包':'bao','宝':'bao','保':'bao','鲍':'bao','北':'bei','贝':'bei','本':'ben','毕':'bi','边':'bian','卞':'bian','别':'bie','宾':'bin','丙':'bing','伯':'bo','卜':'bo','补':'bu','步':'bu',
    '才':'cai','蔡':'cai','曹':'cao','草':'cao','岑':'cen','柴':'chai','昌':'chang','常':'chang','超':'chao','朝':'chao','车':'che','陈':'chen','成':'cheng','程':'cheng','池':'chi','迟':'chi','充':'chong','初':'chu','楚':'chu','储':'chu','褚':'chu','春':'chun','崔':'cui','存':'cun',
    '达':'da','大':'da','戴':'dai','丹':'dan','但':'dan','党':'dang','刀':'dao','到':'dao','邓':'deng','狄':'di','典':'dian','丁':'ding','东':'dong','冬':'dong','董':'dong','杜':'du','段':'duan','顿':'dun','多':'duo',
    '娥':'e','恩':'en',
    '发':'fa','范':'fan','方':'fang','飞':'fei','丰':'feng','冯':'feng','凤':'feng','伏':'fu','符':'fu','福':'fu','傅':'fu',
    '刚':'gang','高':'gao','郜':'gao','戈':'ge','葛':'ge','耿':'geng','公':'gong','龚':'gong','巩':'gong','古':'gu','顾':'gu','关':'guan','管':'guan','广':'guang','桂':'gui','郭':'guo','国':'guo','果':'guo',
    '哈':'ha','海':'hai','韩':'han','杭':'hang','郝':'hao','何':'he','和':'he','贺':'he','衡':'heng','红':'hong','洪':'hong','侯':'hou','后':'hou','胡':'hu','花':'hua','华':'hua','桓':'huan','黄':'huang','回':'hui','惠':'hui','火':'huo','霍':'huo',
    '及':'ji','吉':'ji','纪':'ji','季':'ji','贾':'jia','简':'jian','江':'jiang','姜':'jiang','蒋':'jiang','焦':'jiao','金':'jin','晋':'jin','靳':'jin','经':'jing','景':'jing','靖':'jing','鞠':'ju','隽':'jun',
    '开':'kai','阚':'kan','康':'kang','柯':'ke','可':'ke','孔':'kong','寇':'kou','匡':'kuang','邝':'kuang','况':'kuang','奎':'kui','昆':'kun',
    '来':'lai','赖':'lai','兰':'lan','蓝':'lan','郎':'lang','劳':'lao','乐':'le','雷':'lei','冷':'leng','黎':'li','李':'li','力':'li','历':'li','厉':'li','利':'li','栗':'li','连':'lian','廉':'lian','练':'lian','梁':'liang','廖':'liao','林':'lin','凌':'ling','刘':'liu','柳':'liu','龙':'long','娄':'lou','卢':'lu','鲁':'lu','陆':'lu','路':'lu','吕':'lv','罗':'luo','骆':'luo',
    '麻':'ma','马':'ma','买':'mai','麦':'mai','满':'man','毛':'mao','茅':'mao','梅':'mei','孟':'meng','米':'mi','苗':'miao','闵':'min','明':'ming','莫':'mo','牟':'mu','木':'mu','穆':'mu',
    '那':'na','南':'nan','倪':'ni','聂':'nie','宁':'ning','牛':'niu','农':'nong',
    '欧':'ou','偶':'ou',
    '潘':'pan','庞':'pang','裴':'pei','彭':'peng','皮':'pi','平':'ping','蒲':'pu','濮':'pu','朴':'pu','浦':'pu',
    '戚':'qi','齐':'qi','祁':'qi','钱':'qian','强':'qiang','乔':'qiao','秦':'qin','丘':'qiu','邱':'qiu','裘':'qiu','曲':'qu','瞿':'qu','全':'quan','权':'quan',
    '冉':'ran','饶':'rao','任':'ren','荣':'rong','容':'rong','阮':'ruan','芮':'rui',
    '萨':'sa','桑':'sang','沙':'sha','单':'shan','商':'shang','尚':'shang','邵':'shao','佘':'she','申':'shen','沈':'shen','盛':'sheng','施':'shi','石':'shi','时':'shi','史':'shi','寿':'shou','舒':'shu','帅':'shuai','双':'shuang','税':'shui','司':'si','宋':'song','苏':'su','宿':'su','隋':'sui','孙':'sun','索':'suo',
    '邰':'tai','谈':'tan','谭':'tan','汤':'tang','唐':'tang','陶':'tao','滕':'teng','田':'tian','铁':'tie','童':'tong','佟':'tong','涂':'tu','屠':'tu',
    '万':'wan','汪':'wang','王':'wang','危':'wei','韦':'wei','卫':'wei','魏':'wei','温':'wen','文':'wen','翁':'weng','邬':'wu','巫':'wu','吴':'wu','武':'wu','伍':'wu',
    '奚':'xi','习':'xi','席':'xi','夏':'xia','鲜':'xian','向':'xiang','项':'xiang','肖':'xiao','萧':'xiao','谢':'xie','辛':'xin','邢':'xing','幸':'xing','熊':'xiong','修':'xiu','徐':'xu','许':'xu','续':'xu','宣':'xuan','薛':'xue','荀':'xun',
    '牙':'ya','严':'yan','言':'yan','阎':'yan','颜':'yan','杨':'yang','阳':'yang','姚':'yao','叶':'ye','衣':'yi','易':'yi','殷':'yin','尹':'yin','应':'ying','尤':'you','游':'you','于':'yu','余':'yu','俞':'yu','虞':'yu','禹':'yu','玉':'yu','元':'yuan','袁':'yuan','岳':'yue','云':'yun','郧':'yun','恽':'yun',
    '宰':'zai','臧':'zang','曾':'zeng','翟':'zhai','詹':'zhan','湛':'zhan','张':'zhang','章':'zhang','赵':'zhao','甄':'zhen','郑':'zheng','支':'zhi','钟':'zhong','仲':'zhong','周':'zhou','朱':'zhu','诸':'zhu','祝':'zhu','庄':'zhuang','卓':'zhuo','宗':'zong','邹':'zou','祖':'zu','左':'zuo',
    '阙':'que','缪':'miao','乜':'nie','干':'gan','於':'yu','郏':'jia','逄':'pang','嵇':'ji','濮阳':'pu','澹台':'tan','公冶':'gong','东方':'dong','上官':'shang','欧阳':'ou','诸葛':'ge','令狐':'ling','皇甫':'huang','尉迟':'yu','公孙':'gong','轩辕':'xuan','夏侯':'xia','闻人':'wen'
        };
    }
    return _pinyinMap;
}
const PinyinMap = new Proxy({}, { get: (_, key) => _getPinyinMap()[key] });

function _fallbackPinyinInitials(name) {
    let result = '';
    for (const ch of name) {
        const lower = ch.toLowerCase();
        if (/[a-z0-9]/.test(lower)) { result += lower; continue; }
        const py = PinyinMap[ch];
        if (py) result += py[0];
    }
    return result;
}
function _fallbackFullPinyin(name) {
    let result = '';
    for (const ch of name) {
        const lower = ch.toLowerCase();
        if (/[a-z0-9]/.test(lower)) { result += lower; continue; }
        const py = PinyinMap[ch];
        if (py) result += py;
    }
    return result;
}
function getPinyinInitials(name) {
    try {
        if (typeof pinyin === 'function') {
            return pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' }).join('').toLowerCase();
        }
    } catch(e) { console.warn('pinyin-pro error:', e); }
    return _fallbackPinyinInitials(name);
}
function getFullPinyin(name) {
    try {
        if (typeof pinyin === 'function') {
            return pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase();
        }
    } catch(e) { console.warn('pinyin-pro error:', e); }
    return _fallbackFullPinyin(name);
}

function matchStudent(student, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    const name = student.name.toLowerCase();
    if (name.includes(q)) return true;
    const fullPy = getFullPinyin(student.name).toLowerCase();
    if (fullPy.includes(q.replace(/\s/g, ''))) return true;
    const initials = getPinyinInitials(student.name).toLowerCase();
    if (initials.includes(q)) return true;
    if (student.position && student.position.toLowerCase().includes(q)) return true;
    if (student.personality && student.personality.toLowerCase().includes(q)) return true;
    if (student.hobbies && student.hobbies.some(h => h.toLowerCase().includes(q))) return true;
    return false;
}

function parseQuery(query) {
    const filters = {};
    let text = query || '';
    const patterns = [
        { re: /(?:成绩|score)\s*>\s*(\d+)/i, key: 'scoreAbove' },
        { re: /(?:成绩|score)\s*<\s*(\d+)/i, key: 'scoreBelow' },
        { re: /(?:性别|gender)\s*[:：]\s*(男|女|male|female)/i, key: 'gender' },
        { re: /(?:午休|lunch)\s*[:：]\s*(是|否|yes|no|1|0)/i, key: 'lunch' },
        { re: /(?:性格|personality)\s*[:：]\s*(外向|内向|中性)/i, key: 'personality' },
        { re: /(?:职务|position)\s*[:：]\s*(\S+)/i, key: 'position' },
    ];
    patterns.forEach(({ re, key }) => {
        const m = text.match(re);
        if (m) { filters[key] = m[1]; text = text.replace(m[0], '').trim(); }
    });
    return { text: text.trim(), filters };
}

class SmartSearch {
    constructor({ inputId, dropdownId, textareaId, listKey }) {
        this.input = document.getElementById(inputId);
        this.dropdown = document.getElementById(dropdownId);
        this.textarea = document.getElementById(textareaId);
        this.listKey = listKey;
        this.highlightIdx = -1;
        this.filteredStudents = [];
        this._bound = false;
        this.bind();
    }

    bind() {
        if (this._bound) return;
        this._bound = true;
        this.input.addEventListener('input', () => this.onInput());
        this.input.addEventListener('focus', () => this.onInput());
        this.input.addEventListener('keydown', e => this.onKeydown(e));
        document.addEventListener('click', e => {
            if (!e.target.closest('.smart-search')) this.close();
        });
        const scrollParent = this.input.closest('.sidebar-content');
        if (scrollParent) {
            scrollParent.addEventListener('scroll', () => {
                if (this.dropdown.classList.contains('open')) this.render();
            }, { passive: true });
        }
    }

    onInput() {
        const query = this.input.value.trim().toLowerCase();
        if (!query) { this.close(); return; }
        this.filteredStudents = state.students.filter(s => matchStudent(s, query)).slice(0, 15);
        this.highlightIdx = -1;
        this.render();
    }

    onKeydown(e) {
        if (!this.dropdown.classList.contains('open')) return;
        const items = this.dropdown.querySelectorAll('.smart-search-item:not(.disabled)');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.highlightIdx = Math.min(this.highlightIdx + 1, items.length - 1);
            this.updateHighlight(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.highlightIdx = Math.max(this.highlightIdx - 1, 0);
            this.updateHighlight(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.highlightIdx >= 0 && items[this.highlightIdx]) {
                this.selectStudent(items[this.highlightIdx].dataset.name);
            } else if (items.length > 0) {
                this.selectStudent(items[0].dataset.name);
            }
        } else if (e.key === 'Escape') {
            this.close();
        }
    }

    updateHighlight(items) {
        items.forEach((item, i) => item.classList.toggle('highlighted', i === this.highlightIdx));
        if (items[this.highlightIdx]) items[this.highlightIdx].scrollIntoView({ block: 'nearest' });
    }

    render() {
        const rect = this.input.getBoundingClientRect();
        this.dropdown.style.top = (rect.bottom + 4) + 'px';
        this.dropdown.style.left = rect.left + 'px';
        this.dropdown.style.width = rect.width + 'px';
        if (this.filteredStudents.length === 0) {
            this.dropdown.innerHTML = '<div class="smart-search-empty">未找到匹配学生</div>';
            this.dropdown.classList.add('open');
            return;
        }
        const query = this.input.value.trim().toLowerCase();
        this.dropdown.innerHTML = this.filteredStudents.map(s => {
            const initials = getPinyinInitials(s.name);
            const fullPy = getFullPinyin(s.name);
            let hint = '';
            if (initials.includes(query) && !s.name.toLowerCase().includes(query)) hint = `拼音: ${fullPy}`;
            const genderIcon = s.gender === 'male' ? '♂' : '♀';
            return `<div class="smart-search-item" data-name="${escapeHtml(s.name)}"><span>${escapeHtml(s.name)} ${genderIcon}</span><span class="match-hint">${escapeHtml(hint)}</span></div>`;
        }).join('');
        this.dropdown.classList.add('open');
        this.dropdown.querySelectorAll('.smart-search-item').forEach(item => {
            item.addEventListener('click', () => this.selectStudent(item.dataset.name));
        });
    }

    selectStudent(name) {
        const current = this.textarea.value.trim();
        if (current === '') {
            this.textarea.value = name + ' ';
        } else {
            const lines = current.split('\n');
            const lastLine = lines[lines.length - 1].trim();
            if (lastLine === '') {
                lines[lines.length - 1] = name + ' ';
            } else {
                lines[lines.length - 1] = lastLine + ' ' + name;
            }
            this.textarea.value = lines.join('\n');
        }
        this.textarea.dispatchEvent(new Event('input'));
        const lines = this.textarea.value.trim().split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        state[this.listKey] = lines.map(l => l.trim().split(/\s+/).map(n => n.trim()));
        this.input.value = '';
        this.close();
        Toast.success(`已添加 ${name}`);
    }

    close() {
        this.dropdown.classList.remove('open');
        this.dropdown.style.top = '';
        this.dropdown.style.left = '';
        this.dropdown.style.width = '';
        this.highlightIdx = -1;
    }
}
