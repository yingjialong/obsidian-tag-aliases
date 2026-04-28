/**
 * TagSidebarView — Right-sidebar panel for managing tag aliases.
 *
 * Displays all vault tags merged with alias group data.
 * Supports inline alias editing, conflict detection, search, and sort.
 */

import { ItemView, Modal, WorkspaceLeaf, debounce } from 'obsidian';
import type TagAliasesPlugin from '../main';
import { VIEW_TYPE_TAG_ALIASES } from '../constants';
import { AliasGroup } from '../types';
import { checkConflicts, Conflict } from '../core/ConflictChecker';

/**
 * Internal display model for a single tag row in the sidebar.
 * Merges vault tag counts with alias group metadata.
 */
interface DisplayTag {
    /** The tag string, always with '#' prefix, e.g. "#javascript". */
    tag: string;
    /** Vault usage count from MetadataCache. */
    count: number;
    /** Non-null if this tag has an alias group configured. */
    group: AliasGroup | null;
    /** True if involved in a detected cross-group conflict. */
    hasConflict: boolean;
}

export class TagSidebarView extends ItemView {
    private plugin: TagAliasesPlugin;

    /** Current search filter text. */
    private searchQuery = '';
    /** Current sort mode key. */
    private sortMode = 'name-asc';
    /** Tag string of the currently expanded item (null = all collapsed). */
    private expandedTag: string | null = null;

    /** DOM reference to the scrollable tag list container. */
    private listContainer: HTMLElement | null = null;
    /** DOM reference to the conflict banner area. */
    private bannerContainer: HTMLElement | null = null;
    /** Whether a metadata refresh was deferred while an alias input had focus. */
    private pendingListRefresh = false;

    constructor(leaf: WorkspaceLeaf, plugin: TagAliasesPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return VIEW_TYPE_TAG_ALIASES; }
    getDisplayText(): string { return 'Tag aliases'; }
    getIcon(): string { return 'tags'; }

    /**
     * Called when the sidebar view is opened.
     * Builds the full sidebar UI: toolbar, conflict banner, and tag list.
     */
    async onOpen(): Promise<void> {
        await super.onOpen();
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('tag-aliases-sidebar');

        // Build the toolbar (search input + sort dropdown)
        this.renderToolbar(container);

        // Conflict banner area (populated by renderConflictBanner)
        this.bannerContainer = container.createDiv('tag-aliases-conflict-banner-wrapper');

        // Scrollable tag list container
        this.listContainer = container.createDiv('tag-aliases-sidebar-list');

        // Auto-refresh when MetadataCache finishes re-indexing files
        // (e.g., after batch migration or manual tag edits in notes)
        const debouncedRefresh = debounce(() => this.refreshFromMetadata(), 500, true);
        this.registerEvent(
            this.app.metadataCache.on('resolved', debouncedRefresh),
        );

        // Initial render
        this.refresh();
    }

    async onClose(): Promise<void> {
        await super.onClose();
        this.containerEl.empty();
    }

    /**
     * Full re-render: rebuild display list, update conflict banner, re-render tag list.
     * Called after any data mutation (add/remove alias, delete group, etc.).
     */
    public refresh(): void {
        this.pendingListRefresh = false;
        const displayList = this.buildDisplayList();
        // Pass vault tags so ConflictChecker can detect unmigrated aliases
        const vaultTags = this.getVaultTags();
        const conflicts = checkConflicts(this.plugin.aliasManager.getGroups(), vaultTags);

        this.renderConflictBanner(conflicts);
        this.renderTagList(displayList);
    }

    /**
     * Refresh the sidebar after metadata changes without destroying active alias input.
     * Metadata updates are frequent, so list rendering is deferred while the user is
     * typing a new alias and replayed once that input loses focus.
     */
    private refreshFromMetadata(): void {
        const vaultTags = this.getVaultTags();
        const conflicts = checkConflicts(this.plugin.aliasManager.getGroups(), vaultTags);
        this.renderConflictBanner(conflicts);

        if (this.isAliasInputFocused()) {
            this.pendingListRefresh = true;
            console.debug('[TagAliases] Deferred sidebar list refresh while alias input is focused.');
            return;
        }

        this.pendingListRefresh = false;
        const displayList = this.buildDisplayList();
        this.renderTagList(displayList);
    }

    /**
     * Check whether the active element is one of the add-alias inputs.
     */
    private isAliasInputFocused(): boolean {
        const activeElement = document.activeElement;
        if (!(activeElement instanceof HTMLInputElement)) {
            return false;
        }

        return this.containerEl.contains(activeElement)
            && activeElement.closest('.tag-aliases-sidebar-add-row') !== null;
    }

    /**
     * Register shared behavior for add-alias inputs.
     */
    private registerAliasInputHandlers(addInput: HTMLInputElement): void {
        // Prevent input clicks from toggling expand/collapse.
        addInput.addEventListener('click', (e) => e.stopPropagation());

        addInput.addEventListener('blur', () => {
            if (!this.pendingListRefresh) {
                return;
            }

            window.setTimeout(() => {
                if (!this.isAliasInputFocused() && this.pendingListRefresh) {
                    this.refresh();
                }
            }, 0);
        });
    }

    // ──────────────────────────────────────────────
    //  Toolbar: Search & Sort
    // ──────────────────────────────────────────────

    /**
     * Render the search input and sort dropdown into the toolbar area.
     */
    private renderToolbar(parent: HTMLElement): void {
        const toolbar = parent.createDiv('tag-aliases-sidebar-toolbar');

        // Search input with debounced filtering
        const searchInput = toolbar.createEl('input', {
            cls: 'tag-aliases-sidebar-search',
            attr: { type: 'text', placeholder: 'Search tags...' },
        });

        const debouncedSearch = debounce((value: string) => {
            this.searchQuery = value;
            this.refresh();
        }, 150, true);

        searchInput.addEventListener('input', () => {
            debouncedSearch(searchInput.value);
        });

        // Sort mode dropdown
        const sortSelect = toolbar.createEl('select', {
            cls: 'tag-aliases-sidebar-sort',
        });

        const sortOptions: { value: string; label: string }[] = [
            { value: 'name-asc', label: 'Name A \u2192 Z' },
            { value: 'name-desc', label: 'Name Z \u2192 A' },
            { value: 'count-desc', label: 'Most used' },
            { value: 'alias-desc', label: 'Most aliases' },
        ];

        for (const opt of sortOptions) {
            const optEl = sortSelect.createEl('option', { text: opt.label, attr: { value: opt.value } });
            if (opt.value === this.sortMode) {
                optEl.selected = true;
            }
        }

        sortSelect.addEventListener('change', () => {
            this.sortMode = sortSelect.value;
            this.refresh();
        });
    }

    // ──────────────────────────────────────────────
    //  Conflict Banner
    // ──────────────────────────────────────────────

    /**
     * Render or clear the conflict warning banner.
     *
     * Separates conflicts into two categories:
     * - Unmigrated aliases: fixable via batch migration (shows a "Run Migration" button)
     * - Structural conflicts: require manual editing (duplicate alias, primary-as-alias, etc.)
     */
    private renderConflictBanner(conflicts: Conflict[]): void {
        if (!this.bannerContainer) return;
        this.bannerContainer.empty();

        if (conflicts.length === 0) return;

        const unmigrated = conflicts.filter(c => c.type === 'unmigrated-alias');
        const structural = conflicts.filter(c => c.type !== 'unmigrated-alias');

        // Structural conflicts: user must manually edit groups to resolve
        if (structural.length > 0) {
            const banner = this.bannerContainer.createDiv('tag-aliases-conflict-banner');
            banner.createEl('strong', { text: 'Conflicts detected' });
            banner.createEl('p', {
                text: 'Edit the highlighted groups below to resolve:',
                cls: 'tag-aliases-conflict-hint',
            });
            const list = banner.createEl('ul');
            for (const c of structural) {
                list.createEl('li', { text: c.description });
            }
        }

        // Unmigrated aliases: fixable by running batch migration
        if (unmigrated.length > 0) {
            const banner = this.bannerContainer.createDiv('tag-aliases-conflict-banner');
            banner.createEl('strong', { text: `\u26A0 ${unmigrated.length} unmigrated alias(es)` });
            const list = banner.createEl('ul');
            for (const c of unmigrated) {
                // Shorter description: just show the alias → primary mapping
                const alias = c.tag.replace(/^#/, '');
                const primary = c.groupIds[0]
                    ? this.plugin.aliasManager.getPrimaryTag(c.tag).replace(/^#/, '')
                    : '?';
                list.createEl('li', { text: `${alias} \u2192 ${primary}` });
            }
            // "Run Migration" button
            const migrateBtn = banner.createEl('button', {
                cls: 'tag-aliases-conflict-migrate-btn',
                text: 'Run migration',
            });
            migrateBtn.addEventListener('click', () => {
                void import('../migration/BatchMigration').then(({ BatchMigration }) => {
                    const migration = new BatchMigration(this.app, this.plugin.aliasManager);
                    return migration.run();
                }).then(() => {
                    this.refresh();
                });
            });
        }
    }

    // ──────────────────────────────────────────────
    //  Display List Construction
    // ──────────────────────────────────────────────

    /**
     * Build the merged display list from vault tags and alias groups.
     *
     * Steps:
     * 1. Get vault tags (tag -> count) from MetadataCache
     * 2. Get alias groups from AliasManager
     * 3. Build a set of all known aliases (to exclude from top-level)
     * 4. Run conflict detection to mark conflicting groups
     * 5. For each vault tag: skip aliases, attach group if primary
     * 6. Add alias groups whose primaryTag has no vault usage (count=0)
     * 7. Apply search filter and sort
     */
    /**
     * Get all vault tags with usage counts from MetadataCache.
     */
    private getVaultTags(): Record<string, number> {
        const metadataCache = this.app.metadataCache as unknown as
            { getTags?: () => Record<string, number> };
        return typeof metadataCache.getTags === 'function'
            ? metadataCache.getTags()
            : {};
    }

    private buildDisplayList(): DisplayTag[] {
        // Step 1: Get vault tags
        const vaultTags = this.getVaultTags();

        // Step 2: Get alias groups
        const groups = this.plugin.aliasManager.getGroups();

        // Step 3: Build a set of all normalized aliases for exclusion
        const aliasSet = new Set<string>();
        for (const group of groups) {
            for (const alias of group.aliases) {
                aliasSet.add(alias.replace(/^#/, '').toLowerCase());
            }
        }

        // Step 4: Detect conflicts, build set of conflicting group IDs
        const conflicts = checkConflicts(groups);
        const conflictGroupIds = new Set<string>();
        for (const c of conflicts) {
            for (const id of c.groupIds) {
                conflictGroupIds.add(id);
            }
        }

        const result: DisplayTag[] = [];
        // Track which group primaryTags we've already added (by normalized form)
        const addedPrimaries = new Set<string>();

        // Step 5: Process vault tags
        for (const [tag, count] of Object.entries(vaultTags)) {
            const normalized = tag.replace(/^#/, '').toLowerCase();

            // Skip if this tag is a known alias
            if (aliasSet.has(normalized)) {
                continue;
            }

            // Look up group: if this tag is the primary of a group, attach it
            const group = this.plugin.aliasManager.findGroup(tag);
            let attachedGroup: AliasGroup | null = null;

            if (group && group.primaryTag.replace(/^#/, '').toLowerCase() === normalized) {
                attachedGroup = group;
                addedPrimaries.add(normalized);
            }

            const hasConflict = attachedGroup
                ? conflictGroupIds.has(attachedGroup.id)
                : false;

            result.push({
                tag,
                count,
                group: attachedGroup,
                hasConflict,
            });
        }

        // Step 6: Add alias groups whose primaryTag is not already in the list
        for (const group of groups) {
            const normalized = group.primaryTag.replace(/^#/, '').toLowerCase();
            if (!addedPrimaries.has(normalized)) {
                result.push({
                    tag: group.primaryTag,
                    count: 0,
                    group,
                    hasConflict: conflictGroupIds.has(group.id),
                });
            }
        }

        // Step 7: Apply search filter
        const filtered = this.filterBySearch(result);

        // Step 8: Sort
        filtered.sort((a, b) => this.compareTags(a, b));

        return filtered;
    }

    /**
     * Filter the display list by the current search query.
     * Matches against tag name (without '#', case-insensitive, substring)
     * and alias names in the group.
     */
    private filterBySearch(list: DisplayTag[]): DisplayTag[] {
        if (!this.searchQuery.trim()) {
            return list;
        }

        const query = this.searchQuery.trim().toLowerCase();

        return list.filter(item => {
            // Match against the tag name (without '#')
            const tagName = item.tag.replace(/^#/, '').toLowerCase();
            if (tagName.includes(query)) {
                return true;
            }

            // Match against alias names in the group
            if (item.group) {
                for (const alias of item.group.aliases) {
                    const aliasName = alias.replace(/^#/, '').toLowerCase();
                    if (aliasName.includes(query)) {
                        return true;
                    }
                }
            }

            return false;
        });
    }

    /**
     * Compare two DisplayTag items for sorting based on the current sort mode.
     */
    private compareTags(a: DisplayTag, b: DisplayTag): number {
        switch (this.sortMode) {
            case 'name-desc':
                return b.tag.localeCompare(a.tag);
            case 'count-desc':
                return b.count - a.count;
            case 'alias-desc':
                return (b.group?.aliases.length ?? 0) - (a.group?.aliases.length ?? 0);
            default: // name-asc
                return a.tag.localeCompare(b.tag);
        }
    }

    // ──────────────────────────────────────────────
    //  Tag List Rendering
    // ──────────────────────────────────────────────

    /**
     * Render the full tag list into the scrollable container.
     * Each item shows tag name, count badge, alias preview, and expand/collapse.
     */
    private renderTagList(displayList: DisplayTag[]): void {
        if (!this.listContainer) return;
        this.listContainer.empty();

        if (displayList.length === 0) {
            this.listContainer.createDiv({
                cls: 'tag-aliases-sidebar-empty',
                text: this.searchQuery ? 'No tags match your search.' : 'No tags found in vault.',
            });
            return;
        }

        for (const item of displayList) {
            this.renderTagItem(item);
        }
    }

    /**
     * Render a single tag item row (collapsed or expanded).
     */
    private renderTagItem(item: DisplayTag): void {
        if (!this.listContainer) return;

        const isExpanded = this.expandedTag === item.tag;
        const hasGroup = item.group !== null;

        // Main tag row container
        const itemEl = this.listContainer.createDiv({
            cls: 'tag-aliases-sidebar-item',
        });

        // Add modifier classes
        if (hasGroup) itemEl.addClass('is-group');
        if (isExpanded) itemEl.addClass('is-expanded');
        if (item.hasConflict) itemEl.addClass('tag-aliases-sidebar-item-conflict');

        // Click handler: toggle expand/collapse
        itemEl.addEventListener('click', () => {
            this.expandedTag = isExpanded ? null : item.tag;
            this.refresh();
        });

        // Top row: indicator + tag name + count
        const topRow = itemEl.createDiv('tag-aliases-sidebar-item-top');

        // Expand/collapse indicator
        const indicator = hasGroup
            ? (isExpanded ? '\u25BE' : '\u25B8')  // filled triangle down/right
            : '\u00B7';  // middle dot for standalone tags
        topRow.createSpan({ cls: 'tag-aliases-sidebar-indicator', text: indicator });

        // Tag name (display without '#' prefix for cleaner look)
        topRow.createSpan({ cls: 'tag-aliases-sidebar-tag-name', text: item.tag.replace(/^#/, '') });

        // Count badge (right-aligned)
        if (item.count > 0) {
            topRow.createSpan({ cls: 'tag-aliases-sidebar-count', text: `\u00D7${item.count}` });
        }

        // Aliases preview (below tag name, collapsed only)
        if (hasGroup && !isExpanded && item.group) {
            const aliasNames = item.group.aliases.map(a => a.replace(/^#/, ''));
            if (aliasNames.length > 0) {
                itemEl.createDiv({
                    cls: 'tag-aliases-sidebar-aliases-preview',
                    text: aliasNames.join(', '),
                });
            }
        }

        // Expanded edit panel (rendered inside itemEl, directly below the tag row)
        if (isExpanded) {
            if (item.group) {
                this.renderEditPanel(itemEl, item.group, item.tag);
            } else {
                this.renderCreatePanel(itemEl, item.tag);
            }
        }
    }

    // ──────────────────────────────────────────────
    //  Expanded: Edit Existing Group
    // ──────────────────────────────────────────────

    /**
     * Render the expanded edit panel for an existing alias group.
     * Shows alias rows with delete buttons, an add-alias input, and a delete group button.
     */
    private renderEditPanel(parent: HTMLElement, group: AliasGroup, tag: string): void {
        const panel = parent.createDiv('tag-aliases-sidebar-edit-panel');

        // Render each alias with a delete button (display without '#')
        for (const alias of group.aliases) {
            const aliasRow = panel.createDiv('tag-aliases-sidebar-alias-row');
            aliasRow.createSpan({ text: alias.replace(/^#/, '') });

            const deleteBtn = aliasRow.createEl('button', {
                cls: 'tag-aliases-sidebar-alias-delete',
                text: '\u2715',
                attr: { 'aria-label': `Remove alias ${alias}` },
            });

            // Delete alias click handler
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                void this.handleDeleteAlias(group, alias);
            });
        }

        // Add alias row: input + add button
        const addRow = panel.createDiv('tag-aliases-sidebar-add-row');
        const addInput = addRow.createEl('input', {
            attr: { type: 'text', placeholder: 'Add alias...' },
        });

        const addBtn = addRow.createEl('button', {
            text: '\uFF0B',
            attr: { 'aria-label': 'Add alias' },
        });

        // Error message area (initially hidden)
        const errorEl = panel.createDiv('tag-aliases-sidebar-error');

        // Add alias handler
        const doAdd = async () => {
            const rawValue = addInput.value.trim();
            if (!rawValue) return;

            const newAlias = rawValue.startsWith('#') ? rawValue : '#' + rawValue;
            const error = await this.handleAddAlias(group, newAlias, errorEl);
            if (!error) {
                addInput.value = '';
            }
        };

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void doAdd();
        });

        addInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                void doAdd();
            }
        });

        this.registerAliasInputHandlers(addInput);

        // Delete group button
        const deleteGroupBtn = panel.createEl('button', {
            cls: 'tag-aliases-sidebar-delete-group',
            text: 'Delete group',
        });

        deleteGroupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void this.handleDeleteGroup(group);
        });
    }

    // ──────────────────────────────────────────────
    //  Expanded: Create New Group
    // ──────────────────────────────────────────────

    /**
     * Render the expanded panel for a standalone tag (no group yet).
     * Allows creating a new alias group by adding the first alias.
     */
    private renderCreatePanel(parent: HTMLElement, tag: string): void {
        const panel = parent.createDiv('tag-aliases-sidebar-edit-panel');

        panel.createDiv({
            cls: 'tag-aliases-sidebar-no-aliases',
            text: 'No aliases yet',
        });

        // Add alias row: input + add button
        const addRow = panel.createDiv('tag-aliases-sidebar-add-row');
        const addInput = addRow.createEl('input', {
            attr: { type: 'text', placeholder: 'Add alias...' },
        });

        const addBtn = addRow.createEl('button', {
            text: '\uFF0B',
            attr: { 'aria-label': 'Add alias' },
        });

        // Error message area
        const errorEl = panel.createDiv('tag-aliases-sidebar-error');

        // Create group handler
        const doCreate = async () => {
            const rawValue = addInput.value.trim();
            if (!rawValue) return;

            const newAlias = rawValue.startsWith('#') ? rawValue : '#' + rawValue;
            const primaryTag = tag.startsWith('#') ? tag : '#' + tag;

            const error = await this.handleCreateGroup(primaryTag, newAlias, errorEl);
            if (!error) {
                addInput.value = '';
            }
        };

        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void doCreate();
        });

        addInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                void doCreate();
            }
        });

        this.registerAliasInputHandlers(addInput);

        // Cancel button to collapse without creating
        const cancelBtn = panel.createEl('button', {
            cls: 'tag-aliases-sidebar-cancel',
            text: 'Cancel',
        });

        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.expandedTag = null;
            this.refresh();
        });
    }

    // ──────────────────────────────────────────────
    //  Data Mutation Handlers
    // ──────────────────────────────────────────────

    /**
     * Handle deleting a single alias from a group.
     * If the alias is the last one, the entire group is removed.
     */
    private async handleDeleteAlias(group: AliasGroup, alias: string): Promise<void> {
        const newAliases = group.aliases.filter(a => a !== alias);

        let updatedGroups: AliasGroup[] | null;

        if (newAliases.length === 0) {
            // Last alias removed: delete the entire group
            updatedGroups = this.plugin.aliasManager.removeGroup(group.id);
        } else {
            // Update group with the remaining aliases
            updatedGroups = this.plugin.aliasManager.updateGroup(group.id, { aliases: newAliases });
        }

        if (updatedGroups) {
            this.plugin.settings.aliasGroups = updatedGroups;
            await this.plugin.saveSettings();
        }

        this.refresh();
    }

    /**
     * Handle adding a new alias to an existing group.
     * Validates the alias before adding. Returns true if an error occurred.
     */
    private async handleAddAlias(
        group: AliasGroup,
        newAlias: string,
        errorEl: HTMLElement,
    ): Promise<boolean> {
        // Clear previous error
        errorEl.textContent = '';

        // Build a temporary group with the new alias for validation
        const tempGroup: AliasGroup = {
            ...group,
            aliases: [...group.aliases, newAlias],
        };

        const validationError = this.plugin.aliasManager.validate(tempGroup, group.id);
        if (validationError) {
            errorEl.textContent = validationError;
            return true;
        }

        // Valid: update the group
        const updatedGroups = this.plugin.aliasManager.updateGroup(group.id, {
            aliases: tempGroup.aliases,
        });

        if (updatedGroups) {
            this.plugin.settings.aliasGroups = updatedGroups;
            await this.plugin.saveSettings();
        }

        this.refresh();
        return false;
    }

    /**
     * Handle creating a new alias group for a standalone tag.
     * Validates the group before creating. Returns true if an error occurred.
     */
    private async handleCreateGroup(
        primaryTag: string,
        firstAlias: string,
        errorEl: HTMLElement,
    ): Promise<boolean> {
        // Clear previous error
        errorEl.textContent = '';

        const newGroup: AliasGroup = {
            id: this.plugin.aliasManager.generateId(),
            primaryTag,
            aliases: [firstAlias],
        };

        const validationError = this.plugin.aliasManager.validate(newGroup);
        if (validationError) {
            errorEl.textContent = validationError;
            return true;
        }

        // Valid: add the group
        const updatedGroups = this.plugin.aliasManager.addGroup(newGroup);
        this.plugin.settings.aliasGroups = updatedGroups;
        await this.plugin.saveSettings();

        this.refresh();
        return false;
    }

    /**
     * Handle deleting an entire alias group.
     * Shows a confirmation dialog before proceeding.
     */
    private async handleDeleteGroup(group: AliasGroup): Promise<void> {
        const tagName = group.primaryTag.replace(/^#/, '');
        const confirmed = await showConfirmModal(
            this.app,
            'Delete alias group',
            `Delete alias group "${tagName}"? This will remove all ${group.aliases.length} alias(es). The primary tag will remain as a standalone tag.`,
        );
        if (!confirmed) return;

        const updatedGroups = this.plugin.aliasManager.removeGroup(group.id);

        if (updatedGroups) {
            this.plugin.settings.aliasGroups = updatedGroups;
            await this.plugin.saveSettings();
        }

        this.expandedTag = null;
        this.refresh();
    }
}

/**
 * Simple confirmation modal using Obsidian's Modal API.
 * Returns a promise that resolves to true (confirm) or false (cancel).
 */
function showConfirmModal(
    app: import('obsidian').App,
    title: string,
    message: string,
): Promise<boolean> {
    return new Promise((resolve) => {
        let resolved = false;
        const modal = new (class extends Modal {
            onOpen(): void {
                const { contentEl } = this;
                contentEl.createEl('h3', { text: title });
                contentEl.createEl('p', { text: message });

                const btnRow = contentEl.createDiv({ cls: 'tag-aliases-button-row' });

                const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
                cancelBtn.addEventListener('click', () => {
                    resolved = true;
                    resolve(false);
                    this.close();
                });

                const confirmBtn = btnRow.createEl('button', {
                    text: 'Delete',
                    cls: 'mod-warning',
                });
                confirmBtn.addEventListener('click', () => {
                    resolved = true;
                    resolve(true);
                    this.close();
                });
            }
            onClose(): void {
                this.contentEl.empty();
                if (!resolved) {
                    resolved = true;
                    resolve(false);
                }
            }
        })(app);
        modal.open();
    });
}
