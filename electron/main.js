// ============================================================
// Electron 主进程
// - 创建应用窗口，加载项目页面
// - 放行麦克风（media）权限请求，其余权限默认拒绝
// - API 配置（Key / 接口类型）保存在用户数据目录 config.json，
//   通过 IPC 与渲染层交互：渲染层只能拿到掩码状态，拿不到完整 Key
// - GLM 调用走主进程 net.fetch（无 CORS 限制）
// ============================================================
const { app, BrowserWindow, session, ipcMain, net, dialog, shell, systemPreferences } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const xfyun = require('./xfyun');

// ==================== 后台输出（捕获主进程 print 与渲染层 console） ====================
const backendLog = [];
let backendWin = null;
let mainWinRef = null; // 主窗口引用（对话框父窗口）

function pushBackend(entry) {
    const item = { time: new Date().toLocaleString('zh-CN', { hour12: false }), ...entry };
    backendLog.push(item);
    if (backendLog.length > 2000) backendLog.shift();
    if (backendWin && !backendWin.isDestroyed()) backendWin.webContents.send('backend:log-append', item);
}

// 包装主进程 console：所有输出进后台输出缓冲（终端输出保持不变）
['log', 'info', 'warn', 'error'].forEach(level => {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
        orig(...args);
        const text = args.map(a => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.stack || a.message;
            try { return JSON.stringify(a); } catch { return String(a); }
        }).join(' ');
        pushBackend({ source: '主进程', level, text });
    };
});

// macOS 录音静音修复：禁用进程外音频服务。
// Electron 开启 AudioServiceOutOfProcess 时，macOS（含 Intel 的 macOS 12 与
// Apple Silicon 新版系统）上 getUserMedia 常采集到全零静音流，必须回退进程内采集。
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

// 开发模式（npm start）与打包发行版使用各自独立的用户数据目录：
// 调试期的 API 配置不会影响发行版的"首次运行"体验
if (!app.isPackaged) {
    app.setPath('userData', path.join(app.getPath('appData'), 'Pigai-Dev'));
}

// GLM 官方预设（公开信息，非机密）：用户选择"默认接口"时使用
const GLM_PRESET = {
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-5.3-flash' // 当前最新免费档模型（推理模型，回复带思考过程）
};

// ==================== API 配置（存于用户数据目录，不进项目仓库） ====================
let apiConfig = { apiType: 'glm', key: '', customUrl: '', model: '', xfAppId: '', xfApiKey: '', xfApiSecret: '' };

function configFilePath() {
    return path.join(app.getPath('userData'), 'config.json');
}

function loadApiConfig() {
    try {
        const raw = JSON.parse(fs.readFileSync(configFilePath(), 'utf8'));
        if (raw && typeof raw === 'object') apiConfig = { ...apiConfig, ...raw };
    } catch {
        // 首次运行或文件损坏：保持默认（无 Key），由渲染层弹窗引导配置
    }
}

function persistApiConfig() {
    fs.mkdirSync(path.dirname(configFilePath()), { recursive: true });
    fs.writeFileSync(configFilePath(), JSON.stringify(apiConfig, null, 2), 'utf8');
}

function maskKey(key) {
    return key.length > 10 ? key.slice(0, 4) + '****' + key.slice(-4) : '****';
}

// 当前所选 API 的识别名称（供界面徽章显示）；未配置 Key 时返回空
function apiDisplayName() {
    if (!apiConfig.key) return '';
    if (apiConfig.apiType === 'custom') {
        let host = apiConfig.customUrl;
        try { host = new URL(apiConfig.customUrl).host; } catch { /* 保留原值 */ }
        return `自定义 · ${host} · ${apiConfig.model || GLM_PRESET.model}`;
    }
    return `GLM 官方 · ${GLM_PRESET.model}`;
}

// ==================== 自定义接口（OpenAI 兼容）辅助 ====================
// 用户填基础地址（如 http://127.0.0.1:1234）即可：自动补全标准路径
function normalizeCustomUrl(raw) {
    let u = String(raw).trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(u)) return u;
    if (/\/v1$/i.test(u)) return u + '/chat/completions';
    return u + '/v1/chat/completions';
}

// 模型名留空时自动探测：调 /v1/models 取第一个非 embedding 类模型
async function detectCustomModel(cfg) {
    const base = String(cfg.customUrl).trim().replace(/\/+$/, '')
        .replace(/\/chat\/completions$/i, '').replace(/\/v1$/i, '');
    const resp = await net.fetch(base + '/v1/models', {
        headers: { 'Authorization': 'Bearer ' + cfg.key }
    });
    const data = await resp.json().catch(() => null);
    const ids = data && Array.isArray(data.data) ? data.data.map(m => m.id).filter(Boolean) : [];
    const chatModel = ids.find(id => !/embed|rerank|whisper|tts|guard/i.test(id));
    return chatModel || ids[0] || '';
}

// ==================== 请求日志（主进程记录，独立日志窗口展示/保存） ====================
const glmLog = [];
let logWin = null;

function pushLog(entry) {
    const item = { time: new Date().toLocaleString('zh-CN', { hour12: false }), ...entry };
    glmLog.push(item);
    if (glmLog.length > 500) glmLog.shift();
    if (logWin && !logWin.isDestroyed()) logWin.webContents.send('glm:log-append', item);
    console.log('[Pigai日志]', item.type, item.model || '', String(item.detail || '').slice(0, 80).replace(/\n/g, ' '));
    return item;
}

function openLogWindow() {
    if (logWin && !logWin.isDestroyed()) { logWin.focus(); return logWin; }
    logWin = new BrowserWindow({
        width: 760,
        height: 560,
        title: '请求日志 · Pigai',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'log-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    logWin.loadFile(path.join(__dirname, '..', 'log.html'));
    logWin.on('closed', () => { logWin = null; });
    return logWin;
}

ipcMain.handle('log:open-window', () => { openLogWindow(); return { ok: true }; });
ipcMain.handle('log:get-all', () => glmLog);
ipcMain.handle('log:save', async () => {
    const opts = {
        title: '保存请求日志',
        defaultPath: 'pigai-log-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt',
        filters: [{ name: '文本文件', extensions: ['txt'] }]
    };
    const result = (logWin && !logWin.isDestroyed())
        ? await dialog.showSaveDialog(logWin, opts)
        : await dialog.showSaveDialog(opts);
    const { canceled, filePath } = result;
    if (canceled || !filePath) return { ok: false, canceled: true };
    const text = glmLog.map(e =>
        `[${e.time}] ${e.type}${e.model ? ' · ' + e.model : ''}${e.status ? ' · HTTP ' + e.status : ''}\n${e.detail || ''}\n${'-'.repeat(64)}`
    ).join('\n') + '\n';
    fs.writeFileSync(filePath, text, 'utf8');
    return { ok: true, path: filePath };
});

// ==================== 录音文件（存于用户数据目录，可用资源管理器/Finder 打开） ====================
function recordingsDir() {
    return path.join(app.getPath('userData'), 'recordings');
}

// 保存渲染层传来的录音（base64）；文件名在渲染层已做非法字符清理
ipcMain.handle('recordings:save', (_event, payload) => {
    const { base64, filename } = payload || {};
    if (!base64 || !filename) throw new Error('缺少录音数据');
    const dir = recordingsDir();
    fs.mkdirSync(dir, { recursive: true });
    const safeName = String(filename).replace(/[\\/:*?"<>|]/g, '');
    const filePath = path.join(dir, safeName);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    pushLog({ type: '录音', detail: `录音已保存：${filePath}` });
    return { ok: true, path: filePath };
});

// 用 Windows 资源管理器 / macOS Finder 打开录音目录（不存在则先创建）
ipcMain.handle('recordings:open-folder', async () => {
    const dir = recordingsDir();
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir); // 成功返回 ''，失败返回错误信息
    return { ok: !err, path: dir, error: err || '' };
});

// ==================== 后台输出窗口（调试用，超集于请求日志） ====================
function openBackendWindow() {
    if (backendWin && !backendWin.isDestroyed()) { backendWin.focus(); return backendWin; }
    backendWin = new BrowserWindow({
        width: 860,
        height: 620,
        title: '后台输出 · Pigai',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'backend-preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    backendWin.loadFile(path.join(__dirname, '..', 'backend.html'));
    backendWin.on('closed', () => { backendWin = null; });
    return backendWin;
}

ipcMain.handle('backend:open-window', () => { openBackendWindow(); return { ok: true }; });
ipcMain.handle('backend:get-all', () => backendLog);
ipcMain.handle('backend:save', async () => {
    const opts = {
        title: '保存后台输出',
        defaultPath: 'pigai-backend-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt',
        filters: [{ name: '文本文件', extensions: ['txt'] }]
    };
    const result = (backendWin && !backendWin.isDestroyed())
        ? await dialog.showSaveDialog(backendWin, opts)
        : await dialog.showSaveDialog(opts);
    const { canceled, filePath } = result;
    if (canceled || !filePath) return { ok: false, canceled: true };
    const text = backendLog.map(e =>
        `[${e.time}] [${e.source}·${e.level}] ${e.text}`
    ).join('\n') + '\n';
    fs.writeFileSync(filePath, text, 'utf8');
    return { ok: true, path: filePath };
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 900,
        minHeight: 640,
        autoHideMenuBar: true,
        title: 'Pigai · 语文学习 AI 助手',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWinRef = win;
    win.loadFile(path.join(__dirname, '..', 'index.html'));

    // 捕获渲染层 console（主窗口）：进后台输出，便于调试渲染层报错
    win.webContents.on('console-message', (...cbArgs) => {
        const first = cbArgs[0];
        let level = 'log';
        let message = '';
        if (first && typeof first === 'object' && 'message' in first) {
            level = String(first.level || 'log');
            message = String(first.message || '');
        } else {
            level = typeof cbArgs[1] === 'number' ? (['verbose', 'log', 'warn', 'error'][cbArgs[1]] || 'log') : String(cbArgs[1] || 'log');
            message = String(cbArgs[2] || '');
        }
        if (message.includes('Electron Security Warning')) return;
        pushBackend({ source: '渲染层', level, text: message });
    });

    // 调试自测钩子：以 APP_SELFTEST=1 启动时，自动验证界面状态与调用链路；
    // 结果同时写入 APP_SELFTEST_OUT 指定的 JSON 文件（发行版 exe 无法捕获控制台时用）
    if (process.env.APP_SELFTEST === '1') {
        win.webContents.on('did-finish-load', () => {
            setTimeout(async () => {
                const outPath = process.env.APP_SELFTEST_OUT;
                const report = {};
                const flush = () => {
                    if (outPath) {
                        try { fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8'); } catch {}
                    }
                };
                try {
                    const overlayVisible = await win.webContents.executeJavaScript(
                        "document.getElementById('apiSetupOverlay').classList.contains('visible')"
                    );
                    report.overlayVisible = overlayVisible;
                    console.log('SELFTEST OVERLAY:', overlayVisible);
                    flush();
                    report.apiBadge = await win.webContents.executeJavaScript(
                        "document.getElementById('apiStatusBadge').textContent"
                    );
                    console.log('SELFTEST BADGE:', report.apiBadge);
                    flush();
                    // 弹窗打开（未配置 Key）且提供了测试 Key 时，走一遍弹窗保存流程
                    if (overlayVisible && process.env.GLM_TEST_KEY) {
                        const saveResult = await win.webContents.executeJavaScript(`
                            (async () => {
                                document.getElementById('apiKeyInput').value = ${JSON.stringify(String(process.env.GLM_TEST_KEY))};
                                document.getElementById('apiSaveBtn').click();
                                await new Promise(r => setTimeout(r, 600));
                                return { overlayHidden: !document.getElementById('apiSetupOverlay').classList.contains('visible') };
                            })()
                        `);
                        report.save = saveResult;
                        console.log('SELFTEST SAVE:', JSON.stringify(saveResult));
                        flush();
                    }
                    const scope = process.env.APP_SELFTEST_SCOPE || 'essay';
                    if (scope === 'config-isolation') {
                        // 配置隔离验证：custom 配置 → 切回 glm → 断言 custom 字段无残留
                        const iso = await win.webContents.executeJavaScript(`
                            (async () => {
                                const out = {};
                                await window.chineseAI.saveConfig({ apiType: 'custom', customUrl: 'http://127.0.0.1:1234', model: 'google/gemma-4-12b' });
                                const s1 = await window.chineseAI.getConfigStatus();
                                out.customSaved = { apiType: s1.apiType, customUrl: s1.customUrl, model: s1.model };
                                await window.chineseAI.saveConfig({ apiType: 'glm' });
                                const s2 = await window.chineseAI.getConfigStatus();
                                out.glmSwitched = { apiType: s2.apiType, customUrl: s2.customUrl, model: s2.model, displayName: s2.displayName, hasKey: s2.hasKey };
                                out.pass = s2.apiType === 'glm' && !s2.customUrl && !s2.model && s2.hasKey;
                                return out;
                            })()
                        `);
                        report.configIsolation = iso;
                        console.log('SELFTEST CONFIG-ISOLATION:', JSON.stringify(iso));
                        flush();
                    } else if (scope === 'recite') {
                        // 朗诵批改链路：填标题/类型/内容 → 开始批改 → 轮询数字评分
                        await win.webContents.executeJavaScript(`
                            document.getElementById('reciteTitle').value = '九月九日忆山东兄弟 · 王维';
                            document.getElementById('contentType').value = '古诗';
                            document.getElementById('reciteContent').value = '独在异乡为异客，每逢佳节倍思亲。遥知兄弟登高处，遍插茱萸少一人。';
                            document.getElementById('gradeBtn').click();
                        `);
                        for (let i = 0; i < 40; i++) {
                            await new Promise(r => setTimeout(r, 3000));
                            const score = await win.webContents.executeJavaScript("document.getElementById('scoreDisplay').textContent");
                            if (/^\d{1,3}$/.test(score)) {
                                report.reciteScore = score;
                                report.reciteComment = await win.webContents.executeJavaScript("document.getElementById('commentDisplay').textContent");
                                report.reciteTags = await win.webContents.executeJavaScript("document.getElementById('tagContainer').children.length");
                                console.log('SELFTEST RECITE:', JSON.stringify({ score, comment: report.reciteComment, tags: report.reciteTags }));
                                break;
                            }
                            const c = await win.webContents.executeJavaScript("document.getElementById('commentDisplay').textContent");
                            if (c.includes('调用失败')) {
                                report.reciteError = c;
                                console.log('SELFTEST RECITE ERROR:', c.slice(0, 120));
                                break;
                            }
                        }
                        flush();
                    } else {
                        await win.webContents.executeJavaScript(`
                            document.getElementById('grade').value = '五年级';
                            document.getElementById('essayContent').value = '清晨的巷口，豆浆店的热气模糊了玻璃窗。这是一段用于自测的短文。';
                            document.getElementById('generateBtn').click();
                        `);
                        for (let i = 0; i < 40; i++) {
                            await new Promise(r => setTimeout(r, 3000));
                            const text = await win.webContents.executeJavaScript("document.getElementById('outputContent').innerText");
                            if (text && !text.includes('正在调用')) {
                                report.result = text.slice(0, 220);
                                console.log('SELFTEST RESULT:', text.slice(0, 220).replace(/\n/g, ' | '));
                                break;
                            }
                        }
                        flush();
                    }
                    // 请求日志窗口：点击主页面按钮后应弹出独立日志窗口
                    await win.webContents.executeJavaScript("document.getElementById('logWindowBtn').click()");
                    await new Promise(r => setTimeout(r, 2500));
                    const logW = BrowserWindow.getAllWindows().find(w => w !== win);
                    report.logWindowCount = BrowserWindow.getAllWindows().length;
                    if (logW && !logW.isDestroyed()) {
                        report.logWindowText = (await logW.webContents.executeJavaScript("document.body.innerText")).slice(0, 150);
                    }
                    console.log('SELFTEST LOGWIN:', JSON.stringify({ count: report.logWindowCount, text: (report.logWindowText || '').slice(0, 60) }));
                    flush();
                    // 录音目录按钮：点击后应创建 recordings 目录并打开资源管理器/Finder
                    await win.webContents.executeJavaScript("document.getElementById('recordingsFolderBtn').click()");
                    await new Promise(r => setTimeout(r, 1500));
                    report.recordingsDirCreated = fs.existsSync(path.join(app.getPath('userData'), 'recordings'));
                    console.log('SELFTEST RECORDINGS-DIR:', report.recordingsDirCreated);
                    flush();
                    // 后台输出按钮：点击后应弹出后台输出窗口（含主进程捕获的日志）
                    await win.webContents.executeJavaScript("document.getElementById('backendOutputBtn').click()");
                    await new Promise(r => setTimeout(r, 2000));
                    const backendW = BrowserWindow.getAllWindows().find(w => w !== win && (!logW || w !== logW));
                    report.backendWindowCount = BrowserWindow.getAllWindows().length;
                    if (backendW && !backendW.isDestroyed()) {
                        report.backendText = (await backendW.webContents.executeJavaScript("document.body.innerText")).slice(0, 120);
                    }
                    console.log('SELFTEST BACKENDWIN:', JSON.stringify({ count: report.backendWindowCount, text: (report.backendText || '').slice(0, 60) }));
                    flush();
                    // 麦克风探测：拿到确切错误名 + 实测 RMS 电平
                    // （静音流 RMS 恒为 0，正常采集即使安静环境也有底噪）
                    const micResult = await win.webContents.executeJavaScript(`
                        (async () => {
                            if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return 'MIC API MISSING';
                            try {
                                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                                const src = ctx.createMediaStreamSource(stream);
                                const proc = ctx.createScriptProcessor(4096, 1, 1);
                                let sum = 0, n = 0;
                                proc.onaudioprocess = e => {
                                    const d = e.inputBuffer.getChannelData(0);
                                    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
                                    n += d.length;
                                };
                                const mute = ctx.createGain();
                                mute.gain.value = 0; // 采样但不出声，避免回声
                                src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
                                await new Promise(r => setTimeout(r, 1500));
                                const rms = Math.sqrt(sum / Math.max(1, n));
                                src.disconnect(); proc.disconnect(); mute.disconnect();
                                stream.getTracks().forEach(t => t.stop());
                                ctx.close();
                                return 'MIC OK rms=' + rms.toFixed(7) + (rms > 0.000001 ? ' 有声' : ' 静音!');
                            } catch (e) {
                                return 'MIC FAIL: ' + e.name + ': ' + e.message;
                            }
                        })()
                    `);
                    report.mic = micResult;
                    console.log('SELFTEST MIC:', micResult);
                    flush();
                    // APP_SELFTEST_EXIT=1：自测完成后关闭主窗口（此时日志窗口开着），
                    // 用于验证"关主窗口同步关子窗口"——进程应整体退出
                    if (process.env.APP_SELFTEST_EXIT === '1') {
                        report.closingMain = true;
                        flush();
                        setTimeout(() => win.close(), 500);
                    }
                } catch (e) {
                    report.error = e.message;
                    console.log('SELFTEST RESULT: ERROR ' + e.message);
                    flush();
                }
            }, 1500);
        });
    }
    // 主窗口关闭 = 应用退出：同步关闭日志等子窗口（否则子窗口会悬空保活进程）
    win.on('closed', () => {
        mainWinRef = null;
        if (logWin && !logWin.isDestroyed()) logWin.close();
        app.quit();
    });
    return win;
}

// 麦克风支持：放行 media 权限请求（getUserMedia），其余权限一律拒绝
function setupPermissions() {
    const sess = session.defaultSession;
    sess.setPermissionRequestHandler((_webContents, permission, callback) => {
        callback(permission === 'media');
    });
    sess.setPermissionCheckHandler((_webContents, permission) => permission === 'media');
}

// macOS 隐私授权（TCC）：启动即确认麦克风权限，未授权时触发系统弹窗。
// 打包应用使用 ad-hoc 签名时，若从不主动请求，系统授权弹窗可能一直不出现，
// 表现为"能录音但文件全是静音"。状态写入请求日志便于远程排查。
async function ensureMacMicrophoneAccess() {
    if (process.platform !== 'darwin' || typeof systemPreferences.getMediaAccessStatus !== 'function') return;
    const status = systemPreferences.getMediaAccessStatus('microphone');
    pushLog({ type: '麦克风', detail: `macOS 麦克风授权状态：${status}` });
    if (status === 'granted') return;
    try {
        const granted = await systemPreferences.askForMediaAccess('microphone');
        pushLog({ type: '麦克风', detail: granted
            ? '用户已允许麦克风访问'
            : '麦克风访问被拒绝：请在 系统设置 → 隐私与安全性 → 麦克风 中允许本应用' });
    } catch (e) {
        pushLog({ type: '麦克风', detail: '麦克风授权请求失败：' + e.message });
    }
}

// 配置查询：渲染层只能拿到掩码 Key 与非敏感字段
ipcMain.handle('config:get', () => ({
    hasKey: Boolean(apiConfig.key),
    apiType: apiConfig.apiType,
    customUrl: apiConfig.customUrl || '',
    model: apiConfig.model || '',
    keyMasked: apiConfig.key ? maskKey(apiConfig.key) : '',
    displayName: apiDisplayName(),
    xfConfigured: Boolean(apiConfig.xfAppId && apiConfig.xfApiKey && apiConfig.xfApiSecret),
    xfAppId: apiConfig.xfAppId || ''
}));

// 配置保存：Key 传入即更新；自定义接口模型名留空时自动探测可用模型。
// 接口配置强制隔离：切回 GLM 官方接口时清空自定义地址与模型名，
// 切换到自定义接口时清空模型名（由探测重新填充）——两种接口互不残留。
ipcMain.handle('config:save', async (_event, cfg) => {
    const next = { ...apiConfig };
    if (typeof cfg.apiType === 'string') next.apiType = cfg.apiType === 'custom' ? 'custom' : 'glm';
    if (typeof cfg.key === 'string' && cfg.key.trim()) next.key = cfg.key.trim();
    if (typeof cfg.customUrl === 'string') next.customUrl = cfg.customUrl.trim();
    if (typeof cfg.model === 'string') next.model = cfg.model.trim();
    if (typeof cfg.xfAppId === 'string' && cfg.xfAppId.trim()) next.xfAppId = cfg.xfAppId.trim();
    if (typeof cfg.xfApiKey === 'string' && cfg.xfApiKey.trim()) next.xfApiKey = cfg.xfApiKey.trim();
    if (typeof cfg.xfApiSecret === 'string' && cfg.xfApiSecret.trim()) next.xfApiSecret = cfg.xfApiSecret.trim();
    if (next.apiType === 'glm') {
        // 接口隔离：GLM 官方模式不保留自定义接口的地址与模型名
        next.customUrl = '';
        next.model = '';
    }
    if (!next.key) throw new Error('KEY_EMPTY');
    if (next.apiType === 'custom' && next.customUrl && !next.model) {
        try { next.model = await detectCustomModel(next); } catch { /* 探测失败则留空，调用时再试 */ }
    }
    apiConfig = next;
    persistApiConfig();
    const modelText = apiConfig.apiType === 'custom'
        ? (apiConfig.model || '待探测')
        : GLM_PRESET.model;
    pushLog({ type: '配置', detail: `类型 ${apiConfig.apiType} · 模型 ${modelText}${apiConfig.apiType === 'custom' ? ' · ' + apiConfig.customUrl : ''} · Key ${maskKey(apiConfig.key)} · 讯飞评测 ${apiConfig.xfAppId ? '已配置(' + apiConfig.xfAppId + ')' : '未配置'}` });
    return { ok: true, keyMasked: maskKey(apiConfig.key), model: apiConfig.model };
});

// 一键清空：scope 'llm'（大模型 Key/地址/模型）或 'xf'（讯飞 APPID/Key/Secret）
ipcMain.handle('config:clear', (_event, scope) => {
    if (scope === 'llm') {
        apiConfig.key = '';
        apiConfig.customUrl = '';
        apiConfig.model = '';
    } else if (scope === 'xf') {
        apiConfig.xfAppId = '';
        apiConfig.xfApiKey = '';
        apiConfig.xfApiSecret = '';
    } else {
        throw new Error('未知清空范围');
    }
    persistApiConfig();
    pushLog({ type: '配置', detail: `已清空 ${scope === 'llm' ? '大模型' : '讯飞'} API 信息` });
    return { ok: true, displayName: apiDisplayName() };
});

// 通用文本保存（作文批改 Save 按钮）：系统保存对话框
ipcMain.handle('text:save', async (_event, payload) => {
    const { text, defaultName } = payload || {};
    if (typeof text !== 'string' || !text.trim()) return { ok: false, empty: true };
    const safeName = String(defaultName || 'pigai-export').replace(/[\\/:*?"<>|]/g, '');
    const opts = {
        title: '保存文本',
        defaultPath: safeName + '.txt',
        filters: [{ name: '文本文件', extensions: ['txt'] }]
    };
    const result = (mainWinRef && !mainWinRef.isDestroyed())
        ? await dialog.showSaveDialog(mainWinRef, opts)
        : await dialog.showSaveDialog(opts);
    const { canceled, filePath } = result;
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, text, 'utf8');
    return { ok: true, path: filePath };
});

// 讯飞语音评测：渲染层把录音转好的 MP3（base64）与朗读内容（refText）送来评测
ipcMain.handle('xfyun:evaluate', async (_event, payload) => {
    const { audioBase64, refText } = payload || {};
    if (!audioBase64) throw new Error('缺少音频数据');
    if (!apiConfig.xfAppId || !apiConfig.xfApiKey || !apiConfig.xfApiSecret) {
        pushLog({ type: '错误', model: '讯飞 suntone 语音评测', detail: '未配置 APPID / APIKey / APISecret，跳过读音测评' });
        throw new Error('XF_NOT_CONFIGURED');
    }
    pushLog({ type: '请求', model: '讯飞 suntone 语音评测', detail: `开始读音评测 · 参考文本 ${String(refText || '').length} 字` });
    try {
        const result = await xfyun.evaluate(audioBase64, {
            appId: apiConfig.xfAppId,
            apiKey: apiConfig.xfApiKey,
            apiSecret: apiConfig.xfApiSecret,
            refText
        });
        const r = (result && result.result) || {};
        pushLog({ type: '响应', model: '讯飞 suntone 语音评测', detail: `总分 ${r.overall ?? '—'} · 发音 ${r.pronunciation ?? '—'} · 声调 ${r.tone ?? '—'} · 流利度 ${r.fluency ?? '—'} · 完整度 ${r.integrity ?? '—'} · 韵律 ${r.rhythm ?? '—'} · 语速 ${r.speed ?? '—'}` });
        return result;
    } catch (e) {
        pushLog({ type: '错误', model: '讯飞 suntone 语音评测', detail: e.message });
        throw e;
    }
});

// GLM 调用走主进程 net.fetch：不受 CORS 约束，Key 与配置不出主进程
ipcMain.handle('glm:chat', async (_event, messages) => {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('消息参数无效');
    }
    if (!apiConfig.key) throw new Error('API_KEY_NOT_SET');
    let url, model;
    if (apiConfig.apiType === 'custom') {
        if (!apiConfig.customUrl) throw new Error('CUSTOM_URL_NOT_SET');
        url = normalizeCustomUrl(apiConfig.customUrl);
        model = apiConfig.model;
        if (!model) {
            try {
                model = await detectCustomModel(apiConfig);
                if (model) { apiConfig.model = model; persistApiConfig(); }
            } catch { /* 探测失败回退默认模型名 */ }
        }
        if (!model) model = GLM_PRESET.model;
    } else {
        url = GLM_PRESET.url;
        model = GLM_PRESET.model;
    }
    const startedAt = Date.now();
    let logged = false;
    let data = null;
    pushLog({ type: '请求', url, model, detail: JSON.stringify(messages, null, 2) });
    try {
        const resp = await net.fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiConfig.key
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.6
            })
        });
        data = await resp.json().catch(() => null);
        if (!resp.ok) {
            const msg = data && data.error ? (data.error.message || JSON.stringify(data.error)) : 'HTTP ' + resp.status;
            pushLog({ type: '错误', url, model, status: resp.status, detail: `耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n${msg}` });
            logged = true;
            throw new Error(msg);
        }
        const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) {
            pushLog({ type: '错误', url, model, status: resp.status, detail: `耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n接口返回内容为空：${JSON.stringify(data).slice(0, 400)}` });
            logged = true;
            throw new Error('接口返回内容为空，请重试');
        }
        const usage = data.usage ? ` · tokens ${data.usage.prompt_tokens ?? '?'}→${data.usage.completion_tokens ?? '?'}` : '';
        pushLog({ type: '响应', url, model, status: resp.status, detail: `耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s${usage}\n${content}` });
        logged = true;
        return content.trim();
    } catch (e) {
        if (!logged) pushLog({ type: '错误', url, model, detail: `耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n${e.message}` });
        throw e;
    }
});

// 单实例锁：二次启动时聚焦已有窗口，避免多实例争抢用户数据缓存
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const [win] = BrowserWindow.getAllWindows();
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });

    app.whenReady().then(() => {
        loadApiConfig();
        setupPermissions();
        createWindow();
        ensureMacMicrophoneAccess();
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('window-all-closed', () => {
    app.quit();
});
