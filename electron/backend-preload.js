// ============================================================
// 后台输出窗口预加载脚本：只读的日志查询/订阅/保存入口
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pigaiBackend', {
    // 全量后台输出（打开窗口时主动拉取）
    getAll: () => ipcRenderer.invoke('backend:get-all'),
    // 弹出系统保存对话框，将全部输出写入 TXT
    save: () => ipcRenderer.invoke('backend:save'),
    // 增量推送：每条新输出
    onAppend: (cb) => ipcRenderer.on('backend:log-append', (_e, entry) => cb(entry))
});
