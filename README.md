# LeetCode Studio

一个本地运行的 **LeetCode 刷题与多语言调试** 桌面应用（Electron + React + TypeScript）。

内置题面编辑器、Monaco 代码编辑器、**测试用例运行器** 与 **Python 逐步调试**，支持 Java / C / C++ / Python 四语言的本地编译与运行。

---

## ✨ 功能特性

| 功能 | 说明 |
| --- | --- |
| 📥 在线拉题 | 从 LeetCode 官方接口拉取题目列表与题面、函数签名、各语言 starter 代码 |
| 📝 本地题面 | 描述、标签、难度、可编辑的测试用例；支持新增本地题、剪贴板导入 JSON |
| ⚙️ 内置工具链 | 自动检测系统工具链，可在设置中手动指定路径 |
| ▶️ 本地运行器 | 依据 LeetCode 的函数/类签名自动生成包装代码，编译并逐组运行测试用例，校验期望输出 |
| 🐞 逐步调试 | Python 原生支持断点、单步、步过、继续、变量查看（基于 `sys.settrace`） |
| 🎨 现代 UI | 深色主题、Monaco 编辑器、分栏布局、难度/标签徽章 |

## 🧰 支持语言与类型

- **Python**（`python`/`python3`）
- **Java**（`javac` + `java`）
- **C++**（`g++`，需 `-std=c++17`）
- **C**（`gcc`）

自动生成的包装代码支持常见数据类型：`integer`、`double`、`boolean`、`string`、
`integer[]`、`string[]`、`integer[][]`、`ListNode`、`TreeNode`，以及**函数型**与**类（构造+多方法）型**两类题目。

> C 语言仅支持函数型题目（class 型题目因无类语义暂不支持）。

## 🛠 环境要求

| 工具链 | 状态 | 说明 |
| --- | --- | --- |
| Node.js ≥ 20 | 必需 | 构建/运行 Electron |
| Python ≥ 3 | 必需 | Python 运行与逐步调试 |
| JDK | 建议 | 运行 Java；若不在 PATH，需在「设置→自定义工具链路径」填入 `javac` 所在目录 |
| gcc / g++ | 建议 | 运行 C/C++；不在 PATH 时需在设置里填入编译器路径 |

**设置路径说明**：在「设置」页的“自定义工具链路径”中，为对应语言填入可执行文件路径（例如
`C:\...\jdk-17\bin\javac.exe` 或指向包含 `javac.exe`/`java.exe` 的目录，以及 `gcc.exe` / `g++.exe`）。

## 🚀 快速开始

```bash
npm install
npm run toolchains   # 首次：准备内置工具链（约 400MB，可跳过改用系统工具链）
npm run dev          # 启动开发模式（会打开应用窗口）
npm run build        # 构建到 out/
```

### 打包安装包

```bash
npm run package:win   # Windows NSIS 安装包 → release/
npm run package:mac   # macOS dmg
npm run package:linux # Linux AppImage
```

## 📁 项目结构

```
src/
  main/            Electron 主进程
    index.ts       窗口、IPC、例子数据
    toolchain.ts   工具链自动检测/配置
    runner.ts      编译 + 运行 + 用例对比
    harness.ts     生成各语言包装代码（核心）
    fetcher.ts     LeetCode 在线拉题
    debugger.ts    Python 逐步调试（settrace）
    store.ts       本地题目/设置持久化
    types.ts       题目签名类型模型
  preload/         contextBridge API
  renderer/        React UI（侧边栏/题面/Monaco/运行/调试/设置/拉题）
  shared/types.ts  主进程与渲染进程共享类型
```

## ⚠️ 当前边界

- **C/C++ 逐步调试**：走内置 gdb（MI 协议），断点/单步/步过/变量可用；「单步」是真正的 step-into，遇到 STL 内部调用会进入库代码（可用「步过」跳过）。
- **Java 逐步调试**：走内置 jdb（socket attach），需要 JDK 带 `jdb`（内置 jlink 运行时已包含 `jdb` / `jdk.jdi` / `jdk.jdwp.agent`）。
- **C++ 容器显示**：内置 gdb 未编译 Python，无法使用标准库 pretty-printer，容器/链表/树的展开由应用自身实现。
- **在线拉题 / 题解**：依赖网络与 LeetCode 接口稳定性；题解只从 leetcode.cn 取（该接口仅中文站提供）。
- **体积**：Monaco + Electron + 内置工具链，安装包约 172MB（工具链占绝大部分）。

## 🚀 发布与自动更新

发布流程与 [audioPlayer](https://github.com/locolocoer/audioPlayer) 一致：**打 tag → GitHub Actions 自动打包 → 创建 Release → 客户端自动更新**。

### 本地发版

```bash
node scripts/bump-version.mjs 1.0.1     # 同步 package.json / lock / README 版本号
# 更新 RELEASE.md 的更新说明
git commit -am "release: v1.0.1"
git tag v1.0.1 && git push origin main --tags
```

推 tag 后 [`.github/workflows/main.yml`](.github/workflows/main.yml) 会：

1. `test`：`npm ci` + 类型检查 + 构建（push main / PR 时都跑）
2. `build`（windows-latest）：准备内置工具链 → 构建 → `electron-builder --win` 产出安装包与 `latest.yml` → 上传 artifact
3. `release`（仅 tag）：下载产物 → 创建 GitHub Release（自动生成 release notes）→ 若配置了 OSS 密钥则同步到阿里云 OSS

### 内置工具链（不入库，约 400MB）

```bash
npm run toolchains            # 按固定版本下载/裁剪；已存在则跳过，--force 重新下载
```

| 组件 | 版本 | 来源 |
| --- | --- | --- |
| Python | 3.11.9 embeddable | python.org |
| GCC / G++ / GDB | w64devkit v2.0.0（GCC 14.2.0 + GDB 15.1） | skeeto/w64devkit |
| Java | Temurin 17.0.2 → jlink 裁剪（含 `jdb`/`jdk.jdi`/`jdk.jdwp.agent`） | Adoptium |

### 自动更新

- 客户端用 `electron-updater`：启动 8 秒后自动检查，**自动后台下载**，退出时自动安装；设置页「关于与更新」可手动检查与「重启并安装」，主界面在下载完成时弹出提示条。
- 更新源**优先阿里云 OSS**（`https://leetcode-studio.oss-cn-beijing.aliyuncs.com/`），失败自动回退 GitHub Release；未配置 OSS 时直接用 GitHub。
- 启用 OSS：仓库 `Settings → Secrets` 添加 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`（可选变量 `OSS_BUCKET`，默认 `leetcode-studio`），workflow 的 OSS 步骤会自动启用。

## 📄 License

MIT
