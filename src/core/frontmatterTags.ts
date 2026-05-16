/**
 * Utilities for working with YAML frontmatter tag values.
 */

/**
 * Return only string tags from Obsidian's parsed frontmatter value.
 *
 * Obsidian exposes arbitrary YAML values here, so this function keeps callers
 * away from unsafe `any` assumptions and ignores values that cannot represent
 * valid tag names.
 */
export function normalizeFrontmatterTags(value: unknown): string[] {
    if (typeof value === 'string') {
        return [value];
    }

    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Ensure a frontmatter tag has the same `#tag` shape used by inline tags.
 */
export function toHashPrefixedTag(tag: string): string {
    return tag.startsWith('#') ? tag : `#${tag}`;
}

/**
 * Compare a frontmatter tag with a hash-prefixed Obsidian tag.
 */
export function frontmatterTagMatches(frontmatterTag: string, tag: string): boolean {
    return toHashPrefixedTag(frontmatterTag).toLowerCase() === tag.toLowerCase();
}
