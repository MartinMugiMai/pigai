// ============================================================
// 讯飞语音评测（suntone）WebSocket 客户端
// 文档：https://www.xfyun.cn/doc/voiceservice/suntone/API.html
// - 鉴权：HMAC-SHA256 签名（host / date / request-line），参数拼在 URL
// - 音频：16k/8k 采样、单声道，lame(mp3)/speex 编码，base64 后 ≤10M
// - 分帧：header.status 0 首帧 / 1 继续 / 2 末帧；结果 base64 解码为 JSON
// - 朗读批改使用 lang=cn + core=para（段落模式，refText=朗读内容）
// ============================================================
const crypto = require('node:crypto');

const XF_HOST = 'cn-east-1.ws-api.xf-yun.com';
const XF_PATH = '/v1/private/s8e098720'; // 声通中文评测

function buildAuthUrl(apiKey, apiSecret) {
    const date = new Date().toUTCString(); // RFC1123
    const signatureOrigin = `host: ${XF_HOST}\ndate: ${date}\nGET ${XF_PATH} HTTP/1.1`;
    const signature = crypto.createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64');
    const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
    const authorization = Buffer.from(authorizationOrigin, 'utf8').toString('base64');
    return `wss://${XF_HOST}${XF_PATH}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(XF_HOST)}`;
}

/**
 * 对一段 MP3 音频执行中文朗读评测
 * @param {string} audioBase64 base64 编码的 MP3 音频（16k 单声道）
 * @param {object} opts { appId, apiKey, apiSecret, refText 朗读内容(参考文本) }
 * @returns {Promise<object>} 解码后的评测结果（含 result.overall/pronunciation/tone/fluency/integrity/rhythm/speed/words 等）
 */
function evaluate(audioBase64, { appId, apiKey, apiSecret, refText }) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(buildAuthUrl(apiKey, apiSecret));
        const timer = setTimeout(() => finish(reject, new Error('讯飞评测超时（30 秒无最终结果）')), 30000);
        let settled = false;
        let finalResult = null;

        function finish(fn, arg) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch { /* 忽略 */ }
            fn(arg);
        }

        ws.addEventListener('open', () => {
            // 整段音频按 32KB 分帧；单帧即最后帧时 status=2
            const bin = Buffer.from(audioBase64, 'base64');
            const chunks = [];
            for (let i = 0; i < bin.length; i += 32 * 1024) chunks.push(bin.subarray(i, i + 32 * 1024));
            if (chunks.length === 0) chunks.push(Buffer.alloc(0));

            chunks.forEach((chunk, i) => {
                const isLast = i === chunks.length - 1;
                const status = chunks.length === 1 ? 2 : (isLast ? 2 : (i === 0 ? 0 : 1));
                ws.send(JSON.stringify({
                    header: { app_id: appId, status },
                    parameter: {
                        st: {
                            lang: 'cn',
                            core: 'para',
                            refText: refText || '',
                            result: { encoding: 'utf8', compress: 'raw', format: 'json' }
                        }
                    },
                    payload: {
                        data: {
                            audio: chunk.toString('base64'),
                            encoding: 'lame',
                            sample_rate: 16000,
                            bit_depth: 16,
                            seq: i,
                            status,
                            frame_size: 0
                        }
                    }
                }));
            });
        });

        ws.addEventListener('message', ev => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            const header = msg.header || {};
            if (header.code !== 0) {
                finish(reject, new Error(`讯飞评测失败（${header.code}）：${header.message || '未知错误'}`));
                return;
            }
            if (msg.payload && msg.payload.result && msg.payload.result.text) {
                try {
                    finalResult = JSON.parse(Buffer.from(msg.payload.result.text, 'base64').toString('utf8'));
                } catch (e) {
                    finish(reject, new Error('评测结果解析失败：' + e.message));
                    return;
                }
            }
            if (header.status === 2 || (finalResult && finalResult.eof === 1)) {
                finish(resolve, finalResult || {});
            }
        });

        ws.addEventListener('error', ev => {
            finish(reject, new Error('讯飞连接失败：' + (ev.message || ev.error || '未知错误')));
        });
        ws.addEventListener('close', () => {
            if (!settled) finish(reject, new Error('讯飞连接在评测完成前关闭'));
        });
    });
}

module.exports = { evaluate };
