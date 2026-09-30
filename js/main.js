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
    const logWindowBtn = document.getElementById('logWindowBtn');
    const recordingsFolderBtn = document.getElementById('recordingsFolderBtn');
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
    const xfAppIdInput = document.getElementById('xfAppIdInput');
    const xfApiKeyInput = document.getElementById('xfApiKeyInput');
    const xfApiSecretInput = document.getElementById('xfApiSecretInput');

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
                xfAppIdInput.value = s.xfAppId || '';
                const xfState = s.xfConfigured ? '已配置（留空保持不变）' : '未配置';
                xfApiKeyInput.placeholder = '讯飞 APIKey ' + xfState;
                xfApiSecretInput.placeholder = '讯飞 APISecret ' + xfState;
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

    // 请求日志窗口（Electron 子窗口）；浏览器模式下无日志可看
    logWindowBtn.addEventListener('click', function() {
        if (window.chineseAI) window.chineseAI.openLogWindow();
    });

    // 用资源管理器 / Finder 打开录音目录
    recordingsFolderBtn.addEventListener('click', function() {
        if (window.chineseAI) window.chineseAI.openRecordingsFolder();
    });

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
                model: customModelInput.value.trim(),
                xfAppId: xfAppIdInput.value.trim(),
                xfApiKey: xfApiKeyInput.value.trim(),
                xfApiSecret: xfApiSecretInput.value.trim()
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
        logWindowBtn.style.display = 'none';
        recordingsFolderBtn.style.display = 'none';
    }

    // ==================== 朗诵批改逻辑（录音 → 大模型批改） ====================
    // 后续将接入讯飞语音评测（suntone，WebSocket + HMAC 鉴权）：
    //   录音音频（需转 16k 单声道 lame/speex）分段送讯飞 sent/para 评测，
    //   得到 overall/pronunciation/tone/fluency/integrity/rhythm/speed 与逐字
    //   pinyin/tone/readType 数据后并入下方提示词，由大模型综合评价。
    // 当前版本评测数据为空，大模型基于朗诵标题与朗读内容给出指导性批改。
    const reciteTitleInput = document.getElementById('reciteTitle');
    const contentTypeSelect = document.getElementById('contentType');
    const reciteContentInput = document.getElementById('reciteContent');
    const reciteReviewReqInput = document.getElementById('reciteReviewReq');
    const gradeBtn = document.getElementById('gradeBtn');
    const scoreDisplay = document.getElementById('scoreDisplay');
    const gradeLabel = document.getElementById('gradeLabel');
    const commentDisplay = document.getElementById('commentDisplay');
    const tagContainer = document.getElementById('tagContainer');
    const assessPlaceholder = document.getElementById('assessPlaceholder');

    const voiceRecordBtn = document.getElementById('voiceRecordBtn');
    const voiceStopBtn = document.getElementById('voiceStopBtn');
    const audioUploadBtn = document.getElementById('audioUploadBtn');
    const audioFileInput = document.getElementById('audioFileInput');
    const voiceStatus = document.getElementById('voiceStatus');
    const voiceDetail = document.getElementById('voiceDetail');
    const pulseDot = document.getElementById('pulseDot');

    const DEFAULT_REVIEW_DIMENSIONS = '感情、读音准确、停顿节奏、语气';

    let micRecorder = null;       // 当前录音会话（MicRecorder.start() 的返回值）
    let isRecording = false;
    let recordedBlob = null;      // 录制的朗读音频（WAV，后续送讯飞 suntone 评测）
    let recordingStartTime = null;
    let lastRecordingSeconds = 0; // 最近一次录音时长（秒）
    let isGradingRecite = false;

    // ==================== 麦克风原始 PCM 采集（Web Audio → WAV） ====================
    // 不使用 MediaRecorder(webm/opus)：Electron 在 macOS 上常产出"文件正常但内容
    // 全零"的静音录音（Intel macOS 12 与 Apple Silicon 新版系统均受影响），且 webm
    // 还需二次解码。这里用 AudioWorklet 采集 Float32 PCM，停止时合成 16bit 单声道
    // WAV——保存即可直接播放，转 16k MP3 送讯飞也只需一次重采样。
    // AudioWorklet 不可用时回退 ScriptProcessorNode（老系统兼容）。
    const MicRecorder = (() => {
        const WORKLET_SRC = [
            'class PigaiCapture extends AudioWorkletProcessor {',
            '  process(inputs) {',
            '    const ch = inputs[0] && inputs[0][0];',
            '    if (ch && ch.length) this.port.postMessage(ch.slice(0));',
            '    return true;',
            '  }',
            '}',
            "registerProcessor('pigai-capture', PigaiCapture);"
        ].join('\n');

        // Float32 分片 → 16bit 单声道 WAV Blob（44 字节标准头）
        function encodeWav(chunks, sampleRate) {
            const total = chunks.reduce((s, c) => s + c.length, 0);
            const pcm = new Int16Array(total);
            let idx = 0;
            for (const c of chunks) {
                for (let i = 0; i < c.length; i++) {
                    const s = Math.max(-1, Math.min(1, c[i]));
                    pcm[idx++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
            }
            const buf = new ArrayBuffer(44 + pcm.length * 2);
            const view = new DataView(buf);
            const wstr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
            wstr(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); wstr(8, 'WAVE');
            wstr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
            view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
            view.setUint16(34, 16, true); wstr(36, 'data'); view.setUint32(40, pcm.length * 2, true);
            new Int16Array(buf, 44).set(pcm);
            return new Blob([buf], { type: 'audio/wav' });
        }

        return {
            // 打开麦克风并开始采集；返回 { sampleRate, stop(): Promise<Blob> }
            async start() {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const sampleRate = ctx.sampleRate;
                const source = ctx.createMediaStreamSource(stream);
                const chunks = [];
                const onChunk = data => chunks.push(new Float32Array(data));
                let worklet = null, processor = null, sink = null;
                try {
                    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
                    await ctx.audioWorklet.addModule(url);
                    URL.revokeObjectURL(url);
                    worklet = new AudioWorkletNode(ctx, 'pigai-capture');
                    worklet.port.onmessage = e => onChunk(e.data);
                    source.connect(worklet);
                    worklet.connect(ctx.destination); // 不落图不处理；worklet 输出未写入即静音，无回声
                } catch (e) {
                    processor = ctx.createScriptProcessor(4096, 1, 1);
                    processor.onaudioprocess = e => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
                    sink = ctx.createGain();
                    sink.gain.value = 0; // 零增益防回声
                    source.connect(processor);
                    processor.connect(sink);
                    sink.connect(ctx.destination);
                }
                return {
                    async stop() {
                        try { source.disconnect(); } catch (e) {}
                        try { worklet && worklet.disconnect(); } catch (e) {}
                        try { processor && processor.disconnect(); } catch (e) {}
                        try { sink && sink.disconnect(); } catch (e) {}
                        stream.getTracks().forEach(t => t.stop());
                        try { await ctx.close(); } catch (e) {}
                        return encodeWav(chunks, sampleRate);
                    }
                };
            }
        };
    })();

    async function startRecording() {
        try {
            micRecorder = await MicRecorder.start();
            isRecording = true;
            recordingStartTime = Date.now();
            pulseDot.classList.add('active');
            voiceStatus.textContent = '🔴 录音中…';
            voiceDetail.textContent = '⏳ 录音中，点击 ⏹ 停止结束';
            voiceRecordBtn.textContent = '⏺ 录音中…';
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

    async function stopRecording() {
        const recorder = micRecorder;
        if (recorder && isRecording) {
            micRecorder = null;
            isRecording = false;
            voiceStopBtn.disabled = true;
            voiceRecordBtn.disabled = true;
            try {
                recordedBlob = await recorder.stop();
            } catch (e) {
                console.error('录音收尾失败:', e);
                recordedBlob = null;
            }
            pulseDot.classList.remove('active');
            voiceRecordBtn.classList.remove('recording');
            voiceRecordBtn.disabled = false;
            if (recordedBlob) {
                lastRecordingSeconds = recordingStartTime ? Math.round((Date.now() - recordingStartTime) / 1000) : 0;
                voiceDetail.textContent = `✅ 已录音（${lastRecordingSeconds}s）`;
                voiceStatus.textContent = '🎤 录音完成，可开始批改';
                voiceRecordBtn.textContent = '🎤 重新录音';
                saveRecordingToDisk(recordedBlob);
                // TODO(讯飞 suntone)：recordedBlob（WAV）转 16k 单声道 mp3 后送评测，
                // 评测结果（overall/pronunciation/tone/fluency/integrity/rhythm/speed）
                // 将并入 buildReciteMessages 的提示词
            } else {
                voiceStatus.textContent = '❌ 录音失败，请重试';
                voiceDetail.textContent = '⏳ 未录音';
                voiceRecordBtn.textContent = '🎤 开始录音';
            }
        } else {
            resetVoiceUI();
        }
    }

    function resetVoiceUI() {
        pulseDot.classList.remove('active');
        voiceRecordBtn.textContent = '🎤 开始录音';
        voiceRecordBtn.classList.remove('recording');
        voiceStopBtn.disabled = true;
        voiceRecordBtn.disabled = false;
        isRecording = false;
        if (micRecorder) {
            const recorder = micRecorder;
            micRecorder = null;
            recorder.stop().catch(() => {});
        }
        if (!recordedBlob) {
            voiceStatus.textContent = '点击 🎤 开始录音';
            voiceDetail.textContent = '⏳ 未录音';
        }
    }

    voiceRecordBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (isRecording) return;
        recordedBlob = null;
        lastRecordingSeconds = 0;
        startRecording();
    });

    voiceStopBtn.addEventListener('click', function(e) {
        e.preventDefault();
        stopRecording();
    });

    // 上传音频文件（mp3/aac/m4a/wav/webm）：与录音同等对待
    // - mp3/webm 直接送讯飞；其他格式按录音同路重采样转 16k MP3
    // - 文件自动存入录音目录，时长由解码结果计算
    audioUploadBtn.addEventListener('click', () => audioFileInput.click());
    audioFileInput.addEventListener('change', async function() {
        const file = this.files && this.files[0];
        this.value = ''; // 允许重复选择同一文件
        if (!file) return;
        try {
            voiceStatus.textContent = '⏳ 正在读取音频文件…';
            const arrayBuf = await file.arrayBuffer();
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            let decoded;
            try {
                decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
            } finally {
                ctx.close();
            }
            lastRecordingSeconds = Math.round(decoded.duration);
            recordedBlob = new Blob([arrayBuf], { type: file.type || 'audio/mpeg' });
            pulseDot.classList.remove('active');
            voiceRecordBtn.textContent = '🎤 重新录音';
            voiceStatus.textContent = '🎵 音频已导入，可开始批改';
            voiceDetail.textContent = `✅ 已导入：${file.name}（${lastRecordingSeconds}s）`;
            saveRecordingToDisk(recordedBlob, file.name.replace(/\.[^.]+$/, ''));
        } catch (e) {
            voiceStatus.textContent = '❌ 音频读取失败';
            alert('无法读取该音频文件：' + (e.message || e) + '。请使用 mp3 / aac / m4a / wav / webm 格式。');
        }
    });

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('base64 编码失败'));
            reader.readAsDataURL(blob);
        });
    }

    // 录音/导入音频后自动保存到用户数据目录的 recordings 文件夹
    async function saveRecordingToDisk(blob, namePart) {
        try {
            if (!window.chineseAI || !window.chineseAI.saveRecording) return;
            const now = new Date();
            const p2 = n => String(n).padStart(2, '0');
            const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`;
            const title = namePart || reciteTitleInput.value.trim();
            const cleanTitle = title.replace(/[\\/:*?"<>|]/g, '').slice(0, 20);
            const type = blob.type || '';
            const ext = type.includes('mpeg') || type.includes('mp3') ? 'mp3' : type.includes('wav') ? 'wav' : 'webm';
            const filename = (cleanTitle ? `录音-${cleanTitle}-` : '录音-') + stamp + '.' + ext;
            const base64 = await blobToBase64(blob);
            const r = await window.chineseAI.saveRecording({ base64, filename });
            if (!r.ok) console.error('录音保存失败');
        } catch (e) {
            console.error('录音保存失败:', e);
        }
    }

    // 组装朗诵批改提示词（数字评分满分100 + 30字评语 + 特征标签）
    function buildReciteMessages(info, assessSummary, assessNote) {
        const system = [
            '你是一位资深的中小学语文朗读指导教师，负责批改学生的朗读。',
            '请依据提供的信息批改学生的朗读，并严格遵守：',
            '1. 若"朗读内容"未提供，请根据"朗诵标题"和"内容类型"给出该篇目的标准朗读文本，并以此作为批改依据；',
            '2. 必须给出数字评分，满分 100 分；',
            '3. 教师评语控制在 30 字左右；',
            '4. 评价维度优先参考"评价要求"，未提供时从感情、读音准确、停顿节奏、语气四个维度评价；',
            '5. 严格按以下格式输出，不要输出格式之外的任何内容：',
            '评分：整数分数',
            '评语：约30字的评语',
            '标签：标签1、标签2、标签3'
        ].join('\n');
        const user = [
            `【朗诵标题】${info.title || '未提供'}`,
            `【内容类型】${info.type || '未提供'}`,
            `【朗读内容】${info.content || '（未提供，请根据朗诵标题与内容类型给出标准朗读文本，并以此作为批改依据）'}`,
            `【评价要求】${info.req}`,
            info.durationSec > 0 ? `【录音时长】约 ${info.durationSec} 秒` : null,
            assessSummary
                ? `【语音评测数据】（讯飞 suntone 实测）${JSON.stringify(assessSummary)}\n请务必结合以上读音测评数据评价读音准确度、流利度与韵律，并在评语中体现明显问题。`
                : `【语音评测数据】暂缺（${assessNote || '未提供录音'}）。请基于朗诵标题与朗读内容进行指导性评价。`
        ].filter(Boolean).join('\n');
        return [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ];
    }

    // 录音 Blob(WAV/webm/mp3) → 16k 单声道 MP3 base64（讯飞 suntone 要求 lame 编码）
    async function blobToMp3Base64(blob) {
        const arrayBuf = await blob.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const decoded = await ctx.decodeAudioData(arrayBuf);
        await ctx.close();

        const targetRate = 16000;
        const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
        const offline = new OfflineAudioContext(1, length, targetRate);
        const mono = offline.createBuffer(1, decoded.length, decoded.sampleRate);
        const monoData = mono.getChannelData(0);
        const ch0 = decoded.getChannelData(0);
        if (decoded.numberOfChannels > 1) {
            const ch1 = decoded.getChannelData(1);
            for (let i = 0; i < decoded.length; i++) monoData[i] = (ch0[i] + ch1[i]) / 2;
        } else {
            monoData.set(ch0);
        }
        const src = offline.createBufferSource();
        src.buffer = mono;
        src.connect(offline.destination);
        src.start();
        const rendered = await offline.startRendering();

        const pcm = rendered.getChannelData(0);
        const pcm16 = new Int16Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) {
            const s = Math.max(-1, Math.min(1, pcm[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const encoder = new lamejs.Mp3Encoder(1, targetRate, 128);
        const mp3Chunks = [];
        const blockSize = 1152 * 10;
        for (let i = 0; i < pcm16.length; i += blockSize) {
            const buf = encoder.encodeBuffer(pcm16.subarray(i, i + blockSize));
            if (buf.length) mp3Chunks.push(new Uint8Array(buf));
        }
        const tail = encoder.flush();
        if (tail.length) mp3Chunks.push(new Uint8Array(tail));

        const mp3Blob = new Blob(mp3Chunks, { type: 'audio/mp3' });
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error('MP3 base64 编码失败'));
            reader.readAsDataURL(mp3Blob);
        });
    }

    // 从讯飞评测结果提取批改提示词所需的关键维度
    function summarizeAssess(decoded) {
        const r = (decoded && decoded.result) || {};
        const summary = {
            总分: r.overall ?? null,
            发音得分: r.pronunciation ?? null,
            声调得分: r.tone ?? null,
            流利度: r.fluency ?? null,
            完整度: r.integrity ?? null,
            韵律度: r.rhythm ?? null,
            语速: r.speed ?? null,
            音频时长: r.duration ?? null
        };
        const wrong = [];
        const missed = [];
        const scan = arr => (arr || []).forEach(w => {
            if (w.readType === 2) missed.push(w.word);
            else if (w.readType === 4) wrong.push(w.word);
        });
        scan(r.words);
        scan(r.sentences);
        if (wrong.length) summary.错读字 = wrong.join('');
        if (missed.length) summary.漏读字 = missed.join('');
        return summary;
    }

    function renderAssess(summary) {
        assessPlaceholder.classList.remove('error');
        assessPlaceholder.textContent = '✅ 讯飞语音评测完成：' + Object.entries(summary)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `${k} ${v}`).join(' · ');
    }

    // 解析大模型回复中的 评分 / 评语 / 标签
    function parseReciteResult(reply) {
        const text = String(reply);
        const scoreM = text.match(/评分[:：]\s*(\d{1,3})/);
        const commentM = text.match(/评语[:：]\s*(.+)/);
        const tagsM = text.match(/标签[:：]\s*(.+)/);
        const tags = tagsM
            ? tagsM[1].split(/[、,，;；]+/).map(t => t.trim()).filter(Boolean).slice(0, 5)
            : [];
        return {
            score: scoreM ? Math.min(100, parseInt(scoreM[1], 10)) : null,
            comment: commentM ? commentM[1].trim() : '',
            tags,
            raw: text
        };
    }

    function gradeLabelFor(score) {
        if (score >= 90) return '优秀';
        if (score >= 80) return '良好';
        if (score >= 60) return '合格';
        return '待提高';
    }

    function applyReciteResult(parsed) {
        if (parsed.score !== null) {
            scoreDisplay.textContent = parsed.score;
            gradeLabel.textContent = gradeLabelFor(parsed.score);
        } else {
            scoreDisplay.textContent = '--';
            gradeLabel.textContent = '未获得评分';
        }
        commentDisplay.textContent = parsed.comment || parsed.raw.slice(0, 60);
        const tagStyle = 'background: #d1c3b4; padding: 2px 16px; border-radius: 30px; font-size: 12px; font-family: \'Segoe UI\', \'PingFang SC\', sans-serif;';
        tagContainer.innerHTML = parsed.tags.map(t => `<span style="${tagStyle}">${escapeHtml(t)}</span>`).join('');
    }

    async function gradeRecitation() {
        if (isGradingRecite) return;
        const info = {
            title: reciteTitleInput.value.trim(),
            type: contentTypeSelect.value,
            content: reciteContentInput.value.trim(),
            req: reciteReviewReqInput.value.trim() || DEFAULT_REVIEW_DIMENSIONS,
            durationSec: lastRecordingSeconds
        };
        if (!info.title && !info.content) {
            alert('请至少填写朗诵标题（朗读内容可留空由 AI 自动匹配）');
            return;
        }
        if (!window.chineseAI) {
            alert('批改功能请在桌面版中运行（项目目录执行 npm start）');
            return;
        }
        isGradingRecite = true;
        gradeBtn.disabled = true;
        scoreDisplay.textContent = '…';
        gradeLabel.textContent = '批改中';
        tagContainer.innerHTML = '';

        // 第一步：讯飞语音评测（有音频 + 已配置 + 有参考文本时执行）
        let assessSummary = null;
        let assessNote = '';
        try {
            if (!recordedBlob) {
                assessNote = '本次未提供录音音频';
                assessPlaceholder.classList.remove('error');
                assessPlaceholder.textContent = '⏳ 未检测到录音：本次批改不含读音测评数据（讯飞评测已就绪，录音或上传音频后自动评测）';
            } else if (!info.content) {
                assessNote = '朗读内容为空（AI 自动匹配），无参考文本可评测';
                assessPlaceholder.classList.remove('error');
                assessPlaceholder.textContent = '⏳ 朗读内容为空（AI 将自动匹配），无法进行读音测评';
            } else if (!window.chineseAI.evaluateAudio) {
                assessNote = '当前应用版本不支持语音评测';
                assessPlaceholder.classList.remove('error');
                assessPlaceholder.textContent = '⏳ 当前应用版本不支持语音评测，本次批改不含读音测评数据';
            } else {
                commentDisplay.textContent = '⏳ 第一步：讯飞语音评测中…';
                assessPlaceholder.classList.remove('error');
                assessPlaceholder.textContent = '⏳ 正在进行讯飞语音评测（suntone）…';
                const audioBase64 = await blobToMp3Base64(recordedBlob);
                const result = await window.chineseAI.evaluateAudio({ audioBase64, refText: info.content });
                assessSummary = summarizeAssess(result);
                renderAssess(assessSummary);
            }
        } catch (e) {
            const msg = String(e.message || e);
            if (msg.includes('XF_NOT_CONFIGURED')) {
                assessNote = '讯飞语音评测未配置';
                assessPlaceholder.classList.add('error');
                assessPlaceholder.textContent = '❌ 讯飞语音评测未配置（右上角 ⚙️ API 设置中可配置），本次批改不含读音测评数据';
            } else {
                assessNote = '讯飞语音评测失败：' + msg;
                assessPlaceholder.classList.add('error');
                assessPlaceholder.textContent = '❌ 讯飞语音评测失败：' + msg + '（本次批改不含读音测评数据）';
            }
        }

        // 第二步：大模型综合批改
        commentDisplay.textContent = '⏳ 正在调用大模型批改朗读，请稍候…';
        try {
            const reply = await window.chineseAI.reviewEssay(buildReciteMessages(info, assessSummary, assessNote));
            applyReciteResult(parseReciteResult(reply));
        } catch (err) {
            const msg = String(err.message || err);
            if (msg.includes('API_KEY_NOT_SET') || msg.includes('CUSTOM_URL_NOT_SET')) {
                openApiSetup();
                commentDisplay.textContent = '📭 尚未完成 API 配置，请在弹出的设置窗口中完成。';
            } else {
                commentDisplay.textContent = '❌ 调用失败：' + msg;
            }
        } finally {
            isGradingRecite = false;
            gradeBtn.disabled = false;
        }
    }

    gradeBtn.addEventListener('click', gradeRecitation);
})();
