// ============================================================
// 日志窗口预加载脚本：仅暴露只读的日志查询/订阅/保存入口
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pigaiLog', {
    // 全量日志（打开窗口时主动拉取）
    getAll: () => ipcRenderer.invoke('log:get-all'),
    // 弹出系统保存对话框，将日志写入 TXT
    save: () => ipcRenderer.invoke('log:save'),
    // 增量推送：每条新日志
    onAppend: (cb) => ipcRenderer.on('glm:log-append', (_e, entry) => cb(entry))
});
