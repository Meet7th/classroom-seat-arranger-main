# 🎓 SeatWise — 教室座位智能编排系统

> 本项目由 [Claude Code](https://claude.ai/code) 通过**氛围编程 (Vibe Coding)** 方式开发。

一款运行在浏览器中的教室座位编排工具，教师只需粘贴学生名单，系统即可自动分配座位。

---

## 主要功能

- **公平抽取** — 基于概率权重的公平算法，支持防扎堆、黑白名单、关系网络、历史去重
- **多科成绩** — 支持 9 科成绩录入，综合评价引擎自动加权评估
- **智能推荐** — 分析全班座位安排，推荐最优互换方案和学霸帮扶配对
- **讲台视角** — 从教师视角查看教室布局
- **拖拽换座** — 支持鼠标拖拽、触摸拖拽、点击互换座位
- **热力图** — 综合评价/平均分/单科成绩可视化
- **演示模式** — 动画回放座位分配过程
- **截图导出** — 自定义背景、水印、分辨率，导出 PNG/JPEG
- **插件系统** — 支持自定义插件和算法扩展

## 快速使用

1. 双击打开 `index.html`
2. 在「学生」标签页粘贴学生名单（每行一个，空格分隔字段）
3. 点击底部「🎲 抽取下一个」开始分配座位

## 技术栈

纯前端项目，无需安装、无需后端：HTML + CSS + Vanilla JS，数据保存在浏览器本地。

```
SeatWise/
├── index.html        # 主页面
├── css/main.css      # 样式
└── js/
    ├── config.js     # 全局状态与配置
    ├── utils.js      # 工具函数
    ├── modules.js    # 插件系统与安全沙箱
    ├── analysis.js   # 综合评价引擎
    ├── algorithm.js  # 抽取算法
    ├── ui.js         # 界面交互
    └── app.js        # 应用入口
```

---

## 插件开发

系统支持通过 JavaScript 编写自定义插件，扩展抽取逻辑和界面功能。

### 插件结构

```javascript
const MyPlugin = {
    name: "我的插件",            // 显示名称（必填）
    description: "功能描述",     // 简要描述（必填）
    version: "1.0.0",           // 版本号（必填）
    defaultEnabled: true,       // 默认启用
    hasSettings: false,         // 是否有设置面板
    defaultSettings: {},        // 默认设置

    init() { /* 插件初始化 */ },

    // 每次抽取前调用，可修改概率分布
    beforeDraw(availableStudents, probabilities, nextSeat) {
        return { availableStudents, probabilities };
    },

    // 每次抽取后调用
    afterDraw(student, seat) {},

    // 导出数据前调用，可修改导出内容
    beforeExport(data) { return data; }
};
PluginManager.register('my-plugin', MyPlugin);
```

### 导入方式

点击系统面板中的「导入插件」按钮，选择 `.js` 文件即可。系统会自动进行安全扫描，拦截高危代码。

### 权限与安全

插件运行在安全沙箱中，以下操作会被自动拦截：

| 操作 | 风险等级 | 处理方式 |
|------|----------|----------|
| `eval()` / `new Function()` | 高危 | 禁止 |
| `fetch()` / `XMLHttpRequest` | 高危 | 禁止 |
| `document.cookie` | 高危 | 禁止 |
| `document.write` | 高危 | 禁止 |
| `innerHTML` 赋值 | 中危 | 警告 |
| `localStorage` 写入 | 中危 | 警告 |

### 可用 API

```javascript
// 数据访问
state.students          // 学生列表
state.drawnStudents     // 已抽取学生
state.remainingStudents // 未抽取学生
state.seats             // 座位列表
state.settings          // 系统配置

// UI 工具
Toast.success(msg)      // 成功提示
Toast.error(msg)        // 错误提示
addLog(icon, text)      // 操作日志

// 综合评价
CompositeEval.getScore(student)       // 综合评分
CompositeEval.getAvgScore(student)    // 平均成绩
CompositeEval.peerInfluence(s1, s2)   // 良性影响分
```

---

## 自定义算法开发

支持导入自定义的座位推荐算法，替换内置的推荐逻辑。

### 算法结构

```javascript
const MyAlgorithm = {
    name: "我的算法",

    // 计算两名学生之间的良性影响分（必填）
    peerInfluence(student1, student2, context) {
        // context: { seats, settings, rows, cols, blacklist, whitelist }
        return score; // 正数 = 正面影响，负数 = 负面影响
    }
};
AlgorithmRegistry.register(MyAlgorithm);
```

### 导入方式

点击底部「🧠 智能推荐 ▾」→「🧬 自定义算法」，选择 `.js` 文件。导入后自动激活。

### 内置评价维度

| 维度 | 权重 | 说明 |
|------|------|------|
| 学业成绩 | 60% | 多科平均分 |
| 性格互补 | 15% | 外向+内向 高分，同性格 低分 |
| 爱好搭配 | 10% | 共同爱好越多分越高 |
| 职务平衡 | 10% | 不同职务搭配加分 |
| 性别均衡 | 5% | 男女搭配加分 |

---

## 更新日志

详见 [CHANGELOG.md](CHANGELOG.md)

## 立即尝试
https://meet7th.github.io/classroom-seat-arranger/
