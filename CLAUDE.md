# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tag Aliases plugin for Obsidian. Normalizes tags at input time by intercepting Obsidian's tag suggestions with alias-aware suggestions. Supports alias group management, auto-replace, batch migration, and export/import.

## Language Rules

- All code comments, README, git commit messages, and any other public-facing content MUST be written in English. This is an open-source project — anything visible to others must be in English.
- Internal documentation (e.g., `docs/Task-detail/`) and conversations with the developer may use Chinese.

## Build Commands

```bash
npm run dev    # Development mode (esbuild watch, auto-rebuild)
npm run build  # Production build (TypeScript type check + esbuild bundle)
npm run version # Version bump (sync manifest.json and versions.json)
```

## Architecture

See `docs/Task-detail/project-plan.md` for the full implementation plan.
