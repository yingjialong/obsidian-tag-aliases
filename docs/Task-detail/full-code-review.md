# full-code-review

## 任务信息

- 任务名称：项目全量代码审查
- 开始时间：2026-03-16
- 当前状态：已完成
- 审查结论：Request Changes

## 任务背景

用户要求对 `obsidian-tag-aliases` 项目执行一次完整代码审查。本次任务不是增量 diff review，而是针对当前仓库主干代码进行全量静态审查，重点关注：

- 正确性问题
- 数据破坏风险
- 边界条件缺陷
- 可维护性与兼容性风险
- 验证与测试覆盖缺口

## 审查范围

本次重点审查以下文件与模块：

- `src/main.ts`
- `src/core/AliasManager.ts`
- `src/suggest/TagAliasSuggest.ts`
- `src/migration/BatchMigration.ts`
- `src/ui/SettingTab.ts`
- `src/ui/AliasGroupModal.ts`
- `src/types.ts`
- `src/constants.ts`
- `package.json`
- `tsconfig.json`
- `esbuild.config.mjs`
- `README.md`
- `docs/Task-detail/project-plan.md`

## 实施方案

1. 先阅读 `README.md`、`docs/Task_history.md` 与现有任务计划，确认项目目标和关键路径。
2. 结合代码审查清单，对入口、建议系统、自动替换、批量迁移、导入导出进行逐模块检查。
3. 运行 `npm run build`，确认当前代码至少可以通过 TypeScript 构建。
4. 对高风险路径做定向验证，避免只凭直觉给出结论。
5. 输出按优先级分级的 findings，并记录后续修复建议。

## ToDoList

- [x] 阅读项目说明与任务历史
- [x] 阅读核心源码与关键配置
- [x] 审查自动替换与批量迁移链路
- [x] 审查设置页与导入导出链路
- [x] 执行构建验证
- [x] 输出审查结论并更新文档

## 审查结果

### P1

1. `src/migration/BatchMigration.ts:175-186`

   批量迁移先通过 MetadataCache 扫描“语义上的标签”，但执行阶段却对整篇文档进行全局正则替换。这样会把代码块、缩进代码、示例文本中的 `#alias` 一并替换掉，属于源头性的内容污染风险。该问题不是 UI 误差，而是执行模型错误。

2. `src/main.ts:216-246`

   自动替换逻辑在 `metadataCache.changed` 事件发生后，没有绑定触发事件对应的文件和编辑器，而是延迟读取“当前活动编辑器”。如果用户在 debounce 窗口内切换笔记，插件可能在错误的笔记里执行替换，属于真实的数据修改风险。

### P2

1. `src/migration/BatchMigration.ts:148-152` 与 `src/migration/BatchMigration.ts:295-297`

   迁移预览框只在点击 `Cancel` 或 `Replace` 按钮时 resolve Promise；如果用户按 `Esc`、点击遮罩或右上角关闭按钮，Promise 不会结束，`run()` 会一直挂起。

2. `src/ui/SettingTab.ts:268-295`

   导入逻辑只验证了 JSON 结构，没有复用 `AliasManager.validate()` 校验 tag 格式、重复 alias、跨组冲突等规则。随后直接 `buildIndex()`，而 `Map#set()` 会让后写入的冲突项静默覆盖前项，导致导入后行为不可预测。

3. `src/main.ts:122-175`

   为了移除内置 tag suggest，当前实现通过构造函数名包含 `tag`、以及 `onTrigger.toString()` 中是否出现 `#` / `tag` 来猜测目标对象。这种启发式判断过宽，极易误伤其他插件注册的 suggest，兼容性风险偏高。

### P3

1. `src/suggest/TagAliasSuggest.ts:123-126`

   `matchedAlias` 在 `displayText` 被改写为主标签之后才赋值，导致 UI 上展示的“匹配别名”实际上是主标签本身，提示文案不正确。

## 关键验证记录

### 构建验证

- 执行命令：`npm run build`
- 结果：通过

### 定向验证

- 用 Node.js 复现了批量迁移中的正则替换行为
- 验证结果表明，代码块、缩进代码、普通说明文字中的 `#js` 都会被替换为 `#javascript`

## 变动文件清单

- `docs/Task_history.md`
- `docs/Task-detail/full-code-review.md`

## 测试与覆盖情况

- 当前项目未配置自动化测试框架
- 本次仅完成静态代码审查和构建验证
- 未在真实 Obsidian 运行时执行手工交互回归

## 后续建议

1. 先修复两处 P1 问题，再考虑发布或继续扩展功能。
2. 批量迁移应基于精确位置或 Markdown 结构做替换，不应继续依赖全文正则。
3. 自动替换应把“触发文件、触发时光标上下文、活动编辑器”绑定在同一次事件链中，避免跨文件误改。
4. 导入链路必须复用统一校验逻辑，否则设置数据层永远存在被脏数据污染的入口。
5. 下一步应补最少量的自动化测试，优先覆盖 `AliasManager.validate()`、`TagAliasSuggest.getSuggestions()`、`BatchMigration` 的扫描与替换边界。
