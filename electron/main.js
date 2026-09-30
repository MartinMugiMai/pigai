// ============================================================
// Electron 主进程
// - 创建应用窗口，加载项目页面
// - 放行麦克风（media）权限请求，其余权限默认拒绝
// - API 配置（Key / 接口类型）保存在用户数据目录 config.json，
//   通过 IPC 与渲染层交互：渲染层只能拿到掩码状态，拿不到完整 Key
// - GLM 调用走主进程 net.fetch（无 CORS 限制）
// ============================================================
const { app, BrowserWindow, session, ipcMain, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

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
let apiConfig = { apiType: 'glm', key: '', customUrl: '', model: '' };

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
    win.loadFile(path.join(__dirname, '..', 'index.html'));

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
                    // 麦克风探测：拿到确切错误名（NotAllowed/NotFound/NotReadable 等）
                    const micResult = await win.webContents.executeJavaScript(`
                        (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
                            ? navigator.mediaDevices.getUserMedia({ audio: true })
                                .then(stream => { stream.getTracks().forEach(t => t.stop()); return 'MIC OK'; })
                                .catch(e => 'MIC FAIL: ' + e.name + ': ' + e.message)
                            : Promise.resolve('MIC API MISSING')
                    `);
                    report.mic = micResult;
                    console.log('SELFTEST MIC:', micResult);
                    flush();
                } catch (e) {
                    report.error = e.message;
                    console.log('SELFTEST RESULT: ERROR ' + e.message);
                    flush();
                }
            }, 1500);
        });
    }
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

// 配置查询：渲染层只能拿到掩码 Key 与非敏感字段
ipcMain.handle('config:get', () => ({
    hasKey: Boolean(apiConfig.key),
    apiType: apiConfig.apiType,
    customUrl: apiConfig.customUrl || '',
    model: apiConfig.model || '',
    keyMasked: apiConfig.key ? maskKey(apiConfig.key) : '',
    displayName: apiDisplayName()
}));

// 配置保存：Key 传入即更新；自定义接口模型名留空时自动探测可用模型
ipcMain.handle('config:save', async (_event, cfg) => {
    const next = { ...apiConfig };
    if (typeof cfg.apiType === 'string') next.apiType = cfg.apiType === 'custom' ? 'custom' : 'glm';
    if (typeof cfg.key === 'string' && cfg.key.trim()) next.key = cfg.key.trim();
    if (typeof cfg.customUrl === 'string') next.customUrl = cfg.customUrl.trim();
    if (typeof cfg.model === 'string') next.model = cfg.model.trim();
    if (!next.key) throw new Error('KEY_EMPTY');
    if (next.apiType === 'custom' && next.customUrl && !next.model) {
        try { next.model = await detectCustomModel(next); } catch { /* 探测失败则留空，调用时再试 */ }
    }
    apiConfig = next;
    persistApiConfig();
    return { ok: true, keyMasked: maskKey(apiConfig.key), model: apiConfig.model };
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
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
        const msg = data && data.error ? (data.error.message || JSON.stringify(data.error)) : 'HTTP ' + resp.status;
        throw new Error(msg);
    }
    const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('接口返回内容为空，请重试');
    return content.trim();
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
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('window-all-closed', () => {
    app.quit();
});
