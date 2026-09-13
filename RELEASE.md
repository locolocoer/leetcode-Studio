# LeetCode Studio 1.1.12 发布说明

本地 LeetCode 刷题桌面应用：多语言编译运行、逐步调试、查看题解、AI 引导、账号登录与一键提交。
所有编译器与运行时已内置于安装包，**无需另外安装 Python / JDK / GCC**。

- 版本：1.1.12
- 平台：Windows 10 / 11（x64）
- 仓库：<https://github.com/locolocoer/leetcode-Studio>
- 下载：<https://github.com/locolocoer/leetcode-Studio/releases>

## 本版更新（1.1.12）

**修复「拉取题目」列表一直是英文、不跟题面语言**

- 原因：那个列表以前固定请求 `leetcode.com/api/problems/all/`，拿到的永远是英文标题，跟顶栏的中文/English 切换无关。
- 现在按题面语言取：
  - **中文** → leetcode.cn 的 `problemsetQuestionList`，用 **`titleCn`** 字段：4443 题里 4437 题有中文名（从「两数之和」开始按题号排）。
  - **English** → leetcode.com 的全量列表（4055 题），同样按题号排序。
- 中文索引一次要拉 40 多页，**第一次约 5 秒**，之后缓存到本地（`problem-index-zh.json`，7 天有效），再打开就是毫秒级；弹窗标题会显示当前语言与题目总数。
- 搜索同时匹配**中英文标题、slug、题号**（中文界面下搜 "Two Sum" 也能找到「两数之和」）。
- 顺带修掉另一种「不跟随」：以前把语言从 English 切回中文时，**已经拉取过的题目**题面还是英文。现在打开题目时会比对已存题面的语言，不一致就自动按当前语言重拉（保留你写的代码与自定义用例）。

### 1.1.11

- 题解里同一段代码的多语言版本合并成 tab 切换（默认选中你当前用的语言）。

### 1.1.10

- 题解显示作者头像与昵称；代码块语法高亮。

### 1.1.9

- 判题模板可以自己看、自己改（运行面板「🧩 查看/编辑模板」）。

### 1.1.8

- 判题模板可由 AI 生成：确定性模板不适配时自动兜底，通过本题全部用例才采用并缓存。

### 1.1.7

- 修复「最近公共祖先」这类题的编译错误（`int → TreeNode*`）：按值引用的节点参数现在会先建树、再按值找到节点传指针，返回节点时按节点值比较；三语言都支持。

### 1.1.6

- 变量面板支持**点击展开**的变量树：容器元素、嵌套容器（`vector<vector<int>>`）、对象字段都能一层层点开，单步时自动刷新值。

### 1.1.5

- 修掉「点步过卡住」的真凶：容器显示不再在被调试程序里调用函数（改用只读内存），不再注入调试辅助头文件；命令无响应会立即结束会话并提示。

### 1.1.4

- gdb 命令改为「先注册等待再发送」；错误事件反映到界面；步进加时间预算。

### 1.1.3

- 修复调试时的 `ld.exe: cannot open output file main.exe: Permission denied`：结束调试改为结束整棵进程树，编译遇占用自动清理并重试。

### 1.1.2 / 1.1.1 / 1.1.0

- 1.1.2：调试面板去掉「执行轨迹」列表与高亮行说明。
- 1.1.1：品牌应用图标（桌面/任务栏/安装包）。
- 1.1.0：AI 做题助手（分级提示 + 纠错，绝不直接给答案）。

## 发布产物

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `LeetCode-Studio-1.1.12-setup.exe` | ≈172 MB | 安装版（推荐）：可自选目录、创建快捷方式、支持自动更新 |
| `LeetCode-Studio-1.1.12-portable.exe` | ≈172 MB | 免安装便携版：双击即用（首次启动需解压内置工具链到临时目录，约 1 分钟） |
| `latest.yml` | — | 自动更新元数据（electron-builder 生成，随 Release 发布，含安装包 sha512） |

> 文件名不带空格，确保自动更新的 `latest.yml` 与实际文件名一致。
> 校验值以 Release 上 `latest.yml` 里的 `sha512` 为准（本机与 CI 构建产物哈希不同）。

数据目录：`%APPDATA%\leetcode-studio`（题库、设置、登录 Cookie、运行/调试临时文件；卸载不会自动删除）。

## 功能一览

**刷题**
- 按题号/标题搜索导入单题；拉取「每日一题」；拉取 LeetCode 题单（热题 100 / 200 等）
- 题面语言中英切换（中文走 leetcode.cn 翻译题面，English 走 leetcode.com）
- 题面、示例、测试用例可编辑；用例支持折叠与「全部展开」
- 内置几道示例题，装完即可直接跑

**运行**
- Python 3.11 / Java 17 / C++ (GCC 14.2) / C (GCC 14.2)，内置工具链随包分发
- 逐组用例比对期望输出，显示期望值/实际值差异；编译错误完整回显
- 自动处理 LeetCode 的链表/二叉树/相交链表等特殊输入格式

**逐步调试**
- 断点（行号或 F9）、单步、步过、继续、停止
- Python 原生跟踪、C/C++ 走 gdb、Java 走 jdb，均为内置工具链
- **变量显示对齐主流 IDE**：链表 `ListNode[4, 1, 8, 4, 5]`、二叉树层序 `TreeNode[3, 9, 20, null, null, 15, 7]`、C++ 容器 `[2, 7, 11, 15]` / `{2: 0}`、对象展开字段而不是内存地址

**代码补全**
- 打字即出补全（Monaco 对 Python / Java / C / C++ 只带语法高亮，补全由本应用实现）
- 关键字 / 内置函数 / 常用类型与标准库、常用片段（for、BFS/DFS、并查集、建表建堆、qsort 比较函数…）
- **成员补全**：`nums.` 按类型列出方法（Python 列表/字典/字符串、C++ `vector`/`map`/`set`、Java `List`/`Map`/`Set`/`StringBuilder`），`p->` 列出 `ListNode`/`TreeNode` 字段
- **题目感知**：本题参数名（带真实类型）、完整方法签名、`ListNode`/`TreeNode` 字段
- **签名提示**与**悬停说明**：参数类型、结构体字段

**题解**
- 顶部「📖 题解」：左侧题解列表（默认排序 / 最高赞、分页加载），右侧 Markdown 正文
- 代码块一键复制、图片、表格、列表、行内公式（LaTeX 近似渲染）；正文链接用系统浏览器打开

**账号与提交**
- 内置登录窗口（或粘贴 Cookie 导入会话），支持 leetcode.cn / leetcode.com
- 一键提交当前代码并显示评测结果（通过数、耗时、内存、失败用例）

**界面**
- 无边框窗口：自绘最小化 / 最大化 / 关闭，去掉系统标题栏与 File/Edit/View 菜单栏
- 顶栏分三组：语言切换（带工具链状态点）/ 题面语言与题解 / 账号与提交
- 编辑器与下方面板之间可拖动调整高度；底部标签带实时状态徽标
- 设置页「关于与更新」可查看版本、手动检查更新

## 自动更新

- 基于 `electron-updater`：启动 8 秒后自动检查更新，**自动后台下载**，退出时自动安装；下载完成时主界面弹出提示条，可「重启并安装」。
- 更新源优先**阿里云 OSS**（`https://leetcode.oss-cn-beijing.aliyuncs.com/`），失败自动回退 **GitHub Release**。
- 启用 OSS：仓库 `Settings → Secrets and variables → Actions` 添加 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`（可选变量 `OSS_BUCKET`，默认 `leetcode`；`OSS_ENDPOINT` 默认 `oss-cn-beijing.aliyuncs.com`）。未配置时直接用 GitHub，功能不受影响。

## 发布流程

与 [audioPlayer](https://github.com/locolocoer/audioPlayer) 一致：

```bash
node scripts/bump-version.mjs 1.0.1     # 同步版本号
# 更新本文件（RELEASE.md）的更新说明
git commit -am "release: v1.0.1"
git tag v1.0.1 && git push origin main --tags
```

GitHub Actions（`.github/workflows/main.yml`）：

1. **Test**（ubuntu）：`npm ci` + 类型检查 + 构建 — push main / PR 时运行
2. **Build windows installer**（windows-latest）：下载/裁剪内置工具链（带缓存）→ 构建 → `electron-builder --win` → 上传安装包 + `latest.yml`
3. **Release**（仅 tag）：下载产物 → 创建 GitHub Release（自动生成 release notes）→ 有 OSS 密钥时同步到阿里云 OSS（`latest*.yml` 保留在根目录作为稳定的更新指针，其余按 `v<版本>/` 归档）

## 已知限制

- C 语言不支持 class / 设计类题目
- C/C++ 的「单步」是真正的 step-into：遇到 `std::unordered_map::operator[]` 这类标准库调用会进入库内部（可用「步过」跳过）
- 内置 gdb 未编译 Python 支持，不使用标准库 pretty-printer，容器显示由应用自身实现
- 题解接口仅 leetcode.cn 提供，题解固定取自中文站（与题面语言设置无关）
- 安装包未做代码签名，Windows SmartScreen 可能提示「未知发布者」，选择「仍要运行」即可

## 从源码构建

```bash
npm install
npm run toolchains    # 首次：准备内置工具链（约 400MB，可跳过改用系统工具链）
npm run build
npm run package:win   # → release/（安装版 + 便携版 + latest.yml）
npm run typecheck     # 主进程 + 渲染进程类型检查
```
