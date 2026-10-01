// ============================================================
// 后台输出窗口脚本：渲染主进程/渲染层的全部调试输出，支持保存 TXT
// ============================================================
(function () {
    const logArea = document.getElementById('logArea');
    const saveHint = document.getElementById('saveHint');
    const saveBtn = document.getElementById('saveBtn');
    let count = 0;

    function append(entry) {
        const empty = logArea.querySelector('.empty');
        if (empty) empty.remove();
        const div = document.createElement('div');
        div.className = 'log-entry';
        const head = document.createElement('div');
        head.className = 'log-head';
        const src = document.createElement('span');
        src.className = 'src-' + (entry.source === '渲染层' ? 'renderer' : 'main');
        src.textContent = '[' + entry.time + '] [' + entry.source + '·' + entry.level + ']';
        head.appendChild(src);
        const body = document.createElement('div');
        body.textContent = entry.text || '';
        if (entry.level === 'error') body.className = 'lv-error';
        else if (entry.level === 'warn') body.className = 'lv-warn';
        div.appendChild(head);
        div.appendChild(body);
        logArea.appendChild(div);
        count++;
        saveHint.textContent = '共 ' + count + ' 条输出（主进程 print + 渲染层 console）';
        logArea.scrollTop = logArea.scrollHeight;
    }

    window.pigaiBackend.onAppend(append);

    (async () => {
        try {
            const list = await window.pigaiBackend.getAll();
            (list || []).forEach(append);
        } catch (e) {
            saveHint.textContent = '读取后台输出失败：' + (e.message || e);
        }
    })();

    saveBtn.addEventListener('click', async () => {
        saveHint.textContent = '正在保存…';
        try {
            const r = await window.pigaiBackend.save();
            saveHint.textContent = r.ok ? '已保存到 ' + r.path : (r.canceled ? '已取消保存' : '保存失败');
        } catch (e) {
            saveHint.textContent = '保存失败：' + (e.message || e);
        }
    });
})();
