/**
 * Tag Aliases - Obsidian Plugin
 *
 * Normalizes tags at input time by intercepting Obsidian's tag suggestions.
 * Allows defining alias groups so that typing any alias suggests and inserts
 * the canonical primary tag, keeping vault tags clean and consistent.
 */

import { Plugin, Notice, debounce } from 'obsidian';
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
     *
     * Only replaces the tag the user JUST finished typing (near the cursor),
     * not all alias tags in the file. Old alias tags elsewhere in the file
     * are left untouched — use batch migration for those.
     *
     * Uses the Editor API for replacement, which supports Ctrl+Z undo.
     */
    private registerAutoReplace(): void {
        const debouncedReplace = debounce(
            () => {
                this.processAutoReplace();
            },
            100,
            true,
        );

        this.registerEvent(
            this.app.metadataCache.on('changed', () => {
                if (!this.settings.autoReplace || this.isReplacing) {
                    return;
                }
                debouncedReplace();
            }),
        );
    }

    /**
     * Check the tag the user just finished typing (near cursor).
     * If it's an alias, replace it with the primary tag via Editor API.
     *
     * A tag is considered "just finished" when the text before the cursor
     * matches: #tagname + whitespace (space, tab, newline equivalent).
     */
    private processAutoReplace(): void {
        try {
            const activeEditor = (this.app.workspace as any).activeEditor;
            const editor = activeEditor?.editor;
            if (!editor) return;

            const cursor = editor.getCursor();
            const line = editor.getLine(cursor.line);
            const textBeforeCursor = line.substring(0, cursor.ch);

            // Match a completed tag: #tagname followed by whitespace at cursor position
            // The '#' must be at the start of line or preceded by whitespace
            const match = textBeforeCursor.match(
                /(?:^|\s)(#[\p{L}\p{N}_\-/]+)\s+$/u
            );
            if (!match || match.index === undefined) return;

            const tag = match[1];

            // Check if this tag is an alias
            if (!this.aliasManager.isAlias(tag)) return;

            const primaryTag = this.aliasManager.getPrimaryTag(tag);

            // Calculate the exact position of the tag in the line
            // match[0] includes optional leading whitespace + tag + trailing whitespace
            // match[1] is just the tag (#tagname)
            const fullMatchStart = match.index;
            const leadingLen = match[0].length - match[1].length
                - (match[0].length - match[0].trimStart().length > 0
                    ? 0 : 0);

            // Find exact tag start by searching for '#' in the match
            const tagStartInMatch = match[0].indexOf('#');
            const tagStartCh = fullMatchStart + tagStartInMatch;
            const tagEndCh = tagStartCh + tag.length;

            // Replace via Editor API (supports undo)
            this.isReplacing = true;

            editor.replaceRange(
                primaryTag,
                { line: cursor.line, ch: tagStartCh },
                { line: cursor.line, ch: tagEndCh },
            );

            new Notice(`Tag Aliases: ${tag} \u2192 ${primaryTag}`);
            console.log('[TagAliases] Auto-replaced:', tag, '\u2192', primaryTag);

            setTimeout(() => {
                this.isReplacing = false;
            }, 500);
        } catch (err) {
            console.error('[TagAliases] Auto-replace error:', err);
            this.isReplacing = false;
        }
    }
}
