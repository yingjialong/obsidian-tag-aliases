# Tag Aliases 插件 -- 完整实施计划

> 状态: 待审批
> 创建时间: 2026-03-15
> 版本: v1.0

---

## 一、项目概述

### 1.1 问题背景

Obsidian 原生不支持标签别名。用户经常为同一概念打不同 tag（如 `#js`、`#javascript`、`#JavaScript`），导致后续检索时无法一次性找到所有相关文档。社区自 2020 年起持续提出此需求，至今无插件完整解决。

### 1.2 解决方案

采用**输入时标准化**策略：在用户打标签时接管 Obsidian 的标签建议，无论输入正式标签还是别名，都提示并引导用户使用正确的主标签。从源头消除标签不一致问题，使原生搜索和 Dataview 等工具无需任何适配即可正常工作。

### 1.3 核心功能

1. **别名组管理**：设置面板中管理标签别名组（一个主标签 + 多个别名）
2. **智能标签建议**：接管编辑器标签输入建议，匹配别名时提示主标签
3. **自动替换**：用户跳过建议直接输入别名标签时，可自动替换为主标签（可配置）
4. **批量迁移**：一键扫描 vault，将已有的别名标签替换为主标签
5. **导出/导入**：别名配置可导出为 JSON 文件备份，卸载重装后可导入恢复

### 1.5 数据存储策略

采用 **标准 data.json + 导出/导入** 方案：
- **主存储**：使用 Obsidian 标准 `loadData()`/`saveData()` API，数据保存在 `plugins/tag-aliases/data.json`，各平台兼容性有保证
- **备份恢复**：提供导出/导入功能，用户可将别名配置导出为 JSON 文件保存到 vault 中任意位置，卸载重装后通过导入恢复
- **卸载影响**：卸载插件会删除 `data.json`，但导出的 JSON 备份文件不受影响

### 1.6 暂不实现

- 搜索扩展命令（架构上预留 `search/` 目录，未来可扩展）
- 自定义标签面板视图
- Dataview 辅助 API
- 标签视觉装饰器

---

## 二、技术架构

### 2.1 技术栈

| 项目 | 选择 | 说明 |
|------|------|------|
| 语言 | TypeScript | 与 OBCS 一致 |
| 构建 | esbuild | 参考 OBCS 构建配置 |
| 输出 | CommonJS, ES2018 | Obsidian 运行时要求 |
| 最低 Obsidian 版本 | 1.0.0 | 使用的 API 均在此版本可用 |
| 插件 ID | `tag-aliases` | |
| 项目目录名 | `obsidian-tag-aliases` | |

### 2.2 项目结构

```
obsidian-tag-aliases/
├── src/
│   ├── main.ts                   # 插件入口，生命周期管理，命令/事件注册
│   ├── types.ts                  # 类型定义（TagAliasSettings, AliasGroup 等）
│   ├── constants.ts              # 默认配置
│   ├── core/
│   │   └── AliasManager.ts       # 别名管理核心（CRUD、索引构建、查询）
│   ├── suggest/
│   │   └── TagAliasSuggest.ts    # EditorSuggest 实现（接管标签建议）
│   ├── migration/
│   │   └── BatchMigration.ts     # 批量扫描和替换别名标签
│   ├── ui/
│   │   ├── SettingTab.ts         # 插件设置面板
│   │   └── AliasGroupModal.ts    # 别名组编辑弹窗
│   └── search/                   # [预留] 搜索扩展模块
│       └── .gitkeep
├── styles.css                    # 插件样式
├── manifest.json                 # Obsidian 插件清单
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── version-bump.mjs
├── versions.json
├── CLAUDE.md                     # Claude Code 项目指引
├── README.md
├── README_ZH.md
├── LICENSE
└── docs/
    ├── Task_history.md
    └── Task-detail/
        └── project-plan.md       # 本文档
```

### 2.3 核心数据流

```
┌─ 启动阶段 ───────────────────────────────────────────────────────┐
│ loadData() → AliasManager.buildIndex()                           │
│   → 构建 Map<normalizedTag, AliasGroup> 正向索引                  │
│   → 构建 Map<normalizedAlias, AliasGroup> 别名反向索引            │
│   → 注册 EditorSuggest                                           │
│   → 注册 MetadataCache 事件监听（可选自动替换）                    │
│   → 注册命令（批量迁移等）                                        │
└──────────────────────────────────────────────────────────────────┘

┌─ 用户输入标签（核心路径） ────────────────────────────────────────┐
│ 用户输入 #js                                                     │
│   → TagAliasSuggest.onTrigger() 检测 # 前缀，认领输入             │
│   → getSuggestions() 查询 AliasManager                           │
│      → 匹配主标签名（前缀匹配）                                   │
│      → 匹配别名（前缀匹配）                                       │
│      → 合并结果，标注匹配来源                                      │
│   → renderSuggestion() 渲染建议项                                 │
│      → 主标签: "#javascript"                                      │
│      → 别名提示: "匹配别名: js"                                    │
│   → selectSuggestion() 用户选择后插入主标签 "#javascript"          │
└──────────────────────────────────────────────────────────────────┘

┌─ 自动替换（补救路径，可配置） ────────────────────────────────────┐
│ 用户输入 #js 后未选建议，直接按空格                                │
│   → metadataCache.on('changed') 触发                              │
│   → 检测文件中新增的标签                                           │
│   → AliasManager.findGroupByAlias("#js") 命中                     │
│   → 替换文件中 #js → #javascript                                  │
│   → 设置防循环标志，避免再次触发 changed 事件                      │
└──────────────────────────────────────────────────────────────────┘

┌─ 批量迁移 ──────────────────────────────────────────────────────┐
│ 用户执行 "Migrate alias tags" 命令                               │
│   → 扫描所有 markdown 文件                                       │
│   → 通过 MetadataCache 收集每个文件的标签                         │
│   → 匹配别名 → 生成替换计划                                      │
│   → 弹出确认 Modal 显示变更预览                                   │
│   → 用户确认后执行替换（内联标签正则替换 + frontmatter 处理）      │
│   → 输出迁移报告                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 三、核心类型定义

```typescript
/** 别名组：一个主标签 + 多个别名 */
interface AliasGroup {
    /** 唯一标识符 */
    id: string;
    /** 主标签（带 # 前缀），如 "#javascript" */
    primaryTag: string;
    /** 别名列表（带 # 前缀），如 ["#js", "#JS"] */
    aliases: string[];
    /** 可选描述 */
    description?: string;
}

/** 插件设置 */
interface TagAliasSettings {
    /** 别名组列表 */
    aliasGroups: AliasGroup[];
    /** 是否启用自动替换（用户跳过建议时） */
    autoReplace: boolean;
    /** 选择建议项后插入的标签类型 */
    insertBehavior: 'primary';  // 始终插入主标签（未来可扩展为 'as-typed' 等）
}

/** EditorSuggest 的建议项 */
interface TagSuggestionItem {
    /** 要插入的标签文本 */
    insertText: string;
    /** 显示的标签名 */
    displayText: string;
    /** 匹配来源: 'primary' 直接匹配主标签, 'alias' 通过别名匹配 */
    matchSource: 'primary' | 'alias' | 'none';
    /** 如果通过别名匹配，显示匹配的别名 */
    matchedAlias?: string;
    /** 所属别名组（如果有） */
    group?: AliasGroup;
    /** 该标签在 vault 中的使用次数 */
    count?: number;
}

/** 批量迁移的替换计划 */
interface MigrationPlan {
    /** 需要修改的文件列表 */
    changes: MigrationChange[];
    /** 总替换数 */
    totalReplacements: number;
}

interface MigrationChange {
    /** 文件对象 */
    file: TFile;
    /** 该文件中的替换列表 */
    replacements: Array<{
        /** 原别名标签 */
        from: string;
        /** 目标主标签 */
        to: string;
        /** 标签位置: 内联 or frontmatter */
        location: 'inline' | 'frontmatter';
    }>;
}
```

---

## 四、模块详细设计

### 4.1 AliasManager（核心模块）

**职责**：别名组的 CRUD 操作，维护高效查找索引。

**核心数据结构**：
```typescript
class AliasManager {
    /** 主标签 → 别名组的索引（key 为小写标签名，不含 #） */
    private primaryIndex: Map<string, AliasGroup>;
    /** 别名 → 别名组的反向索引（key 为小写标签名，不含 #） */
    private aliasIndex: Map<string, AliasGroup>;

    /** 从 settings 构建索引，插件启动时调用 */
    buildIndex(groups: AliasGroup[]): void;

    /** 通过任意标签名查找所属别名组 */
    findGroup(tag: string): AliasGroup | null;

    /** 判断标签是否为某个别名（非主标签） */
    isAlias(tag: string): boolean;

    /** 获取标签对应的主标签（如果是别名则返回主标签，否则返回自身） */
    getPrimaryTag(tag: string): string;

    /** 模糊搜索：输入前缀，返回匹配的主标签和别名 */
    search(query: string): TagSuggestionItem[];

    /** CRUD 操作 */
    addGroup(group: AliasGroup): void;
    updateGroup(id: string, group: Partial<AliasGroup>): void;
    removeGroup(id: string): void;
    getGroups(): AliasGroup[];
}
```

**查找性能**：Map 查找 O(1)，搜索为 O(n) 遍历所有标签+别名（n 通常 < 1000，毫秒级）。

**标签标准化**：内部查找时统一转小写、去除 `#` 前缀。存储时保留用户输入的原始大小写。

### 4.2 TagAliasSuggest（EditorSuggest 实现）

**职责**：接管 Obsidian 编辑器中 `#` 触发的标签建议，融合别名信息。

**关键实现**：

```typescript
class TagAliasSuggest extends EditorSuggest<TagSuggestionItem> {

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null):
        EditorSuggestTriggerInfo | null {
        // 1. 获取光标所在行文本
        // 2. 从光标位置往前查找 # 符号
        // 3. 提取 # 后面的输入文本作为 query
        // 4. 如果匹配到 #xxx 模式，返回 trigger info（认领此次输入）
        // 5. 否则返回 null（让内置建议器接管）
    }

    getSuggestions(context: EditorSuggestContext): TagSuggestionItem[] {
        const query = context.query;  // 用户输入的 # 后面的文本

        // 1. 从 AliasManager 搜索匹配的别名组
        const aliasResults = this.aliasManager.search(query);

        // 2. 从 MetadataCache.getTags() 获取 vault 中所有已有标签
        // 3. 对已有标签做前缀匹配
        // 4. 合并两个结果，别名匹配的排在前面
        // 5. 去重（同一个主标签只出现一次）
        // 6. 返回排序后的建议列表
    }

    renderSuggestion(item: TagSuggestionItem, el: HTMLElement): void {
        // 渲染建议项：
        // - 主文本: 标签名（如 "#javascript"）
        // - 副文本: 如果是别名匹配，显示 "↩ 别名: js"
        // - 右侧: 使用次数（如 "×15"）
    }

    selectSuggestion(item: TagSuggestionItem, evt: MouseEvent | KeyboardEvent): void {
        // 1. 获取要插入的文本（始终为主标签）
        // 2. 替换编辑器中 # 开始的输入文本为主标签
    }
}
```

**关键设计决策**：

- `onTrigger` 只在检测到 `#` + 字母/数字时返回非 null，此时应能阻止内置标签建议弹出
- 建议列表同时包含别名组标签和 vault 中的普通标签（无别名的标签照常建议）
- 选择建议后始终插入主标签文本

**风险与验证**：

插件的 `EditorSuggest` 和 Obsidian 内置标签建议器的优先级关系未在公开 API 中承诺。需要在开发初期用最小代码验证：
1. 注册 EditorSuggest 后内置建议是否被抑制
2. 如果两者同时弹出，需要研究 monkey-patch 方案抑制内置建议器
3. 验证方案在不同平台（桌面/移动端）的一致性

### 4.3 SettingTab（设置面板）

**职责**：插件设置界面，管理别名组和全局选项。

**界面布局**：

```
Tag Aliases 设置
════════════════════════════════════════════

别名组管理
────────────────────────────────────────────
┌─────────────────────────────────────────┐
│ javascript                              │
│ 主标签: #javascript                     │
│ 别名: #js, #JS, #Javascript            │
│                          [编辑] [删除]   │
├─────────────────────────────────────────┤
│ machine-learning                        │
│ 主标签: #machine-learning               │
│ 别名: #ML, #ml                          │
│                          [编辑] [删除]   │
└─────────────────────────────────────────┘
              [+ 新建别名组]

行为设置
────────────────────────────────────────────
自动替换别名标签    [开关]
  用户跳过建议直接输入别名时，自动替换为主标签

数据迁移
────────────────────────────────────────────
[扫描并替换 Vault 中的别名标签]
  扫描所有文件，将已有的别名标签批量替换为主标签

备份与恢复
────────────────────────────────────────────
[导出别名配置]
  将所有别名组导出为 JSON 文件，保存到 vault 中
  （建议卸载插件前先导出备份）

[导入别名配置]
  从 JSON 文件导入别名组配置
  （重装插件后可通过此功能恢复数据）
```

**交互流程**：
- 点击"新建别名组"或"编辑" → 打开 AliasGroupModal
- 点击"删除" → 确认后删除别名组
- 开关"自动替换"→ 切换 autoReplace 设置
- 点击"扫描并替换" → 执行批量迁移流程

### 4.4 AliasGroupModal（别名组编辑弹窗）

**职责**：创建或编辑一个别名组。

**界面布局**：

```
┌─ 编辑别名组 ──────────────────────────────┐
│                                           │
│  主标签:  [#javascript          ] [选择▼]  │
│           (从 vault 已有标签中选择或输入)   │
│                                           │
│  别名:                                    │
│    [#js          ] [✕]                    │
│    [#JS          ] [✕]                    │
│    [#Javascript  ] [✕]                    │
│    [+添加别名]                             │
│                                           │
│  描述:  [JavaScript 相关标签    ] (可选)    │
│                                           │
│              [取消]  [保存]                 │
└───────────────────────────────────────────┘
```

**验证规则**：
- 主标签不能为空
- 主标签不能与其他组的主标签或别名冲突
- 别名不能与其他组的主标签或别名冲突
- 同一组内别名不能重复
- 标签格式校验（只允许字母、数字、下划线、连字符、斜杠）

**主标签选择器**：使用 `FuzzyMatch` 或自定义下拉框，支持从 vault 现有标签中选择，也支持手动输入新标签。

### 4.5 BatchMigration（批量迁移）

**职责**：扫描 vault 中所有文件，将别名标签替换为主标签。

**执行流程**：

1. **扫描阶段**：
   - 遍历 `vault.getMarkdownFiles()`
   - 对每个文件通过 `metadataCache.getFileCache()` 获取标签
   - 检查每个标签是否为某个别名
   - 生成 `MigrationPlan`

2. **预览阶段**：
   - 弹出 Modal 显示变更预览
   - 列出每个文件的替换详情
   - 显示总替换数
   - 用户可选择确认或取消

3. **执行阶段**：
   - 内联标签替换：读取文件内容，用正则 `(?<![#\w])#alias\b` 替换为 `#primaryTag`
   - Frontmatter 标签替换：使用 `app.fileManager.processFrontMatter()`
   - 逐文件处理，每个文件替换后等待 MetadataCache 更新
   - 输出替换报告（Notice 通知）

**安全措施**：
- 替换前做预览确认
- 正则替换时确保只匹配完整标签（避免误替换标签的子串）
- Frontmatter 处理使用官方 API

### 4.6 自动替换（Auto-Replace）

**职责**：当用户跳过 EditorSuggest 建议、直接输入别名标签时，自动替换为主标签。

**实现方案**：

```typescript
// 监听 MetadataCache 变更事件
this.registerEvent(
    this.app.metadataCache.on('changed', (file, data, cache) => {
        if (!settings.autoReplace) return;
        if (this.isReplacing) return;  // 防止循环触发

        const tags = getAllTags(cache) || [];
        for (const tag of tags) {
            if (this.aliasManager.isAlias(tag)) {
                this.scheduleReplace(file, tag, this.aliasManager.getPrimaryTag(tag));
            }
        }
    })
);
```

**防循环机制**：
- 设置 `isReplacing` 标志，替换操作期间忽略 changed 事件
- 使用 `debounce` 合并短时间内的多次变更

**替换实现**：
- 读取文件内容
- 正则替换内联标签：确保替换完整标签词，不误伤嵌套标签
- Frontmatter 标签：通过 `processFrontMatter` API 处理
- 替换后文件自动保存

**注意事项**：
- 此功能默认关闭，用户可在设置中启用
- 替换操作是异步的，可能有短暂延迟
- 如果用户正在活跃编辑该文件，替换可能导致光标位置变化（需要测试实际体验）

---

## 五、开发任务拆解

### Phase 1: 项目初始化（预计产出: 可构建的空壳插件）

- [ ] 1.1 创建 `manifest.json`（plugin id: `tag-aliases`）
- [ ] 1.2 创建 `package.json`（依赖: obsidian, 构建: esbuild）
- [ ] 1.3 创建 `tsconfig.json`（参考 OBCS 配置）
- [ ] 1.4 创建 `esbuild.config.mjs`（参考 OBCS，去掉 OBCS 特有的环境变量）
- [ ] 1.5 创建 `version-bump.mjs`、`versions.json`
- [ ] 1.6 创建 `src/main.ts`（空壳 Plugin 类，onload/onunload）
- [ ] 1.7 创建 `src/types.ts`（核心类型定义）
- [ ] 1.8 创建 `src/constants.ts`（默认设置）
- [ ] 1.9 执行 `npm install`，验证 `npm run dev` 可构建
- [ ] 1.10 在 Obsidian 中启用插件，验证加载正常
- [ ] 1.11 创建 `CLAUDE.md`、`README.md`、`docs/Task_history.md`

### Phase 2: 核心数据层（预计产出: AliasManager 可用）

- [ ] 2.1 实现 `AliasManager` 类
  - [ ] 2.1.1 `buildIndex()` 构建正向/反向索引
  - [ ] 2.1.2 `findGroup()` / `isAlias()` / `getPrimaryTag()` 查询方法
  - [ ] 2.1.3 `search()` 模糊搜索（前缀匹配主标签和别名）
  - [ ] 2.1.4 `addGroup()` / `updateGroup()` / `removeGroup()` CRUD
- [ ] 2.2 在 `main.ts` 中集成 `loadData()`/`saveData()` 与 AliasManager
- [ ] 2.3 验证数据持久化（重启 Obsidian 后设置保留）

### Phase 3: 设置面板 UI（预计产出: 可视化管理别名组）

- [ ] 3.1 实现 `SettingTab`
  - [ ] 3.1.1 别名组列表展示（显示主标签、别名、编辑/删除按钮）
  - [ ] 3.1.2 "新建别名组"按钮
  - [ ] 3.1.3 自动替换开关
  - [ ] 3.1.4 批量迁移按钮
  - [ ] 3.1.5 导出/导入按钮
- [ ] 3.2 实现 `AliasGroupModal`
  - [ ] 3.2.1 主标签输入（支持从 vault 已有标签选择）
  - [ ] 3.2.2 别名列表编辑（添加/删除）
  - [ ] 3.2.3 描述输入
  - [ ] 3.2.4 保存时的验证逻辑（冲突检测）
- [ ] 3.3 设置面板整体样式（styles.css）
- [ ] 3.4 验证: 创建/编辑/删除别名组，重启后数据保持

### Phase 4: 智能标签建议（核心功能）

- [ ] 4.1 实现 `TagAliasSuggest`
  - [ ] 4.1.1 `onTrigger()`: 检测 `#` 输入并认领
  - [ ] 4.1.2 `getSuggestions()`: 合并别名匹配 + vault 已有标签
  - [ ] 4.1.3 `renderSuggestion()`: 渲染建议项（标签名 + 别名提示 + 使用次数）
  - [ ] 4.1.4 `selectSuggestion()`: 插入主标签
- [ ] 4.2 **关键验证**: 测试插件建议与内置标签建议的优先级
  - [ ] 4.2.1 验证 onTrigger 返回非 null 时内置建议是否被抑制
  - [ ] 4.2.2 如果两者冲突，研究并实现抑制内置建议的方案
  - [ ] 4.2.3 验证桌面端和移动端的一致性
- [ ] 4.3 验证: 输入别名前缀能看到主标签建议，选择后插入主标签
- [ ] 4.4 验证: 对无别名的普通标签，建议行为与原生一致

### Phase 5: 自动替换（补救机制）

- [ ] 5.1 实现 MetadataCache changed 事件监听
- [ ] 5.2 实现别名标签检测逻辑
- [ ] 5.3 实现内联标签替换（正则匹配完整标签）
- [ ] 5.4 实现 frontmatter 标签替换（processFrontMatter）
- [ ] 5.5 实现防循环机制（isReplacing 标志 + debounce）
- [ ] 5.6 验证: 输入别名标签后自动被替换为主标签
- [ ] 5.7 验证: 关闭设置后不再自动替换

### Phase 6: 批量迁移

- [ ] 6.1 实现扫描逻辑（遍历 vault 文件，生成 MigrationPlan）
- [ ] 6.2 实现预览 Modal（展示变更清单）
- [ ] 6.3 实现执行逻辑（内联替换 + frontmatter 替换）
- [ ] 6.4 实现迁移报告（Notice 通知成功/失败统计）
- [ ] 6.5 验证: 创建含别名标签的测试文件，执行迁移后标签全部标准化

### Phase 7: 导出/导入

- [ ] 7.1 实现导出功能
  - [ ] 7.1.1 将 aliasGroups 序列化为格式化 JSON
  - [ ] 7.1.2 通过文件选择器让用户选择保存位置（vault 内）
  - [ ] 7.1.3 写入 JSON 文件，显示成功通知
- [ ] 7.2 实现导入功能
  - [ ] 7.2.1 通过文件选择器让用户选择 JSON 文件
  - [ ] 7.2.2 解析并验证 JSON 结构（格式校验 + 冲突检测）
  - [ ] 7.2.3 提供导入策略选择: 覆盖现有 / 合并（跳过冲突）
  - [ ] 7.2.4 导入后重建索引，显示导入结果通知
- [ ] 7.3 验证: 导出 → 删除所有别名组 → 导入 → 数据完整恢复

### Phase 8: 收尾

- [ ] 8.1 完善 `CLAUDE.md`（项目架构、核心模块说明）
- [ ] 8.2 完善 `README.md`（功能介绍、使用说明）
- [ ] 8.3 更新 `docs/Task_history.md`
- [ ] 8.4 代码审查: 检查日志打印、注释完整性
- [ ] 8.5 全流程验证测试

---

## 六、风险分析

### 风险 1: EditorSuggest 优先级不确定（高风险）

**描述**：插件的 `EditorSuggest` 可能无法稳定抑制 Obsidian 内置标签建议，导致两个建议弹窗同时出现。

**影响**：核心功能受阻，用户体验混乱。

**缓解方案**：
1. 在 Phase 4 开始时优先验证此问题（4.2.1）
2. 如果不能自然抑制，备选方案：
   - monkey-patch 内置建议器（通过 `(app as any).workspace.editorSuggest` 访问内部建议列表，移除内置标签建议器）
   - 监听 DOM 事件，检测到内置建议弹窗时隐藏它
3. 参考社区插件（Various Complements、Completr）的处理方式

**决策点**：Phase 4.2 验证结果决定是否需要采用备选方案。

### 风险 2: 自动替换影响用户编辑体验（中风险）

**描述**：自动替换别名标签时修改文件内容，可能导致光标跳动、undo 历史被污染。

**影响**：用户感知"我打的东西被改了"，体验不佳。

**缓解方案**：
1. 默认关闭自动替换，用户主动启用
2. 替换时使用 Editor API（如果文件正在编辑）而非直接修改文件，可保留 undo 历史
3. 替换后短暂显示 Notice 提示"已将 #js 替换为 #javascript"
4. 如果体验始终不佳，降级为仅在文件关闭/切换时检查替换

### 风险 3: processFrontMatter 破坏 YAML 格式（低风险）

**描述**：`processFrontMatter` 会重新序列化 YAML，可能改变引号、注释等格式。

**影响**：文件 diff 变大，用户可能不接受格式变化。

**缓解方案**：
1. Frontmatter 标签替换使用字符串级别的正则替换而非 `processFrontMatter`
2. 仅在无法用正则安全替换时才回退到 `processFrontMatter`

---

## 七、构建与调试

### 开发流程

```bash
# 安装依赖
npm install

# 开发模式（监听文件变更，自动重新构建）
npm run dev

# 生产构建
npm run build
```

### 调试方法

1. 启动 `npm run dev`
2. 在 Obsidian 中打开设置 → 第三方插件 → 刷新 → 启用 Tag Aliases
3. Ctrl+Shift+I 打开开发者工具查看 console 日志
4. 修改代码后 esbuild 自动重新构建，在 Obsidian 中 Ctrl+R 重新加载

---

## 八、后续扩展方向（暂不实现）

1. **搜索扩展命令**：提供命令将标签别名自动扩展为 OR 查询
2. **Dataview 集成**：暴露 `expandAliases()` API 供 DataviewJS 使用
3. **标签视觉装饰**：阅读/编辑模式下对别名标签添加 tooltip
4. **自定义标签面板**：创建替代视图，合并显示同义标签
5. **智能推荐**：基于 vault 中已有标签，自动建议可能的别名组
