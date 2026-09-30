// ============================================================
// Chinese Learning AI Assistant · 主脚本
// 由 pigai.html 的内联 <script> 独立整合而来
// 模块〇：顶部选项卡切换
// 模块一：作文批改（GLM 接口批改）
// 模块二：古诗背诵默写
// ============================================================

(function() {
    // ==================== 顶部选项卡切换 ====================
    const tabButtons = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const target = this.dataset.view; // 对应视图 id：view-essay / view-recite
            tabButtons.forEach(b => b.classList.toggle('active', b === this));
            views.forEach(v => v.classList.toggle('active', v.id === 'view-' + target));
        });
    });

    // ==================== API 设置弹窗（首次配置 / 随时修改） ====================
    const apiSettingsBtn = document.getElementById('apiSettingsBtn');
    const apiStatusBadge = document.getElementById('apiStatusBadge');
    const apiSetupOverlay = document.getElementById('apiSetupOverlay');
    const apiTypeSelect = document.getElementById('apiTypeSelect');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const importKeyBtn = document.getElementById('importKeyBtn');
    const keyFileInput = document.getElementById('keyFileInput');
    const keyFileHint = document.getElementById('keyFileHint');
    const keyMask = document.getElementById('keyMask');
    const customUrlItem = document.getElementById('customUrlItem');
    const customUrlInput = document.getElementById('customUrlInput');
    const customModelItem = document.getElementById('customModelItem');
    const customModelInput = document.getElementById('customModelInput');
    const apiCancelBtn = document.getElementById('apiCancelBtn');
    const apiSaveBtn = document.getElementById('apiSaveBtn');

    function toggleCustomFields() {
        const isCustom = apiTypeSelect.value === 'custom';
        customUrlItem.style.display = isCustom ? '' : 'none';
        customModelItem.style.display = isCustom ? '' : 'none';
    }

    // 从导入文本识别 Key：优先匹配智谱格式（id.secret），单行纯文本兜底
    function parseKeyText(text) {
        const m = String(text).match(/[A-Za-z0-9]{16,}\.[A-Za-z0-9]{8,}/);
        if (m) return m[0];
        const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 1 && !/[:：]/.test(lines[0])) return lines[0];
        return null;
    }

    function maskLocal(key) {
        return key.length > 10 ? key.slice(0, 4) + '****' + key.slice(-4) : '****';
    }

    // 顶部徽章：显示当前所选大模型 API 的识别名；未配置时显示"未启用大模型 API"
    function applyApiStatus(status) {
        if (status && status.hasKey && status.displayName) {
            apiStatusBadge.textContent = status.displayName;
            apiStatusBadge.classList.add('enabled');
        } else {
            apiStatusBadge.textContent = '未启用大模型 API';
            apiStatusBadge.classList.remove('enabled');
        }
        return status;
    }

    async function openApiSetup() {
        if (window.chineseAI) {
            try {
                const s = await window.chineseAI.getConfigStatus();
                applyApiStatus(s);
                apiTypeSelect.value = s.apiType === 'custom' ? 'custom' : 'glm';
                customUrlInput.value = s.customUrl || '';
                customModelInput.value = s.model || '';
                if (s.hasKey) {
                    keyMask.textContent = '当前 Key：' + s.keyMasked;
                    keyMask.style.display = '';
                } else {
                    keyMask.style.display = 'none';
                }
            } catch { /* 读取失败则保持空表单 */ }
        }
        apiKeyInput.value = '';
        keyFileHint.textContent = '支持智谱 key.txt 或纯文本 Key';
        toggleCustomFields();
        apiSetupOverlay.classList.add('visible');
    }

    function closeApiSetup() {
        apiSetupOverlay.classList.remove('visible');
    }

    apiSettingsBtn.addEventListener('click', openApiSetup);
    apiCancelBtn.addEventListener('click', closeApiSetup);
    apiTypeSelect.addEventListener('change', toggleCustomFields);

    // 导入 key.txt：读文件内容，自动识别 Key 填入输入框
    importKeyBtn.addEventListener('click', () => keyFileInput.click());
    keyFileInput.addEventListener('change', function() {
        const file = this.files && this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const parsed = parseKeyText(String(reader.result));
            if (parsed) {
                apiKeyInput.value = parsed;
                keyFileHint.textContent = '已识别 Key：' + maskLocal(parsed);
            } else {
                keyFileHint.textContent = '未能从文件中识别 Key，请手动粘贴';
            }
        };
        reader.readAsText(file, 'utf-8');
    });

    apiSaveBtn.addEventListener('click', async function() {
        const key = apiKeyInput.value.trim();
        if (!key) {
            alert('请填写 API Key（或点击"导入 key.txt"自动识别）');
            return;
        }
        const isCustom = apiTypeSelect.value === 'custom';
        if (isCustom && !/^https?:\/\//i.test(customUrlInput.value.trim())) {
            alert('自定义接口需要填写以 http(s):// 开头的 API 链接');
            return;
        }
        try {
            apiSaveBtn.disabled = true;
            await window.chineseAI.saveConfig({
                apiType: apiTypeSelect.value,
                key,
                customUrl: customUrlInput.value.trim(),
                model: customModelInput.value.trim()
            });
            closeApiSetup();
            window.chineseAI.getConfigStatus().then(applyApiStatus).catch(() => {});
        } catch (e) {
            alert('保存失败：' + (e.message || e));
        } finally {
            apiSaveBtn.disabled = false;
        }
    });

    // ==================== GLM 接口（Electron 主进程代理） ====================
    // Key 与网络请求全部在主进程（electron/main.js）处理；渲染层通过 preload
    // 暴露的 window.chineseAI.reviewEssay() 经 IPC 调用，本文件不保存任何密钥。

    // ==================== 作文批改逻辑（GLM 接口版） ====================
    const gradeInput = document.getElementById('grade');
    const titleInput = document.getElementById('essayTitle');
    const minWordsInput = document.getElementById('minWords');
    const writingReqInput = document.getElementById('writingReq');
    const reviewNeedsInput = document.getElementById('reviewNeeds');
    const essayContentInput = document.getElementById('essayContent');
    const outputDiv = document.getElementById('outputContent');
    const generateBtn = document.getElementById('generateBtn');
    const clearBtn = document.getElementById('clearBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const essayFileInput = document.getElementById('essayFile');
    const fileHint = document.getElementById('fileHint');

    function getForm() {
        const minWords = parseInt(minWordsInput.value, 10);
        return {
            grade: gradeInput.value.trim(),
            title: titleInput.value.trim(),
            minWords: isNaN(minWords) ? 0 : minWords,
            writingReq: writingReqInput.value.trim(),
            reviewNeeds: reviewNeedsInput.value.trim(),
            essay: essayContentInput.value.trim()
        };
    }

    // 统计字数（去除空白符）
    function countChars(text) {
        return text.replace(/\s/g, '').length;
    }

    // 组装提示词：把批改条件与作文正文交给 GLM
    function buildMessages(f) {
        const system = '你是一位经验丰富、温和鼓励的中小学语文老师。请依据批改条件批改学生作文，输出结构化的中文评语，包含：总体评价、亮点、不足、修改建议、建议评分（0-100）。如果未提供作文正文，请简要说明需要先导入作文并给出写作建议。';
        const user = [
            `【年级】${f.grade || '未提供'}`,
            `【作文题目】${f.title ? `《${f.title}》` : '未提供'}`,
            `【最低字数要求】${f.minWords > 0 ? f.minWords + ' 字' : '未提供'}`,
            `【学生写作要求】${f.writingReq || '未提供'}`,
            `【教师批改需求】${f.reviewNeeds || '未提供'}`,
            '',
            '【学生作文正文】',
            f.essay || '（未提供作文正文）'
        ].join('\n');
        return [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ];
    }

    // 调用 GLM 接口（经 Electron 主进程 IPC 代理），返回评语文本
    async function callGLM(form) {
        if (!window.chineseAI || typeof window.chineseAI.reviewEssay !== 'function') {
            throw new Error('未检测到 Electron 桌面环境。批改功能请在桌面版中运行（项目目录执行 npm start）；浏览器预览模式下页面其余功能不受影响。');
        }
        return window.chineseAI.reviewEssay(buildMessages(form));
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // 评语渲染：按行分段，轻量处理 **加粗** 与 # 标题；剥离本地推理模型的 <think> 段落
    function formatReview(text) {
        const html = escapeHtml(String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim())
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/^#{1,4}\s*/gm, '');
        return html.split('\n').map(line =>
            line.trim() === '' ? '<br>' : `<p>${line}</p>`
        ).join('');
    }

    let isGenerating = false;

    async function renderReview() {
        if (isGenerating) return;
        const form = getForm();
        if (!form.grade && !form.title && !form.writingReq && !form.reviewNeeds && !form.essay) {
            outputDiv.innerHTML = '<p>📭 请至少填写年级、题目或导入作文内容，再生成评语。</p>';
            return;
        }
        isGenerating = true;
        generateBtn.disabled = true;
        outputDiv.innerHTML = '<p class="output-placeholder">⏳ 正在调用 大模型 批改作文，请稍候…</p>';
        try {
            const reviewText = await callGLM(form);
            outputDiv.innerHTML = formatReview(reviewText);
        } catch (err) {
            const msg = String(err.message || err);
            if (msg.includes('API_KEY_NOT_SET') || msg.includes('CUSTOM_URL_NOT_SET')) {
                openApiSetup();
                outputDiv.innerHTML = '<p>📭 尚未完成 API 配置，请在弹出的设置窗口中填写 Key' +
                    (msg.includes('CUSTOM_URL_NOT_SET') ? '并补全自定义接口链接' : '（支持导入 key.txt）') + '。</p>';
            } else {
                outputDiv.innerHTML = '<p>❌ 调用失败：' + escapeHtml(msg) + '</p><p class="output-placeholder">请检查网络连接后重试，或点右上角"⚙️ API 设置"检查配置。</p>';
            }
        } finally {
            isGenerating = false;
            generateBtn.disabled = false;
        }
    }

    function clearAll() {
        gradeInput.value = '';
        titleInput.value = '';
        minWordsInput.value = '';
        writingReqInput.value = '';
        reviewNeedsInput.value = '';
        essayContentInput.value = '';
        essayFileInput.value = '';
        fileHint.textContent = '支持 .txt 文本文件，或直接在下方粘贴';
        outputDiv.innerHTML = '';
    }

    // 附件导入：点击按钮选择 .txt 文件，内容读入作文输入框（导入后手动点生成，避免自动消耗调用）
    uploadBtn.addEventListener('click', () => essayFileInput.click());
    essayFileInput.addEventListener('change', () => {
        const file = essayFileInput.files && essayFileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            essayContentInput.value = reader.result;
            fileHint.textContent = `已导入：${file.name}（${countChars(String(reader.result))} 字）`;
        };
        reader.readAsText(file, 'utf-8');
    });

    generateBtn.addEventListener('click', renderReview);
    clearBtn.addEventListener('click', clearAll);

    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            renderReview();
        }
    });

    // 初始状态：输入框与输出框均保持空白（不自动调用接口，等待用户触发）
    outputDiv.innerHTML = '';

    // 首次运行检查：未配置 Key 时自动弹出设置窗口；浏览器模式下隐藏设置按钮
    if (window.chineseAI) {
        window.chineseAI.getConfigStatus().then(status => {
            applyApiStatus(status);
            if (!status.hasKey) openApiSetup();
        }).catch(() => {});
    } else {
        apiSettingsBtn.style.display = 'none';
    }

    // ==================== 古诗默写批改逻辑 ====================
    const writeInput = document.getElementById('writeInput');
    const studentDisplay = document.getElementById('studentDisplay');
    const fluencyBadge = document.getElementById('fluencyBadge');
    const scoreDisplay = document.getElementById('scoreDisplay');
    const gradeLabel = document.getElementById('gradeLabel');
    const commentDisplay = document.getElementById('commentDisplay');
    const correctSentences = document.getElementById('correctSentences');
    const wrongCharCount = document.getElementById('wrongCharCount');
    const omitCount = document.getElementById('omitCount');
    const accuracyLabel = document.getElementById('accuracyLabel');
    const fluencyLabel = document.getElementById('fluencyLabel');
    const emotionLabel = document.getElementById('emotionLabel');
    const tagContainer = document.getElementById('tagContainer');
    const reciteMeta = document.getElementById('reciteMeta');

    const voiceRecordBtn = document.getElementById('voiceRecordBtn');
    const voiceStopBtn = document.getElementById('voiceStopBtn');
    const voiceStatus = document.getElementById('voiceStatus');
    const voiceDetail = document.getElementById('voiceDetail');
    const pulseDot = document.getElementById('pulseDot');

    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recordedBlob = null;
    let recordingStartTime = null;

    const defaultData = {
        write: '独在异乡为异客，\n每逢佳节倍思亲。\n遥知兄弟登高处，\n遍插茱萸少一人',
        displayHtml: '独在异乡为异客，<br>每逢佳节倍思亲。<br>遥知兄弟登高处，<br>遍插茱萸少一人',
        score: '92',
        grade: 'Excellent',
        comment: '“默写整体优秀，仅一字笔误。背诵感情饱满，节奏恰当。继续加油！”',
        correct: '3/4',
        wrong: '1',
        omit: '0',
        accuracy: '92%',
        fluency: 'A-',
        emotion: 'B+',
        tags: ['👍 背诵流畅', '📌 错字1处', '✨ 情感到位'],
        reciteMeta: '⏳ Recited 48s · Smooth rhythm',
        fluencyBadgeText: 'Fluency ★★★☆'
    };

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = event => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = () => {
                recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const duration = recordingStartTime ? Math.round((Date.now() - recordingStartTime) / 1000) : 0;
                voiceDetail.textContent = `✅ Recorded (${duration}s)`;
                voiceStatus.textContent = '🎤 Done, ready to submit';
                pulseDot.classList.remove('active');
                voiceRecordBtn.textContent = '🎤 Re-record';
                voiceRecordBtn.classList.remove('recording');
                voiceStopBtn.disabled = true;
                reciteMeta.textContent = `⏳ Recited ${duration}s · Recorded`;
                fluencyBadge.textContent = `🎤 Recited ${duration}s`;
                if (duration > 0) {
                    let fluencyNote = '';
                    if (duration < 20) fluencyNote = '⭐ Very fluent';
                    else if (duration < 40) fluencyNote = '★★★ Fairly fluent';
                    else fluencyNote = '★★ Some pauses';
                    fluencyBadge.textContent += ` · ${fluencyNote}`;
                }
                stream.getTracks().forEach(track => track.stop());
                mediaRecorder = null;
            };

            mediaRecorder.start();
            isRecording = true;
            recordingStartTime = Date.now();
            pulseDot.classList.add('active');
            voiceStatus.textContent = '🔴 Recording...';
            voiceDetail.textContent = '⏳ Recording, click Stop';
            voiceRecordBtn.textContent = '⏺ Recording...';
            voiceRecordBtn.classList.add('recording');
            voiceStopBtn.disabled = false;
            voiceRecordBtn.disabled = true;
        } catch (err) {
            const name = err && err.name ? err.name : 'UnknownError';
            console.error('Recording error:', name, err && err.message);
            const hints = {
                NotAllowedError: '麦克风权限被拒绝。请在系统"设置→隐私→麦克风"中允许桌面应用使用麦克风，然后重试。',
                NotFoundError: '未检测到麦克风设备，请连接或启用麦克风后重试。',
                NotReadableError: '麦克风被系统隐私设置关闭，或被其他程序占用。请检查"设置→隐私→麦克风"。',
                OverconstrainedError: '麦克风不支持当前录音参数。'
            };
            alert('无法访问麦克风：' + (hints[name] || (name + ' ' + (err && err.message || ''))));
            resetVoiceUI();
        }
    }

    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            isRecording = false;
            voiceRecordBtn.disabled = false;
            voiceStopBtn.disabled = true;
            voiceRecordBtn.classList.remove('recording');
            voiceStatus.textContent = '⏹ Stopped';
        } else {
            resetVoiceUI();
        }
    }

    function resetVoiceUI() {
        pulseDot.classList.remove('active');
        voiceRecordBtn.textContent = '🎤 Record';
        voiceRecordBtn.classList.remove('recording');
        voiceStopBtn.disabled = true;
        voiceRecordBtn.disabled = false;
        isRecording = false;
        if (mediaRecorder) {
            try { mediaRecorder.stop(); } catch(e) {}
            mediaRecorder = null;
        }
        if (!recordedBlob) {
            voiceStatus.textContent = 'Click 🎤 to start';
            voiceDetail.textContent = '⏳ Not recorded';
        }
    }

    voiceRecordBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (isRecording) return;
        recordedBlob = null;
        startRecording();
    });

    voiceStopBtn.addEventListener('click', function(e) {
        e.preventDefault();
        stopRecording();
    });

    function updateFeedback() {
        let raw = writeInput.value;
        if (!raw.trim()) {
            raw = '（未填写默写内容）';
        }
        const displayHtml = raw.replace(/\n/g, '<br>');
        studentDisplay.innerHTML = displayHtml;

        let voiceDuration = 0;
        const detailText = voiceDetail.textContent;
        const match = detailText.match(/(\d+)秒/);
        if (match) voiceDuration = parseInt(match[1], 10);

        const content = raw.trim();
        const lines = content.split('\n').filter(line => line.trim() !== '');
        const lineCount = lines.length;

        let wrongCount = 0;
        if (content.includes('朱')) wrongCount = 1;
        if (content.includes('茱萸')) wrongCount = 0;
        if (content.includes('朱萸')) wrongCount = 1;
        if (content.includes('茱') && !content.includes('茱萸')) wrongCount = 1;

        const standard = '独在异乡为异客，每逢佳节倍思亲。遥知兄弟登高处，遍插茱萸少一人';
        const stdClean = standard.replace(/[，。、！？\s]/g, '');
        const inputClean = content.replace(/[，。、！？\s]/g, '');
        let diffCount = 0;
        for (let i = 0; i < Math.min(stdClean.length, inputClean.length); i++) {
            if (stdClean[i] !== inputClean[i]) diffCount++;
        }
        diffCount += Math.abs(stdClean.length - inputClean.length);
        if (diffCount > 0) wrongCount = Math.max(1, diffCount);
        if (content.includes('遍插茱萸少一人') && content.includes('独在异乡')) {
            if (diffCount <= 1) wrongCount = 0;
        }
        if (content.includes('朱') && !content.includes('茱萸')) wrongCount = 1;

        let omit = 0;
        if (lineCount < 4) omit = 4 - lineCount;
        if (content.includes('独在') && content.includes('每逢') && content.includes('遥知') && content.includes('遍插')) {
            omit = 0;
        }

        let correct = 4 - omit - (wrongCount > 0 ? 1 : 0);
        if (correct < 0) correct = 0;
        const correctStr = `${correct}/4`;

        let score = 100;
        if (wrongCount > 0) score -= wrongCount * 5;
        if (omit > 0) score -= omit * 12;
        if (score < 0) score = 0;
        if (score > 100) score = 100;

        let grade = 'Excellent';
        if (score >= 90) grade = 'Excellent';
        else if (score >= 75) grade = 'Good';
        else if (score >= 60) grade = 'Pass';
        else grade = 'Needs Work';

        let comment = 'Overall OK.';
        if (wrongCount === 0 && omit === 0) comment = '🎉 Perfect! Fluent recitation, great emotion. Keep it up!';
        else if (wrongCount === 0 && omit > 0) comment = `Accurate, but ${omit} line(s) omitted. Strengthen memory.`;
        else if (wrongCount > 0 && omit === 0) comment = `${wrongCount} wrong character(s). Pay attention to strokes. Good rhythm.`;
        else if (wrongCount > 0 && omit > 0) comment = `${wrongCount} wrong, ${omit} omitted. Read more and understand the poem.`;
        if (content.includes('朱')) comment = '"茱萸" written as "朱萸". Note the grass radical. Otherwise excellent!';
        if (content.includes('茱萸') && !content.includes('朱')) comment = 'Perfect dictation! Full of emotion. Very well done!';
        if (content.trim() === '' || content === '（未填写默写内容）') {
            comment = 'Please enter the dictation content and submit for review.';
        }

        const tags = [];
        if (score >= 90) tags.push('🌟 Excellent');
        else if (score >= 75) tags.push('👍 Good');
        else tags.push('📖 Keep going');
        if (wrongCount === 0 && omit === 0) tags.push('✅ Perfect');
        if (wrongCount > 0) tags.push(`📌 ${wrongCount} wrong`);
        if (omit > 0) tags.push(`📄 ${omit} omitted`);
        if (content.includes('茱萸')) tags.push('🌿 Accurate wording');

        scoreDisplay.textContent = score;
        gradeLabel.textContent = grade;
        commentDisplay.textContent = comment;
        correctSentences.textContent = correctStr;
        wrongCharCount.textContent = wrongCount;
        omitCount.textContent = omit;
        accuracyLabel.textContent = `${Math.min(100, Math.round((correct/4)*100))}%`;

        let fluency = 'A';
        if (score < 60) fluency = 'C';
        else if (score < 75) fluency = 'B-';
        else if (score < 90) fluency = 'B+';
        else fluency = 'A-';
        if (voiceDuration > 0) {
            if (voiceDuration < 15) fluency = 'A+';
            else if (voiceDuration < 30) fluency = 'A';
            else fluency = 'B+';
        }
        fluencyLabel.textContent = fluency;

        let emotion = 'B+';
        if (score >= 90) emotion = 'A-';
        else if (score >= 75) emotion = 'B+';
        else emotion = 'B-';
        emotionLabel.textContent = emotion;

        tagContainer.innerHTML = tags.map(t =>
            `<span style="background: #d1c3b4; padding: 2px 16px; border-radius: 30px; font-size: 12px; font-family: 'Segoe UI', sans-serif;">${t}</span>`
        ).join('');

        if (voiceDuration > 0) {
            reciteMeta.textContent = `⏳ Recited ${voiceDuration}s · Recorded`;
            fluencyBadge.textContent = `🎤 Recited ${voiceDuration}s · Fluency ${fluency}`;
        }
    }

    function resetToDefault() {
        writeInput.value = defaultData.write;
        studentDisplay.innerHTML = defaultData.displayHtml;
        fluencyBadge.textContent = defaultData.fluencyBadgeText;
        scoreDisplay.textContent = defaultData.score;
        gradeLabel.textContent = defaultData.grade;
        commentDisplay.textContent = defaultData.comment;
        correctSentences.textContent = defaultData.correct;
        wrongCharCount.textContent = defaultData.wrong;
        omitCount.textContent = defaultData.omit;
        accuracyLabel.textContent = defaultData.accuracy;
        fluencyLabel.textContent = defaultData.fluency;
        emotionLabel.textContent = defaultData.emotion;
        reciteMeta.textContent = defaultData.reciteMeta;
        tagContainer.innerHTML = defaultData.tags.map(t =>
            `<span style="background: #d1c3b4; padding: 2px 16px; border-radius: 30px; font-size: 12px; font-family: 'Segoe UI', sans-serif;">${t}</span>`
        ).join('');
        recordedBlob = null;
        resetVoiceUI();
        voiceDetail.textContent = '⏳ Not recorded';
        voiceStatus.textContent = 'Click 🎤 to start';
    }

    // 注：submitBtn / resetBtn 在当前页面中不存在，保留以便后续扩展
    document.getElementById('submitBtn')?.addEventListener('click', updateFeedback);
    document.getElementById('resetBtn')?.addEventListener('click', resetToDefault);

    writeInput.addEventListener('input', function() {
        const val = this.value;
        if (val.trim() === '') {
            studentDisplay.innerHTML = '（Waiting for input...）';
        } else {
            studentDisplay.innerHTML = val.replace(/\n/g, '<br>');
        }
    });

    // 初始化古诗模块
    resetToDefault();
})();
