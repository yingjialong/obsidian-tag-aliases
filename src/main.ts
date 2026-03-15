/**
 * Tag Aliases - Obsidian Plugin
 *
 * Normalizes tags at input time by intercepting Obsidian's tag suggestions.
 * Allows defining alias groups so that typing any alias suggests and inserts
 * the canonical primary tag, keeping vault tags clean and consistent.
 */

import { Plugin, TFile, CachedMetadata, getAllTags, Notice, debounce } from 'obsidian';
import { TagAliasSettings } from './types';
import { DEFAULT_SETTINGS } from './constants';
import { AliasManager } from './core/AliasManager';
import { TagAliasesSettingTab } from './ui/SettingTab';
import { TagAliasSuggest } from './suggest/TagAliasSuggest';
import { BatchMigration } from './migration/BatchMigration';

export default class TagAliasesPlugin extends Plugin {
    /** Current plugin settings. */
    settings: TagAliasSettings = DEFAULT_SETTINGS;
    /** Core alias management: indexing, lookup, CRUD. */
    aliasManager: AliasManager = new AliasManager();
    /** Guard flag to prevent recursive auto-replace triggers. */
    private isReplacing = false;
    /** Reference to our EditorSuggest instance. */
    private tagAliasSuggest: TagAliasSuggest | null = null;
    /** Saved built-in tag suggest, restored on unload. */
    private removedBuiltInSuggest: any = null;
    /** Index of the removed built-in suggest, for restoring at the same position. */
    private removedBuiltInSuggestIndex = -1;

    /**
     * Plugin lifecycle: called when the plugin is loaded.
     * Registers settings, commands, editor suggest, and event listeners.
     */
    async onload(): Promise<void> {
        console.log('[TagAliases] Loading plugin...');

        // Load persisted settings and build alias index
        await this.loadSettings();
        this.aliasManager.buildIndex(this.settings.aliasGroups);

        // Register the settings tab
        this.addSettingTab(new TagAliasesSettingTab(this.app, this));

        // Register alias-aware tag suggestions
        this.tagAliasSuggest = new TagAliasSuggest(this.app, this.aliasManager);
        this.registerEditorSuggest(this.tagAliasSuggest);

        // Once layout is ready, move our suggest to top priority and
        // disable the built-in tag suggest to prevent conflicts
        this.app.workspace.onLayoutReady(() => {
            this.overrideBuiltInTagSuggest();
        });

        // Register auto-replace: detect alias tags and replace with primary tags
        this.registerAutoReplace();

        // Register migration command
        this.addCommand({
            id: 'migrate-alias-tags',
            name: 'Scan & replace alias tags in vault',
            callback: async () => {
                const migration = new BatchMigration(this.app, this.aliasManager);
                await migration.run();
            },
        });

        console.log('[TagAliases] Plugin loaded successfully.');
    }

    /**
     * Plugin lifecycle: called when the plugin is unloaded.
     * Restores the built-in tag suggest if it was removed.
     */
    onunload(): void {
        this.restoreBuiltInTagSuggest();
        console.log('[TagAliases] Plugin unloaded.');
    }

    /**
     * Load settings from disk, merging with defaults for any missing fields.
     */
    async loadSettings(): Promise<void> {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
        console.log('[TagAliases] Settings loaded.', {
            groupCount: this.settings.aliasGroups.length,
            autoReplace: this.settings.autoReplace,
        });
    }

    /**
     * Persist current settings to disk.
     */
    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        console.log('[TagAliases] Settings saved.');
    }

    /**
     * Override the built-in tag suggest by:
     * 1. Finding and removing the built-in tag suggest from the internal suggests array
     * 2. Ensuring our suggest is checked first (moved to front of array)
     *
     * This uses Obsidian's internal API (editorSuggest.suggests).
     * The built-in suggest is restored on plugin unload.
     */
    private overrideBuiltInTagSuggest(): void {
        try {
            const editorSuggest = (this.app.workspace as any).editorSuggest;
            if (!editorSuggest?.suggests) {
                console.warn('[TagAliases] Cannot access editorSuggest.suggests');
                return;
            }

            const suggests: any[] = editorSuggest.suggests;

            // Log all suggests for debugging
            console.log('[TagAliases] Registered suggests:',
                suggests.map((s: any, i: number) => `[${i}] ${s.constructor?.name}`));

            // Find and remove the built-in tag suggest
            // Identify it by: not our suggest, and its constructor name hints at tags
            for (let i = 0; i < suggests.length; i++) {
                const s = suggests[i];
                if (s === this.tagAliasSuggest) continue; // skip our own

                const name = s.constructor?.name || '';

                // Check constructor name for tag-related keywords
                // Obsidian's built-in class names are not minified
                if (this.looksLikeTagSuggest(s, name)) {
                    this.removedBuiltInSuggest = suggests.splice(i, 1)[0];
                    this.removedBuiltInSuggestIndex = i;
                    console.log('[TagAliases] Removed built-in tag suggest:',
                        name, 'at index', i);
                    break;
                }
            }

            // Move our suggest to the front of the array for priority
            const ourIndex = suggests.findIndex((s: any) => s === this.tagAliasSuggest);
            if (ourIndex > 0) {
                const [ours] = suggests.splice(ourIndex, 1);
                suggests.unshift(ours);
                console.log('[TagAliases] Moved our suggest to front, index 0');
            }

            console.log('[TagAliases] Final suggests order:',
                suggests.map((s: any, i: number) => `[${i}] ${s.constructor?.name}`));
        } catch (err) {
            console.error('[TagAliases] Failed to override built-in tag suggest:', err);
        }
    }

    /**
     * Heuristic to identify the built-in tag suggest.
     * Checks constructor name and internal properties.
     */
    private looksLikeTagSuggest(suggest: any, constructorName: string): boolean {
        // Check by constructor name (Obsidian doesn't minify class names)
        const nameLower = constructorName.toLowerCase();
        if (nameLower.includes('tag') && !nameLower.includes('tagalias')) {
            return true;
        }

        // Fallback: check if it has tag-specific internal behavior
        // by looking for properties that indicate tag completion
        try {
            if (suggest.onTrigger && suggest.getSuggestions) {
                // Try to see if this suggest handles '#' triggers by inspecting source
                const triggerStr = suggest.onTrigger.toString();
                if (triggerStr.includes('#') || triggerStr.includes('tag')) {
                    return true;
                }
            }
        } catch {
            // Ignore errors from toString() inspection
        }

        return false;
    }

    /**
     * Restore the built-in tag suggest on plugin unload.
     */
    private restoreBuiltInTagSuggest(): void {
        if (!this.removedBuiltInSuggest) return;

        try {
            const editorSuggest = (this.app.workspace as any).editorSuggest;
            if (!editorSuggest?.suggests) return;

            const suggests: any[] = editorSuggest.suggests;
            // Insert back at original position (or end if index is invalid)
            const insertAt = Math.min(this.removedBuiltInSuggestIndex, suggests.length);
            suggests.splice(insertAt, 0, this.removedBuiltInSuggest);
            console.log('[TagAliases] Restored built-in tag suggest at index', insertAt);

            this.removedBuiltInSuggest = null;
            this.removedBuiltInSuggestIndex = -1;
        } catch (err) {
            console.error('[TagAliases] Failed to restore built-in tag suggest:', err);
        }
    }

    /**
     * Register the auto-replace mechanism.
     * Listens to MetadataCache 'changed' events and replaces alias tags
     * with their primary tags when the autoReplace setting is enabled.
     *
     * Key timing logic: only replaces tags that are "completed" — i.e.,
     * the cursor is NOT immediately adjacent to the tag (the user has
     * pressed space/enter/etc. and moved past it).
     */
    private registerAutoReplace(): void {
        // Debounced handler: 300ms is enough since isCursorAtTagEnd()
        // already guards against premature replacement while typing
        const debouncedReplace = debounce(
            async (file: TFile, _data: string, cache: CachedMetadata) => {
                await this.processAutoReplace(file, cache);
            },
            100,
            true,
        );

        this.registerEvent(
            this.app.metadataCache.on('changed', (file, data, cache) => {
                if (!this.settings.autoReplace || this.isReplacing) {
                    return;
                }
                debouncedReplace(file, data, cache);
            }),
        );
    }

    /**
     * Process auto-replace for a single file.
     * Only replaces alias tags that are "completed" — the cursor is not
     * still at the end of the tag (user is done typing).
     */
    private async processAutoReplace(file: TFile, cache: CachedMetadata): Promise<void> {
        const fileTags = getAllTags(cache);
        if (!fileTags || fileTags.length === 0) return;

        // Check if the user is actively editing right at the end of a tag
        if (this.isCursorAtTagEnd()) {
            console.log('[TagAliases] Skipping auto-replace: cursor still at tag end');
            return;
        }

        // Find alias tags that need replacement
        const replacements: Array<{ from: string; to: string }> = [];
        for (const tag of fileTags) {
            if (this.aliasManager.isAlias(tag)) {
                const primaryTag = this.aliasManager.getPrimaryTag(tag);
                replacements.push({ from: tag, to: primaryTag });
            }
        }

        if (replacements.length === 0) return;

        console.log('[TagAliases] Auto-replacing in file:', file.path, replacements);

        this.isReplacing = true;

        try {
            let content = await this.app.vault.read(file);

            // Replace inline tags in content body
            for (const { from, to } of replacements) {
                const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Match the exact tag: preceded by start/whitespace,
                // followed by whitespace/punctuation/end (tag must be "completed")
                const regex = new RegExp(
                    `(^|[\\s])${escapedFrom}(?=[\\s,;.!?\\)\\]\\}]|$)`,
                    'gm',
                );
                content = content.replace(regex, `$1${to}`);
            }

            await this.app.vault.modify(file, content);

            // Handle frontmatter tags
            await this.replaceFrontmatterTags(file, replacements);

            const summary = replacements.map(r => `${r.from} \u2192 ${r.to}`).join(', ');
            new Notice(`Tag Aliases: ${summary}`);
        } catch (err) {
            console.error('[TagAliases] Auto-replace failed:', err);
        } finally {
            setTimeout(() => {
                this.isReplacing = false;
            }, 1000);
        }
    }

    /**
     * Check if the user's cursor is currently at the end of a tag
     * (i.e., they might still be typing). Returns true if the text
     * immediately before the cursor looks like an unfinished tag.
     */
    private isCursorAtTagEnd(): boolean {
        try {
            const activeEditor = (this.app.workspace as any).activeEditor;
            const editor = activeEditor?.editor;
            if (!editor) return false;

            const cursor = editor.getCursor();
            const line = editor.getLine(cursor.line);
            const textBeforeCursor = line.substring(0, cursor.ch);

            // If text before cursor ends with #tag-characters, user is still typing a tag
            return /#[\p{L}\p{N}_\-/]+$/u.test(textBeforeCursor);
        } catch {
            return false;
        }
    }

    /**
     * Replace alias tags in a file's YAML frontmatter.
     */
    private async replaceFrontmatterTags(
        file: TFile,
        replacements: Array<{ from: string; to: string }>,
    ): Promise<void> {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            if (!frontmatter.tags) return;

            const tags: string[] = Array.isArray(frontmatter.tags)
                ? frontmatter.tags
                : [frontmatter.tags];

            let changed = false;
            for (let i = 0; i < tags.length; i++) {
                const tagWithHash = tags[i].startsWith('#') ? tags[i] : `#${tags[i]}`;
                const replacement = replacements.find(r =>
                    r.from.toLowerCase() === tagWithHash.toLowerCase()
                );
                if (replacement) {
                    tags[i] = replacement.to.replace(/^#/, '');
                    changed = true;
                }
            }

            if (changed) {
                frontmatter.tags = tags;
            }
        });
    }
}
