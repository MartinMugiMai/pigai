// ============================================================
// 日志窗口脚本：渲染主进程推送的请求日志，支持一键保存 TXT
// ============================================================
(function () {
    const logArea = document.getElementById('logArea');
    const saveHint = document.getElementById('saveHint');
    const saveBtn = document.getElementById('saveBtn');
    let count = 0;

    function showFatal(msg) {
        saveHint.textContent = '日志初始化失败：' + msg;
    }

    window.addEventListener('error', e => showFatal(e.message));

    function entryNode(entry) {
        const div = document.createElement('div');
        div.className = 'log-entry';
        const head = document.createElement('div');
        head.className = 'log-head';
        const tag = document.createElement('span');
        tag.className = 't-' + entry.type;
        tag.textContent = '[' + entry.time + '] ' + entry.type +
            (entry.model ? ' · ' + entry.model : '') +
            (entry.status ? ' · HTTP ' + entry.status : '');
        head.appendChild(tag);
        const body = document.createElement('div');
        body.textContent = entry.detail || '';
        div.appendChild(head);
        div.appendChild(body);
        return div;
    }

    function append(entry) {
        const empty = logArea.querySelector('.empty');
        if (empty) empty.remove();
        logArea.appendChild(entryNode(entry));
        count++;
        saveHint.textContent = '共 ' + count + ' 条记录';
        logArea.scrollTop = logArea.scrollHeight;
    }

    if (!window.pigaiLog) {
        showFatal('pigaiLog 未注入（preload 未加载）');
        return;
    }

    // 先订阅增量，再拉取全量，保证不丢日志
    window.pigaiLog.onAppend(append);

    (async () => {
        try {
            const list = await window.pigaiLog.getAll();
            (list || []).forEach(append);
        } catch (e) {
            showFatal('读取日志失败：' + (e.message || e));
        }
    })();

    saveBtn.addEventListener('click', async () => {
        saveHint.textContent = '正在保存…';
        try {
            const r = await window.pigaiLog.save();
            saveHint.textContent = r.ok ? '已保存到 ' + r.path : (r.canceled ? '已取消保存' : '保存失败');
        } catch (e) {
            saveHint.textContent = '保存失败：' + (e.message || e);
        }
    });
})();
