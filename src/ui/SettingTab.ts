/**
 * SettingTab - Plugin settings panel.
 *
 * Sections:
 * 1. Alias Groups - Summary + open sidebar button (CRUD is in sidebar)
 * 2. Behavior Settings - Auto-replace toggle
 * 3. Data Migration - Batch scan & replace button
 * 4. Backup & Restore - Export / Import alias configuration
 */

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import TagAliasesPlugin from '../main';
import { AliasGroup } from '../types';
import { PLUGIN_NAME, EXPORT_FILE_NAME } from '../constants';
import { AliasManager } from '../core/AliasManager';
import { BatchMigration } from '../migration/BatchMigration';

export class TagAliasesSettingTab extends PluginSettingTab {
    plugin: TagAliasesPlugin;

    constructor(app: App, plugin: TagAliasesPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /**
     * Render the settings panel content.
     * Called each time the user navigates to the plugin settings.
     */
    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        this.renderAliasGroupSection(containerEl);
        this.renderBehaviorSection(containerEl);
        this.renderMigrationSection(containerEl);
        this.renderBackupSection(containerEl);
    }

    /**
     * Render alias group summary with a button to open the sidebar.
     * CRUD operations are handled in the sidebar panel.
     */
    private renderAliasGroupSection(container: HTMLElement): void {
        container.createEl('h2', { text: 'Alias Groups' });

        const groups = this.plugin.aliasManager.getGroups();
        const count = groups.length;

        new Setting(container)
            .setName(`${count} alias group${count !== 1 ? 's' : ''} configured`)
            .setDesc('Use the sidebar panel to create, edit, and delete alias groups.')
            .addButton(btn => {
                btn.setButtonText('Open Sidebar')
                    .setCta()
                    .onClick(() => {
                        this.plugin.activateSidebarView();
                    });
            });
    }

    /**
     * Render the behavior settings section.
     */
    private renderBehaviorSection(container: HTMLElement): void {
        container.createEl('h2', { text: 'Behavior' });

        new Setting(container)
            .setName('Auto-replace alias tags')
            .setDesc(
                'When enabled, alias tags that bypass the suggestion popup ' +
                'will be automatically replaced with the primary tag.'
            )
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.autoReplace)
                    .onChange(async (value) => {
                        this.plugin.settings.autoReplace = value;
                        await this.plugin.saveSettings();
                    });
            });
    }

    /**
     * Render the data migration section.
     */
    private renderMigrationSection(container: HTMLElement): void {
        container.createEl('h2', { text: 'Migration' });

        new Setting(container)
            .setName('Scan & replace alias tags in vault')
            .setDesc(
                'Scan all markdown files and replace existing alias tags ' +
                'with their primary tags. A preview will be shown before any changes are made.'
            )
            .addButton(btn => {
                btn.setButtonText('Scan & Replace')
                    .setWarning()
                    .onClick(async () => {
                        const migration = new BatchMigration(
                            this.app,
                            this.plugin.aliasManager,
                        );
                        await migration.run();
                    });
            });
    }

    /**
     * Render the backup & restore section.
     */
    private renderBackupSection(container: HTMLElement): void {
        container.createEl('h2', { text: 'Backup & Restore' });

        // Export button
        new Setting(container)
            .setName('Export alias configuration')
            .setDesc(
                'Save all alias groups as a JSON file in your vault. ' +
                'Recommended before uninstalling the plugin.'
            )
            .addButton(btn => {
                btn.setButtonText('Export')
                    .onClick(async () => {
                        await this.handleExport();
                    });
            });

        // Import button
        new Setting(container)
            .setName('Import alias configuration')
            .setDesc(
                'Restore alias groups from a previously exported JSON file.'
            )
            .addButton(btn => {
                btn.setButtonText('Import')
                    .onClick(async () => {
                        await this.handleImport();
                    });
            });
    }

    /**
     * Export alias groups to a JSON file in the vault root.
     */
    private async handleExport(): Promise<void> {
        const groups = this.plugin.aliasManager.getGroups();
        if (groups.length === 0) {
            new Notice('No alias groups to export.');
            return;
        }

        const exportData = {
            pluginId: 'tag-aliases',
            version: '1.0',
            exportedAt: new Date().toISOString(),
            aliasGroups: groups,
        };

        const json = JSON.stringify(exportData, null, 2);

        try {
            // Check if file already exists, append timestamp if so
            let fileName = EXPORT_FILE_NAME;
            const existingFile = this.app.vault.getAbstractFileByPath(fileName);
            if (existingFile) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                fileName = `tag-aliases-backup-${timestamp}.json`;
            }

            await this.app.vault.create(fileName, json);
            new Notice(`Exported ${groups.length} alias group(s) to "${fileName}".`);
        } catch (err) {
            console.error('[TagAliases] Export failed:', err);
            new Notice('Export failed. Check the console for details.');
        }
    }

    /**
     * Import alias groups from a JSON file selected via file input.
     */
    private async handleImport(): Promise<void> {
        // Create a hidden file input to let user pick a file
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';

        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);

                // Validate structure
                if (!data.aliasGroups || !Array.isArray(data.aliasGroups)) {
                    new Notice('Invalid file format: missing "aliasGroups" array.');
                    return;
                }

                const importedGroups: AliasGroup[] = data.aliasGroups;

                // Validate each group has required fields
                for (const g of importedGroups) {
                    if (!g.primaryTag || !Array.isArray(g.aliases)) {
                        new Notice('Invalid file format: each group must have "primaryTag" and "aliases".');
                        return;
                    }
                    // Ensure each group has an ID
                    if (!g.id) {
                        g.id = this.plugin.aliasManager.generateId();
                    }
                }

                // Validate each group for format and inter-group conflicts
                const tempManager = new AliasManager();
                for (const g of importedGroups) {
                    const error = tempManager.validate(g);
                    if (error) {
                        new Notice(`Import failed — group "${g.primaryTag}": ${error}`);
                        console.warn('[TagAliases] Import validation error:', error, g);
                        return;
                    }
                    // Add validated group so subsequent checks detect conflicts
                    tempManager.addGroup(g);
                }

                // Replace current groups with validated imports
                this.plugin.settings.aliasGroups = importedGroups;
                this.plugin.aliasManager.buildIndex(importedGroups);
                await this.plugin.saveSettings();

                new Notice(`Imported ${importedGroups.length} alias group(s) successfully.`);

                // Refresh settings panel
                this.display();
            } catch (err) {
                console.error('[TagAliases] Import failed:', err);
                new Notice('Import failed. Ensure the file is valid JSON.');
            }
        });

        input.click();
    }
}
