# cssgraph Spec

## Problem

| # | 问题 | 影响面 |
|---|------|--------|
| P1 | AI coding agent（opencode、Claude Code、Cursor 等）在回答 CSS 相关问题时，只能通过 grep/Read 逐文件搜索 className，无法像 codegraph 查询代码符号一样快速定位样式来源 | Agent 答复 CSS 问题耗时 5-10 倍于代码问题，需要多轮 Read/Grep 才能拼出完整样式链 |
| P2 | 现有工具（PurgeCSS、analyze-css 等）只做单向分析，没有构建 className → selector → property → value 的**双向关系图谱**，无法回答"哪些文件/选择器影响了 .btn-primary 的 background-color" | 前端改一个样式需要人工排查所有来源，CSS 层叠（cascade）和优先级问题难以排查 |
| P3 | CSS 变体（SCSS/Less/Tailwind/CSS Modules）的嵌套、变量、mixin 和哈希映射让 className 溯源变得困难，现有 codegraph 完全不索引 CSS 选择器 | 全栈项目中的样式依赖关系对 Agent 完全不可见，Agent 只能猜测样式影响范围 |
| P4 | MCP 生态中没有 CSS intelligence 工具，Agent 面对样式问题时只能退回低效的 grep → Read 循环 | 前端样式调试/重构/审查场景的全链路 Agent 体验存在空白，Agent 无法回答"改了这个 className 会影响哪些页面" |

## Related Spec

无

## Solution

### Part 1 — 核心索引引擎（CSS Extraction + SQLite Graph）

| # | Requirement | Mockup & Description |
|---|-------------|----------------------|
| R1 | 支持 CSS / SCSS / Less 三种格式的样式文件解析 | 使用 PostCSS + postcss-scss / postcss-less 插件解析样式文件 AST<br/>复用 codegraph 的 `ExtractionOrchestrator` 分层设计：扫描 → 解析 → 存储 |
| R2 | 提取 className selector 作为节点（Node），存储其所在文件、行号、选择器字符串、完整属性列表 | NodeKind: `class_selector`<br/>节点字段: name(className), filePath, startLine, selector(完整选择器字符串), properties(JSON 数组存 property:value 对) |
| R3 | 提取 CSS 属性声明作为独立节点，建立 className → property 的 contains 边 | NodeKind: `css_property`<br/>每条 `property: value` 是一个节点，通过 `contains` 边关联到所属 className |
| R4 | 处理 SCSS/Less 嵌套语法：还原完整选择器路径 | 对 `.parent { .child { color: red } }` 自动展开为 `.parent .child`，正确记录嵌套级联关系<br/>Edge: `nests` 表示父子选择器关系 |
| R5 | 处理 CSS at-rules（@media、@keyframes、@supports、@layer）作为节点 | NodeKind: `at_rule`<br/>at-rule 内的 className 通过 `contains` 边关联到 at-rule 节点<br/>使 Agent 可以查询"这个 className 在哪些媒体查询下被重写" |
| R6 | 提取 CSS 自定义属性（CSS Variables / `--custom-property`），支持变量引用关系 | NodeKind: `css_variable`<br/>Edge: `references` 表示 `var(--my-var)` 引用<br/>使 Agent 能追踪设计令牌（design tokens）的引用链 |
| R7 | CSS 文件本身作为 `file` 节点，记录文件语言（css/scss/less）、修改时间 | 与 codegraph 的 files 表设计一致，存储 content_hash 用于增量同步检测 |

### Part 2 — CSS 特异性与层叠关系

| # | Requirement | Mockup & Description |
|---|-------------|----------------------|
| R8 | 计算每个 className selector 的 CSS 特异性（specificity: a, b, c），存储为节点字段 | 四个元组 (inline, id, class, element)<br/>存储为 JSON `[0, 0, 1, 2]` 如 `.nav .item`<br/>使 Agent 能回答"当两个选择器都匹配同一元素时，谁的优先级高" |
| R9 | 建立同 className 在不同文件/选择器中的重复声明关系 — `overrides` 边 | 当同一个 class 名出现在多个选择器中时，按特异性排序建立 `overrides` 边<br/>标注来源文件和行号 |
| R10 | 建立 `@import` 引用关系 — 样式文件间的依赖图 | Edge: `imports`<br/>追踪 SCSS `@import`/`@use`/`@forward`、Less `@import`、CSS `@import url()`<br/>使 Agent 能回答"哪些文件导入了这个样式文件" |

### Part 3 — CSS Modules 与动态 className 溯源

| # | Requirement | Mockup & Description |
|---|-------------|----------------------|
| R11 | 解析 `.module.css` / `.module.scss` 文件中的 className 到哈希名的映射，建立 `exports` 边 | 定位同目录下的 `.tsx`/`.jsx` 文件，匹配 `import styles from './X.module.css'`<br/>解析模块导出映射 (className → hashedName)<br/>Edge: `exports` 连接哈希名 → 源 className |
| R12 | 解析 JSX/TSX 中的 className 使用（`className={styles.foo}`、`clsx(styles.a, styles.b)`、`classnames(...)`、模板字符串），建立 JSX 元素 → CSS className 的 `references` 边 | 通过 tree-sitter 解析 TSX/JSX 文件<br/>识别 `className` 属性中引用的 CSS Modules 对象<br/>Edge: `references` 从 JSX 组件 → CSS Module className |
| R13 | Tailwind / utility-class 项目：解析 `tailwind.config.js`，提取 utility class → CSS 属性的映射 | 直接使用 Tailwind 默认配置表 + 用户自定义配置<br/>包体积小（规则表作为数据文件，不引入 Tailwind 运行时）<br/>使 Agent 能回答" `px-4` 对应什么 CSS 属性" |

### Part 4 — CLI 命令

| # | Requirement | Mockup & Description |
|---|-------------|----------------------|
| R14 | `cssgraph init [path]` — 初始化项目并构建样式索引 | 创建 `.cssgraph/` 目录 + SQLite 数据库<br/>扫描所有 `.css/.scss/.less/.module.css` 文件并建立索引<br/>支持 `-i` / `-f` / `-v` 选项（与 codegraph 风格一致） |
| R15 | `cssgraph query <className>` — 查询 className 的所有定义位置、属性列表、覆盖关系 | 返回 className 的完整样式链：<br/>- 定义文件和行号<br/>- 完整选择器<br/>- 所有 property: value 对<br/>- 同一 className 在不同文件中的覆盖关系<br/>- CSS 特异性排序 |
| R16 | `cssgraph impact <className>` — 查询修改某个 className 会影响哪些属性/元素 | 以 className 为起点，沿 `contains`/`overrides`/`nests` 边遍历<br/>返回受影响的选择器、属性和引用它的 JSX 组件 |
| R17 | `cssgraph files` — 显示项目的样式文件结构 | 按目录树展示所有样式文件，标注文件类型和选择器数量<br/>与 codegraph 的 `codegraph files` 风格一致 |
| R18 | `cssgraph status` — 显示索引统计 | 显示选择器数量、属性数量、样式文件数量<br/>pending 变更、数据库元信息 |
| R19 | `cssgraph sync` — 增量同步样式文件变更 | 文件 watcher（FSEvents/inotify）自动触发，支持 `--quiet` |
| R20 | `cssgraph serve --mcp` — 启动 MCP server | 对外暴露 MCP tools，供 AI agent 调用 |

### Part 5 — MCP Server & AI Agent Tools

| # | Requirement | Mockup & Description |
|---|-------------|----------------------|
| R21 | `cssgraph_explore` — PRIMARY 工具：一次性返回 className 的完整样式上下文 | 输入 class name 或自然语言查询<br/>返回：<br/>- 所有匹配的 className 的完整属性列表（分组按文件）<br/>- 该 className 的覆盖关系和特异性排序<br/>- 引用该 className 的 JSX 组件<br/>- at-rule 上下文（在哪些 media query 下被重写）<br/>输出格式：Markdown fenced code block（属性） + 结构化表格（覆盖关系） |
| R22 | `cssgraph_search` — 按 className 名称搜索 | FTS5 全文搜索 className 名称<br/>返回文件路径 + 行号 + 选择器字符串 |
| R23 | `cssgraph_callers` — 查询哪些 JSX 组件使用了某个 className | 沿 `references` 边回溯<br/>返回使用该 className 的 JSX 组件列表 |
| R24 | `cssgraph_impact` — 查询修改某个 CSS 属性的影响范围 | 从 property 节点出发，追踪 className → JSX 组件的引用链 |
| R25 | `cssgraph_files` / `cssgraph_status` — 浏览器端信息查询 | 与 CLI 对应命令同一后端，为 Agent 提供样式文件结构和索引状态 |

### Part 6 — 安装与分发

| # | Requirement | Mockup & Description |
|---|-------------|----------------------|
| R26 | `cssgraph install` — 与 codegraph 一致的安装器 | 自动检测已安装的 Agent（Claude Code、Cursor、Codex、opencode、Gemini 等）<br/>写入 MCP 配置到各 Agent 的配置文件<br/>支持 `--target` / `--location` / `--yes` |
| R27 | 零配置启动 — 不需要项目侧配置文件 | 自动识别 `.css/.scss/.less` 文件<br/>自动排除 `node_modules`、`dist`、`.gitignore` 中的路径<br/>仅在工作区的 `.cssgraph.json` 中可选配置 `exclude` 和 `extensions` 映射 |
| R28 | 打包为 npm 包 + curl 安装脚本 | 与 codegraph 发布流程一致：npm publish + bash/PowerShell 安装脚本<br/>Node >= 22.5（复用 `node:sqlite`） |

### Part 7 — 共享部分（与 codegraph 保持一致的设计决策）

| # | Requirement | Mockup & Description |
|---|-------------|----------------------|
| R29 | 使用 SQLite + FTS5 作为唯一存储后端 | 复用 codegraph 的 `node:sqlite` 策略，WAL 模式<br/>schema: `nodes`, `edges`, `files`, `unresolved_refs`, `project_metadata`<br/>Schema 命名自带 `css_` 前缀避免与 codegraph 混淆 |
| R30 | 文件 watcher 自动同步 | FSEvents（macOS）/ inotify（Linux）/ ReadDirectoryChangesW（Windows）<br/>debounce 窗口 2s<br/>支持 `CODEGRAPH_WATCH_DEBOUNCE_MS` 环境变量（可复用同名变量或采用 `CSSGRAPH_` 前缀） |
| R31 | 分层架构：Extraction → Resolution → Graph → Context → MCP | 与 codegraph 五层架构一一对应<br/>`PostCSSExtractor` 对应 `ExtractionOrchestrator`<br/>`ImportResolver` 对应 `ReferenceResolver`<br/>`GraphTraverser` 完全复用 BFS/DFS 算法<br/>`MCP server` 复用 transport / daemon / session 层 |
| R32 | 禁止 `isError: true` 在可恢复场景中返回 | 与 codegraph 设计一致：未初始化、className 未找到等返回 success-shaped 的引导信息<br/>仅安全拒绝和真正错误场景返回 isError |

## Sign-off

Leave a comment "Sign-off" below to sign.
