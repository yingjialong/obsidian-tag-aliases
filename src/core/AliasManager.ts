/**
 * AliasManager - Core alias group management and lookup.
 *
 * Maintains two indexes for O(1) tag lookup:
 * - primaryIndex: normalized primary tag -> AliasGroup
 * - aliasIndex:   normalized alias tag   -> AliasGroup
 *
 * All internal lookups normalize tags by lowercasing and stripping the '#' prefix.
 */

import { AliasGroup, TagSuggestionItem } from '../types';

export class AliasManager {
    /** Primary tag (normalized) -> AliasGroup */
    private primaryIndex: Map<string, AliasGroup> = new Map();
    /** Alias tag (normalized) -> AliasGroup */
    private aliasIndex: Map<string, AliasGroup> = new Map();
    /** All groups, kept in sync with settings */
    private groups: AliasGroup[] = [];

    /**
     * Build indexes from a list of alias groups.
     * Called on plugin load and after any CRUD operation.
     */
    buildIndex(groups: AliasGroup[]): void {
        this.groups = [...groups];
        this.primaryIndex.clear();
        this.aliasIndex.clear();

        for (const group of this.groups) {
            const normalizedPrimary = this.normalize(group.primaryTag);
            this.primaryIndex.set(normalizedPrimary, group);

            for (const alias of group.aliases) {
                const normalizedAlias = this.normalize(alias);
                this.aliasIndex.set(normalizedAlias, group);
            }
        }

        console.log('[TagAliases] Index built.', {
            groups: this.groups.length,
            primaryTags: this.primaryIndex.size,
            aliases: this.aliasIndex.size,
        });
    }

    /**
     * Find the alias group that a tag belongs to (as primary or alias).
     * Returns null if the tag is not part of any group.
     */
    findGroup(tag: string): AliasGroup | null {
        const normalized = this.normalize(tag);
        return this.primaryIndex.get(normalized)
            ?? this.aliasIndex.get(normalized)
            ?? null;
    }

    /**
     * Check whether a tag is registered as an alias (not a primary tag).
     */
    isAlias(tag: string): boolean {
        const normalized = this.normalize(tag);
        // It's an alias if it's in the alias index but NOT a primary tag
        return this.aliasIndex.has(normalized) && !this.primaryIndex.has(normalized);
    }

    /**
     * Get the primary tag for a given tag.
     * If the tag is an alias, returns the group's primary tag.
     * If the tag is already a primary tag or not in any group, returns itself.
     */
    getPrimaryTag(tag: string): string {
        const group = this.findGroup(tag);
        if (group) {
            return group.primaryTag;
        }
        return tag;
    }

    /**
     * Search for tags matching a query prefix.
     * Matches against both primary tags and aliases.
     * Returns TagSuggestionItems sorted by relevance:
     *   1. Primary tag name matches (matchSource = 'primary')
     *   2. Alias matches (matchSource = 'alias')
     *
     * @param query - The search prefix (without '#'), e.g. "js"
     */
    search(query: string): TagSuggestionItem[] {
        const normalizedQuery = query.toLowerCase();
        const results: TagSuggestionItem[] = [];
        const seenGroupIds = new Set<string>();

        // Phase 1: Match against primary tags
        for (const group of this.groups) {
            const primaryName = this.normalize(group.primaryTag);
            if (primaryName.startsWith(normalizedQuery)) {
                seenGroupIds.add(group.id);
                results.push({
                    insertText: group.primaryTag,
                    displayText: group.primaryTag,
                    matchSource: 'primary',
                    group,
                });
            }
        }

        // Phase 2: Match against aliases (skip groups already matched via primary)
        for (const group of this.groups) {
            if (seenGroupIds.has(group.id)) {
                continue;
            }

            for (const alias of group.aliases) {
                const aliasName = this.normalize(alias);
                if (aliasName.startsWith(normalizedQuery)) {
                    seenGroupIds.add(group.id);
                    results.push({
                        insertText: group.primaryTag,
                        displayText: group.primaryTag,
                        matchSource: 'alias',
                        matchedAlias: alias,
                        group,
                    });
                    // Only add the group once, even if multiple aliases match
                    break;
                }
            }
        }

        return results;
    }

    /**
     * Add a new alias group.
     * Returns the updated groups array (caller should persist to settings).
     */
    addGroup(group: AliasGroup): AliasGroup[] {
        this.groups.push(group);
        this.buildIndex(this.groups);
        console.log('[TagAliases] Group added:', group.primaryTag);
        return [...this.groups];
    }

    /**
     * Update an existing alias group by ID.
     * Returns the updated groups array, or null if the ID was not found.
     */
    updateGroup(id: string, updates: Partial<AliasGroup>): AliasGroup[] | null {
        const index = this.groups.findIndex(g => g.id === id);
        if (index === -1) {
            console.warn('[TagAliases] Cannot update: group not found, id =', id);
            return null;
        }

        this.groups[index] = { ...this.groups[index], ...updates };
        this.buildIndex(this.groups);
        console.log('[TagAliases] Group updated:', this.groups[index].primaryTag);
        return [...this.groups];
    }

    /**
     * Remove an alias group by ID.
     * Returns the updated groups array, or null if the ID was not found.
     */
    removeGroup(id: string): AliasGroup[] | null {
        const index = this.groups.findIndex(g => g.id === id);
        if (index === -1) {
            console.warn('[TagAliases] Cannot remove: group not found, id =', id);
            return null;
        }

        const removed = this.groups.splice(index, 1)[0];
        this.buildIndex(this.groups);
        console.log('[TagAliases] Group removed:', removed.primaryTag);
        return [...this.groups];
    }

    /** Get all alias groups. */
    getGroups(): AliasGroup[] {
        return [...this.groups];
    }

    /**
     * Validate a new or updated alias group for conflicts.
     * Returns an error message string if invalid, or null if valid.
     *
     * @param group - The group to validate
     * @param excludeId - If editing, exclude this group's own ID from conflict checks
     */
    validate(group: AliasGroup, excludeId?: string): string | null {
        // Primary tag must not be empty
        const primaryNorm = this.normalize(group.primaryTag);
        if (!primaryNorm) {
            return 'Primary tag cannot be empty.';
        }

        // Validate tag format (alphanumeric, underscore, hyphen, slash)
        if (!this.isValidTagFormat(primaryNorm)) {
            return `Invalid primary tag format: "${group.primaryTag}". Tags may only contain letters, numbers, underscores, hyphens, and slashes.`;
        }

        // Must have at least one alias
        if (group.aliases.length === 0) {
            return 'At least one alias is required.';
        }

        // Validate each alias format
        for (const alias of group.aliases) {
            const aliasNorm = this.normalize(alias);
            if (!aliasNorm) {
                return 'Alias tags cannot be empty.';
            }
            if (!this.isValidTagFormat(aliasNorm)) {
                return `Invalid alias format: "${alias}". Tags may only contain letters, numbers, underscores, hyphens, and slashes.`;
            }
        }

        // Check for duplicates within the aliases list
        const aliasSet = new Set<string>();
        for (const alias of group.aliases) {
            const norm = this.normalize(alias);
            if (norm === primaryNorm) {
                return `Alias "${alias}" is the same as the primary tag.`;
            }
            if (aliasSet.has(norm)) {
                return `Duplicate alias: "${alias}".`;
            }
            aliasSet.add(norm);
        }

        // Check for conflicts with other groups
        for (const existing of this.groups) {
            if (excludeId && existing.id === excludeId) {
                continue;
            }

            const existingPrimary = this.normalize(existing.primaryTag);

            // Primary tag conflicts
            if (primaryNorm === existingPrimary) {
                return `Primary tag "${group.primaryTag}" conflicts with existing group "${existing.primaryTag}".`;
            }
            if (existing.aliases.some(a => this.normalize(a) === primaryNorm)) {
                return `Primary tag "${group.primaryTag}" is already used as an alias in group "${existing.primaryTag}".`;
            }

            // Alias conflicts
            for (const alias of group.aliases) {
                const aliasNorm = this.normalize(alias);
                if (aliasNorm === existingPrimary) {
                    return `Alias "${alias}" conflicts with primary tag of group "${existing.primaryTag}".`;
                }
                if (existing.aliases.some(a => this.normalize(a) === aliasNorm)) {
                    return `Alias "${alias}" is already used in group "${existing.primaryTag}".`;
                }
            }
        }

        return null;
    }

    /**
     * Generate a unique ID for a new alias group.
     */
    generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    }

    /**
     * Normalize a tag string for index lookup:
     * strip '#' prefix and convert to lowercase.
     */
    private normalize(tag: string): string {
        return tag.replace(/^#/, '').toLowerCase();
    }

    /**
     * Validate that a tag name (without '#') contains only allowed characters:
     * letters (any script), digits, underscores, hyphens, and slashes.
     */
    private isValidTagFormat(normalizedTag: string): boolean {
        // Obsidian tags allow: letters (unicode), digits, underscores, hyphens, forward slashes
        // Must not be empty, must not start/end with slash
        return /^[\p{L}\p{N}_\-/]+$/u.test(normalizedTag)
            && !normalizedTag.startsWith('/')
            && !normalizedTag.endsWith('/');
    }
}
