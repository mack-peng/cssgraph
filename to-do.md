# cssgraph V2 待办事项

## Stylus 支持

- [ ] 调研 postcss-stylus 解析器可行性
- [ ] 如社区有成熟的 PostCSS 兼容方案直接接入
- [ ] 否则需要独立 stylus 解析器

## Tailwind v4 兼容

- [x] 解析 CSS-based config 中的 `@theme` 块
- [x] 提取 `@theme { --color-primary: #000; }` 作为 utility 映射来源
- [x] 与 v3 JS config 保持同一套 utility 解析输出格式

## styled-components / CSS-in-JS

- [x] 解析 `styled.div` 模板字面量中的 CSS
- [x] 解析 `styled(Component)` 模板字面量
- [ ] 提取 `styled(Component)` 继承链（建立 references 边）
- [x] 支持 emotion `css` 模板字面量
- [ ] stitches / vanilla-extract / panda-css 对象语法

## CSS Modules 动态 import 场景

- [x] `const styles = await import('./X.module.css')` 动态导入
- [x] `import('./X.module.css').then(...)` 无绑定导入（imports 边）
- [x] `require('./X.module.css')` CommonJS 形式
- [x] 提取 `styles.foo` / `styles['foo-bar']` 类名引用
- [ ] 解析 webpack/vite loader 输出的 source map 实现哈希反向映射

## 增强查询能力

- [ ] `cssgraph diff <branch>` — 分支间样式变更对比（暂缓）
- [x] `cssgraph unused` — 检测未被引用的 className
- [x] `cssgraph cascade <className>` — 可视化层叠路径
- [x] `cssgraph property <query>` — 按 CSS 属性值搜索
- [x] `cssgraph rule <selector>` — selector 级精确/关联匹配 + loose/strict 影响面
- [x] `cssgraph details <selector>` — O(1) 精确 selector 查找（轻量，不查 edges）
- [x] `cssgraph impact-selector <selector>` — 查 selector 影响的代码文件（JS/TS/JSX/TSX/es6）

## 性能优化

- [x] `git ls-files` 文件发现（替代 filesystem walk）
- [x] Content-hash 跳过（未变动的文件 skip parse + insert）
- [x] SAVEPOINT 批事务（~100 文件/COMMIT，替代逐文件 BEGIN/COMMIT）
- [x] PRAGMA synchronous=OFF + 500MB cache_size（索引期间激进模式）
- [x] 扫描阶段 `setImmediate` yield（进度条不卡死）
- [x] MAX_FILE_SIZE 上限（跳过 >1MB 的文件）
- [x] 批 I/O 读文件（10 文件并行 `Promise.all(fsp.readFile)`）
- [x] PostCSS 解析 Worker 线程池（`parse-pool.ts` + `parse-worker.ts`）
- [x] `flushOrdered()` 有序提交缓冲器（Worker 池乱序 result → 文件顺序 store）
- [x] `reinit()` — 删 DB 文件重建（替代 34s 的 bulk DELETE）
- [ ] 数据库查询计划优化（EXPLAIN QUERY PLAN 分析）
- [ ] 增量索引正确性（sync 时保留跨文件 `references` 边、classSelectorMap 差异更新）

## 扩展语言支持

- [x] Sass（缩进语法 `.sass`）
- [x] PostCSS 自定义语法（`.pcss`）
- [x] `.es6` 作为 JSX 类文件处理
- [ ] Lightning CSS 作为备选解析器

## 新增（未在原始 V2 计划中）

- [x] `cssgraph impact-selector` — 场景二：改 selector → 哪些代码文件受影响
- [x] `.cssgraph.json` 项目配置（mtime-cached）
- [x] 默认排除（`*.test.*`, `*.stories.*`, `__tests__/`, `generated/`）
- [ ] 测试覆盖（当前 0 测试）
