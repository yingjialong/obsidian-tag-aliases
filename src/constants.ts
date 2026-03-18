/**
 * Default settings and constants for the Tag Aliases plugin.
 */

import { TagAliasSettings } from './types';

/** Default plugin settings applied on first load. */
export const DEFAULT_SETTINGS: TagAliasSettings = {
    aliasGroups: [],
    autoReplace: false,
};

/** Plugin display name used in UI elements. */
export const PLUGIN_NAME = 'Tag Aliases';

/** File name for exported alias configuration. */
export const EXPORT_FILE_NAME = 'tag-aliases-backup.json';

/** Sidebar view type identifier for Obsidian's view registry. */
export const VIEW_TYPE_TAG_ALIASES = 'tag-aliases-sidebar';
