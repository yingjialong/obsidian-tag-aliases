/**
 * Comprehensive tests for replaceTagsOutsideCode().
 *
 * Verifies that tag replacement only happens in normal Markdown text
 * and is correctly skipped inside all protected regions.
 */

import { replaceTagsOutsideCode } from '../src/migration/tagReplacer';

// Helper: call with standard #js → #javascript replacement
const r = (content: string) => replaceTagsOutsideCode(content, '#js', '#javascript');

// ═══════════════════════════════════════════════════════════════════
// 1. Normal replacement — SHOULD replace
// ═══════════════════════════════════════════════════════════════════

describe('normal replacement', () => {
    test('tag at start of line', () => {
        expect(r('#js is great')).toBe('#javascript is great');
    });

    test('tag after whitespace', () => {
        expect(r('I love #js today')).toBe('I love #javascript today');
    });

    test('tag at end of line', () => {
        expect(r('I love #js')).toBe('I love #javascript');
    });

    test('tag followed by comma', () => {
        expect(r('#js, #py')).toBe('#javascript, #py');
    });

    test('tag followed by period', () => {
        expect(r('Use #js.')).toBe('Use #javascript.');
    });

    test('tag followed by exclamation', () => {
        expect(r('Use #js!')).toBe('Use #javascript!');
    });

    test('tag followed by question mark', () => {
        expect(r('Is #js?')).toBe('Is #javascript?');
    });

    test('tag followed by semicolon', () => {
        expect(r('Tag #js; done')).toBe('Tag #javascript; done');
    });

    test('tag followed by closing paren', () => {
        expect(r('(see #js)')).toBe('(see #javascript)');
    });

    test('tag followed by closing bracket (with space before #)', () => {
        expect(r('[ #js]')).toBe('[ #javascript]');
    });

    test('tag followed by closing brace (with space before #)', () => {
        expect(r('{ #js}')).toBe('{ #javascript}');
    });

    test('tag wrapped by brackets without spaces', () => {
        expect(r('[#js]')).toBe('[#javascript]');
        expect(r('{#js}')).toBe('{#javascript}');
        expect(r('(#js)')).toBe('(#javascript)');
    });

    test('tag wrapped by quotes', () => {
        expect(r('"#js"')).toBe('"#javascript"');
        expect(r("'#js'")).toBe("'#javascript'");
    });

    test('tag followed by additional non-tag punctuation', () => {
        expect(r('#js:detail')).toBe('#javascript:detail');
        expect(r('<#js>')).toBe('<#javascript>');
    });

    test('multiple occurrences on same line', () => {
        expect(r('#js and #js')).toBe('#javascript and #javascript');
    });

    test('multiple occurrences across lines', () => {
        const input = 'line1 #js\nline2 #js';
        expect(r(input)).toBe('line1 #javascript\nline2 #javascript');
    });

    test('tag on its own line', () => {
        expect(r('#js')).toBe('#javascript');
    });

    test('preserves surrounding text exactly', () => {
        expect(r('before #js after')).toBe('before #javascript after');
    });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Non-tags — should NOT be matched
// ═══════════════════════════════════════════════════════════════════

describe('non-tag text (should not replace)', () => {
    test('tag-like text not preceded by whitespace or start-of-line', () => {
        // "word#js" — '#' is preceded by a tag character, so it is not a standalone tag.
        expect(r('word#js')).toBe('word#js');
    });

    test('partial tag match (longer tag name)', () => {
        // #json starts with #js but is a different tag
        expect(r('#json data')).toBe('#json data');
    });

    test('tag followed by non-boundary character', () => {
        // '#jscode' — no boundary after #js
        expect(r('#jscode')).toBe('#jscode');
    });

    test('empty content', () => {
        expect(r('')).toBe('');
    });

    test('content with no tags', () => {
        expect(r('just plain text')).toBe('just plain text');
    });
});

// ═══════════════════════════════════════════════════════════════════
// 3. YAML frontmatter — tags SHOULD be replaced
// ═══════════════════════════════════════════════════════════════════

describe('YAML frontmatter (should replace tags)', () => {
    test('tag with # prefix in frontmatter tags list', () => {
        const input = '---\ntags:\n  - #js\n  - #python\n---\nBody text';
        const expected = '---\ntags:\n  - #javascript\n  - #python\n---\nBody text';
        expect(r(input)).toBe(expected);
    });

    test('bare tag names without # are not matched', () => {
        const input = '---\ntags: [js, python]\n---\nBody text';
        expect(r(input)).toBe(input);
    });

    test('tag in frontmatter AND body both replaced', () => {
        const input = '---\ntags:\n  - #js\n---\nBody #js here';
        const expected = '---\ntags:\n  - #javascript\n---\nBody #javascript here';
        expect(r(input)).toBe(expected);
    });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Fenced code blocks — should NOT replace
// ═══════════════════════════════════════════════════════════════════

describe('fenced code blocks (backtick)', () => {
    test('tag inside backtick-fenced block', () => {
        const input = '```\n#js inside code\n```';
        expect(r(input)).toBe(input);
    });

    test('tag inside fence with language id', () => {
        const input = '```javascript\nconst x = "#js";\n```';
        expect(r(input)).toBe(input);
    });

    test('tag after fenced block is replaced', () => {
        const input = '```\n#js\n```\n#js after';
        expect(r(input)).toBe('```\n#js\n```\n#javascript after');
    });

    test('tag before fenced block is replaced', () => {
        const input = '#js before\n```\n#js\n```';
        expect(r(input)).toBe('#javascript before\n```\n#js\n```');
    });

    test('multiple fenced blocks', () => {
        const input = '```\n#js\n```\nmiddle #js\n```\n#js\n```';
        expect(r(input)).toBe('```\n#js\n```\nmiddle #javascript\n```\n#js\n```');
    });

    test('four-backtick fence', () => {
        const input = '````\n#js inside\n````';
        expect(r(input)).toBe(input);
    });
});

describe('fenced code blocks (tilde)', () => {
    test('tag inside tilde-fenced block', () => {
        const input = '~~~\n#js inside code\n~~~';
        expect(r(input)).toBe(input);
    });

    test('tilde fence with language id', () => {
        const input = '~~~js\n#js\n~~~';
        expect(r(input)).toBe(input);
    });
});

describe('fenced code blocks (mixed fence chars)', () => {
    test('backtick fence not closed by tildes', () => {
        // Opened with ```, ~~~ inside should NOT close it
        const input = '```\n#js\n~~~\n#js\n```';
        expect(r(input)).toBe(input);
    });

    test('tilde fence not closed by backticks', () => {
        const input = '~~~\n#js\n```\n#js\n~~~';
        expect(r(input)).toBe(input);
    });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Indented code blocks — should NOT replace
// ═══════════════════════════════════════════════════════════════════

describe('indented code blocks (4 spaces)', () => {
    test('4-space indented line after blank line', () => {
        const input = 'paragraph\n\n    #js indented';
        expect(r(input)).toBe(input);
    });

    test('multiple indented lines', () => {
        const input = 'paragraph\n\n    #js line1\n    #js line2';
        expect(r(input)).toBe(input);
    });

    test('blank line between indented lines (stays in code block)', () => {
        const input = 'paragraph\n\n    #js line1\n\n    #js line2';
        expect(r(input)).toBe(input);
    });

    test('tag after indented block ends is replaced', () => {
        const input = 'paragraph\n\n    #js indented\nnormal #js';
        expect(r(input)).toBe('paragraph\n\n    #js indented\nnormal #javascript');
    });

    test('indented line WITHOUT preceding blank line is NOT a code block', () => {
        const input = 'paragraph\n    #js here';
        expect(r(input)).toBe('paragraph\n    #javascript here');
    });
});

describe('indented code blocks (tab)', () => {
    test('tab-indented line after blank line', () => {
        const input = 'paragraph\n\n\t#js tab indented';
        expect(r(input)).toBe(input);
    });

    test('tab indent without blank line is not a code block', () => {
        const input = 'paragraph\n\t#js here';
        expect(r(input)).toBe('paragraph\n\t#javascript here');
    });
});

describe('indented code block at document start', () => {
    test('first line indented (prevLineBlank starts true)', () => {
        // prevLineBlank is initialized to true, so the very first line
        // being indented should be treated as a code block
        const input = '    #js at start';
        expect(r(input)).toBe(input);
    });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Inline code (single backtick) — should NOT replace
// ═══════════════════════════════════════════════════════════════════

describe('inline code (single backtick)', () => {
    test('tag inside single-backtick inline code', () => {
        expect(r('Use `#js` for short')).toBe('Use `#js` for short');
    });

    test('tag outside inline code on same line is replaced', () => {
        expect(r('Use `code` and #js')).toBe('Use `code` and #javascript');
    });

    test('multiple inline code spans on same line', () => {
        expect(r('`#js` text `#js`')).toBe('`#js` text `#js`');
    });

    test('inline code and replaceable tag mixed', () => {
        expect(r('`#js` then #js')).toBe('`#js` then #javascript');
    });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Inline code (multi-backtick) — should NOT replace
// ═══════════════════════════════════════════════════════════════════

describe('inline code (multi-backtick)', () => {
    test('double-backtick inline code', () => {
        expect(r('Use ``#js`` here')).toBe('Use ``#js`` here');
    });

    test('triple-backtick inline code (not at line start)', () => {
        expect(r('See ```#js``` here')).toBe('See ```#js``` here');
    });

    test('double-backtick containing single backtick', () => {
        // ``code `#js` here`` — the entire thing is one inline code span
        expect(r('text ``code `#js` here`` after')).toBe('text ``code `#js` here`` after');
    });
});

// ═══════════════════════════════════════════════════════════════════
// 8. HTML comments — should NOT replace
// ═══════════════════════════════════════════════════════════════════

describe('HTML comments (same line)', () => {
    test('tag inside same-line comment', () => {
        expect(r('<!-- #js -->')).toBe('<!-- #js -->');
    });

    test('tag after same-line comment is replaced', () => {
        expect(r('<!-- comment --> #js')).toBe('<!-- comment --> #javascript');
    });

    test('tag before same-line comment is replaced', () => {
        expect(r('#js <!-- comment -->')).toBe('#javascript <!-- comment -->');
    });

    test('multiple comments on same line', () => {
        expect(r('<!-- #js --> text <!-- #js -->')).toBe('<!-- #js --> text <!-- #js -->');
    });

    test('tag between two comments is replaced', () => {
        expect(r('<!-- a --> #js <!-- b -->')).toBe('<!-- a --> #javascript <!-- b -->');
    });
});

describe('HTML comments (multi-line)', () => {
    test('tag inside multi-line comment', () => {
        const input = '<!--\n#js inside comment\n-->';
        expect(r(input)).toBe(input);
    });

    test('tag on comment-start line', () => {
        const input = '<!-- #js\ncontinues\n-->';
        expect(r(input)).toBe(input);
    });

    test('tag on comment-end line (before -->)', () => {
        const input = '<!--\n#js here -->';
        expect(r(input)).toBe(input);
    });

    test('tag after multi-line comment close is replaced', () => {
        const input = '<!--\ncomment\n--> #js after';
        expect(r(input)).toBe('<!--\ncomment\n--> #javascript after');
    });

    test('tag before multi-line comment is replaced', () => {
        const input = '#js before <!--\ncomment\n-->';
        expect(r(input)).toBe('#javascript before <!--\ncomment\n-->');
    });

    test('comment end and new comment start on same line', () => {
        const input = '<!-- first\n--> #js <!-- second\n#js inside\n-->';
        const expected = '<!-- first\n--> #javascript <!-- second\n#js inside\n-->';
        expect(r(input)).toBe(expected);
    });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Combined / complex scenarios
// ═══════════════════════════════════════════════════════════════════

describe('combined scenarios', () => {
    test('fenced block + inline code + normal text', () => {
        const input = [
            '#js top',
            '```',
            '#js in fence',
            '```',
            'text `#js` then #js',
        ].join('\n');
        const expected = [
            '#javascript top',
            '```',
            '#js in fence',
            '```',
            'text `#js` then #javascript',
        ].join('\n');
        expect(r(input)).toBe(expected);
    });

    test('all protected regions in one document', () => {
        const input = [
            '#js normal',                           // replaced
            '```',
            '#js fenced',                           // protected
            '```',
            '',
            '    #js indented',                     // protected (after blank)
            '',
            'text `#js` and #js',                   // inline protected, last replaced
            '<!-- #js comment -->',                  // protected
            '#js end',                              // replaced
        ].join('\n');
        const expected = [
            '#javascript normal',
            '```',
            '#js fenced',
            '```',
            '',
            '    #js indented',
            '',
            'text `#js` and #javascript',
            '<!-- #js comment -->',
            '#javascript end',
        ].join('\n');
        expect(r(input)).toBe(expected);
    });

    test('frontmatter + fenced block + comment + inline code', () => {
        const input = [
            '---',
            'tags:',
            '  - #js',
            '---',
            '#js after frontmatter',
            '```',
            '#js in code',
            '```',
            '<!-- #js in comment -->',
            '`#js` inline',
            'final #js',
        ].join('\n');
        const expected = [
            '---',
            'tags:',
            '  - #javascript',
            '---',
            '#javascript after frontmatter',
            '```',
            '#js in code',
            '```',
            '<!-- #js in comment -->',
            '`#js` inline',
            'final #javascript',
        ].join('\n');
        expect(r(input)).toBe(expected);
    });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Edge cases
// ═══════════════════════════════════════════════════════════════════

describe('edge cases', () => {
    test('unclosed fenced block (rest of document protected)', () => {
        const input = '```\n#js never closed';
        expect(r(input)).toBe(input);
    });

    test('unclosed HTML comment (rest of document protected)', () => {
        const input = '<!-- #js never closed';
        expect(r(input)).toBe(input);
    });

    test('empty lines only', () => {
        expect(r('\n\n\n')).toBe('\n\n\n');
    });

    test('special regex chars in tag name', () => {
        // Tag contains characters that are special in regex
        const result = replaceTagsOutsideCode(
            'Use #c++ here',
            '#c++',
            '#cpp',
        );
        expect(result).toBe('Use #cpp here');
    });

    test('unicode tag name', () => {
        const result = replaceTagsOutsideCode(
            '使用 #标签 记录',
            '#标签',
            '#tag',
        );
        expect(result).toBe('使用 #tag 记录');
    });

    test('tag with nested slashes', () => {
        const result = replaceTagsOutsideCode(
            'See #lang/js here',
            '#lang/js',
            '#lang/javascript',
        );
        expect(result).toBe('See #lang/javascript here');
    });

    test('content that is only a tag', () => {
        expect(r('#js')).toBe('#javascript');
    });

    test('fence opening line is not processed for tags', () => {
        // Even if the fence line had a tag after ```, the entire line is skipped
        const input = '```javascript #js\ncode\n```';
        expect(r(input)).toBe(input);
    });

    test('deeply indented line after non-blank is not code block', () => {
        const input = 'paragraph\n        #js deeply indented';
        expect(r(input)).toBe('paragraph\n        #javascript deeply indented');
    });

    test('tag adjacent to inline code (no space between)', () => {
        // The inline code span stays protected; the adjacent standalone tag is replaced.
        expect(r('`code`#js')).toBe('`code`#javascript');
    });

    test('multiple replacements do not interfere', () => {
        // Replace two different tags in sequence
        let content = 'Use #js and #py here';
        content = replaceTagsOutsideCode(content, '#js', '#javascript');
        content = replaceTagsOutsideCode(content, '#py', '#python');
        expect(content).toBe('Use #javascript and #python here');
    });
});
