/**
 * Tag Aliases - Obsidian Plugin
 *
 * Normalizes tags at input time by intercepting Obsidian's tag suggestions.
 * Allows defining alias groups so that typing any alias suggests and inserts
 * the canonical primary tag, keeping vault tags clean and consistent.
 */

import { Plugin } from 'obsidian';
import { TagAliasSettings } from './types';
import { DEFAULT_SETTINGS } from './constants';
import { AliasManager } from './core/AliasManager';
import { TagAliasesSettingTab } from './ui/SettingTab';
import { TagAliasSuggest } from './suggest/TagAliasSuggest';

export default class TagAliasesPlugin extends Plugin {
    /** Current plugin settings. */
    settings: TagAliasSettings = DEFAULT_SETTINGS;
    /** Core alias management: indexing, lookup, CRUD. */
    aliasManager: AliasManager = new AliasManager();

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

        // TODO: Register auto-replace event listener (Phase 5)
        // TODO: Register migration command (Phase 6)

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
}
