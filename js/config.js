// ==================== Global State ====================
const state = {
    rows: 7, cols: 11,
    seats: [],
    drawOrder: [],
    currentDrawIndex: 0,
    platformLeft: { disabled: true, student: null, type: 'platform-left', number: 0, row: -1, col: -1 },
    platformRight: { disabled: true, student: null, type: 'platform-right', number: -1, row: -1, col: -2 },
    showPlatformLeft: true, showPlatformRight: true,
    students: [], drawnStudents: [], remainingStudents: [],
    blacklist: [], whitelist: [], history: [],
    plugins: {},
    selectedSeat: null, swapMode: false,
    heatmapVisible: false, heatmapType: 'composite',
    batchMode: false, batchSeats: [],
    poolFilter: 'all', poolSearch: '',
    selectedPoolStudent: null,
    pendingDrawSequence: null,
    subjects: ['语文', '数学', '英语', '物理', '化学', '历史', '地理', '政治', '生物'],
    subjectMaxScores: {
        '语文': 150, '数学': 150, '英语': 150,
        '物理': 100, '化学': 100, '历史': 100, '地理': 100, '政治': 100, '生物': 100
    },
    personalityTypes: ['外向', '内向', '中性'],
    classPositions: ['班长', '副班长', '学习委员', '体育委员', '文艺委员', '劳动委员', '小组长', '课代表'],
    relationships: [],
    relationshipPresets: [
        { type: 'lovers', label: '💕 恋人', defaultScore: 80 },
        { type: 'besties', label: '👭 闺蜜', defaultScore: 60 },
        { type: 'brothers', label: '🤜🤛 兄弟', defaultScore: 50 },
        { type: 'friends', label: '😊 好友', defaultScore: 30 },
        { type: 'enemies', label: '😤 死对头', defaultScore: -80 },
        { type: 'chatterbox', label: '🗣️ 话包子', defaultScore: -50 },
        { type: 'disturber', label: '⚡ 干扰源', defaultScore: -60 },
        { type: 'neutral', label: '🤝 一般', defaultScore: 10 },
        { type: 'custom', label: '🏷️ 自定义', defaultScore: 0 }
    ],
    hardwareInfo: null, // Stores hardware detection results
    settings: {
        numberingMode: 'horizontal-snake',
        maleMapping: '男', femaleMapping: '女',
        blacklistPenalty: 95, blacklistRadius: 2,
        whitelistDeskBonus: 200, whitelistFrontBackBonus: 120,
        whitelistDiagonalBonus: 60, whitelistFallbackBonus: 150,
        drawMode: 'predictable', genderBalance: true, antiCluster: true,
        lunchUnderlineColor: '#007AFF', seatFontSize: 13,
        drawAnimationDuration: 400, screenshotBgColor: '#ffffff',
        screenshotTransparentBg: false,
        exportIncludeGender: true, exportIncludeLunch: true,
        exportIncludeSeatNumber: true,
        enableDragDrop: true, enableClickSwap: true,
        showStatsByDefault: true, showProbabilityByDefault: true,
        autoDrawInterval: 800,
        theme: '', accentColor: '#007AFF',
        demoSpeed: 600,
        performanceMode: 'auto', // 'low' | 'medium' | 'high' | 'auto'
        quickInfoItems: {
            layout: true, total: true, drawn: true, remaining: true,
            male: true, female: true, lunch: true
        },
        weights: {
            academic: 60,
            personality: 15,
            hobby: 10,
            position: 10,
            gender: 5
        }
    }
};
