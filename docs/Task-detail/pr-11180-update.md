# pr-11180-update

## 任务信息

- 任务名称：更新 Obsidian 社区插件审核 PR #11180
- 开始时间：2026-04-08
- 当前状态：进行中
- 目标结果：将已修复代码通过新 release 资产同步给审核方，并在 `obsidianmd/obsidian-releases#11180` 留下明确跟进说明

## 任务背景

用户要求直接更新 `obsidianmd/obsidian-releases#11180` 对应的社区插件审核 PR。经前置核查发现：

- PR 当前仍为 `Open`
- 最后一次互动停留在 2026-03-20
- 本地与远端主分支已包含 review 修复提交
- 但 GitHub release 仍停留在 `0.1.0`，没有覆盖 2026-03-20 的修复

这意味着当前问题的根因不是“代码没修”，而是“审核方可下载到的 release 资产没有跟上源码修复”。

## 实施方案

1. 按仓库规范创建任务文档并更新任务历史索引。
2. 核对版本、release、GitHub 权限与仓库状态，确认可以直接执行发布闭环。
3. 将插件版本从 `0.1.0` 升级到新的补丁版本，重新生成构建产物。
4. 提交版本变更并推送到 GitHub 仓库。
5. 创建新的 GitHub release，确保 `main.js`、`manifest.json`、`styles.css` 与最新修复一致。
6. 在 `obsidianmd/obsidian-releases#11180` 留英文评论，明确说明修复已发布，请审核方继续 review。
7. 回写任务文档，记录执行结果、变动文件和验证情况。

## ToDoList

- [x] 阅读 `README.md` 与任务历史
- [x] 核查 PR 当前状态与 release 差异
- [ ] 升级补丁版本并生成发布资产
- [ ] 提交并推送版本更新
- [ ] 创建新的 GitHub release
- [ ] 在 PR #11180 留跟进评论
- [ ] 更新任务文档与结果记录

## 预期变动文件

- `manifest.json`
- `package.json`
- `package-lock.json`
- `versions.json`
- `docs/Task_history.md`
- `docs/Task-detail/pr-11180-update.md`

## 风险与注意事项

1. 不能只在 PR 里回复“已修复”，必须让 GitHub release 资产与修复提交对齐，否则审核方下载到的仍是旧包。
2. 版本号不能复用 `0.1.0`，否则 release 资产与历史记录会混乱，违反最基本的可追溯性。
3. 发布后仍可能需要等待人工审核，但那应建立在“交付物已更新”这个前提上，而不是被动空等。
