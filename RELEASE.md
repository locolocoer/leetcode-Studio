# LeetCode Studio 1.0.0 发布说明

本地 LeetCode 刷题桌面应用：多语言编译运行、逐步调试、查看题解、账号登录与一键提交。
所有编译器与运行时已内置于安装包，**无需另外安装 Python / JDK / GCC**。

- 版本：1.0.0
- 平台：Windows 10 / 11（x64）
- 构建时间：2026-09-12

## 发布产物

| 文件 | 大小 | SHA256 |
| --- | --- | --- |
| `LeetCode Studio-1.0.0-setup.exe` | 172.3 MB | `C0AF356EE534C9D0F1C18EE239DFE63C74F97D52A091856203FF7364FF810DE6` |
| `LeetCode Studio-1.0.0-portable.exe` | 172.1 MB | `87E1BB451E97BF66D0CC48D0BB5FA34AB462E21FBBBFCF61372BE19A2F3861BC` |

- **安装版（推荐）**：双击安装，可自选安装目录，自动创建桌面快捷方式，启动快。
- **便携版**：免安装，双击即用；首次启动需要把内置工具链解压到临时目录（约 1 分钟，之后每次启动同样需要解压），适合试用或放在 U 盘里。

数据目录：`%APPDATA%\leetcode-studio`（题库、设置、登录 Cookie、运行/调试临时文件都在这里，卸载不会自动删除）。

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
- **变量显示对齐主流 IDE**：链表显示为 `ListNode[4, 1, 8, 4, 5]`，二叉树显示层序 `TreeNode[3, 9, 20, null, null, 15, 7]`，C++ 容器显示为 `[2, 7, 11, 15]` / `{2: 0}`，对象展开字段而不是内存地址

**题解**
- 顶部「📖 题解」打开：左侧题解列表（默认排序 / 最高赞、分页加载），右侧 Markdown 正文
- 支持代码块一键复制、图片、表格、列表、行内公式（LaTeX 近似渲染）
- 正文链接用系统浏览器打开

**代码补全**
- 打字即出补全（Monaco 对 Python / Java / C / C++ 只带语法高亮，补全由本应用实现）
- 关键字 / 内置函数 / 常用类型与标准库：Python 的 `collections`、`heapq`、`bisect`、`lru_cache`，C++ 的 STL，Java 的集合与 `Math`，C 的 `malloc` / `qsort` 等
- 常用片段：for 循环、BFS/DFS、并查集、建 map/vector/优先队列、排序、`qsort` 比较函数……
- **成员补全**：输入 `nums.` 自动按类型列出可用方法（Python 列表/字典/字符串、C++ `vector`/`map`/`set`、Java `List`/`Map`/`Set`/`StringBuilder` 等），`p->` 自动列出 `ListNode`/`TreeNode` 的字段；类型来自题目参数与代码中的声明，做轻量推断
- **题目感知**：本次题目的参数名（带真实类型）、完整方法签名、`ListNode`/`TreeNode` 字段都可补全
- **签名提示**：写 `方法名(` 时显示参数列表并高亮当前参数；悬停参数/结构体可看类型说明

**账号与提交**
- 内置登录窗口（或粘贴 Cookie 导入会话），支持 leetcode.cn / leetcode.com
- 一键提交当前代码并显示评测结果（通过数、耗时、内存、失败用例）

## 界面

- 无边框窗口：自绘最小化 / 最大化 / 关闭按钮，去掉系统标题栏与 File/Edit/View 菜单栏
- 顶栏分三组：语言切换（带工具链状态点）/ 题面语言与题解 / 账号与提交
- 编辑器与下方面板之间可拖动调整高度；底部标签带实时状态徽标（通过数、暂停行号）
- 深色主题，统一的间距、圆角与按钮层级

## 已知限制

- C 语言不支持 class / 设计类题目
- C/C++ 的「单步」是真正的 step-into：遇到 `std::unordered_map::operator[]` 这类标准库调用会进入库内部（可用「步过」跳过）
- 内置 gdb 未编译 Python 支持，因此不使用标准库 pretty-printer，容器显示由应用自身实现（已覆盖 vector / map / set / string 等常用类型）
- 题解接口仅 leetcode.cn 提供，题解固定取自中文站（与题面语言设置无关）
- 打包未做代码签名，Windows SmartScreen 可能提示「未知发布者」，选择「仍要运行」即可

## 从源码构建

```bash
npm install
npm run build         # 编译 main / preload / renderer
npm run package:win   # 产出 release/*.exe（安装版 + 便携版）
npm run typecheck     # 主进程 + 渲染进程类型检查
```

调试脚本（`scripts/`）：`locals-test.ts`（调试变量显示）、`p160-test.ts`（相交链表运行）、`py-nodes-run.ts`（Python 链表/树题型）、`solutions-test.ts`（题解接口 + Markdown 渲染）。
