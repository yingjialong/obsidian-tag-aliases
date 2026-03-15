# Tag Aliases

An [Obsidian](https://obsidian.md) plugin that lets you define **tag aliases** so your vault stays consistent. When you type an alias like `#js`, the plugin suggests the primary tag `#javascript` — keeping your tags clean without memorizing every variation.

## The Problem

You tag notes with `#js`, `#javascript`, `#JavaScript` — all meaning the same thing. Later, searching for `#javascript` misses notes tagged `#js`. Over time, your vault accumulates dozens of inconsistent tags for the same concepts.

## The Solution

Tag Aliases normalizes tags **at input time**:

1. **Define alias groups** — e.g., primary tag `#javascript` with aliases `#js`, `#JS`
2. **Type any alias** — the plugin intercepts Obsidian's tag suggestion and shows the primary tag
3. **Select and insert** — the primary tag is inserted, not the alias

Since all notes end up with the same canonical tag, native search, Dataview, and the tag pane just work.

## Features

- **Alias Group Management** — Create, edit, and delete alias groups in the settings panel
- **Smart Tag Suggestions** — Overrides Obsidian's tag autocomplete with alias-aware suggestions
- **Auto-Replace** — Optionally auto-replace alias tags that slip through (configurable)
- **Batch Migration** — Scan your vault and replace all existing alias tags with primary tags in one click
- **Export / Import** — Back up your alias configuration as JSON; restore after reinstalling

## Installation

### From Obsidian Community Plugins (coming soon)

1. Open **Settings → Community plugins → Browse**
2. Search for "Tag Aliases"
3. Click **Install**, then **Enable**

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/yingjialong/obsidian-tag-aliases/releases)
2. Create a folder `<vault>/.obsidian/plugins/tag-aliases/`
3. Copy the downloaded files into this folder
4. Restart Obsidian and enable the plugin in **Settings → Community plugins**

## Usage

### Setting Up Alias Groups

1. Go to **Settings → Tag Aliases**
2. Click **Add New Alias Group**
3. Enter the primary tag (e.g., `#javascript`) and its aliases (e.g., `#js`, `#JS`)
4. Save

### Writing Notes

Just type `#` followed by any alias — the suggestion popup will show the primary tag with a hint indicating which alias matched. Select it, and the primary tag is inserted.

### Migrating Existing Tags

If your vault already has inconsistent tags:

1. Go to **Settings → Tag Aliases → Batch Migration**
2. Click **Scan & Replace**
3. Review the preview of changes
4. Confirm to apply

### Backup & Restore

- **Export**: Settings → Tag Aliases → Export to save your configuration as JSON
- **Import**: Settings → Tag Aliases → Import to restore from a previously exported JSON file

## Development

```bash
npm install       # Install dependencies
npm run dev       # Development mode (watch & rebuild)
npm run build     # Production build
```

## License

[MIT](LICENSE)
