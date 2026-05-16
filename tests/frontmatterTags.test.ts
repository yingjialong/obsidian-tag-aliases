/**
 * Tests for frontmatter tag helpers.
 *
 * Obsidian exposes parsed YAML frontmatter values as unknown shapes. These
 * helpers keep tag handling strict so automated review does not flag unsafe
 * any access and invalid YAML values do not crash migration.
 */

import {
    frontmatterTagMatches,
    normalizeFrontmatterTags,
    toHashPrefixedTag,
} from '../src/core/frontmatterTags';

describe('frontmatter tag helpers', () => {
    test('normalizes a single string tag', () => {
        expect(normalizeFrontmatterTags('project')).toEqual(['project']);
    });

    test('normalizes an array of string tags', () => {
        expect(normalizeFrontmatterTags(['project', '#work'])).toEqual(['project', '#work']);
    });

    test('ignores non-string frontmatter values', () => {
        expect(normalizeFrontmatterTags(['project', 42, null, { tag: 'bad' }])).toEqual(['project']);
        expect(normalizeFrontmatterTags(42)).toEqual([]);
        expect(normalizeFrontmatterTags({ tag: 'bad' })).toEqual([]);
    });

    test('adds hash prefix only when needed', () => {
        expect(toHashPrefixedTag('project')).toBe('#project');
        expect(toHashPrefixedTag('#work')).toBe('#work');
    });

    test('matches frontmatter tags with or without hash prefix', () => {
        expect(frontmatterTagMatches('project', '#project')).toBe(true);
        expect(frontmatterTagMatches('#project', '#project')).toBe(true);
        expect(frontmatterTagMatches('project', '#other')).toBe(false);
    });
});
