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

        // Register alias-aware tag suggestions (overrides built-in tag suggest)
        this.registerEditorSuggest(new TagAliasSuggest(this.app, this.aliasManager));

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
     * Cleans up resources registered during onload.
     */
    onunload(): void {
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
     * Register the auto-replace mechanism.
     * Listens to MetadataCache 'changed' events and replaces alias tags
     * with their primary tags when the autoReplace setting is enabled.
     *
     * Uses debounce to batch rapid changes and a guard flag to prevent
     * infinite replace loops.
     */
    private registerAutoReplace(): void {
        // Debounced handler: wait 500ms after the last change before processing
        const debouncedReplace = debounce(
            async (file: TFile, _data: string, cache: CachedMetadata) => {
                await this.processAutoReplace(file, cache);
            },
            500,
            true,  // Run on leading edge = false, trailing edge = true
        );

        this.registerEvent(
            this.app.metadataCache.on('changed', (file, data, cache) => {
                // Skip if auto-replace is disabled or currently replacing
                if (!this.settings.autoReplace || this.isReplacing) {
                    return;
                }
                debouncedReplace(file, data, cache);
            }),
        );
    }

    /**
     * Process auto-replace for a single file.
     * Scans tags in the file and replaces any alias tags with primary tags.
     */
    private async processAutoReplace(file: TFile, cache: CachedMetadata): Promise<void> {
        const fileTags = getAllTags(cache);
        if (!fileTags || fileTags.length === 0) return;

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

        // Set guard flag to prevent recursive triggers
        this.isReplacing = true;

        try {
            let content = await this.app.vault.read(file);

            // Replace inline tags in content body
            for (const { from, to } of replacements) {
                // Escape special regex characters in tag name
                const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // Match the exact tag: preceded by start/whitespace, not followed by word chars
                const regex = new RegExp(`(^|[\\s])${escapedFrom}(?=[\\s,;.!?\\)\\]\\}]|$)`, 'gm');
                content = content.replace(regex, `$1${to}`);
            }

            await this.app.vault.modify(file, content);

            // Handle frontmatter tags separately via the official API
            await this.replaceFrontmatterTags(file, replacements);

            // Notify user about the replacement
            const summary = replacements.map(r => `${r.from} -> ${r.to}`).join(', ');
            new Notice(`Tag Aliases: auto-replaced ${summary}`);
        } catch (err) {
            console.error('[TagAliases] Auto-replace failed:', err);
        } finally {
            // Release guard flag after a delay to let MetadataCache settle
            setTimeout(() => {
                this.isReplacing = false;
            }, 1000);
        }
    }

    /**
     * Replace alias tags in a file's YAML frontmatter.
     * Uses the official processFrontMatter API.
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
                // Frontmatter tags may or may not have '#' prefix
                const tagWithHash = tags[i].startsWith('#') ? tags[i] : `#${tags[i]}`;
                const replacement = replacements.find(r =>
                    r.from.toLowerCase() === tagWithHash.toLowerCase()
                );
                if (replacement) {
                    // Strip '#' for frontmatter format
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
