/**
 * Tests for checkConflicts() — detects inter-group conflicts
 * among alias groups (duplicate aliases, primary-as-alias, duplicate primaries).
 */

import { checkConflicts } from '../src/core/ConflictChecker';
import { AliasGroup } from '../src/types';

/** Helper to create an AliasGroup with minimal boilerplate. */
const group = (id: string, primary: string, aliases: string[]): AliasGroup => ({
    id, primaryTag: primary, aliases,
});

describe('checkConflicts', () => {
    test('no conflicts with valid groups', () => {
        const groups = [
            group('1', '#javascript', ['#js', '#JS']),
            group('2', '#python', ['#py']),
        ];
        expect(checkConflicts(groups)).toEqual([]);
    });

    test('no conflicts with empty array', () => {
        expect(checkConflicts([])).toEqual([]);
    });

    test('detects duplicate alias across groups', () => {
        const groups = [
            group('1', '#javascript', ['#js']),
            group('2', '#java-script', ['#js']),
        ];
        const conflicts = checkConflicts(groups);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].type).toBe('duplicate-alias');
        expect(conflicts[0].tag).toBe('#js');
        expect(conflicts[0].groupIds).toContain('1');
        expect(conflicts[0].groupIds).toContain('2');
    });

    test('detects primary tag used as alias in another group', () => {
        const groups = [
            group('1', '#js', ['#j']),
            group('2', '#javascript', ['#js']),
        ];
        const conflicts = checkConflicts(groups);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].type).toBe('primary-as-alias');
        expect(conflicts[0].tag).toBe('#js');
    });

    test('detects duplicate primary tags (case-insensitive)', () => {
        const groups = [
            group('1', '#JavaScript', ['#js']),
            group('2', '#javascript', ['#jscript']),
        ];
        const conflicts = checkConflicts(groups);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].type).toBe('duplicate-primary');
    });

    test('detects multiple conflicts at once', () => {
        const groups = [
            group('1', '#javascript', ['#js']),
            group('2', '#java-script', ['#js']),
            group('3', '#JavaScript', ['#jscript']),
        ];
        const conflicts = checkConflicts(groups);
        expect(conflicts.length).toBeGreaterThanOrEqual(2);
    });

    test('case-insensitive alias comparison', () => {
        const groups = [
            group('1', '#javascript', ['#JS']),
            group('2', '#java', ['#js']),
        ];
        const conflicts = checkConflicts(groups);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].type).toBe('duplicate-alias');
    });
});
