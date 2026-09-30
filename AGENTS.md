# Pigai 项目协作约定

## Git 工作流（重要）

### 仅当在 macOS 设备上参与本项目时（`uname` 为 Darwin）生效

- **默认禁止直接提交/推送到 `main` 分支。**
- 每次改动：从 `main` 最新代码切出功能分支，命名格式：

  ```
  featureMac/<当前版本号>/<简短描述>
  ```

  - 版本号取自 `package.json` 的 `version` 字段（如 `1.0.3`）
  - 描述用简短中文或英文，如：`featureMac/1.0.3/mac分架构打包`
- 在功能分支上提交并推送到 `origin`，不合并回 `main`（合并由仓库所有者手动处理）。
- 提交信息用中文，风格与现有历史一致（如 `修复：xxx`、`新增：xxx`）。

### 非 macOS 设备（如 Windows）

上述 `featureMac/...` 分支规则**不适用**，按常规方式操作（或按仓库所有者届时指示）。

## 环境

- macOS 打包：`npm run dist:mac:arm64`（Apple Silicon）、`npm run dist:mac:x64`（Intel），产物在 `release/`（已 gitignore）。
- GitHub 凭据已存入 macOS 钥匙串（osxkeychain），push/pull 无需手动认证。
