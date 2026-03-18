/**
 * Tag replacement logic extracted as pure functions for testability.
 *
 * replaceTagsOutsideCode() is the public entry point — it replaces all
 * occurrences of a tag in Markdown content while skipping protected regions:
 *   - Fenced code blocks (``` or ~~~)
 *   - Indented code blocks (4+ spaces / tab, after blank line)
 *   - Inline code spans (single and multi-backtick)
 *   - HTML comments (<!-- -->, including multi-line)
 */

/**
 * Replace a tag in Markdown content, skipping all protected regions.
 *
 * @param content - Full Markdown document text
 * @param from    - Tag to find, including '#' prefix (e.g. "#js")
 * @param to      - Replacement tag, including '#' prefix (e.g. "#javascript")
 * @returns Content with tags replaced outside protected regions
 */
export function replaceTagsOutsideCode(content: string, from: string, to: string): string {
    const lines = content.split('\n');
    let inFencedBlock = false;
    let fenceChar = '';
    let inHtmlComment = false;
    let prevLineBlank = true;
    let inIndentedCode = false;
    const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();
        const indent = line.length - trimmed.length;
        const isBlank = trimmed.length === 0;

        // ── Multi-line HTML comment continuation ──
        if (inHtmlComment) {
            const endIdx = line.indexOf('-->');
            if (endIdx === -1) {
                // Entire line is inside comment
                prevLineBlank = isBlank;
                continue;
            }
            // Comment ends on this line; process the remainder
            inHtmlComment = false;
            const afterComment = line.substring(endIdx + 3);
            const processed = replaceInNormalText(afterComment, escapedFrom, to);
            lines[i] = line.substring(0, endIdx + 3) + processed.text;
            inHtmlComment = processed.endsInComment;
            prevLineBlank = false;
            continue;
        }

        // ── Fenced code blocks (``` or ~~~) ──
        const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
        if (fenceMatch) {
            if (!inFencedBlock) {
                inFencedBlock = true;
                fenceChar = fenceMatch[1].charAt(0);
                inIndentedCode = false;
                prevLineBlank = false;
                continue;
            }
            // Closing fence must use the same character as the opening
            if (trimmed.charAt(0) === fenceChar) {
                inFencedBlock = false;
                prevLineBlank = false;
                continue;
            }
        }
        if (inFencedBlock) {
            prevLineBlank = false;
            continue;
        }

        // ── Indented code blocks (4+ spaces or tab, after blank line) ──
        const isIndented = !isBlank && (indent >= 4 || line.charAt(0) === '\t');
        if (inIndentedCode) {
            if (isIndented || isBlank) {
                prevLineBlank = isBlank;
                continue;
            }
            // Non-indented non-blank line exits indented code block
            inIndentedCode = false;
        } else if (isIndented && prevLineBlank) {
            inIndentedCode = true;
            prevLineBlank = false;
            continue;
        }

        // ── Normal line: replace tags, skip inline code and HTML comments ──
        if (!isBlank) {
            const processed = replaceInNormalText(line, escapedFrom, to);
            lines[i] = processed.text;
            inHtmlComment = processed.endsInComment;
        }
        prevLineBlank = isBlank;
    }

    return lines.join('\n');
}

/**
 * Replace tags in a single line of normal text.
 * Skips inline code spans (single/multi-backtick) and HTML comments
 * via regex alternation — protected patterns match first and are preserved.
 *
 * @returns Processed text and whether the line ends inside an unclosed comment.
 */
function replaceInNormalText(
    text: string,
    escapedFrom: string,
    to: string,
): { text: string; endsInComment: boolean } {
    let endsInComment = false;

    // Regex alternatives, matched left-to-right (first match wins):
    //   1. Multi-backtick inline code  — (`{2,})...\1
    //   2. Single-backtick inline code — `[^`]+`
    //   3. Complete HTML comment       — <!-- ... -->
    //   4. Unclosed HTML comment start — <!-- to end of line
    //   5. Target tag to replace
    const regex = new RegExp(
        '(`{2,})([\\s\\S]*?)\\1' +
        '|`[^`]+`' +
        '|<!--[\\s\\S]*?-->' +
        '|<!--.*$' +
        `|((^|[\\s])${escapedFrom}(?=[\\s,;.!?\\)\\]\\}]|$))`,
        'gu',
    );

    const result = text.replace(
        regex,
        (match, _multiTick, _multiContent, tag, prefix) => {
            // Unclosed HTML comment — preserve and flag multi-line state
            if (match.startsWith('<!--') && !match.includes('-->')) {
                endsInComment = true;
                return match;
            }
            // Tag match — replace with primary tag
            if (tag !== undefined) {
                return (prefix || '') + to;
            }
            // All other matches (inline code, complete comment) — preserve
            return match;
        },
    );

    return { text: result, endsInComment };
}
