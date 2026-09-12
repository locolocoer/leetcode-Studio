# 逐步调试(Java/C/C++)多轮开发状态

## 最新进展：变量显示对齐主流 IDE（本次）
- **结论：内置 gdb（w64devkit）未编译 Python 支持**，`source *.py` / `python` 命令都会报
  "Python scripting is not supported in this copy of GDB"，所以 **pretty-printer 路线不可用**
  （之前 bootstrap 里 `source lc_printers.py` 还会因 `^error` 白等 9s 超时，已删除该机制）。
- 现方案（nativeDebug.ts）：
  1. `-stack-list-variables --all-values` 拿名字和原始值；
  2. 值形如裸地址 `0x...` → `-var-create` 拿类型/numchild，再用 `-data-evaluate-expression "*(expr)"`
     逐节点展开：`val`+`next` → `ListNode[4, 1, 8, 4, 5]`；`val`+`left`+`right` → 层序 `TreeNode[...]`；
     其他结构体 → `Type{field=value, ...}`（深度 1，带访问去重）。var 对象用完 `-var-delete`。
  3. 值含 `std::` / `_M_` / `{<` → C++ 调试辅助 `lc_show(x)`（debugger.ts CPP_DEBUG_HELPER，注入
     `lc_dbg.hpp` 并在 main.cpp 首行 `#include "lc_dbg.hpp"`）把 vector/map/set/string 渲染成
     `[2, 7, 11, 15]` / `{2: 0}` / `"abc"`，返回 `const char*` 便于 gdb 直接显示。
- Java：`LcDbg.java`（debugger.ts JAVA_DEBUG_HELPER，反射渲染）随调试版一起编译；Main.java 注入
  `try { Class.forName("LcDbg"); } catch (...) {}`（**jdb 的表达式求值只能引用已加载的类**，
  否则报 `Name unknown: LcDbg.show`）；locals 里非原始类型的值用
  `print "a=" + LcDbg.show(a) + " | " + ...` 一次性取回。
- Python：调试驱动内联 `fmt_value`（链表/树/对象/dict/list）—— 与 gdb/jdb 显示一致。
- 验证脚本：`scripts/locals-test.ts`（160 相交链表，cpp/java/python）、`scripts/locals-test2.ts`
  （104 二叉树 + 1 两数之和 + 206 反转链表）。
- **顺带修掉的真 bug**：Python harness 之前把 TreeNode/ListNode 参数当普通 list 直接传入，
  树/链表题在 Python 下必然报 `'list' object has no attribute 'left'`，返回值也不会序列化。
  现在 harness.ts 的 `PY_NODES` 提供 ListNode/TreeNode 构造 + `_lc_load/_lc_dump`，
  `pyShapes(problem)`/`isNodeReturn(problem)` 决定参数构造与 `null → []`；
  调试驱动用 `LC_SHAPES` / `LC_RET_NODE` 环境变量走同一套。验证：`scripts/py-nodes-run.ts`
  （104/94/206/21/1，python+java+cpp 全过）。

目标：Java/C/C++ 逐步调试（断点/单步/步过/继续/变量），统一现有 Python 调试协议与 UI。
用户已确认逐轮推进直到三个都完成；每轮真机验证后重新打包。

## 已验证的事实（勿重复实验）
- w64devkit 自带 gdb.exe（内置 toolchains/w64/w64devkit/bin），C/C++ 走 gdb。
- gdb 对 `#include "solution.c/cpp"` 进来的用户代码，按**原始文件** solution.c/cpp 报告行号
  （实测 break twoSum → solution.c:3；行号=编辑器行号，无需偏移换算）。=> 断点直接用用户行号，文件用 solution.c/solution.cpp。
- 内置 JDK 已用 jlink 加 jdk.jdi + jdk.jdwp.agent 重建，bin 下有 jdb.exe（17.0.2）。
- C/C++/Java 编译运行 harness 均已内置工具链实测通过（two-sum/MinStack）。
- Java jdb 的 stdin 问题：jdb 下程序无法可靠读 stdin 用例 => 调试版 Main.java 需把
  `new String(System.in.readAllBytes())` 替换为读 input.txt：
  `new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("input.txt")))` 再编译。
- Python 调试协议（已可用）：@@DBG/@@OUT 行协议 + 命令 step/over/continue/stop/break N；DebugSession 统一封装。

## 实现计划/进度
- [x] 工具链准备；[x] 第1/2轮 C/C++ gdb 后端 真机验证通过并已打包（172MB，9/9 23:35 版本含 gdb 调试）
- [x] 第3轮 Java jdb 后端：实现了 suspend=y JVM + jdb socket attach（jdb -connect com.sun.jdi.SocketAttach）；
      透传证实 **jdb 能命中断点**：Main.main 行201 → Solution.twoSum 行5（bp5）。
- [ ] **Java 卡点（下轮优先）**：jdb 提示符为“main[1] > ”且会与响应同内联行（非纯提示符行），
      目前 sendCmd 的“按行+纯提示符”判定时序不稳 → 多次出现状态 starting/finished 抖动。
      下一步建议（更稳的协议）：
      1) 控制命令（cont/step/next）改用 gdb 式 waitFor——按“出现新的 Breakpoint hit/Step completed/exited 行”判定结束，
         不再依赖提示符；命令按序发送（发送前先等纯提示符行，避免内联粘连）。
      2) locals：capture 模式——发送 locals 后收集到“下一行以 > / main[n] > 开头”为止，解析 name = value。
      3) 设置断点类命令 fire-and-forget + 小延时即可。
      4) 若仍不稳：完全改用 raw 文本流扫描（忽略行分隔），按“> ”token 分段。
- [ ] Java 验证通过（two-sum 断点/单步/变量）后打包；再补 UI 文案收尾（Debug 空态已更新为 C/C++gdb/Java 接入中）。

## 关键事实
- 内置 w64devkit 有 gdb.exe；内置 jdk17（jlink 已含 jdk.jdi/jdk.jdwp.agent）有 jdb.exe、java 支持 socket agent。
- jdb `-attach` 走共享内存（对 socket 目标失败）；socket 需 `-connect com.sun.jdi.SocketAttach:hostname=127.0.0.1,port=NN`。
- suspend=y 时 VM 先于 main 挂起（“当前调用栈没有帧”），cont 后先命中 `stop in Main.main`。
- 测试命令：见前（tsc 显式文件 --outDir .tmp-t；node .tmp-t/scripts/native-test.js）。
- 调试透传：gdb 加 $env:LC_GDB_DEBUG=1；jdb 加 $env:LC_JDB_DEBUG=1（nativeDebug feed 内 console.error）。

## gdb 交互要点（MI 模式）
- 启动：`gdb -q -i=mi3 ./main.exe`，cwd=会话目录，PATH 前插 w64 bin（gdb 需自身 dll）。
- 断点：`-break-insert -f solution.cpp:LINE`（等 ^done,bkpt=）。
- 无断点入口：`-break-insert <methodName>`（函数型=方法名；类型=构造函数或第一个方法名），等 ^done。
- 运行并注入用例：`-interpreter-exec console "run < input.txt"`。
- 单步/步过/继续：`-exec-step` / `-exec-next` / `-exec-continue`。
- 停在驱动代码(main)时：若是 stepping 且不在用户文件 → 自动 -exec-continue 跳过（限次）。
- 变量：`-stack-list-variables --frame 0 --all-values` → `^done,variables=[{name="x",value=".."}...]`。
- 事件行：`*stopped,reason="breakpoint-hit|end-stepping-range|exited-normally",frame={...file line func}`。
- 停止/结束：kill 子进程即可。

## Java jdb 交互要点
- 编译加 `-g`；spawn `jdb -classpath <dir> Main`，等 `> ` 提示。
- 断点：`stop at <类名>:LINE`（用户行号）；入口（无断点）：`stop in <类名>.<方法名>`。
- 运行：`run`（已把 Main 改成读 input.txt，stdin 留给命令）。
- step/next/cont；locals 输出 `名 = 值`。
- 停止行格式：`Breakpoint hit: "thread=main", 类.方法(), line=N bci=..` / `Step completed: ...`。
- 停在 Main.java（驱动）时若为步进 → 自动 cont/继续进入用户类。

## 测试方式（每轮）
scripts/native-test.ts：直接 new DebugSession + 手动 toolchain（内置路径），对 two-sum 用样例
输入跑 断点→单步→变量 断言（打印事件即可人工判读），通过后再 electron build + package:win。
