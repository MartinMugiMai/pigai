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
    // 返回：{ hasKey, apiType, customUrl, model, keyMasked }
    getConfigStatus: () => ipcRenderer.invoke('config:get'),
    // cfg: { apiType: 'glm'|'custom', key?, customUrl?, model? }
    saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg)
});
