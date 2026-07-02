# cssgraph V2 — FE Code Design

## Spec

上游需求清单：`/Users/mack/Open-projects/cssgraph/to-do.md`（本地 Markdown），覆盖 6 大类功能增强与性能优化，目标将 cssgraph 从 v0.1.2 推至 v0.2.0。

---

## Spec Analysis

| 模块 | 当前状态 | 需求目标 | GAP |
|------|----------|----------|-----|
| Stylus 支持 | `src/extraction/grammars.ts` 仅识别 `.css`/`.scss`/`.less`，`postcss-extractor.ts` 无 stylus 分支 | 支持 `.styl` 文件解析 | ❌ |
| Tailwind v4 兼容 | `tailwind-mapper.ts` 仅解析 `tailwind.config.js` 的 `theme.extend.spacing`（v3 JS config），硬编码 80+ 常用 utility | 解析 CSS-based config 的 `@theme` 块，与 v3 保持统一输出 | ❌ |
| styled-components / CSS-in-JS | `jsx-classname-extractor.ts` 返回空数组（stub），无 CSS-in-JS 解析器 | 解析 `styled.div` 模板字面量、`styled(Component)` 继承链，支持 emotion/stitches/vanilla-extract/panda-css | ❌ |
| CSS Modules 动态 import | `css-modules-resolver.ts` 仅处理 `*.module.{css,scss,less}` 静态文件，无 `await import()` 处理 | 处理动态导入、CommonJS `require()`，哈希反向映射 | ❌ |
| 查询能力增强 | CLI: `init`, `index`, `explore`, `impact`, `files`, `status`, `sync`, `serve`. MCP: 6 tools | 新增 `diff`, `unused`, `cascade`, CSS 属性值搜索 | ❌ |
| 性能优化（Worker 线程池） | `src/index.ts:227` 单线程 `for` 循环解析，每文件 `BEGIN/COMMIT` 事务 | Worker 线程池并行 PostCSS 解析 | ❌ |
| 性能优化（EXPLAIN QUERY PLAN） | `queries.ts` 使用 FTS5 全文索引，但无查询计划分析 | 数据库查询计划分析及索引优化 | ❌ |
| 扩展语言支持 (.sass) | `postcss-extractor.ts` 仅 css/scss/less 三种分支 | 支持 `.sass` 缩进语法 | ❌ |
| 扩展语言支持 (.pcss) | 同上 | 支持 PostCSS 自定义语法 | ❌ |
| 扩展语言支持 (Lightning CSS) | 无 | 作为备选解析器（性能更优） | ❌ |
| Less 解析 | 已修复：使用 `postcss-less` syntax plugin + 事务 + 预编译 statement | ✅ | ✅ |
| 索引性能（基础） | 已修复：单文件事务 + 预编译 SQL statement，1,486 文件 4 分钟 | ✅ | ✅ |

---

## Requirements

| # | Requirement | 所属模块 | 主要难点 |
|---|-------------|----------|----------|
| R1 | 调研 `postcss-stylus` 可行性，若不可行则开发独立 Stylus 解析器 | `src/extraction/` | Stylus 语法与 SCSS/Less 差异大，PostCSS 社区插件成熟度未知 |
| R2 | 解析 Tailwind v4 CSS-based config 的 `@theme` 块 | `src/extraction/tailwind-mapper.ts` | `@theme` AST 遍历与 v3 JS config 逻辑完全异构 |
| R3 | 提取 `@theme { --color-primary: #000; }` 作为 utility 映射来源 | `src/extraction/tailwind-mapper.ts` | CSS 变量到 utility class 的映射生成算法 |
| R4 | v4 与 v3 保持同一套 utility 解析输出格式 | `src/extraction/tailwind-mapper.ts` | 统一 `UtilityMap` 接口，两种 parser 输出合并 |
| R5 | 解析 `styled.div` 模板字面量中的 CSS | `src/extraction/` | CSS-in-JS 运行时动态样式，静态分析仅覆盖模板字面量形式 |
| R6 | 提取 `styled(Component)` 继承链 | `src/extraction/` | JSX AST 分析：需解析 TypeScript/JSX 文件而非仅 CSS 文件 |
| R7 | 支持 emotion / stitches / vanilla-extract / panda-css | `src/extraction/` | 各方案 API 不同，需插件化架构 |
| R8 | 处理 `const styles = await import('./X.module.css')` 动态导入 | `src/extraction/css-modules-resolver.ts` | 需解析 JS/TS 文件中的 import 语句 |
| R9 | 处理 `require('./X.module.css')` CommonJS 形式 | `src/extraction/css-modules-resolver.ts` | CJS 语法与 ESM 动态 import 异构 |
| R10 | 解析 webpack/vite loader 输出的 source map 实现哈希反向映射 | `src/extraction/css-modules-resolver.ts` | source map 解析 + 哈希名到原始名的反向查找 |
| R11 | 新增 `cssgraph diff <branch>` 子命令 | `src/bin/cssgraph.ts` + `src/graph/` | 需对比另一个分支的索引（需要 checkout 或预建索引） |
| R12 | 新增 `cssgraph unused` 子命令 | `src/bin/cssgraph.ts` + `src/graph/` | 基于图查询检测无 incoming reference 的 classNode |
| R13 | 新增 `cssgraph cascade <className>` 子命令 | `src/bin/cssgraph.ts` + `src/graph/` | 可视化完整层叠路径（覆盖关系链） |
| R14 | 支持按 CSS 属性值搜索 | `src/db/queries.ts` + `src/types.ts` | 需在 nodes 表新增属性值索引（当前 `css_property.value` 不带索引） |
| R15 | Worker 线程池并行 PostCSS 解析 | `src/index.ts` | 引入 `worker_threads`，跨线程数据传递，竞态管理 |
| R16 | 数据库查询计划分析与优化 | `src/db/queries.ts` | `EXPLAIN QUERY PLAN` 分析 + 必要时添加索引 |
| R17 | 支持 `.sass` 缩进语法 | `src/extraction/postcss-extractor.ts` + `src/extraction/grammars.ts` | 社区 `postcss-sass` 或独立 sass 解析器 |
| R18 | 支持 `.pcss` PostCSS 自定义语法 | `src/extraction/grammars.ts` | 需确认 `.pcss` 内使用的 PostCSS 插件链 |
| R19 | Lightning CSS 作为备选解析器 | `src/extraction/` | 新依赖 `lightningcss`，需封装为与 PostCSS 同接口 |

---

## Spec Gaps / 需确认事项

| # | 问题 | 影响 | 结论 |
|---|------|------|------|
| Q1 | `postcss-stylus` 社区成熟度？是否能用 PostCSS 直接解析 `.styl`？ | R1 | ⏳ 待调研 |
| Q2 | Lightning CSS 是替代 PostCSS 还是并行？选择策略是什么？ | R19 | ⏳ 待确认。建议通过文件扩展名配置（`.cssgraph.json` 中 `parser` 字段） |
| Q3 | CSS-in-JS 需要解析 JSX/TSX 文件 — 是否引入 babel/swc 作为 JSX parser？ | R5-R7 | ⏳ 待确认技术选型 |
| Q4 | `diff <branch>` 的对比策略：git checkout 另一个分支再索引，还是预存基线？ | R11 | ⏳ 建议先做简单方案：checkout → index → diff → checkout back |
| Q5 | Worker 线程池是否需要限定最大线程数？如何配置？ | R15 | ⏳ 待确认。建议 `os.cpus().length - 1`，通过环境变量 `CSSGRAPH_WORKER_COUNT` 可覆盖 |

---

## 主要难点

### 难点 1: Tailwind v4 CSS-based config 解析

`tailwind-mapper.ts` 当前仅解析 v3 `tailwind.config.js` 中 `theme.extend.spacing` 的 JS 对象字面量（正则匹配）。v4 改用 CSS 原生 `@theme` 块定义 design tokens，需要 PostCSS AST 遍历 `@theme` 内部的所有 CSS 自定义属性并推导对应的 utility class 名。

```typescript
// src/extraction/tailwind-mapper.ts — loadTailwindV4Mapping 示意
interface UtilityMap {
  [className: string]: Array<{ property: string; value: string }>;
}

function loadTailwindV4Mapping(projectRoot: string): UtilityMap {
  const merged: UtilityMap = {};

  const cssPath = path.join(projectRoot, 'app.css');
  if (!fs.existsSync(cssPath)) return merged;

  const source = fs.readFileSync(cssPath, 'utf-8');
  const root = postcss.parse(source, { from: cssPath });

  root.walkAtRules('theme', (atRule) => {
    atRule.walkDecls((decl) => {
      if (!decl.prop.startsWith('--')) return;
      // --color-primary-500 → bg-primary-500, text-primary-500, ...
      const tokenName = decl.prop.replace(/^--/, '');
      const value = decl.value;

      // 生成对应的 utility class 映射
      // e.g. --color-primary-500: #3b82f6
      //   → bg-primary-500: background-color: #3b82f6
      //   → text-primary-500: color: #3b82f6
      //   → border-primary-500: border-color: #3b82f6
      if (tokenName.startsWith('color-')) {
        const suffix = tokenName.replace('color-', '');
        merged[`bg-${suffix}`] = [{ property: 'background-color', value }];
        merged[`text-${suffix}`] = [{ property: 'color', value }];
        merged[`border-${suffix}`] = [{ property: 'border-color', value }];
      } else if (tokenName.startsWith('spacing-')) {
        const suffix = tokenName.replace('spacing-', '');
        merged[`p-${suffix}`] = [{ property: 'padding', value }];
        merged[`m-${suffix}`] = [{ property: 'margin', value }];
        merged[`gap-${suffix}`] = [{ property: 'gap', value }];
      }
      // ... 更多 token 类型映射
    });
  });

  return merged;
}
```

### 难点 2: Worker 线程池并行解析

当前 `scanAndIndex` 是单线程 for 循环。引入 Worker 池需要：
1. 创建解析 worker（`src/extraction/parse-worker.ts`），接收文件路径 + 源码，返回 `ExtractionResult`
2. 主线程分发文件到 worker 池，收集结果，按序写入数据库
3. 数据库写入仍在主线程（`node:sqlite` 不支持多线程写入）

```typescript
// src/index.ts — scanAndIndex 改造示意
import { Worker } from 'worker_threads';

private async scanAndIndex(options: IndexOptions): Promise<IndexResult> {
  const styleFiles = scanFiles(this.projectRoot);

  const workerCount = parseInt(process.env.CSSGRAPH_WORKER_COUNT || '') ||
    Math.max(1, require('os').cpus().length - 1);
  const workers: Worker[] = [];
  const workerPath = path.join(__dirname, 'extraction', 'parse-worker.js');

  for (let i = 0; i < workerCount; i++) {
    workers.push(new Worker(workerPath));
  }

  let nextFileIndex = 0;
  const totalFiles = styleFiles.length;

  const parseFile = (filePath: string, source: string): Promise<ExtractionResult> => {
    return new Promise((resolve, reject) => {
      const worker = workers[nextFileIndex % workerCount]!;
      nextFileIndex++;
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.postMessage({ filePath, source });
    });
  };

  // 并发解析，主线程串行写入数据库
  const concurrency = Math.min(workerCount, 8); // 限制并发避免 OOM
  for (let i = 0; i < styleFiles.length; i += concurrency) {
    const batch = styleFiles.slice(i, i + concurrency);
    const promises = batch.map(filePath => {
      const fullPath = path.join(this.projectRoot, filePath);
      const source = require('fs').readFileSync(fullPath, 'utf-8');
      return parseFile(filePath, source);
    });
    const results = await Promise.all(promises);

    // 数据库写入（按顺序）
    for (const result of results) {
      this.db.getDb().exec('BEGIN');
      for (const node of result.nodes) this.queries.insertNode(node);
      for (const edge of result.edges) this.queries.insertEdge(edge);
      this.db.getDb().exec('COMMIT');
    }
  }

  // cleanup workers
  for (const w of workers) w.terminate();
}
```

### 难点 3: CSS-in-JS styled-components 模板字面量静态分析

`styled.div` 模板字面量中的 CSS 是运行时确定的，但最常见的形式是静态模板字面量（`styled.div\`...\``）。需要：
1. 识别 TSX/JSX 文件中的 `styled.div\`...\`` 模式
2. 提取模板字面量中的 CSS 字符串
3. 将 CSS 字符串交由 PostCSS 解析（或自定义 parser）
4. 建立 "组件 → class selector hash → CSS 属性" 的映射关系

关键是：styled-components 在运行时生成哈希类名（如 `.sc-bdVaJa`），静态分析无法预测哈希。因此选择器节点使用组件的显示名或文件路径 — 让 AI agent 按组件名搜索。

---

## Tech Changes

### UI / 组件变更

本项目为 CLI 库，无 UI 组件变更。

### 样式 / CSS 变更

本项目为 CLI 库，无样式变更。

### 数据 / Hook / 内部模块变更

| # | 文件路径 | 操作 | 描述 |
|---|----------|------|------|
| D1 | `src/extraction/grammars.ts` | **修改** | 新增 `styl`, `sass`, `pcss` 语言检测和 `Language` 类型扩展 |
| D2 | `src/extraction/postcss-extractor.ts` | **修改** | 新增 `stylus`, `sass` parser 分支，Lightning CSS 备选分支 |
| D3 | `src/extraction/tailwind-mapper.ts` | **修改** | 新增 `loadTailwindV4Mapping()` 函数，合并 v3 + v4 utility map |
| D4 | `src/extraction/stylus-extractor.ts` | **新增** | Stylus 独立解析器（兜底方案，若 postcss-stylus 不可用） |
| D5 | `src/extraction/css-in-js-extractor.ts` | **新增** | styled-components / emotion CSS-in-JS 模板字面量提取器 |
| D6 | `src/extraction/parse-worker.ts` | **新增** | Worker 线程入口：接收 `{ filePath, source }`，返回 `ExtractionResult` |
| D7 | `src/extraction/css-modules-resolver.ts` | **修改** | 新增动态 import / require 处理 + source map 反向映射 |
| D8 | `src/extraction/jsx-classname-extractor.ts` | **修改** | 实现 `extractClassNameUsage()` — 从 JSX 文件中提取 className 引用 |
| D9 | `src/index.ts` | **修改** | `scanAndIndex` 引入 Worker 线程池；新增 `diff`, `unused`, `cascade` 方法 |
| D10 | `src/db/queries.ts` | **修改** | 新增按 CSS 属性值搜索的查询方法（可能需要 FTS 或新索引列） |
| D11 | `src/bin/cssgraph.ts` | **修改** | 新增 `diff`, `unused`, `cascade` CLI 子命令 |
| D12 | `src/mcp/index.ts` | **修改** | 新增对应 MCP tools：`cssgraph_diff`, `cssgraph_unused`, `cssgraph_cascade`, `cssgraph_property`（属性值搜索） |
| D13 | `src/mcp/server-instructions.ts` | **修改** | 更新 agent 使用说明，包含新 tools |
| D14 | `src/types.ts` | **修改** | `Language` 类型新增 `stylus`, `sass`, `pcss`；新增 `DiffResult`, `CascadeResult` 接口 |
| D15 | `src/db/schema.sql` | **修改** | 若属性值搜索需要新索引/新列，更新 schema（需 `copy-assets` 同步到 dist） |
| D16 | `package.json` | **修改** | 新增 devDependencies: `postcss-stylus` (或等效包), `lightningcss`, `@types/...` |

---

## Implementation Order

```
Phase 1 — 基础扩展（低风险、独立、可并行开发）
  1. 扩展语言支持（R17 .sass, R18 .pcss）
     ─ 修改 grammars.ts 的 detectLanguage
     ─ 修改 postcss-extractor.ts 新增 parser 分支
  2. Tailwind v4 兼容（R2-R4）
     ─ tailwind-mapper.ts 新增 loadTailwindV4Mapping
     ─ 合并 v3 + v4 utility 输出

Phase 2 — 查询增强（独立功能，可并行开发）
  3. cssgraph unused（R12）
     ─ GraphQueryManager.findDeadCode 已有基础，需 CLI 包装
  4. cssgraph cascade <className>（R13）
     ─ 基于 GraphTraverser.findPath 构建层叠路径
  5. CSS 属性值搜索（R14）
     ─ queries.ts 新增按 value 列搜索 + CLI 子命令
  6. cssgraph diff <branch>（R11）
     ─ git checkout → index → 对比两个索引的节点差

Phase 3 — CSS-in-JS & CSS Modules 增强
  7. styled-components 模板字面量解析（R5-R7）
     ─ jsx-classname-extractor.ts 实现 + css-in-js-extractor.ts
  8. CSS Modules 动态 import & source map（R8-R10）
     ─ css-modules-resolver.ts 扩展

Phase 4 — 性能优化
  9. Worker 线程池（R15）
     ─ parse-worker.ts + index.ts scanAndIndex 改造
     ─ 需要 Phase 3 稳定后再引入，避免 worker 路径下的模块导入冲突
  10. 数据库查询计划优化（R16）
      ─ 对高频查询路径做 EXPLAIN QUERY PLAN 分析

Phase 5 — Stylus & Lightning CSS
  11. Stylus 支持（R1）
      ─ 调研 postcss-stylus → 接入或自建解析器
  12. Lightning CSS 备选解析器（R19）
      ─ 封装为 parser backend，通过 .cssgraph.json 配置选择
```

---

## Module Dependency Map

```
cssgraph (src/index.ts)
├── src/db/
│   ├── index.ts (DatabaseConnection)
│   ├── queries.ts (QueryBuilder)
│   └── schema.sql
├── src/extraction/
│   ├── grammars.ts (detectLanguage)       ← Phase 1 修改
│   ├── postcss-extractor.ts               ← Phase 1, 5 修改
│   ├── selector-builder.ts
│   ├── specificity.ts
│   ├── tailwind-mapper.ts                 ← Phase 1 修改
│   ├── css-modules-resolver.ts            ← Phase 3 修改
│   ├── import-resolver.ts
│   ├── stylus-extractor.ts                ← Phase 5 新增
│   ├── css-in-js-extractor.ts             ← Phase 3 新增
│   ├── jsx-classname-extractor.ts         ← Phase 3 修改
│   └── parse-worker.ts                    ← Phase 4 新增
├── src/graph/
│   ├── index.ts (GraphQueryManager)       ← Phase 2 修改
│   └── traversal.ts (GraphTraverser)
├── src/context/
│   └── index.ts (ContextBuilder)
├── src/sync/
│   └── watcher.ts
├── src/mcp/
│   ├── index.ts (MCPServer)               ← Phase 2 修改
│   └── server-instructions.ts             ← Phase 2 修改
└── src/bin/
    └── cssgraph.ts                        ← Phase 2 修改
```

`→ Phase N 修改/新增` 标注的模块是有变更的。无标注的模块不改动。

---

## Dependencies with Others

| Requirement | 依赖项 | 状态 | 详情 |
|-------------|--------|------|------|
| R1 Stylus | `postcss-stylus` (npm) | ⏳ | 需调研社区维护状态；备选：独立 `stylus` parser |
| R5-R7 CSS-in-JS | `@babel/parser` + `@babel/traverse` 或 `typescript` compiler API | ⏳ | 用于解析 JSX/TSX 提取 `styled.div` 模板字面量 |
| R17 .sass | `postcss-sass` 或 `sass` (Dart Sass JS API) | ⏳ | 调研 PostCSS 兼容性 |
| R19 Lightning CSS | `lightningcss` (npm) | ⏳ | 需封装为与 PostCSS 同接口的 parser backend |
| R11 diff | git（系统级依赖） | ✅ | 已存在 |
| R10 source map | `source-map` (npm) | ⏳ | 用于解析 webpack/vite 的 CSS module source map |

---

## Timeline

| 任务 | 预估工时 |
|------|----------|
| Phase 1 — 语言扩展 + Tailwind v4 | 8h |
| Phase 2 — 查询增强 (unused, cascade, property search, diff) | 12h |
| Phase 3 — CSS-in-JS + CSS Modules 动态 import | 16h |
| Phase 4 — Worker 线程池 + 查询计划优化 | 12h |
| Phase 5 — Stylus + Lightning CSS | 10h |
| 测试与文档 | 8h |
| **合计** | **66h** |

---

## Release Checklist

- [ ] 所有新 parser（stylus, sass, pcss）在 bobcat 1,486 文件项目上验证无回归
- [ ] Tailwind v4 解析在含 `@theme` 的 CSS 文件上验证
- [ ] `cssgraph diff` 输出格式与 `git diff` 类似，可读
- [ ] `cssgraph unused` 输出含文件路径 + 行号
- [ ] `cssgraph cascade` 输出完整覆盖链（selector → specificity → source file）
- [ ] CSS 属性值搜索支持精确和模糊匹配
- [ ] Worker 线程池在 1,486 文件项目上索引时间显著缩短（目标 < 2min）
- [ ] 并发环境线程安全（Mutex 保护索引写入）
- [ ] `cssgraph serve --mcp` 新 tools 正常响应
- [ ] 所有 CLI 子命令有 `--help` 输出
- [ ] `schema.sql` 变更后同步到 `dist/db/schema.sql`（`copy-assets` 已验证）
- [ ] `EXPLAIN QUERY PLAN` 无全表扫描（高频查询路径）
- [ ] CSS-in-JS 静态分析在真实 styled-components/emotion 项目上验证
- [ ] 文档更新（README, AGENTS.md）
- [ ] 不 bump 版本号（除非另行要求）
