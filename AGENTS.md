# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Tag Aliases plugin for Obsidian. Normalizes tags at input time by intercepting Obsidian's tag suggestions with alias-aware suggestions. Supports alias group management, auto-replace, batch migration, and export/import.

## Language Rules

- All code comments, README, git commit messages, and any other public-facing content MUST be written in English. This is an open-source project — anything visible to others must be in English.
- Internal documentation (e.g., `docs/Task-detail/`) and conversations with the developer may use Chinese.

## Build Commands

```bash
npm run dev    # Development mode (esbuild watch, auto-rebuild → main.js)
npm run build  # Production build (TypeScript type check + esbuild bundle)
npm run version # Version bump (sync manifest.json and versions.json)
```

No test framework is configured. Testing is done manually inside Obsidian. `npm run dev` watches for changes and rebuilds `main.js` in place, which Obsidian picks up on reload.

## Architecture

See `docs/Task-detail/project-plan.md` for the full implementation plan.

### Entry Point & Core Class

`src/main.ts` — `TagAliasesPlugin extends Plugin` is the entry point. Registers commands, event listeners, EditorSuggest, and the settings panel.

### Module Layout

```
src/
├── main.ts              # Plugin entry, lifecycle management
├── types.ts             # Core interfaces (AliasGroup, TagAliasSettings, etc.)
├── constants.ts         # Default settings, plugin constants
├── core/
│   └── AliasManager.ts  # Alias CRUD, index building, tag lookup (dual Map indexes)
├── suggest/
│   └── TagAliasSuggest.ts  # EditorSuggest: intercept tag input, merge with vault tags
├── migration/
│   └── BatchMigration.ts   # Scan vault, preview modal, execute replacements
├── ui/
│   ├── SettingTab.ts       # Plugin settings panel (4 sections)
│   └── AliasGroupModal.ts  # Modal for creating/editing alias groups
└── search/                 # [Reserved] Future search expansion
```

Output: `main.js` (generated bundle, do not edit), `styles.css` (hand-written CSS).

### Data Conventions

- **Tag format in data**: Tags in `AliasGroup` always include the `#` prefix (e.g., `"#javascript"`).
- **Tag normalization**: Internal lookups strip `#` and lowercase via `AliasManager.normalize()`. All index keys are normalized.
- **Dual index**: `AliasManager` maintains `primaryIndex` (normalized primary tag -> group) and `aliasIndex` (normalized alias -> group) for O(1) lookup.
- **CSS class prefix**: All CSS classes use `tag-aliases-` prefix.
- **Settings**: Stored via `loadData()`/`saveData()` -> `data.json`. Export/import for backup/restore.

### Core Data Flow

1. **Startup**: `loadData()` -> `AliasManager.buildIndex()` -> register EditorSuggest + events + commands
2. **Tag input**: User types `#` -> `TagAliasSuggest.onTrigger()` claims input -> `getSuggestions()` merges alias matches + vault tags -> `selectSuggestion()` inserts primary tag
3. **Auto-replace**: `metadataCache.on('changed')` -> detect alias tag near cursor -> Editor API `replaceRange()` (supports undo)
4. **Batch migration**: Scan all files -> preview modal -> inline regex replace + `processFrontMatter` for YAML

### Undocumented Obsidian APIs

The plugin relies on several internal/undocumented APIs (cast via `as any`):

- **`(app.workspace as any).editorSuggest.suggests`**: Array of registered EditorSuggest instances. Used to remove the built-in tag suggest and reorder priority. Restored on unload.
- **`(app.metadataCache as any).getTags()`**: Returns `Record<string, number>` of all vault tags with usage counts. Fallback to manual enumeration exists in `TagAliasSuggest.getVaultTags()`.
- **`(app.workspace as any).activeEditor`**: Used in auto-replace to get the current editor instance.

### Key Obsidian APIs Used

- `EditorSuggest`: intercept tag input suggestions
- `getAllTags()`: get tags from a single file's cache
- `processFrontMatter()`: modify YAML frontmatter tags
- `loadData()`/`saveData()`: persist settings to `data.json`

### Key Dependencies

- `obsidian`: Obsidian API (provided by runtime, external in bundle)
- `esbuild`: Build tool
- No runtime dependencies beyond Obsidian API
