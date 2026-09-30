# Pigai · 语文学习 AI 助手

（Chinese Learning AI Assistant）作文批改（GLM 大模型）+ 古诗背诵默写，支持 **Windows 与 macOS（最低 macOS 12 Monterey）** 的 Electron 桌面应用；页面部分为纯静态 HTML/CSS/JS，也可在浏览器中预览。

## 项目结构

```
pigai/
├── index.html            页面入口（选项卡切换：作文批改 / 朗诵默写）
├── css/style.css         样式（卷轴主题 + 选项卡）
├── js/main.js            渲染层脚本（表单、选项卡、默写逻辑、IPC 调用）
├── electron/main.js      Electron 主进程（窗口、麦克风权限、GLM IPC 代理）
├── electron/preload.js   预加载脚本（contextBridge 暴露受控调用入口）
├── package.json          Electron 43（钉死主版本，保 macOS 12 兼容）+ 打包配置
├── key.txt.example       Key 文件模板（复制为 key.txt 并填入自己的 Key，key.txt 已 gitignore）
├── 作文范例1/2.txt        测试数据（配合上传按钮使用）
└── README.md
```

## 运行（Electron 桌面版）

前提：安装 [Node.js LTS](https://nodejs.org/)（任一 LTS 版本均可）。

```bash
npm install     # 首次安装依赖（含 Electron 43）
npm start       # 启动桌面应用
```

## 打包安装程序

```bash
npm run dist        # 同时构建 Windows + macOS
npm run dist:win    # 仅 Windows（NSIS 安装包）
npm run dist:mac    # 仅 macOS（dmg）
```

产物输出到 `release/` 目录。注意：macOS 的 dmg 需要在 macOS 上构建，Windows 安装包可在任一平台交叉构建；推荐用 GitHub Actions 等 CI 分平台出包。未签名时 macOS 首次打开需右键 → 打开。

## 配置 API Key（首次使用必读）

本程序**不内置任何 API Key**，采用"用户自带 Key"模式。首次运行（或点右上角 **⚙️ API 设置**）会弹出配置窗口：

1. **API 类型**：默认 `GLM 官方 · glm-5.3-flash`（智谱开放平台）；也可选 `自定义接口`，额外填写 OpenAI 兼容的 API 链接与可选模型名；
2. **API Key**：直接粘贴，或点 **📥 导入 key.txt** 自动识别（把 `key.txt.example` 复制为 `key.txt` 填入自己的 Key 也可以）；
3. 保存后配置写入系统用户数据目录（Windows 为 `%APPDATA%\pigai\config.json`），**不在项目目录、不进 git 仓库**。

> 从本项目旧版本（Key 写死在代码里）升级的用户：请在智谱控制台轮换新 Key，并改用上述方式配置。

## 关键设计

- **GLM 接口在主进程**：API Key 与网络请求全部位于 `electron/main.js`（`net.fetch`，无 CORS 限制），渲染层通过 preload 暴露的 `window.chineseAI.reviewEssay()` 走 IPC 调用，`js/main.js` 中不含任何密钥。当前模型为免费档 `glm-5.3-flash`（推理模型，生成需数秒到数十秒）。
- **Electron 版本钉死在 43**：Electron 44 起要求 macOS 13+，钉在 43 主线（`^43.0.0`）以兼容最低 macOS 12 Monterey。将来放弃 macOS 12 时，升级 `package.json` 中版本号即可，页面代码无需改动。
- **麦克风**：主进程通过 `setPermissionRequestHandler` 放行 `media` 权限；macOS 打包已在 Info.plist 声明 `NSMicrophoneUsageDescription`（见 `package.json` 的 `build.mac.extendInfo`）。Windows 开箱即用。

## 浏览器预览模式

直接双击 `index.html` 或用本地服务器打开均可浏览页面，选项卡切换、默写回显等功能正常；**作文批改需要 Electron 环境**（无 `window.chineseAI` 时点击生成会给出明确提示）。

## 安全提醒

- 仓库中**不包含任何 API Key**：Key 保存在各用户自己的系统用户数据目录（`config.json`），`key.txt` 与打包产物 `release/` 均已 gitignore。
- 打包分发（`npm run dist`）不会把你的 Key 带进安装包；每个安装者使用自己的 Key。
- 请勿把 `key.txt`、`config.json` 或手工打包目录提交/上传到任何公开位置。
