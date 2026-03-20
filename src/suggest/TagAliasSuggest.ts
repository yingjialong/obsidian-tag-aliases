/**
 * TagAliasSuggest - EditorSuggest implementation that intercepts
 * Obsidian's built-in tag autocomplete with alias-aware suggestions.
 *
 * When the user types '#', this suggest activates and:
 * 1. Matches the input against alias groups (primary tags + aliases)
 * 2. Merges with all existing vault tags for completeness
 * 3. Shows alias hints when a match was via alias
 * 4. Always inserts the primary tag on selection
 */

import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    TFile,
} from 'obsidian';
import { TagSuggestionItem } from '../types';
import { AliasManager } from '../core/AliasManager';

export class TagAliasSuggest extends EditorSuggest<TagSuggestionItem> {
    private aliasManager: AliasManager;

    constructor(app: App, aliasManager: AliasManager) {
        super(app);
        this.aliasManager = aliasManager;
    }

    /**
     * Detect whether the cursor is in a tag-typing context.
     * Looks backwards from the cursor for a '#' character that starts a tag.
     * Returns trigger info if found, null otherwise.
     *
     * When this returns non-null, this suggest "claims" the input and
     * should prevent other suggests (including built-in tag suggest) from showing.
     */
    onTrigger(
        cursor: EditorPosition,
        editor: Editor,
        file: TFile | null,
    ): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line);
        const textBeforeCursor = line.substring(0, cursor.ch);

        // Match a '#' followed by optional tag characters (letters, digits, _, -, /)
        // The '#' must be at the start of the line or preceded by a space/whitespace
        const match = textBeforeCursor.match(/(?:^|[\s])#([\p{L}\p{N}_\-/]*)$/u);

        if (!match) {
            return null;
        }

        // Calculate the start position of the '#' character
        // match.index is the start of the full match (may include the leading space)
        const matchStart = match.index! + (match[0].length - match[1].length - 1);

        return {
            start: { line: cursor.line, ch: matchStart },
            end: cursor,
            query: match[1], // The text after '#', e.g. "js" from "#js"
        };
    }

    /**
     * Generate the suggestion list based on the user's input.
     * Combines alias-aware matches with all vault tags.
     */
    getSuggestions(context: EditorSuggestContext): TagSuggestionItem[] {
        const query = context.query;

        // Get alias-matched suggestions
        const aliasResults = this.aliasManager.search(query);

        // Get all vault tags with their counts
        const vaultTags = this.getVaultTags();

        // Build a set of primary tags already covered by alias results
        const coveredPrimaryTags = new Set<string>(
            aliasResults.map(r => r.insertText.toLowerCase())
        );

        // Add vault tags that aren't already covered by alias results
        const normalizedQuery = query.toLowerCase();
        const vaultResults: TagSuggestionItem[] = [];

        for (const [tag, count] of Object.entries(vaultTags)) {
            const tagLower = tag.toLowerCase();
            // Strip '#' for matching
            const tagName = tagLower.replace(/^#/, '');

            // Skip if already in alias results
            if (coveredPrimaryTags.has(tagLower)) {
                // Update count on the alias result instead
                const existing = aliasResults.find(
                    r => r.insertText.toLowerCase() === tagLower
                );
                if (existing) {
                    existing.count = count;
                }
                continue;
            }

            // Prefix match against the query
            if (tagName.startsWith(normalizedQuery)) {
                vaultResults.push({
                    insertText: tag,
                    displayText: tag,
                    matchSource: 'none',
                    count,
                });
            }
        }

        // Also check if vault tags match any alias (tag exists in vault but was
        // entered as an alias, and its group wasn't matched via primary in search)
        for (const item of vaultResults) {
            const group = this.aliasManager.findGroup(item.insertText);
            if (group) {
                // Save original vault tag as the matched alias before overwriting
                const originalTag = item.insertText;
                item.insertText = group.primaryTag;
                item.displayText = group.primaryTag;
                item.matchSource = 'alias';
                item.matchedAlias = originalTag;
                item.group = group;
            }
        }

        // Merge: alias results first, then vault tags, sorted by count within each group
        const merged = [
            ...aliasResults.sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
            ...vaultResults.sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
        ];

        // Deduplicate by insertText (case-insensitive)
        const seen = new Set<string>();
        const deduped: TagSuggestionItem[] = [];
        for (const item of merged) {
            const key = item.insertText.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(item);
            }
        }

        return deduped;
    }

    /**
     * Render a single suggestion item in the popup.
     * Shows the tag name, alias hint (if matched via alias), and usage count.
     */
    renderSuggestion(item: TagSuggestionItem, el: HTMLElement): void {
        const container = el.createDiv('tag-aliases-suggest-item');

        // Top row: primary tag name
        const topRow = container.createDiv({
            cls: 'tag-aliases-suggest-top-row',
        });

        topRow.createSpan({
            text: item.displayText,
            cls: 'tag-aliases-suggest-primary',
        });

        // Count badge (if available)
        if (item.count !== undefined && item.count > 0) {
            topRow.createSpan({
                text: `\u00D7${item.count}`,  // ×N
                cls: 'tag-aliases-suggest-count',
            });
        }

        // Alias hint (if matched via alias)
        if (item.matchSource === 'alias' && item.matchedAlias) {
            container.createDiv({
                text: `\u21A9 alias: ${item.matchedAlias.replace(/^#/, '')}`,  // ↩ alias: js
                cls: 'tag-aliases-suggest-alias-hint',
            });
        }

        // Show all aliases if matched via primary and group has aliases
        if (item.matchSource === 'primary' && item.group && item.group.aliases.length > 0) {
            const aliasNames = item.group.aliases.map(a => a.replace(/^#/, '')).join(', ');
            container.createDiv({
                text: `aliases: ${aliasNames}`,
                cls: 'tag-aliases-suggest-alias-hint',
            });
        }
    }

    /**
     * Handle selection of a suggestion item.
     * Replaces the trigger text with the primary tag.
     */
    selectSuggestion(
        item: TagSuggestionItem,
        evt: MouseEvent | KeyboardEvent,
    ): void {
        if (!this.context) return;

        const editor = this.context.editor;
        const start = this.context.start;
        const end = this.context.end;

        // Replace the '#partial' with the full primary tag, plus trailing space
        editor.replaceRange(
            item.insertText + ' ',
            start,
            end,
        );

        // Move cursor to after the inserted tag + space
        const newCh = start.ch + item.insertText.length + 1;
        editor.setCursor({ line: start.line, ch: newCh });
    }

    /**
     * Get all tags in the vault with their usage counts.
     * Uses the undocumented MetadataCache.getTags() API which returns
     * Record<string, number>. Falls back to manual enumeration if unavailable.
     */
    private getVaultTags(): Record<string, number> {
        // getTags() is undocumented but widely used and stable
        const metadataCache = this.app.metadataCache as unknown as
            { getTags?: () => Record<string, number> };
        if (typeof metadataCache.getTags === 'function') {
            return metadataCache.getTags();
        }

        // Fallback: manually enumerate all files and collect tags
        console.warn('[TagAliases] MetadataCache.getTags() not available, using fallback.');
        const tags: Record<string, number> = {};
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache) continue;

            // Inline tags
            if (cache.tags) {
                for (const tagCache of cache.tags) {
                    const tag = tagCache.tag;
                    tags[tag] = (tags[tag] ?? 0) + 1;
                }
            }

            // Frontmatter tags
            if (cache.frontmatter?.tags) {
                const fmTags = Array.isArray(cache.frontmatter.tags)
                    ? cache.frontmatter.tags
                    : [cache.frontmatter.tags];
                for (const t of fmTags) {
                    const tag = t.startsWith('#') ? t : `#${t}`;
                    tags[tag] = (tags[tag] ?? 0) + 1;
                }
            }
        }

        return tags;
    }
}
