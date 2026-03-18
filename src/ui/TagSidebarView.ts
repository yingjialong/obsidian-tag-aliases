/**
 * TagSidebarView — Right-sidebar panel for managing tag aliases.
 *
 * Displays all vault tags, supports inline alias editing,
 * conflict detection, search, and sort.
 */

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
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('tag-aliases-sidebar');
        // Placeholder header — will be replaced with full UI in later tasks
        container.createEl('div', { cls: 'tag-aliases-sidebar-header', text: 'Tag Aliases' });
    }

    async onClose(): Promise<void> {
        this.containerEl.empty();
    }
}
