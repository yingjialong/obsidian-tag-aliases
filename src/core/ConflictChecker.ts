/**
 * ConflictChecker — detect conflicts across alias groups.
 * Pure function, no Obsidian dependencies.
 */

import { AliasGroup } from '../types';

/** A single conflict detected between alias groups. */
export interface Conflict {
    /** The type of conflict detected. */
    type: 'duplicate-alias' | 'primary-as-alias' | 'duplicate-primary';
    /** Human-readable description of the conflict. */
    description: string;
    /** The tag string involved in the conflict. */
    tag: string;
    /** IDs of the groups involved in this conflict. */
    groupIds: string[];
}

/**
 * Check all alias groups for inter-group conflicts.
 *
 * Detects three kinds of conflicts:
 * - duplicate-alias: the same alias appears in two or more groups
 * - primary-as-alias: a primary tag in one group is used as an alias in another
 * - duplicate-primary: two groups share the same primary tag (case-insensitive)
 *
 * All comparisons are case-insensitive and ignore the leading '#'.
 *
 * @param groups - The alias groups to check
 * @returns An array of Conflict objects; empty if no conflicts found
 */
export function checkConflicts(groups: AliasGroup[]): Conflict[] {
    const conflicts: Conflict[] = [];

    // Normalize a tag for comparison: strip '#' prefix and lowercase
    const normalize = (t: string) => t.replace(/^#/, '').toLowerCase();

    // Build an index: normalized tag -> list of owners with their role
    const tagOwners: Map<string, { groupId: string; tag: string; role: 'primary' | 'alias' }[]> = new Map();

    for (const group of groups) {
        // Register the primary tag
        const pNorm = normalize(group.primaryTag);
        if (!tagOwners.has(pNorm)) tagOwners.set(pNorm, []);
        tagOwners.get(pNorm)!.push({ groupId: group.id, tag: group.primaryTag, role: 'primary' });

        // Register each alias
        for (const alias of group.aliases) {
            const aNorm = normalize(alias);
            if (!tagOwners.has(aNorm)) tagOwners.set(aNorm, []);
            tagOwners.get(aNorm)!.push({ groupId: group.id, tag: alias, role: 'alias' });
        }
    }

    // Scan for conflicts: any normalized tag with owners from 2+ distinct groups
    for (const [norm, owners] of tagOwners) {
        if (owners.length <= 1) continue;

        // Deduplicate group IDs (same alias within one group is not a conflict)
        const groupIds = [...new Set(owners.map(o => o.groupId))];
        if (groupIds.length <= 1) continue;

        const primaryCount = owners.filter(o => o.role === 'primary').length;
        const hasPrimary = owners.some(o => o.role === 'primary');
        const hasAlias = owners.some(o => o.role === 'alias');
        const tag = owners[0].tag;

        // Classify the conflict type based on the roles involved
        if (primaryCount >= 2) {
            conflicts.push({
                type: 'duplicate-primary',
                description: `"${tag}" is used as primary tag in multiple groups.`,
                tag, groupIds,
            });
        } else if (hasPrimary && hasAlias) {
            conflicts.push({
                type: 'primary-as-alias',
                description: `"${tag}" is a primary tag in one group and an alias in another.`,
                tag, groupIds,
            });
        } else {
            conflicts.push({
                type: 'duplicate-alias',
                description: `"${tag}" is used as an alias in multiple groups.`,
                tag, groupIds,
            });
        }
    }

    return conflicts;
}
