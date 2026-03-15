/**
 * AliasGroupModal - Modal dialog for creating or editing an alias group.
 *
 * Provides input fields for:
 * - Primary tag (with suggestion from existing vault tags)
 * - Alias list (add/remove individual aliases)
 * - Optional description
 *
 * Validates the group before saving and reports conflicts.
 */

import { App, Modal, Setting, Notice, getAllTags } from 'obsidian';
import { AliasGroup } from '../types';
import { AliasManager } from '../core/AliasManager';

/** Callback invoked when the user saves the alias group. */
type OnSaveCallback = (group: AliasGroup) => void;

export class AliasGroupModal extends Modal {
    /** The alias group being edited, or a new empty group. */
    private group: AliasGroup;
    /** Whether this is editing an existing group (vs creating new). */
    private isEditing: boolean;
    /** Reference to AliasManager for validation. */
    private aliasManager: AliasManager;
    /** Callback when user clicks save. */
    private onSave: OnSaveCallback;

    /** Container for the alias tags list UI. */
    private aliasListContainer: HTMLElement | null = null;
    /** Current aliases being edited (mutable working copy). */
    private currentAliases: string[];

    constructor(
        app: App,
        aliasManager: AliasManager,
        onSave: OnSaveCallback,
        existingGroup?: AliasGroup,
    ) {
        super(app);
        this.aliasManager = aliasManager;
        this.onSave = onSave;
        this.isEditing = !!existingGroup;

        if (existingGroup) {
            // Deep copy to avoid mutating the original until save
            this.group = {
                ...existingGroup,
                aliases: [...existingGroup.aliases],
            };
        } else {
            this.group = {
                id: aliasManager.generateId(),
                primaryTag: '',
                aliases: [],
            };
        }
        this.currentAliases = [...this.group.aliases];
    }

    /**
     * Build the modal content when it opens.
     */
    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('tag-aliases-modal');

        // Title
        contentEl.createEl('h2', {
            text: this.isEditing ? 'Edit Alias Group' : 'New Alias Group',
        });

        // Primary tag input
        this.renderPrimaryTagInput(contentEl);

        // Alias list
        this.renderAliasList(contentEl);

        // Description input
        this.renderDescriptionInput(contentEl);

        // Action buttons
        this.renderButtons(contentEl);
    }

    /**
     * Clean up when the modal closes.
     */
    onClose(): void {
        this.contentEl.empty();
    }

    /**
     * Render the primary tag input field with existing vault tags as suggestions.
     */
    private renderPrimaryTagInput(container: HTMLElement): void {
        const setting = new Setting(container)
            .setName('Primary tag')
            .setDesc('The canonical tag to use. Include the "#" prefix.');

        setting.addText(text => {
            text
                .setPlaceholder('#javascript')
                .setValue(this.group.primaryTag)
                .onChange(value => {
                    // Auto-add '#' prefix if missing
                    this.group.primaryTag = this.ensureHashPrefix(value.trim());
                });

            // Style the input wider for better usability
            text.inputEl.style.width = '200px';
        });
    }

    /**
     * Render the alias list with add/remove functionality.
     */
    private renderAliasList(container: HTMLElement): void {
        const section = container.createDiv('tag-aliases-alias-section');
        section.createEl('h3', { text: 'Aliases' });
        section.createEl('p', {
            text: 'Tags that should resolve to the primary tag.',
            cls: 'setting-item-description',
        });

        // Container for individual alias items
        this.aliasListContainer = section.createDiv('tag-aliases-alias-list');
        this.refreshAliasList();

        // "Add alias" button
        new Setting(section)
            .addButton(btn => {
                btn.setButtonText('+ Add alias')
                    .setCta()
                    .onClick(() => {
                        this.currentAliases.push('');
                        this.refreshAliasList();
                        // Focus the newly added input
                        const inputs = this.aliasListContainer?.querySelectorAll('input');
                        if (inputs && inputs.length > 0) {
                            inputs[inputs.length - 1].focus();
                        }
                    });
            });
    }

    /**
     * Re-render the list of alias input fields.
     */
    private refreshAliasList(): void {
        if (!this.aliasListContainer) return;
        this.aliasListContainer.empty();

        if (this.currentAliases.length === 0) {
            this.aliasListContainer.createEl('p', {
                text: 'No aliases defined. Click "+ Add alias" to add one.',
                cls: 'tag-aliases-empty-hint',
            });
            return;
        }

        this.currentAliases.forEach((alias, index) => {
            const row = this.aliasListContainer!.createDiv('tag-aliases-alias-row');

            // Alias text input
            const input = row.createEl('input', {
                type: 'text',
                value: alias,
                placeholder: '#js',
                cls: 'tag-aliases-alias-input',
            });
            input.addEventListener('input', () => {
                this.currentAliases[index] = this.ensureHashPrefix(input.value.trim());
            });
            // Also update on blur to ensure '#' prefix is applied
            input.addEventListener('blur', () => {
                input.value = this.currentAliases[index];
            });

            // Delete button
            const deleteBtn = row.createEl('button', {
                text: '\u2715',  // Unicode ✕
                cls: 'tag-aliases-alias-delete',
                attr: { 'aria-label': 'Remove alias' },
            });
            deleteBtn.addEventListener('click', () => {
                this.currentAliases.splice(index, 1);
                this.refreshAliasList();
            });
        });
    }

    /**
     * Render the optional description input.
     */
    private renderDescriptionInput(container: HTMLElement): void {
        new Setting(container)
            .setName('Description')
            .setDesc('Optional note about this alias group.')
            .addText(text => {
                text
                    .setPlaceholder('JavaScript related tags')
                    .setValue(this.group.description || '')
                    .onChange(value => {
                        this.group.description = value.trim() || undefined;
                    });
                text.inputEl.style.width = '200px';
            });
    }

    /**
     * Render Save and Cancel buttons.
     */
    private renderButtons(container: HTMLElement): void {
        const buttonRow = container.createDiv('tag-aliases-button-row');

        // Cancel button
        const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        // Save button
        const saveBtn = buttonRow.createEl('button', {
            text: 'Save',
            cls: 'mod-cta',
        });
        saveBtn.addEventListener('click', () => this.handleSave());
    }

    /**
     * Validate and save the alias group.
     */
    private handleSave(): void {
        // Filter out empty aliases
        const filteredAliases = this.currentAliases.filter(a => {
            const stripped = a.replace(/^#/, '').trim();
            return stripped.length > 0;
        });

        // Build the final group
        const finalGroup: AliasGroup = {
            id: this.group.id,
            primaryTag: this.group.primaryTag,
            aliases: filteredAliases,
            description: this.group.description,
        };

        // Validate
        const error = this.aliasManager.validate(
            finalGroup,
            this.isEditing ? this.group.id : undefined,
        );

        if (error) {
            new Notice(`Validation error: ${error}`);
            console.warn('[TagAliases] Validation failed:', error);
            return;
        }

        // Invoke callback and close
        this.onSave(finalGroup);
        this.close();
    }

    /**
     * Ensure a tag string has the '#' prefix.
     */
    private ensureHashPrefix(tag: string): string {
        if (!tag) return '';
        return tag.startsWith('#') ? tag : `#${tag}`;
    }
}
