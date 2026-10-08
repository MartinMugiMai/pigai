// ============================================================
// 预加载脚本：以受控方式向渲染层暴露唯一的调用入口
// 渲染层无法接触完整 Key 与配置文件（contextIsolation 开启，
// nodeIntegration 关闭）；config:get 只返回掩码状态
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chineseAI', {
    // messages: [{ role: 'system' | 'user', content: string }]
    // 返回：评语文本（string）；失败时 reject Error
    reviewEssay: (messages) => ipcRenderer.invoke('glm:chat', messages),
    // 返回：{ hasKey, apiType, customUrl, model, keyMasked, displayName, xfConfigured, xfAppId }
    getConfigStatus: () => ipcRenderer.invoke('config:get'),
    // cfg: { apiType: 'glm'|'custom', key?, customUrl?, model?, xfAppId?, xfApiKey?, xfApiSecret? }
    saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
    // 打开（或聚焦）请求日志窗口
    openLogWindow: () => ipcRenderer.invoke('log:open-window'),
    // 讯飞语音评测：{ audioBase64, refText } → 评测结果 JSON
    evaluateAudio: (payload) => ipcRenderer.invoke('xfyun:evaluate', payload),
    // 保存录音文件到用户数据目录：{ base64, filename } → { ok, path }
    saveRecording: (payload) => ipcRenderer.invoke('recordings:save', payload),
    // 用资源管理器 / Finder 打开录音目录
    openRecordingsFolder: () => ipcRenderer.invoke('recordings:open-folder'),
    // 打开（或聚焦）后台输出窗口
    openBackendWindow: () => ipcRenderer.invoke('backend:open-window'),
    // 热切换大模型接口（另一接口已配置时）：返回切换后的双档案状态
    switchApi: () => ipcRenderer.invoke('config:switch'),
    // 关于本应用弹窗
    showAboutDialog: () => ipcRenderer.invoke('app:about'),
    // 一键清空：scope 'llm'（大模型）| 'xf'（讯飞）
    clearConfig: (scope) => ipcRenderer.invoke('config:clear', scope),
    // 保存文本到 TXT：{ text, defaultName } → { ok, path } / { ok:false, canceled }
    saveTextFile: (payload) => ipcRenderer.invoke('text:save', payload)
});
