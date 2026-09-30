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

// 由配置解析实际请求参数；Key 未配置 / 自定义链接缺失时抛出约定错误码
function resolveApi() {
    if (!apiConfig.key) throw new Error('API_KEY_NOT_SET');
    if (apiConfig.apiType === 'custom') {
        if (!apiConfig.customUrl) throw new Error('CUSTOM_URL_NOT_SET');
        return { url: apiConfig.customUrl, model: apiConfig.model || GLM_PRESET.model };
    }
    return { url: GLM_PRESET.url, model: GLM_PRESET.model };
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

    // 调试自测钩子：以 APP_SELFTEST=1 启动时，自动验证界面状态与调用链路
    if (process.env.APP_SELFTEST === '1') {
        win.webContents.on('did-finish-load', () => {
            setTimeout(async () => {
                try {
                    const overlayVisible = await win.webContents.executeJavaScript(
                        "document.getElementById('apiSetupOverlay').classList.contains('visible')"
                    );
                    console.log('SELFTEST OVERLAY:', overlayVisible);
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
                        console.log('SELFTEST SAVE:', JSON.stringify(saveResult));
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
                            console.log('SELFTEST RESULT:', text.slice(0, 220).replace(/\n/g, ' | '));
                            break;
                        }
                    }
                    // 麦克风探测：拿到确切错误名（NotAllowed/NotFound/NotReadable 等）
                    const micResult = await win.webContents.executeJavaScript(`
                        (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
                            ? navigator.mediaDevices.getUserMedia({ audio: true })
                                .then(stream => { stream.getTracks().forEach(t => t.stop()); return 'MIC OK'; })
                                .catch(e => 'MIC FAIL: ' + e.name + ': ' + e.message)
                            : Promise.resolve('MIC API MISSING')
                    `);
                    console.log('SELFTEST MIC:', micResult);
                } catch (e) {
                    console.log('SELFTEST RESULT: ERROR ' + e.message);
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
    keyMasked: apiConfig.key ? maskKey(apiConfig.key) : ''
}));

// 配置保存：Key 传入即更新；校验通过后写入用户数据目录
ipcMain.handle('config:save', (_event, cfg) => {
    const next = { ...apiConfig };
    if (typeof cfg.apiType === 'string') next.apiType = cfg.apiType === 'custom' ? 'custom' : 'glm';
    if (typeof cfg.key === 'string' && cfg.key.trim()) next.key = cfg.key.trim();
    if (typeof cfg.customUrl === 'string') next.customUrl = cfg.customUrl.trim();
    if (typeof cfg.model === 'string') next.model = cfg.model.trim();
    if (!next.key) throw new Error('KEY_EMPTY');
    apiConfig = next;
    persistApiConfig();
    return { ok: true, keyMasked: maskKey(apiConfig.key) };
});

// GLM 调用走主进程 net.fetch：不受 CORS 约束，Key 与配置不出主进程
ipcMain.handle('glm:chat', async (_event, messages) => {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('消息参数无效');
    }
    const { url, model } = resolveApi();
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
        const msg = data && data.error ? data.error.message : 'HTTP ' + resp.status;
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
