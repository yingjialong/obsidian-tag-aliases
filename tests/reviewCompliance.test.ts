/**
 * Review compliance checks for Obsidian Community Portal submissions.
 *
 * These tests codify release metadata rules that can block automated review,
 * so version and manifest regressions are caught before publishing.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface PluginManifest {
    id: string;
    version: string;
    minAppVersion: string;
    description: string;
}

interface PackageJson {
    version: string;
    description: string;
    devDependencies?: Record<string, string>;
}

/** Read and parse a JSON file from the repository root. */
function readJson<T>(fileName: string): T {
    return JSON.parse(readFileSync(join(__dirname, '..', fileName), 'utf8')) as T;
}

/** Compare dotted semantic-ish version strings numerically. */
function compareVersions(left: string, right: string): number {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    const length = Math.max(leftParts.length, rightParts.length);

    for (let i = 0; i < length; i++) {
        const leftPart = leftParts[i] ?? 0;
        const rightPart = rightParts[i] ?? 0;
        if (leftPart !== rightPart) {
            return leftPart - rightPart;
        }
    }

    return 0;
}

describe('Community Portal review metadata', () => {
    const manifest = readJson<PluginManifest>('manifest.json');
    const packageJson = readJson<PackageJson>('package.json');
    const versions = readJson<Record<string, string>>('versions.json');

    test('manifest requires the newest Obsidian API used by the plugin', () => {
        expect(compareVersions(manifest.minAppVersion, '1.7.2')).toBeGreaterThanOrEqual(0);
    });

    test('manifest description describes behavior without self-referential wording', () => {
        expect(manifest.description).not.toMatch(/\b(this plugin|a plugin that|plugin for)\b/i);
    });

    test('package description avoids self-referential wording', () => {
        expect(packageJson.description).not.toMatch(/\b(this plugin|a plugin that|plugin for)\b/i);
    });

    test('package and manifest versions stay synchronized', () => {
        expect(packageJson.version).toBe(manifest.version);
        expect(versions[manifest.version]).toBe(manifest.minAppVersion);
    });

    test('build configuration does not depend on builtin-modules', () => {
        expect(packageJson.devDependencies ?? {}).not.toHaveProperty('builtin-modules');
    });
});
