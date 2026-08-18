/*
 * Sanitiser tests for the HTML Renderer visualization.
 *
 * This app renders arbitrary author-supplied HTML into a Dashboard Studio panel,
 * interpolating {{field}} values from search results. That makes it the most
 * security-sensitive visualization in the estate, and until now it had no tests
 * at all.
 *
 * The shipped file is an IIFE with no exports, so rather than refactor a
 * published app to make it testable, these tests drive the REAL code through its
 * real entry point: stub globalThis.DashboardExtensionAPI and #root, let
 * bootWhenReady() find them, then push options and data through the listeners it
 * registers and assert on what lands in the DOM.
 *
 * The sanitiser is DOM-based: parse into an inert template fragment, walk the
 * tree, drop script elements, strip on* attributes and srcdoc, neuter
 * javascript: URLs and non-http embed sources. The "former regex bypasses"
 * block below pins the three payloads that defeated the original string-regex
 * sanitiser (shipped up to v1.0.4) so they can never come back.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(
    __dirname, '..', 'appserver', 'static', 'visualizations', 'html_renderer', 'visualization.js'
);
const CODE = fs.readFileSync(SOURCE, 'utf8');

// NOTE: do NOT use vm.runInThisContext here. It evaluates in Node's V8 context,
// where `document` is undefined, so bootWhenReady() never finds #root and spins
// on its 25 ms retry forever. Every assertion then runs against an empty string,
// which silently PASSES every `not.toMatch(...)` test in this file. new Function
// evaluates in the jsdom context the tests actually live in.
const evaluate = () => new Function(CODE)();

/**
 * Boot the real visualization against a stub Studio API and return the root
 * element plus a render(options, row) helper.
 */
function boot({ options = {}, row = null } = {}) {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');

    const listeners = {};
    const state = {
        options,
        dataSources: row ? toDataSources(row) : null,
        theme: null,
    };

    globalThis.DashboardExtensionAPI = {
        addOptionsListener: (fn) => { listeners.options = fn; },
        addDataSourcesListener: (fn) => { listeners.data = fn; },
        addThemeListener: (fn) => { listeners.theme = fn; },
        getOptions: () => state.options,
        getDataSources: () => state.dataSources,
        getTheme: () => state.theme,
    };

    evaluate();

    return {
        root,
        setOptions(next) { listeners.options(next); },
        setRow(next) { listeners.data(toDataSources(next)); },
    };
}

/** Build the Studio dataSources shape the viz expects from a flat {field: value}. */
function toDataSources(row) {
    const names = Object.keys(row);
    return {
        dataSources: {
            primary: {
                data: {
                    fields: names.map((n) => ({ name: n })),
                    columns: names.map((n) => [row[n]]),
                },
            },
        },
    };
}

/**
 * Render a template and return the resulting root innerHTML.
 *
 * Guards against the vacuous-pass trap: if the viz fails to boot, innerHTML is
 * '' and every `not.toMatch(/<script/)` assertion in this file passes for the
 * wrong reason. Fail loudly instead.
 */
function render(htmlTemplate, { row = null, allowScripts = false } = {}) {
    const app = boot({ options: { htmlTemplate, allowScripts }, row });
    const out = app.root.innerHTML;
    if (out === '') {
        throw new Error(
            'visualization rendered nothing — the harness did not boot, so any ' +
            '"absence" assertion would pass vacuously. Check that the code is ' +
            'evaluated in the jsdom context and that #root exists.'
        );
    }
    return out;
}

afterEach(() => {
    delete globalThis.DashboardExtensionAPI;
    document.body.innerHTML = '';
});

describe('script stripping', () => {
    test('blocks a paired script tag', () => {
        const out = render('<p>hi</p><script>alert(1)</script>');
        expect(out).not.toMatch(/<script/i);
        expect(out).toContain('<p>hi</p>');
    });

    // Each of these keeps a benign sibling element so the render is non-empty:
    // a template that is nothing BUT a script legitimately sanitises to '', which
    // would trip the vacuous-pass guard in render(). The sibling also strengthens
    // the assertion, by proving the surrounding markup survived.
    test('blocks a script tag carrying attributes', () => {
        const out = render('<p>keep</p><script type="text/javascript" src="https://evil.example/x.js"></script>');
        expect(out).not.toMatch(/<script/i);
        expect(out).not.toContain('evil.example');
        expect(out).toContain('<p>keep</p>');
    });

    test('blocks a self-closing script tag', () => {
        const out = render('<p>keep</p><script src="https://evil.example/x.js" />');
        expect(out).not.toMatch(/<script/i);
        expect(out).not.toContain('evil.example');
        expect(out).toContain('<p>keep</p>');
    });

    test('blocks an unterminated script tag', () => {
        const out = render('<p>keep</p><script>alert(1)');
        expect(out).not.toMatch(/<script/i);
        expect(out).not.toContain('alert(1)');
        expect(out).toContain('<p>keep</p>');
    });

    test('blocks mixed-case and spaced script tags', () => {
        const out = render('<p>keep</p><ScRiPt >alert(1)</ScRiPt >');
        expect(out).not.toMatch(/<script/i);
        expect(out).toContain('<p>keep</p>');
    });

    test('blocks a script hidden inside an inert template element', () => {
        const app = boot({ options: { htmlTemplate: '<template><script>alert(1)</script></template><p>keep</p>' } });
        const tpl = app.root.querySelector('template');
        if (tpl) expect(tpl.content.querySelectorAll('script')).toHaveLength(0);
        expect(app.root.innerHTML).toContain('<p>keep</p>');
    });

    test('no script element survives into the DOM', () => {
        const app = boot({ options: { htmlTemplate: '<div><script>alert(1)</script></div>' } });
        expect(app.root.querySelectorAll('script')).toHaveLength(0);
    });
});

describe('event-handler attribute stripping', () => {
    test('blocks a double-quoted handler', () => {
        expect(render('<img src="x" onerror="alert(1)">')).not.toMatch(/onerror/i);
    });

    test('blocks a single-quoted handler', () => {
        expect(render("<img src='x' onerror='alert(1)'>")).not.toMatch(/onerror/i);
    });

    test('blocks an unquoted handler', () => {
        expect(render('<img src=x onerror=alert(1)>')).not.toMatch(/onerror/i);
    });

    test('blocks a handler with spaces around the equals sign', () => {
        expect(render('<div onclick = "alert(1)">x</div>')).not.toMatch(/onclick/i);
    });

    test('blocks handlers on the body of a larger document fragment', () => {
        const out = render('<section><button onmouseover="steal()">go</button></section>');
        expect(out).not.toMatch(/onmouseover/i);
        expect(out).toContain('go');
    });
});

describe('javascript: URL neutering', () => {
    test('neuters a double-quoted javascript: href', () => {
        const out = render('<a href="javascript:alert(1)">x</a>');
        expect(out).not.toMatch(/javascript:/i);
    });

    test('neuters a single-quoted javascript: src', () => {
        const out = render("<iframe src='javascript:alert(1)'></iframe>");
        expect(out).not.toMatch(/javascript:/i);
    });

    test('neuters a javascript: URL with leading whitespace', () => {
        const out = render('<a href="   javascript:alert(1)">x</a>');
        expect(out).not.toMatch(/javascript:/i);
    });
});

describe('interpolated search data is sanitised', () => {
    // The important ordering property: interpolate() runs BEFORE sanitise(), so a
    // hostile value in a search result cannot inject markup. If anyone reorders
    // those two lines, every test here fails.
    test('a script tag arriving in a search field is stripped', () => {
        const out = render('<div>{{msg}}</div>', { row: { msg: '<script>alert(1)</script>' } });
        expect(out).not.toMatch(/<script/i);
    });

    test('an event handler arriving in a search field is stripped', () => {
        const out = render('<div>{{msg}}</div>', { row: { msg: '<img src=x onerror=alert(1)>' } });
        expect(out).not.toMatch(/onerror/i);
    });

    test('a javascript: URL arriving in a search field is neutered', () => {
        const out = render('<div>{{msg}}</div>', { row: { msg: '<a href="javascript:alert(1)">x</a>' } });
        expect(out).not.toMatch(/javascript:/i);
    });

    test('benign field values still interpolate', () => {
        const out = render('<div>{{msg}}</div>', { row: { msg: 'Hello world' } });
        expect(out).toContain('Hello world');
    });

    test('a missing field renders empty, not the literal placeholder', () => {
        const out = render('<div>[{{nope}}]</div>', { row: { msg: 'x' } });
        expect(out).toContain('[]');
    });
});

describe('allowScripts opt-in', () => {
    test('with allowScripts the sanitiser is skipped', () => {
        const out = render('<div onclick="alert(1)">x</div>', { allowScripts: true });
        expect(out).toMatch(/onclick/i);
    });

    test('sanitiser is on by default when the option is absent', () => {
        const app = boot({ options: { htmlTemplate: '<div onclick="alert(1)">x</div>' } });
        expect(app.root.innerHTML).not.toMatch(/onclick/i);
    });
});

describe('former regex bypasses, closed by the DOM sanitiser', () => {
    // These three were shipped as documented KNOWN GAP tests against the old
    // string-regex sanitiser. The sanitiser now parses first and scrubs the
    // resulting tree, so every check operates on the values the browser will
    // actually act on. Each assertion here is the inverse of the old one.

    test('a slash instead of whitespace no longer hides a handler', () => {
        // The parser reads <img/onerror=...> as an img with an onerror
        // attribute; the DOM walk sees the attribute name and drops it.
        const out = render('<img/onerror=alert(1) src=x>');
        expect(out).not.toMatch(/onerror/i);
    });

    test('an unquoted javascript: URL is neutered', () => {
        const out = render('<a href=javascript:alert(1)>x</a>');
        expect(out).not.toMatch(/javascript:/i);
    });

    test('an entity-encoded javascript: scheme is neutered after parsing', () => {
        // The killer case for the regex approach: "java&#115;cript:" only
        // becomes a live javascript: URL after entity decoding. The DOM
        // sanitiser reads the DECODED attribute value, so it catches it.
        // Confirmed by reading the parsed href back off the element.
        const app = boot({ options: { htmlTemplate: '<a id="t" href="java&#115;cript:alert(1)">x</a>' } });
        const href = app.root.querySelector('#t').getAttribute('href');
        expect(href).toBe('#');
    });

    test('a tab inside the scheme is neutered', () => {
        const app = boot({ options: { htmlTemplate: '<a id="t" href="java&#9;script:alert(1)">x</a>' } });
        const href = app.root.querySelector('#t').getAttribute('href');
        expect(href).toBe('#');
    });
});

describe('embedded-document vectors', () => {
    // Studio's panel sandbox allows script execution (that is how the viz
    // itself runs), so a nested browsing context that carries its own markup
    // is a script-smuggling vector, not just a cosmetic concern.

    test('iframe srcdoc is removed', () => {
        const out = render('<iframe srcdoc="<script>alert(1)</script>"></iframe><p>keep</p>');
        expect(out).not.toMatch(/srcdoc/i);
        expect(out).toContain('<p>keep</p>');
    });

    test('data: URL on an iframe src is removed', () => {
        const app = boot({ options: { htmlTemplate: '<iframe id="t" src="data:text/html,<script>alert(1)</script>"></iframe>' } });
        expect(app.root.querySelector('#t').getAttribute('src')).toBeNull();
    });

    test('data attribute on an object element is removed for non-http schemes', () => {
        const app = boot({ options: { htmlTemplate: '<object id="t" data="data:text/html,hi"></object>' } });
        expect(app.root.querySelector('#t').getAttribute('data')).toBeNull();
    });

    test('an https iframe src is preserved', () => {
        const app = boot({ options: { htmlTemplate: '<iframe id="t" src="https://example.org/page"></iframe>' } });
        expect(app.root.querySelector('#t').getAttribute('src')).toBe('https://example.org/page');
    });

    test('a relative embed src is preserved', () => {
        const app = boot({ options: { htmlTemplate: '<embed id="t" src="/static/app/thing.svg">' } });
        expect(app.root.querySelector('#t').getAttribute('src')).toBe('/static/app/thing.svg');
    });
});
