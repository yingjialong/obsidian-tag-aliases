/**
 * BatchMigration - Scan vault and replace alias tags with primary tags.
 *
 * Workflow:
 * 1. Scan all markdown files via MetadataCache
 * 2. Build a MigrationPlan listing all alias tags to replace
 * 3. Show a preview modal for user confirmation
 * 4. Execute replacements (inline regex + frontmatter API)
 * 5. Report results via Notice
 */

import { App, Modal, Notice, TFile, getAllTags, Setting } from 'obsidian';
import { AliasManager } from '../core/AliasManager';
import { MigrationPlan, MigrationChange, MigrationReplacement } from '../types';

export class BatchMigration {
    private app: App;
    private aliasManager: AliasManager;

    constructor(app: App, aliasManager: AliasManager) {
        this.app = app;
        this.aliasManager = aliasManager;
    }

    /**
     * Entry point: scan the vault, show preview, and execute if confirmed.
     */
    async run(): Promise<void> {
        const groups = this.aliasManager.getGroups();
        if (groups.length === 0) {
            new Notice('No alias groups defined. Create alias groups first.');
            return;
        }

        // Step 1: Scan vault and build migration plan
        new Notice('Scanning vault for alias tags...');
        const plan = this.scan();

        if (plan.totalReplacements === 0) {
            new Notice('No alias tags found in vault. Everything is already normalized.');
            return;
        }

        // Step 2: Show preview modal for confirmation
        console.log('[TagAliases] Migration plan:', {
            files: plan.changes.length,
            replacements: plan.totalReplacements,
        });

        const confirmed = await this.showPreview(plan);
        if (!confirmed) {
            new Notice('Migration cancelled.');
            return;
        }

        // Step 3: Execute replacements
        await this.execute(plan);
    }

    /**
     * Scan all markdown files and build a migration plan.
     */
    private scan(): MigrationPlan {
        const changes: MigrationChange[] = [];
        let totalReplacements = 0;
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache) continue;

            const tags = getAllTags(cache) || [];
            const replacements: MigrationReplacement[] = [];

            for (const tag of tags) {
                if (this.aliasManager.isAlias(tag)) {
                    const primaryTag = this.aliasManager.getPrimaryTag(tag);

                    // Determine location: check if tag appears in frontmatter or inline
                    const isInFrontmatter = this.isTagInFrontmatter(tag, cache);
                    const isInline = cache.tags?.some(
                        t => t.tag.toLowerCase() === tag.toLowerCase()
                    );

                    if (isInFrontmatter) {
                        replacements.push({
                            from: tag,
                            to: primaryTag,
                            location: 'frontmatter',
                        });
                    }
                    if (isInline) {
                        replacements.push({
                            from: tag,
                            to: primaryTag,
                            location: 'inline',
                        });
                    }
                }
            }

            // Deduplicate: same from/to/location combination
            const uniqueReplacements = this.deduplicateReplacements(replacements);

            if (uniqueReplacements.length > 0) {
                changes.push({
                    filePath: file.path,
                    replacements: uniqueReplacements,
                });
                totalReplacements += uniqueReplacements.length;
            }
        }

        return { changes, totalReplacements };
    }

    /**
     * Check if a tag exists in the file's YAML frontmatter.
     */
    private isTagInFrontmatter(tag: string, cache: any): boolean {
        if (!cache.frontmatter?.tags) return false;

        const fmTags: string[] = Array.isArray(cache.frontmatter.tags)
            ? cache.frontmatter.tags
            : [cache.frontmatter.tags];

        const tagName = tag.replace(/^#/, '').toLowerCase();
        return fmTags.some(t => t.toLowerCase() === tagName);
    }

    /**
     * Remove duplicate replacements (same from/to/location).
     */
    private deduplicateReplacements(replacements: MigrationReplacement[]): MigrationReplacement[] {
        const seen = new Set<string>();
        return replacements.filter(r => {
            const key = `${r.from.toLowerCase()}|${r.to.toLowerCase()}|${r.location}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Show a preview modal listing all planned changes.
     * Returns true if user confirms, false if cancelled.
     */
    private showPreview(plan: MigrationPlan): Promise<boolean> {
        return new Promise((resolve) => {
            const modal = new MigrationPreviewModal(this.app, plan, resolve);
            modal.open();
        });
    }

    /**
     * Execute the migration plan: replace alias tags in all affected files.
     */
    private async execute(plan: MigrationPlan): Promise<void> {
        let successCount = 0;
        let errorCount = 0;

        for (const change of plan.changes) {
            try {
                const file = this.app.vault.getAbstractFileByPath(change.filePath);
                if (!(file instanceof TFile)) {
                    console.warn('[TagAliases] File not found:', change.filePath);
                    errorCount++;
                    continue;
                }

                // Separate inline and frontmatter replacements
                const inlineReplacements = change.replacements.filter(r => r.location === 'inline');
                const fmReplacements = change.replacements.filter(r => r.location === 'frontmatter');

                // Replace inline tags
                if (inlineReplacements.length > 0) {
                    let content = await this.app.vault.read(file);
                    for (const { from, to } of inlineReplacements) {
                        const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(
                            `(^|[\\s])${escapedFrom}(?=[\\s,;.!?\\)\\]\\}]|$)`,
                            'gmu',
                        );
                        content = content.replace(regex, `$1${to}`);
                    }
                    await this.app.vault.modify(file, content);
                }

                // Replace frontmatter tags
                if (fmReplacements.length > 0) {
                    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
                        if (!frontmatter.tags) return;
                        const tags: string[] = Array.isArray(frontmatter.tags)
                            ? frontmatter.tags
                            : [frontmatter.tags];

                        for (let i = 0; i < tags.length; i++) {
                            const tagWithHash = tags[i].startsWith('#') ? tags[i] : `#${tags[i]}`;
                            const replacement = fmReplacements.find(
                                r => r.from.toLowerCase() === tagWithHash.toLowerCase(),
                            );
                            if (replacement) {
                                tags[i] = replacement.to.replace(/^#/, '');
                            }
                        }
                        frontmatter.tags = tags;
                    });
                }

                successCount++;
            } catch (err) {
                console.error('[TagAliases] Migration error for file:', change.filePath, err);
                errorCount++;
            }
        }

        // Report results
        const message = errorCount === 0
            ? `Migration complete: ${successCount} file(s) updated successfully.`
            : `Migration complete: ${successCount} file(s) updated, ${errorCount} error(s).`;
        new Notice(message);
        console.log('[TagAliases] Migration result:', { successCount, errorCount });
    }
}

/**
 * Modal that shows a preview of planned migration changes
 * and asks the user to confirm or cancel.
 */
class MigrationPreviewModal extends Modal {
    private plan: MigrationPlan;
    private onResult: (confirmed: boolean) => void;

    constructor(app: App, plan: MigrationPlan, onResult: (confirmed: boolean) => void) {
        super(app);
        this.plan = plan;
        this.onResult = onResult;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.createEl('h2', { text: 'Migration Preview' });
        contentEl.createEl('p', {
            text: `Found ${this.plan.totalReplacements} alias tag(s) in ${this.plan.changes.length} file(s) to replace:`,
        });

        // Scrollable list of changes
        const listContainer = contentEl.createDiv({
            cls: 'tag-aliases-migration-list',
        });
        listContainer.style.maxHeight = '300px';
        listContainer.style.overflow = 'auto';
        listContainer.style.marginBottom = '1em';

        for (const change of this.plan.changes) {
            const fileItem = listContainer.createDiv({
                cls: 'tag-aliases-migration-file',
            });
            fileItem.style.marginBottom = '8px';

            fileItem.createEl('strong', { text: change.filePath });

            const ul = fileItem.createEl('ul');
            ul.style.margin = '4px 0';
            for (const r of change.replacements) {
                ul.createEl('li', {
                    text: `${r.from} \u2192 ${r.to} (${r.location})`,
                });
            }
        }

        // Buttons
        const buttonRow = contentEl.createDiv({
            cls: 'tag-aliases-button-row',
        });

        const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.onResult(false);
            this.close();
        });

        const confirmBtn = buttonRow.createEl('button', {
            text: `Replace ${this.plan.totalReplacements} tag(s)`,
            cls: 'mod-warning',
        });
        confirmBtn.addEventListener('click', () => {
            this.onResult(true);
            this.close();
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
