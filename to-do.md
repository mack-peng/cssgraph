# cssgraph V2 待办事项

## Stylus 支持

- [ ] 调研 postcss-stylus 解析器可行性
- [ ] 如社区有成熟的 PostCSS 兼容方案直接接入
- [ ] 否则需要独立 stylus 解析器（Stylus 语法与 SCSS/Less 差异较大）

## Tailwind v4 兼容

- [ ] 解析 CSS-based config 中的 `@theme` 块
- [ ] 提取 `@theme { --color-primary: #000; }` 作为 utility 映射来源
- [ ] 与 v3 JS config 保持同一套 utility 解析输出格式

## styled-components / CSS-in-JS

- [ ] 解析 `styled.div` 模板字面量中的 CSS
- [ ] 提取 `styled(Component)` 继承链
- [ ] 支持 emotion / stitches / vanilla-extract / panda-css 等主流方案
- [ ] 难点：CSS-in-JS 的样式是运行时确定的，静态分析只能覆盖模板字面量形式

## CSS Modules 动态 import 场景

- [ ] 处理 `const styles = await import('./X.module.css')` 动态导入
- [ ] 处理 `require('./X.module.css')` CommonJS 形式
- [ ] 解析 webpack/vite loader 输出的 source map 实现哈希反向映射

## 增强查询能力

- [ ] `cssgraph diff <branch>` — 对比两个分支的样式变更
- [ ] `cssgraph unused` — 检测未被引用的 className（类似 PurgeCSS 但基于图查询）
- [ ] `cssgraph cascade <className>` — 可视化特定 className 的完整层叠路径
- [ ] 支持按 CSS 属性值搜索（如查询所有设置了 `display: flex` 的选择器）

## 性能优化

- [ ] 大型项目（> 5000 样式文件）的增量索引优化
- [ ] PostCSS 解析的 Worker 线程池（参考 codegraph 的 parse-worker.ts）
- [ ] 数据库查询计划优化（EXPLAIN QUERY PLAN 分析）

## 扩展语言支持

- [ ] Sass（缩进语法 `.sass`）
- [ ] PostCSS 自定义语法（`.pcss`）
- [ ] Lightning CSS 作为备选解析器（性能更优）
