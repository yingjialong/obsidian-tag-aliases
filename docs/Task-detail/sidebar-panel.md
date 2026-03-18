# Tag Aliases Sidebar Panel — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-sidebar panel (Obsidian ItemView) that displays all vault tags, supports inline alias editing, conflict detection, search, and sort — replacing the settings tab as the primary alias management UI.

**Architecture:** New `ItemView` subclass renders a merged list of vault tags + alias groups. Pure-function `ConflictChecker` runs on open and after each edit. Inline expand/collapse editing avoids modals. Settings tab retains behavior/migration/backup sections only.

**Tech Stack:** Obsidian API (`ItemView`, `MetadataCache.getTags()`), TypeScript, Jest (for ConflictChecker tests)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/core/ConflictChecker.ts` | Pure function: detect conflicts across alias groups |
| Create | `tests/conflictChecker.test.ts` | Tests for conflict detection |
| Create | `src/ui/TagSidebarView.ts` | ItemView: tag list, search, sort, inline editing, conflict banner |
| Modify | `src/constants.ts` | Add `VIEW_TYPE_TAG_ALIASES` constant |
| Modify | `src/main.ts` | Register view, ribbon icon, toggle command |
| Modify | `src/ui/SettingTab.ts` | Remove group CRUD section, add "Open Sidebar" button |
| Modify | `styles.css` | Add sidebar-specific styles |

---

## Chunk 1: ConflictChecker (pure logic + tests)

### Task 1: ConflictChecker — tests and implementation

**Files:**
- Create: `src/core/ConflictChecker.ts`
- Create: `tests/conflictChecker.test.ts`

- [ ] **Step 1: Write ConflictChecker interface and failing tests**

Create `tests/conflictChecker.test.ts`:

```typescript
import { checkConflicts } from '../src/core/ConflictChecker';
import { AliasGroup } from '../src/types';

const group = (id: string, primary: string, aliases: string[]): AliasGroup => ({
    id, primaryTag: primary, aliases,
});

describe('checkConflicts', () => {
    test('no conflicts with valid groups', () => {
        const groups = [
            group('1', '#javascript', ['#js', '#JS']),
            group('2', '#python', ['#py']),
        ];
        expect(checkConflicts(groups)).toEqual([]);
    });

    test('no conflicts with empty array', () => {
        expect(checkConflicts([])).toEqual([]);
    });

    test('detects duplicate alias across groups', () => {
        const groups = [
            group('1', '#javascript', ['#js']),
            group('2', '#java-script', ['#js']),
        ];
        const conflicts = checkConflicts(groups);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].type).toBe('duplicate-alias');
        expect(conflicts[0].tag).toBe('#js');
        expect(conflicts[0].groupIds).toContain('1');
        expect(conflicts[0].groupIds).toContain('2');
    });

    test('detects primary tag used as alias in another group', () => {
        const groups = [
            group('1', '#js', ['#j']),
            group('2', '#javascript', ['#js']),
        ];
        const conflicts = checkConflicts(groups);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].type).toBe('primary-as-alias');
        expect(conflicts[0].tag).toBe('#js');
    });

    test('detects duplicate primary tags (case-insensitive)', () => {
        const groups = [
            group('1', '#JavaScript', ['#js']),
            group('2', '#javascript', ['#jscript']),
        ];
        const conflicts = checkConflicts(groups);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].type).toBe('duplicate-primary');
    });

    test('detects multiple conflicts at once', () => {
        const groups = [
            group('1', '#javascript', ['#js']),
            group('2', '#java-script', ['#js']),    // dup alias
            group('3', '#JavaScript', ['#jscript']), // dup primary
        ];
        const conflicts = checkConflicts(groups);
        expect(conflicts.length).toBeGreaterThanOrEqual(2);
    });

    test('case-insensitive alias comparison', () => {
        const groups = [
            group('1', '#javascript', ['#JS']),
            group('2', '#java', ['#js']),
        ];
        const conflicts = checkConflicts(groups);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].type).toBe('duplicate-alias');
    });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/conflictChecker.test.ts
```

Expected: FAIL — `Cannot find module '../src/core/ConflictChecker'`

- [ ] **Step 3: Implement ConflictChecker**

Create `src/core/ConflictChecker.ts`:

```typescript
/**
 * ConflictChecker — detect conflicts across alias groups.
 *
 * Pure function, no Obsidian dependencies. Returns a list of
 * Conflict objects describing each issue found.
 */

import { AliasGroup } from '../types';

/** A single conflict detected between alias groups. */
export interface Conflict {
    /** Conflict category. */
    type: 'duplicate-alias' | 'primary-as-alias' | 'duplicate-primary';
    /** Human-readable description of the conflict. */
    description: string;
    /** The tag involved in the conflict. */
    tag: string;
    /** IDs of the groups involved. */
    groupIds: string[];
}

/**
 * Check all alias groups for inter-group conflicts.
 * Returns an empty array if no conflicts are found.
 */
export function checkConflicts(groups: AliasGroup[]): Conflict[] {
    const conflicts: Conflict[] = [];
    const normalize = (t: string) => t.replace(/^#/, '').toLowerCase();

    // Index: normalized tag -> list of { groupId, role }
    const tagOwners: Map<string, { groupId: string; tag: string; role: 'primary' | 'alias' }[]> = new Map();

    for (const group of groups) {
        const pNorm = normalize(group.primaryTag);
        if (!tagOwners.has(pNorm)) tagOwners.set(pNorm, []);
        tagOwners.get(pNorm)!.push({ groupId: group.id, tag: group.primaryTag, role: 'primary' });

        for (const alias of group.aliases) {
            const aNorm = normalize(alias);
            if (!tagOwners.has(aNorm)) tagOwners.set(aNorm, []);
            tagOwners.get(aNorm)!.push({ groupId: group.id, tag: alias, role: 'alias' });
        }
    }

    // Detect conflicts: any normalized tag owned by more than one entry
    for (const [norm, owners] of tagOwners) {
        if (owners.length <= 1) continue;

        const groupIds = [...new Set(owners.map(o => o.groupId))];
        if (groupIds.length <= 1) continue; // same group (e.g., primary = alias, caught by validate)

        const hasPrimary = owners.some(o => o.role === 'primary');
        const hasAlias = owners.some(o => o.role === 'alias');
        const primaryCount = owners.filter(o => o.role === 'primary').length;
        const tag = owners[0].tag;

        if (primaryCount >= 2) {
            conflicts.push({
                type: 'duplicate-primary',
                description: `"${tag}" is used as primary tag in multiple groups.`,
                tag,
                groupIds,
            });
        } else if (hasPrimary && hasAlias) {
            conflicts.push({
                type: 'primary-as-alias',
                description: `"${tag}" is a primary tag in one group and an alias in another.`,
                tag,
                groupIds,
            });
        } else {
            conflicts.push({
                type: 'duplicate-alias',
                description: `"${tag}" is used as an alias in multiple groups.`,
                tag,
                groupIds,
            });
        }
    }

    return conflicts;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- tests/conflictChecker.test.ts
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/ConflictChecker.ts tests/conflictChecker.test.ts
git commit -m "feat: add ConflictChecker with tests for alias group validation"
```

---

## Chunk 2: Sidebar skeleton + registration

### Task 2: Constants, view registration, and minimal sidebar

**Files:**
- Modify: `src/constants.ts` — add VIEW_TYPE
- Create: `src/ui/TagSidebarView.ts` — minimal ItemView skeleton
- Modify: `src/main.ts` — register view, ribbon icon, toggle command

- [ ] **Step 1: Add VIEW_TYPE constant**

In `src/constants.ts`, add:

```typescript
/** Sidebar view type identifier for Obsidian's view registry. */
export const VIEW_TYPE_TAG_ALIASES = 'tag-aliases-sidebar';
```

- [ ] **Step 2: Create minimal TagSidebarView**

Create `src/ui/TagSidebarView.ts` with a working skeleton that just renders the header, search bar, and sort dropdown. No tag list yet — that's Task 3.

The view receives a reference to the plugin instance (for accessing `aliasManager`, `settings`, and `saveSettings()`).

Key structure:
```typescript
import { ItemView, WorkspaceLeaf } from 'obsidian';
import type TagAliasesPlugin from '../main';
import { VIEW_TYPE_TAG_ALIASES } from '../constants';

export class TagSidebarView extends ItemView {
    private plugin: TagAliasesPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: TagAliasesPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return VIEW_TYPE_TAG_ALIASES; }
    getDisplayText(): string { return 'Tag Aliases'; }
    getIcon(): string { return 'tags'; }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1]; // Obsidian ItemView content area
        container.empty();
        container.addClass('tag-aliases-sidebar');
        // Render header with search + sort (placeholder for now)
        container.createEl('div', { cls: 'tag-aliases-sidebar-header', text: 'Tag Aliases' });
    }

    async onClose(): Promise<void> {
        this.containerEl.empty();
    }
}
```

- [ ] **Step 3: Register view, ribbon icon, and command in main.ts**

In `src/main.ts`, add:

1. Import `TagSidebarView` and `VIEW_TYPE_TAG_ALIASES`
2. In `onload()`:
   ```typescript
   // Register sidebar view
   this.registerView(VIEW_TYPE_TAG_ALIASES, (leaf) => new TagSidebarView(leaf, this));

   // Ribbon icon to toggle sidebar
   this.addRibbonIcon('tags', 'Open Tag Aliases', () => {
       this.activateSidebarView();
   });

   // Command to toggle sidebar
   this.addCommand({
       id: 'open-tag-aliases-sidebar',
       name: 'Open Tag Aliases sidebar',
       callback: () => this.activateSidebarView(),
   });
   ```
3. Add the `activateSidebarView` method:
   ```typescript
   async activateSidebarView(): Promise<void> {
       const { workspace } = this.app;
       let leaf = workspace.getLeavesOfType(VIEW_TYPE_TAG_ALIASES)[0];
       if (!leaf) {
           const rightLeaf = workspace.getRightLeaf(false);
           if (!rightLeaf) return;
           await rightLeaf.setViewState({ type: VIEW_TYPE_TAG_ALIASES, active: true });
           leaf = rightLeaf;
       }
       workspace.revealLeaf(leaf);
   }
   ```
4. In `onunload()`, add: `this.app.workspace.detachLeavesOfType(VIEW_TYPE_TAG_ALIASES);`

- [ ] **Step 4: Build and verify manually**

```bash
npm run build
```

Verify: plugin builds, ribbon icon appears, clicking opens an empty sidebar panel with "Tag Aliases" header.

- [ ] **Step 5: Commit**

```bash
git add src/constants.ts src/ui/TagSidebarView.ts src/main.ts
git commit -m "feat: register sidebar view with ribbon icon and command"
```

---

## Chunk 3: Tag list rendering + search + sort

### Task 3: Build merged tag list and render it

**Files:**
- Modify: `src/ui/TagSidebarView.ts`

This is the core of the sidebar. The view must:

1. **Fetch data**: `MetadataCache.getTags()` → vault tags with counts; `aliasManager.getGroups()` → alias groups
2. **Build display list**: For each vault tag, determine if it's a primary, alias, or standalone. Exclude known aliases from the top-level list. Include alias groups whose primary has 0 vault usage.
3. **Render**: Scrollable list with each tag showing name, count badge, and alias summary.

**Display item data model** (internal to the view, not in types.ts):
```typescript
interface DisplayTag {
    tag: string;              // "#javascript"
    count: number;            // vault usage count
    group: AliasGroup | null; // non-null = has alias group
    hasConflict: boolean;     // involved in a conflict
}
```

**Merge logic** (pseudocode):
```
aliasSet = set of all normalized aliases across all groups
displayList = []

for each (tag, count) in vaultTags:
    if normalize(tag) in aliasSet → skip
    group = aliasManager.findGroup(tag) where tag is primary
    displayList.push({ tag, count, group, hasConflict: false })

for each group in aliasGroups:
    if group.primaryTag not already in displayList:
        displayList.push({ tag: group.primaryTag, count: 0, group, hasConflict: false })
```

- [ ] **Step 1: Implement `buildDisplayList()` method**

Private method on TagSidebarView that returns `DisplayTag[]`.

- [ ] **Step 2: Implement `renderTagList()` method**

Renders the list into a scrollable container. Each item shows:
- Tag name (with `#` prefix)
- Alias count badge (if group exists): `[3 aliases]`
- Vault count: `×42`
- Aliases preview line in muted text: `js, JS, Js`

Collapsed items use a `tag-aliases-sidebar-item` div. Items with groups get a `▸` indicator and `is-group` class.

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Verify: sidebar shows all vault tags with correct counts and alias info.

- [ ] **Step 4: Commit**

```bash
git add src/ui/TagSidebarView.ts
git commit -m "feat: render merged vault tag list in sidebar"
```

### Task 4: Search and sort

**Files:**
- Modify: `src/ui/TagSidebarView.ts`

- [ ] **Step 1: Add search input**

At the top of the sidebar, add a text input with placeholder "Search tags...". On input, filter the display list:
- Match against tag name (without `#`, case-insensitive, partial/substring match)
- Match against alias names (same rules)

Store current search query as instance state. Re-render tag list on each input event (debounced 150ms).

- [ ] **Step 2: Add sort dropdown**

Below the search input, add a `<select>` with options:
- `name-asc` — Name A → Z (default)
- `name-desc` — Name Z → A
- `count-desc` — Most used first
- `alias-desc` — Most aliases first

Store current sort mode as instance state. Re-render on change.

**Sort comparator logic:**
```typescript
function compareTags(a: DisplayTag, b: DisplayTag, mode: string): number {
    switch (mode) {
        case 'name-desc': return b.tag.localeCompare(a.tag);
        case 'count-desc': return b.count - a.count;
        case 'alias-desc': return (b.group?.aliases.length ?? 0) - (a.group?.aliases.length ?? 0);
        default: return a.tag.localeCompare(b.tag); // name-asc
    }
}
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Verify: search filters tags in real time; sort dropdown reorders list.

- [ ] **Step 4: Commit**

```bash
git add src/ui/TagSidebarView.ts
git commit -m "feat: add search and sort to sidebar tag list"
```

---

## Chunk 4: Inline editing + conflict UI

### Task 5: Expand/collapse and inline alias editing

**Files:**
- Modify: `src/ui/TagSidebarView.ts`

- [ ] **Step 1: Implement expand/collapse**

Track `expandedTagId: string | null` in view state. Clicking a tag item:
- If it has a group → toggle expanded state, show alias edit panel
- If standalone → expand with "create group" flow (empty alias list + add input)
- Clicking another item collapses the previously expanded one

- [ ] **Step 2: Implement expanded panel for existing groups**

When expanded, render below the tag item:
```
┌───────────────────────────┐
│  #js                  [✕] │
│  #JS                  [✕] │
│  ┌──────────────┐    [＋] │
│  │ add alias... │         │
│  └──────────────┘         │
│  [error message area]     │
│            [Delete Group] │
└───────────────────────────┘
```

Each alias row: text display + delete button (✕). Clicking ✕:
1. Remove alias from group
2. If last alias → delete entire group (confirm with user? or just delete)
3. Call `aliasManager.updateGroup()` or `removeGroup()`
4. Persist + refresh

Add alias flow:
1. User types in input, presses Enter or clicks ＋
2. Validate via `aliasManager.validate()` (with `excludeId` for the current group)
3. If valid → update group, persist, refresh
4. If invalid → show error message below input (red text, fades after 3s)

- [ ] **Step 3: Implement standalone tag → create group flow**

When a standalone tag is expanded:
1. Show add-alias input with ＋ button and Cancel button
2. User adds first alias → create new group via `aliasManager.addGroup()`
3. Persist + refresh (tag now shows as a group)
4. Cancel → collapse without creating

- [ ] **Step 4: Implement delete group**

"Delete Group" button at bottom of expanded panel:
1. Call `aliasManager.removeGroup(groupId)`
2. Persist + refresh (tag reverts to standalone)

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Verify: expand/collapse works, can add/remove aliases, can create/delete groups, validation errors shown inline.

- [ ] **Step 6: Commit**

```bash
git add src/ui/TagSidebarView.ts
git commit -m "feat: inline alias editing in sidebar with expand/collapse"
```

### Task 6: Conflict detection UI

**Files:**
- Modify: `src/ui/TagSidebarView.ts`

- [ ] **Step 1: Run conflict check on view open and after edits**

In `onOpen()` and after any CRUD operation, call `checkConflicts(groups)`.

If conflicts found:
1. Render a warning banner at the top of the sidebar (below search/sort):
   ```html
   <div class="tag-aliases-conflict-banner">
     <strong>⚠ Conflicts detected</strong>
     <ul>
       <li>"#js" is used as an alias in multiple groups.</li>
       <li>...</li>
     </ul>
   </div>
   ```
2. Mark conflicting tags in the display list: set `hasConflict = true`
3. Conflicting items get `tag-aliases-sidebar-item-conflict` class (red left border)

- [ ] **Step 2: Clear banner when conflicts resolved**

After each edit, re-run `checkConflicts()`. If empty → remove banner and conflict highlights.

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Verify: manually create a conflict (edit data.json), open sidebar → banner appears, fix → banner disappears.

- [ ] **Step 4: Commit**

```bash
git add src/ui/TagSidebarView.ts
git commit -m "feat: conflict detection banner in sidebar"
```

---

## Chunk 5: CSS + SettingTab update

### Task 7: Sidebar CSS styles

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Add all sidebar styles**

CSS classes to implement:

```css
/* ── Sidebar container ── */
.tag-aliases-sidebar { padding: 0; }
.tag-aliases-sidebar-header { /* title area */ }

/* ── Search + sort bar ── */
.tag-aliases-sidebar-toolbar { /* flex row: search + sort */ }
.tag-aliases-sidebar-search { /* full-width text input */ }
.tag-aliases-sidebar-sort { /* select dropdown */ }

/* ── Conflict banner ── */
.tag-aliases-conflict-banner { /* red/warning background, padding, list of conflicts */ }

/* ── Tag list ── */
.tag-aliases-sidebar-list { /* scrollable container */ }
.tag-aliases-sidebar-item { /* single tag row: clickable, hover state */ }
.tag-aliases-sidebar-item.is-group { /* has ▸ indicator */ }
.tag-aliases-sidebar-item.is-expanded { /* ▾ indicator, highlighted background */ }
.tag-aliases-sidebar-item-conflict { /* red left border for conflicts */ }
.tag-aliases-sidebar-tag-name { /* tag text */ }
.tag-aliases-sidebar-count { /* ×N badge */ }
.tag-aliases-sidebar-aliases-preview { /* muted alias list below tag name */ }

/* ── Expanded edit panel ── */
.tag-aliases-sidebar-edit-panel { /* indented panel below tag item */ }
.tag-aliases-sidebar-alias-row { /* single alias: text + delete button */ }
.tag-aliases-sidebar-add-row { /* input + add button */ }
.tag-aliases-sidebar-error { /* red error message */ }
.tag-aliases-sidebar-delete-group { /* danger button at bottom */ }
```

Design principles:
- Use Obsidian CSS variables (`--text-muted`, `--background-modifier-border`, etc.)
- Follow existing `tag-aliases-` prefix convention
- Compact spacing suitable for sidebar width (~250px)
- Hover and focus states for interactive elements

- [ ] **Step 2: Build and verify visual quality**

```bash
npm run build
```

Verify: sidebar looks clean in both light and dark themes.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "feat: sidebar CSS styles for tag list and edit panel"
```

### Task 8: Simplify SettingTab

**Files:**
- Modify: `src/ui/SettingTab.ts`

- [ ] **Step 1: Replace group CRUD section**

Replace `renderAliasGroupSection()` with a simplified version:
- Show a read-only summary: "N alias groups configured"
- Add a button "Open Tag Aliases Sidebar" that calls `this.plugin.activateSidebarView()`
- Remove modal-based create/edit/delete (now handled by sidebar)

Keep the following sections unchanged:
- `renderBehaviorSection()` — auto-replace toggle
- `renderMigrationSection()` — batch migration
- `renderBackupSection()` — export/import

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Verify: settings tab shows summary + sidebar button; behavior/migration/backup sections unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/ui/SettingTab.ts
git commit -m "feat: simplify settings tab, delegate group management to sidebar"
```

### Task 9: Final verification and commit

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: all tests pass (conflictChecker + tagReplacer)

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: clean build, no TypeScript errors

- [ ] **Step 3: Manual testing checklist**

- Open sidebar via ribbon icon → tag list appears
- Search filters tags by name and alias
- Sort options work (A-Z, Z-A, count, alias count)
- Click group tag → expands, shows aliases
- Add alias → validates, saves, refreshes
- Delete alias → updates group, refreshes
- Delete last alias → removes group, tag becomes standalone
- Click standalone tag → create group flow
- Delete Group → tag reverts to standalone
- Conflict detection: edit data.json to create conflict, reopen sidebar → banner appears
- Fix conflict → banner disappears
- Settings tab shows "Open Sidebar" button
- Plugin loads/unloads cleanly

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete sidebar panel for tag alias management"
```
