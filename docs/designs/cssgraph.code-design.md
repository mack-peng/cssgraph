# cssgraph — FE Code Design

## Spec

关联 Spec：`output/cssgraph.spec.md` — 覆盖 cssgraph CLI 工具 + MCP Server 的全部 32 条需求。

## Spec Analysis

| 区块 | 当前状态 | 需求要求 | GAP |
|------|----------|----------|-----|
| CSS 解析引擎 | ❌ 无 | 支持 CSS/SCSS/Less 三种格式解析并提取 className/property/variable 节点 | ❌ |
| SQLite 图数据库 | ❌ 无 | nodes/edges/files 表 + FTS5 索引 | ❌ |
| CSS 特异性计算 | ❌ 无 | 每个 selector 计算 (a,b,c) specificity 并建立 overrides 边 | ❌ |
| CSS Modules 溯源 | ❌ 无 | 解析 .module.css 导出映射 + JSX className 引用追踪 | ❌ |
| Tailwind 映射 | ❌ 无 | 解析 tailwind.config.js + utility class → CSS 属性表 | ❌ |
| CLI 命令 | ❌ 无 | init/query/impact/files/status/sync/serve 子命令 | ❌ |
| MCP Server | ❌ 无 | cssgraph_explore/search/callers/impact/files/status 工具 | ❌ |
| 安装器 | ❌ 无 | 多 Agent 检测 + MCP 配置写入 | ❌ |
| 文件 Watcher | ❌ 无 | FSEvents/inotify/ReadDirectoryChangesW 自动同步 | ❌ |

## Requirements

| # | Requirement | 所属板块 | Mock | 主要难点 |
|---|-------------|----------|------|----------|
| R1 | PostCSS 解析器 — 支持 CSS/SCSS/Less 三种语法 | 核心引擎 | R1 | 无 |
| R2 | className 选择器节点提取 + 属性列表存储 | 核心引擎 | R2 | 无 |
| R3 | CSS 属性独立节点 + contains 边 | 核心引擎 | R3 | 无 |
| R4 | SCSS/Less 嵌套展开 — 还原完整选择器路径 | 核心引擎 | R4 | SCSS 嵌套层级深时路径拼接逻辑 |
| R5 | @media/@keyframes/@supports/@layer at-rule 节点 | 核心引擎 | R5 | 无 |
| R6 | CSS 变量（--custom-property）+ var() 引用链 | 核心引擎 | R6 | 变量作用域（跨文件、跨选择器的变量可见性） |
| R7 | File 节点 + content_hash 增量检测 | 核心引擎 | R7 | 无 |
| R8 | CSS 特异性计算 (a, b, c, d) 元组 | 层叠系统 | R8 | 复合选择器特异性累加逻辑 |
| R9 | overrides 边 — 同 className 多声明覆盖关系 | 层叠系统 | R9 | 跨文件 specificity 比较 + 来源优先级 |
| R10 | @import/@use/@forward 样式文件依赖图 | 层叠系统 | R10 | SCSS @use namespace 映射 |
| R11 | CSS Modules .module.css → className 映射 | CSS Modules | R11 | Hash 反向映射需要解析 JS import |
| R12 | JSX className 引用 — styles.foo / clsx / classnames | CSS Modules | R12 | clsx/classnames 的条件表达式解析 |
| R13 | Tailwind utility class → CSS 属性映射表 | Tailwind | R13 | 用户自定义 theme 合并 |
| R14 | `init` 命令 — 初始化 + 建索引 | CLI | R14 | 无 |
| R15 | `query` 命令 — className 完整样式链 | CLI | R15 | 无 |
| R16 | `impact` 命令 — className 影响范围 | CLI | R16 | 无 |
| R17 | `files` 命令 — 样式文件树 | CLI | R17 | 无 |
| R18 | `status` 命令 — 索引统计 | CLI | R18 | 无 |
| R19 | `sync` 命令 — 增量同步 | CLI | R19 | 无 |
| R20 | `serve --mcp` 命令 — 启动 MCP server | CLI | R20 | 无 |
| R21 | cssgraph_explore — PRIMARY MCP 工具 | MCP Server | R21 | 输出格式设计（Markdown + 表格混合） |
| R22 | cssgraph_search — FTS5 搜索 | MCP Server | R22 | 无 |
| R23 | cssgraph_callers — JSX 组件反向引用 | MCP Server | R23 | 跨文件 JSX → CSS 引用可能不在同一次索引中 |
| R24 | cssgraph_impact — 属性影响范围 | MCP Server | R24 | 无 |
| R25 | cssgraph_files/cssgraph_status — 浏览工具 | MCP Server | R25 | 无 |
| R26 | 多 Agent 安装器 — install 命令 | 安装分发 | R26 | opencode/jsonc 配置写入 |
| R27 | 零配置 — 自动识别样式文件 + 排除规则 | 安装分发 | R27 | 无 |
| R28 | npm + curl 发布 | 安装分发 | R28 | 无 |
| R29 | SQLite + FTS5 数据库 | 共享 | R29 | 无 |
| R30 | 文件 Watcher 自动同步 | 共享 | R30 | 无 |
| R31 | 五层分层架构 | 共享 | R31 | PostCSS 线程池管理 |
| R32 | Success-shaped 错误响应 | 共享 | R32 | 无 |

## Spec Gaps / 需确认事项

| # | 问题 | 影响 | 结论 |
|---|------|------|------|
| Q1 | 是否与 codegraph 共用同一份 `.codegraph/` 目录还是独立 `.cssgraph/` 目录？ | R29, R30 | ✅ 独立 `.cssgraph/`，职责隔离 |
| Q2 | V1 是否需要支持 Stylus 格式？Spec 当前只列了 CSS/SCSS/Less | R1 | ✅ 不支持，V2 考虑 |
| Q3 | Tailwind v4 的 CSS-based config（`@theme` 块）与 v3 的 JS config 如何兼容？ | R13 | ✅ V1 只做 v3 JS config |
| Q4 | CSS Modules 哈希映射解析是否需要 webpack/vite loader 信息？纯静态解析可能无法覆盖动态 import 场景 | R11, R12 | ✅ 纯静态解析足够，动态 import 归 V2 |
| Q5 | 是否需要支持 styled-components / CSS-in-JS？Spec 未覆盖 | R1, R12 | ✅ 不做，V2 考虑 |
| Q6 | MCP server 是否与 codegraph 共用同一个 daemon 进程，还是独立启动？ | R20, R31 | ✅ 独立 daemon，降低耦合 |
| Q7 | 项目名称用 `cssgraph` 还是 `@colbymchenry/cssgraph`（保持同一 npm scope）？ | R28 | ✅ `cssgraph`，独立品牌推广 |

## 主要难点

### 难点 1: SCSS/Less 嵌套展开与选择器拼接

嵌套语法 `.parent { .child { } }` 需要展开为 `.parent .child`。深度嵌套（4-5 层）时路径拼接需正确处理 `&` 父选择器引用和 `@at-root` 跳出。

```typescript
// src/extraction/selector-builder.ts
import { Rule, AtRule } from 'postcss';

interface SelectorContext {
  parentSelectors: string[];
  atRules: { name: string; params: string }[];  // @media, @supports...
}

function buildFullSelector(
  rule: Rule, 
  context: SelectorContext
): string {
  const selectors = rule.selectors.map(sel => {
    const resolved = sel.replace(/&/g, context.parentSelectors.join(' '));
    return context.parentSelectors.length > 0 && !sel.includes('&')
      ? `${context.parentSelectors.join(' ')} ${resolved}`
      : resolved;
  });
  return selectors.join(', ');
}

function walkNestedRules(
  node: Container, 
  context: SelectorContext,
  collector: (selector: string, decls: Declaration[], atRules: AtRule[]) => void
): void {
  node.walk(child => {
    if (child.type === 'rule') {
      const fullSelector = buildFullSelector(child as Rule, context);
      collector(fullSelector, (child as Rule).nodes, context.atRules);
      // 递归进入嵌套规则
      walkNestedRules(child, {
        parentSelectors: (child as Rule).selector.split(',').map(s => s.trim()),
        atRules: context.atRules,
      }, collector);
    } else if (child.type === 'atrule') {
      walkNestedRules(child, {
        ...context,
        atRules: [...context.atRules, { 
          name: (child as AtRule).name, 
          params: (child as AtRule).params 
        }],
      }, collector);
    }
  });
}
```

### 难点 2: CSS 特异性计算引擎

Spec 要求计算 (a, b, c, d) 四元组特异性：a=inline, b=id, c=class/attribute/pseudo-class, d=element/pseudo-element。复合选择器 `.nav .item:hover` 中各部分需要独立累加。

```typescript
// src/extraction/specificity.ts

export type Specificity = [number, number, number, number]; // [a, b, c, d]

const SPECIFICITY_MAP: Record<string, Specificity> = {
  id:          [0, 1, 0, 0],
  class:       [0, 0, 1, 0],
  attribute:   [0, 0, 1, 0],
  pseudoClass: [0, 0, 1, 0],
  pseudoElement: [0, 0, 0, 1],
  universal:   [0, 0, 0, 0],
};

function parseSelectorParts(selector: string): { type: keyof typeof SPECIFICITY_MAP }[] {
  // 使用 postcss-selector-parser 拆解选择器为各部分
  // .btn[disabled]:hover > span::after
  // → [{type:'class'}, {type:'attribute'}, {type:'pseudoClass'}, {type:'element'}, {type:'pseudoElement'}]
  const parser = require('postcss-selector-parser');
  const parts: { type: keyof typeof SPECIFICITY_MAP }[] = [];
  parser(selectors => {
    selectors.walk(node => {
      if (node.type === 'class') parts.push({ type: 'class' });
      else if (node.type === 'id') parts.push({ type: 'id' });
      else if (node.type === 'attribute') parts.push({ type: 'attribute' });
      else if (node.type === 'pseudo') {
        const kind = node.value.startsWith('::') ? 'pseudoElement' : 'pseudoClass';
        parts.push({ type: kind });
      }
      else if (node.type === 'tag') parts.push({ type: node.value === '*' ? 'universal' : 'element' });
    });
  }).processSync(selector);
  return parts;
}

export function calculateSpecificity(selector: string): Specificity {
  const parts = parseSelectorParts(selector);
  return parts.reduce<Specificity>(
    (acc, part) => {
      const delta = SPECIFICITY_MAP[part.type] ?? [0, 0, 0, 0];
      return [acc[0] + delta[0], acc[1] + delta[1], acc[2] + delta[2], acc[3] + delta[3]];
    },
    [0, 0, 0, 0]
  );
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}
```

### 难点 3: CSS Modules 哈希反向映射

`.module.css` 编译后 className 被哈希化（`.foo` → `.foo_a1b2`），需要从 JS import 语句中反向建立映射。核心思路：解析 JSX 文件中的 `import styles from './X.module.css'`，然后在 CSS Module 文件中定位原始 className。

```typescript
// src/extraction/css-modules-resolver.ts
import { parse } from 'postcss';

interface ModuleMapping {
  sourceFile: string;       // ./Button.module.css
  originalName: string;     // container
  hashedName: string;       // container_a1b2
  properties: Array<{ prop: string; value: string }>;
}

export function resolveCSSModules(
  cssFilePath: string, 
  cssSource: string
): Map<string, string> {
  // .module.css 文件中的 className 在编译前就是原始名
  // 哈希发生在打包阶段，index 阶段我们直接用原始名
  // 映射存储在 nodes 表中: name = "container", exportsName = "container_a1b2"
  const root = parse(cssSource);
  const mapping = new Map<string, string>();

  root.walkRules(rule => {
    rule.selectors.forEach(sel => {
      rule.walkClasses(cls => {
        // name = cls.value (原始名)
        // 如果有 source map 或 loader 输出，这里记录哈希映射
        // V1: 只存储原始名，Agent 通过原始名查询
        mapping.set(cls.value, cls.value);
      });
    });
  });

  return mapping;
}

// 在 JSX 侧解析引用
// src/extraction/jsx-classname-extractor.ts
export function extractClassNameUsage(
  jsxSource: string
): Array<{ className: string; filePath: string; line: number }> {
  // tree-sitter 解析 JSX:
  // <div className={styles.container}>
  // <div className={clsx(styles.a, condition && styles.b)}>
  // <button className="btn-primary">
  //
  // 识别三类模式:
  // 1. styles.X → CSS Modules 引用
  // 2. clsx/classnames → 条件 className
  // 3. 字符串常量 → 全局 className
  //
  // V1 仅处理模式 1 和模式 3
  // 模式 2 需要部分求值，V2 再做
  return [];
}
```

### 难点 4: Tailwind utility class → CSS 属性映射

Tailwind 的 utility class 不像传统 CSS 那样直接声明属性。需要从 `tailwind.config.js` 中提取 theme 配置 + Tailwind 默认规则表，建立 `px-4` → `padding-left: 1rem; padding-right: 1rem` 的映射。

```typescript
// src/extraction/tailwind-mapper.ts

interface UtilityMap {
  [className: string]: Array<{ property: string; value: string }>;
}

// 内置默认映射表（精简版，完整版 ~2000 条）
const DEFAULT_UTILITIES: UtilityMap = {
  'px-0': [{ property: 'padding-left', value: '0' }, { property: 'padding-right', value: '0' }],
  'px-4': [{ property: 'padding-left', value: '1rem' }, { property: 'padding-right', value: '1rem' }],
  'flex': [{ property: 'display', value: 'flex' }],
  'text-center': [{ property: 'text-align', value: 'center' }],
  'bg-white': [{ property: 'background-color', value: 'rgb(255,255,255)' }],
  // ... 从 tailwindcss 官方配置提取完整映射
};

export function loadTailwindMapping(projectRoot: string): UtilityMap {
  const configPath = path.join(projectRoot, 'tailwind.config.js');
  let userTheme: Record<string, any> = {};

  if (fs.existsSync(configPath)) {
    // 解析 config: 读取文件 + require() 或静态分析
    try {
      userTheme = require(configPath).theme || {};
    } catch { /* 忽略解析失败，使用默认值 */ }
  }

  // 合并用户自定义 spacing/screen/colors 等
  const spacing = userTheme?.extend?.spacing ?? userTheme?.spacing ?? {};
  const merged = { ...DEFAULT_UTILITIES };

  // 动态生成 spacing utilities
  for (const [key, value] of Object.entries(spacing)) {
    merged[`px-${key}`] = [
      { property: 'padding-left', value: String(value) },
      { property: 'padding-right', value: String(value) },
    ];
    merged[`m-${key}`] = [
      { property: 'margin', value: String(value) },
    ];
  }

  return merged;
}
```

## Tech Changes

### 项目文件结构

```
cssgraph/
├── src/
│   ├── index.ts                  # CodeGraph 类（对外的 init/open/sync/search/close）
│   ├── types.ts                  # NodeKind/EdgeKind/Node/Edge/FileRecord 类型
│   ├── directory.ts              # .cssgraph/ 目录管理
│   ├── errors.ts                 # 错误类型
│   ├── utils.ts                  # Mutex/FileLock/工具函数
│   ├── project-config.ts         # .cssgraph.json 配置解析
│   ├── bin/
│   │   └── cssgraph.ts           # CLI 入口（commander）
│   ├── db/
│   │   ├── index.ts              # DatabaseConnection (node:sqlite)
│   │   ├── queries.ts            # QueryBuilder (所有 prepared statements)
│   │   ├── schema.sql            # DDL: nodes/edges/files/unresolved_refs/project_metadata + FTS5
│   │   └── sqlite-adapter.ts     # node:sqlite 适配层
│   ├── extraction/
│   │   ├── index.ts              # ExtractionOrchestrator（扫描 → 解析 → 存储）
│   │   ├── postcss-extractor.ts  # PostCSS 核心解析器
│   │   ├── selector-builder.ts   # SCSS/Less 嵌套选择器展开
│   │   ├── specificity.ts        # CSS 特异性计算
│   │   ├── css-modules-resolver.ts
│   │   ├── jsx-classname-extractor.ts
│   │   ├── tailwind-mapper.ts    # Tailwind utility 映射
│   │   ├── import-resolver.ts    # @import/@use/@forward 解析
│   │   └── grammars.ts           # 样式文件类型检测
│   ├── graph/
│   │   ├── index.ts              # GraphQueryManager
│   │   └── traversal.ts          # GraphTraverser (BFS/DFS)
│   ├── context/
│   │   └── index.ts              # ContextBuilder（explore 输出格式化）
│   ├── search/
│   │   └── index.ts              # FTS5 搜索 + query-utils
│   ├── sync/
│   │   ├── index.ts              # FileWatcher 封装
│   │   └── watcher.ts            # 原生 FS 事件监听 + debounce
│   ├── mcp/
│   │   ├── index.ts              # MCPServer 类
│   │   ├── tools.ts              # ToolHandler + 所有工具实现
│   │   ├── server-instructions.ts # MCP initialize 中的使用指引
│   │   ├── transport.ts          # stdio transport
│   │   └── daemon.ts             # 后台 daemon 进程管理
│   ├── installer/
│   │   ├── index.ts              # 交互式安装器
│   │   └── targets/
│   │       ├── registry.ts       # Agent 目标注册
│   │       ├── claude.ts         # Claude Code
│   │       ├── cursor.ts         # Cursor
│   │       ├── codex.ts          # Codex CLI
│   │       └── opencode.ts       # opencode
│   ├── ui/
│   │   └── progress.ts           # 终端进度渲染
│   └── telemetry/
│       └── index.ts              # 匿名使用统计
├── __tests__/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### UI / 模块变更

| # | 文件路径 | 操作 | 描述 |
|---|----------|------|------|
| C1 | `src/index.ts` | **新增** | CodeGraph 主类，init/open/close/sync/search/explore 生命周期 |
| C2 | `src/types.ts` | **新增** | NodeKind（class_selector/css_property/css_variable/at_rule/file）、EdgeKind（contains/nests/overrides/imports/references/exports） |
| C3 | `src/db/` | **新增** | SQLite 数据库层：schema.sql 建表 + queries.ts prepared statements + FTS5 |
| C4 | `src/extraction/postcss-extractor.ts` | **新增** | PostCSS 解析核心：walk Rules → 提取 className + 声明 + at-rule |
| C5 | `src/extraction/selector-builder.ts` | **新增** | SCSS/Less 嵌套选择器展开为完整选择器路径 |
| C6 | `src/extraction/specificity.ts` | **新增** | (a,b,c,d) 特异性计算 + 比较函数 |
| C7 | `src/extraction/css-modules-resolver.ts` | **新增** | .module.css 导出映射 + JSX import 解析 |
| C8 | `src/extraction/jsx-classname-extractor.ts` | **新增** | tree-sitter 解析 JSX className={styles.X} / clsx() / 字符串 |
| C9 | `src/extraction/tailwind-mapper.ts` | **新增** | tailwind.config.js 解析 + utility→CSS 映射表 |
| C10 | `src/extraction/import-resolver.ts` | **新增** | @import/@use/@forward 样式文件依赖解析 |
| C11 | `src/extraction/grammars.ts` | **新增** | 样式文件语言检测（.css/.scss/.less/.module.css） |
| C12 | `src/graph/traversal.ts` | **新增** | BFS/DFS 图遍历（复用 codegraph 算法） |
| C13 | `src/context/index.ts` | **新增** | explore 输出格式化：className 属性列表 + 覆盖关系表 |
| C14 | `src/bin/cssgraph.ts` | **新增** | CLI 入口（commander）：init/query/impact/files/status/sync/serve |
| C15 | `src/mcp/tools.ts` | **新增** | MCP 工具实现：explore/search/callers/impact/files/status |
| C16 | `src/mcp/server-instructions.ts` | **新增** | Agent 使用指引（MCP initialize 响应） |
| C17 | `src/mcp/daemon.ts` | **新增** | 后台 daemon + liveness watchdog |
| C18 | `src/installer/targets/` | **新增** | claude/cursor/codex/opencode 的 MCP 配置写入 |
| C19 | `src/sync/watcher.ts` | **新增** | FSEvents/inotify/ReadDirectoryChangesW 文件监听 |
| C20 | `src/ui/progress.ts` | **新增** | 终端 shimmer 进度条 |

### 数据 / Hook 变更（对应 Spec NodeKind）

| # | 文件路径 | 操作 | 描述 |
|---|----------|------|------|
| D1 | `nodes.class_selector` | **新增** | className 节点：name/selector/specificity/properties/filePath/startLine |
| D2 | `nodes.css_property` | **新增** | 属性声明节点：name(属性名)/value/specificity/filePath/startLine |
| D3 | `nodes.css_variable` | **新增** | CSS 变量节点：name(--var)/value/filePath |
| D4 | `nodes.at_rule` | **新增** | at-rule 节点：name(media/keyframes)/params/filePath |
| D5 | `nodes.file` | **新增** | 样式文件节点：path/language/contentHash/size |
| D6 | `edges.contains` | **新增** | class_selector → css_property（包含关系）<br/>at_rule → class_selector（at-rule 内的选择器） |
| D7 | `edges.nests` | **新增** | 父选择器 → 子选择器（SCSS/Less 嵌套） |
| D8 | `edges.overrides` | **新增** | 相同 className、不同 specificity 的覆盖关系 |
| D9 | `edges.imports` | **新增** | 样式文件之间的 @import/@use 依赖 |
| D10 | `edges.references` | **新增** | css_variable → var() 引用<br/>JSX 组件 → className 引用 |
| D11 | `edges.exports` | **新增** | CSS Module 文件 → 导出的 className 映射 |

## Module Architecture

```
┌────────────────────────────────────────────────────┐
│                   CLI / MCP Server                  │
│  cssgraph init | query | impact | serve --mcp      │
└───────────────────────┬────────────────────────────┘
                        │
┌───────────────────────▼────────────────────────────┐
│                   CodeGraph 主类                    │
│  init / open / close / sync / search / explore     │
│  watch / unwatch / getStats / resolveReferences    │
└───────────────────────┬────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Extraction   │ │  Resolution  │ │   Graph      │
│ Orchestrator │ │   (import    │ │  Traverser   │
│              │ │  resolution) │ │  (BFS/DFS)   │
│ PostCSS      │ │              │ │              │
│ tree-sitter  │ │              │ │              │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        ▼
┌───────────────────────────────────────────────────┐
│              SQLite + FTS5 (.cssgraph/)            │
│  nodes │ edges │ files │ unresolved_refs          │
└───────────────────────────────────────────────────┘
```

## Dependencies with Others

| Requirement | 依赖后端 | 状态 | API 定义 |
|-------------|----------|------|----------|
| R1-R6 | PostCSS + postcss-scss + postcss-less + postcss-selector-parser | ✅ npm 可用 | 无网络依赖，纯本地解析 |
| R7, R29 | Node.js `node:sqlite` (≥22.5) | ✅ 内置 | 与 codegraph 相同的 SQLite 后端 |
| R12 | tree-sitter + tree-sitter-tsx/tree-sitter-javascript WASM | ✅ npm 可用 | 复用 codegraph 的 tree-sitter 基础设施 |
| R13 | tailwind.config.js 静态解析 | ✅ 本地文件读取 | 不引入 Tailwind 运行时，仅解析配置对象 |
| R26-R28 | npm registry + GitHub Releases | ⏳ 需创建 npm scope | `npm publish @colbymchenry/cssgraph` 或独立 scope |

## Timeline

| 任务 | 预估工时 |
|------|----------|
| 项目脚手架：package.json/tsconfig/vitest/build 脚本 | 2h |
| SQLite schema + DatabaseConnection + QueryBuilder | 3h |
| PostCSS 解析核心 + className/property 提取 | 4h |
| SCSS/Less 嵌套展开 + at-rule 处理 | 3h |
| CSS 特异性计算引擎 | 2h |
| CSS 变量 + var() 引用解析 | 2h |
| @import/@use/@forward 依赖解析 | 2h |
| CSS Modules 解析 + JSX className 提取（tree-sitter） | 5h |
| Tailwind utility 映射表 | 3h |
| CLI 命令（init/query/impact/files/status/sync/serve） | 5h |
| MCP Server + tools（explore/search/callers/impact） | 6h |
| 文件 Watcher 自动同步 | 3h |
| 多 Agent 安装器 | 4h |
| 测试用例编写 | 6h |
| 文档（README/CLI help/Agent 使用指引） | 3h |
| npm 打包发布脚本 | 2h |
| **合计** | **55h** |

## Release Checklist

- [ ] `node:sqlite` WAL 模式正常启用
- [ ] CSS/SCSS/Less 三种格式的样式文件均能正确解析
- [ ] SCSS 嵌套深度 ≥4 层时选择器路径展开正确
- [ ] CSS 特异性计算与浏览器行为一致
- [ ] `.module.css` 文件中的 className 能溯源到源文件
- [ ] JSX 中 `className={styles.foo}` 能反向引用到 CSS Module
- [ ] Tailwind 常用 utility class 映射正确（flex/grid/spacing/color/text）
- [ ] `cssgraph init` 在 500 文件级别项目中 < 5 秒索引完成
- [ ] 文件 watcher 在 macOS/Linux 上正常触发增量同步
- [ ] MCP server 在 Claude Code / Cursor / opencode 中正常连接
- [ ] `cssgraph_explore` 输出能在一次调用中覆盖 Agent 所需的完整样式信息
- [ ] 未初始化的项目返回 success-shaped 引导而非 isError
- [ ] `cssgraph install --target=opencode` 正确写入 opencode.jsonc
- [ ] `.gitignore` 排除规则与 codegraph 保持一致
- [ ] 与 codegraph `.codegraph/` 目录无冲突
