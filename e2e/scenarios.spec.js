/*
 * Sanitisation, data and option scenarios for the HTML Renderer on a real
 * Splunk, in Dashboard Studio (Studio-only viz: no Simple XML leg).
 *
 * "Never executes" is observed two ways the viz never touches: each payload
 * logs PWNED:<name> to the console (page-level capture covers nested frames
 * too) and sets a window flag in the viz frame. A positive control proves
 * both channels work in the sandbox: with allowScripts true the same kind of
 * script does run and log.
 */
const { test, expect, request } = require('@playwright/test');

const MGMT_URL = process.env.SPLUNK_MGMT_URL || 'https://localhost:8089';
const USER = process.env.SPLUNK_USER || 'admin';
const PASS = process.env.SPLUNK_PASSWORD || 'Changeme1!';
const APP = 'viz-html-renderer';

const pw = (name) => `console.log('PWNED:${name}');window.__p_${name}=1`;

// Every payload family the sanitiser contract covers. Clickable ones carry an id.
const HOSTILE =
    '<div id="e2e-hostile">' +
    `<script>${pw('script')}</script>` +
    `<img src="x" onerror="${pw('img')}">` +
    `<svg onload="${pw('svgonload')}" width="10" height="10"></svg>` +
    `<svg><script>${pw('svgscript')}</script></svg>` +
    `<a id="js-href" href="javascript:${pw('jshref')}">a</a> ` +
    `<a id="js-entity" href="java&#115;cript:${pw('jsentity')}">b</a> ` +
    `<a id="js-tab" href="java\tscript:${pw('jstab')}">c</a> ` +
    `<iframe srcdoc="<script>console.log('PWNED:srcdoc')</script>"></iframe>` +
    `<iframe src="data:text/html,<script>console.log('PWNED:dataiframe')</script>"></iframe>` +
    // SVG animation writing a javascript: href after sanitising (click the text).
    `<svg width="120" height="30"><a><animate attributeName="href" values="x;javascript:console.log('PWNED:animate')" dur="0.05s" fill="freeze"/>` +
    '<text id="anim-text" x="0" y="20">anim</text></a></svg>' +
    '<p id="hostile-end">end</p>' +
    '</div>';

// Mutation XSS: inert on the first parse, a live <img onerror> on a re-parse
// (the shipped viz serialised the scrubbed tree and re-parsed it). Each sits
// alone at the end of its template: they leave elements open by design.
const MXSS = {
    html_e2e_mxss1: `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=&quot;${pw('mxss1')}&quot;&gt;">`,
    html_e2e_mxss2: `<form><math><mtext></form><form><mglyph><style></math><img src onerror="${pw('mxss2')}">`,
};

function view(title, options, query) {
    return {
        version: '2',
        title,
        dataSources: query ? { ds: { type: 'ds.search', options: query } } : {},
        visualizations: {
            viz_html: {
                type: `${APP}.html_renderer`,
                ...(query ? { dataSources: { primary: 'ds' } } : {}),
                options: { theme: 'dark', ...options },
                title,
            },
        },
        inputs: {},
        defaults: {},
        layout: { type: 'grid', options: {}, structure: [{ item: 'viz_html', type: 'block', position: { x: 0, y: 0, w: 700, h: 400 } }] },
    };
}

const VIEWS = {
    ...Object.fromEntries(Object.entries(MXSS).map(([k, p]) => [k, view(k, { htmlTemplate: `<p id="mx-start">start</p>${p}` })])),
    html_e2e_hostile: view('HTML hostile', { htmlTemplate: HOSTILE }),
    // A field value from the search carrying markup is sanitised too.
    html_e2e_field: view('HTML field payload',
        { htmlTemplate: '<div id="e2e-field">{{evil}}</div>' },
        { query: `| makeresults | eval evil="<img src=x onerror=\\"console.log('PWNED:field')\\"><b id=\\"field-b\\">bold</b>" | table evil` }),
    // allowScripts as the string "false" is truthy: it used to switch the sanitiser off.
    html_e2e_allow_false_string: view('HTML allowScripts string',
        { allowScripts: 'false', htmlTemplate: `<div id="e2e-strfalse"><script>${pw('strfalse')}</script><img src="x" onerror="${pw('strfalseimg')}"></div>` }),
    // Positive control: the channel works when scripts are really allowed.
    html_e2e_control: view('HTML control',
        { allowScripts: true, htmlTemplate: '<div id="e2e-control"><script>console.log(\'CONTROL:ran\');window.__control=1</script></div>' }),
    html_e2e_empty: view('HTML empty',
        { htmlTemplate: '<div id="e2e-empty">[{{message}}]</div>' },
        { query: '| makeresults | eval message="x" | where 1=0 | table message' }),
    // Wrong field names, nulls and numbers-as-strings.
    html_e2e_malformed: view('HTML malformed',
        { htmlTemplate: '<div id="e2e-bad"><i id="b1">[{{message}}]</i><i id="b2">[{{nulled}}]</i><i id="b3">[{{count}}]</i><i id="b4">[{{ spaced }}]</i></div>' },
        { query: '| makeresults | eval wrong_name="hello", nulled=null(), count="not a number", spaced=5 | table wrong_name, nulled, count, spaced' }),
    html_e2e_badopts: view('HTML bad options', { htmlTemplate: { not: 'a string' }, theme: 'purple' }),
    // Alternates every 10 s between two values, refreshed every 4 s. (Zero
    // rows would swap in Studio's placeholder, see the empty test.)
    html_e2e_rerun: view('HTML re-run',
        { htmlTemplate: '<div id="e2e-rerun">[{{message}}]</div>' },
        { query: '| makeresults | eval message=if(floor(now()/10)%2=0, "PHASE_A", "PHASE_B") | table message', refresh: '4s', refreshType: 'delay' }),
};

test.beforeAll(async () => {
    const api = await request.newContext({ baseURL: MGMT_URL, ignoreHTTPSErrors: true, httpCredentials: { username: USER, password: PASS } });
    for (const [name, def] of Object.entries(VIEWS)) {
        const xml = `<dashboard version="2" theme="dark"><label>${def.title}</label>` +
            `<definition><![CDATA[${JSON.stringify(def)}]]></definition></dashboard>`;
        const create = await api.post(`/servicesNS/${USER}/${APP}/data/ui/views?output_mode=json`, { form: { name, 'eai:data': xml } });
        if (!create.ok()) {
            const update = await api.post(`/servicesNS/${USER}/${APP}/data/ui/views/${name}?output_mode=json`, { form: { 'eai:data': xml } });
            if (!update.ok()) throw new Error(`could not create/update ${name}: ${update.status()} ${await update.text()}`);
        }
    }
    await api.dispose();
});

async function openView(page, name, selector) {
    const logs = [];
    const errors = [];
    page.on('console', (m) => { logs.push(m.text()); if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto('/en-GB/account/login');
    await page.fill('input[name="username"]', USER);
    await page.fill('input[name="password"]', PASS);
    await page.press('input[name="password"]', 'Enter');
    await page.waitForURL((u) => /^\/[^/]+\/(app|launcher|home)\b/.test(new URL(u).pathname), { timeout: 60000 });
    await page.goto(`/en-GB/app/${APP}/${name}`);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        for (const f of page.frames()) {
            if (f === page.mainFrame()) continue;
            try { if (await f.$(selector)) return { frame: f, logs, vizErrors: () => errors.filter((e) => /html_renderer|visualization\.js/.test(e)) }; } catch (_) { /* detached */ }
        }
        await page.waitForTimeout(2000);
    }
    throw new Error(`${selector} never rendered in any viz frame of ${name}`);
}

const pwned = (v) => v.logs.filter((l) => l.startsWith('PWNED:'));
const flags = (v) => v.frame.evaluate(() => Object.keys(window).filter((k) => k.startsWith('__p_')));

test('positive control: with allowScripts true a script runs and is observed', async ({ page }) => {
    const v = await openView(page, 'html_e2e_control', '#e2e-control');
    await expect.poll(() => v.logs.includes('CONTROL:ran'), { timeout: 15000 }).toBe(true);
    expect(await v.frame.evaluate(() => window.__control)).toBe(1);
});

test('hostile template: no payload executes, including on click', async ({ page }) => {
    const v = await openView(page, 'html_e2e_hostile', '#hostile-end');
    for (const id of ['#js-href', '#js-entity', '#js-tab', '#anim-text']) {
        await v.frame.click(id, { timeout: 5000 }).catch(() => { /* hidden or removed is fine */ });
    }
    await page.waitForTimeout(3000); // let image errors, iframes and animations settle
    expect(pwned(v)).toEqual([]);
    expect(await flags(v)).toEqual([]);
    // The clicks did not navigate the panel away: a neutered link rewritten to
    // href="#" loaded a Splunk error page into the viz iframe.
    expect(await v.frame.$('#hostile-end'), 'the panel was navigated away by a click').not.toBeNull();
    // And structurally: nothing executable is left in the live DOM.
    const left = await v.frame.evaluate(() => {
        const box = document.getElementById('e2e-hostile');
        return {
            scripts: box.querySelectorAll('script').length,
            handlers: [...box.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).length,
            srcdoc: box.querySelectorAll('[srcdoc]').length,
            jsUrls: [...box.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /javascript:/i.test(a.value.replace(/[\u0000- ]/g, '')))).length,
        };
    });
    expect(left).toEqual({ scripts: 0, handlers: 0, srcdoc: 0, jsUrls: 0 });
    expect(v.vizErrors()).toEqual([]);
});

for (const name of Object.keys(MXSS)) {
    test(`mutation XSS (${name}): the payload never becomes a live handler`, async ({ page }) => {
        const v = await openView(page, name, '#mx-start');
        await page.waitForTimeout(3000);
        expect(pwned(v)).toEqual([]);
        expect(await flags(v)).toEqual([]);
        expect(await v.frame.evaluate(() => document.querySelectorAll('img[onerror]').length)).toBe(0);
    });
}

test('markup arriving in a search field is sanitised but still renders', async ({ page }) => {
    const v = await openView(page, 'html_e2e_field', '#field-b');
    await page.waitForTimeout(2000);
    expect(pwned(v)).toEqual([]);
    expect(await v.frame.locator('#field-b').textContent()).toBe('bold');
    expect(await v.frame.locator('#e2e-field img[onerror]').count()).toBe(0);
});

test('allowScripts "false" (a string) keeps the sanitiser on', async ({ page }) => {
    const v = await openView(page, 'html_e2e_allow_false_string', '#e2e-strfalse');
    await page.waitForTimeout(3000);
    expect(pwned(v)).toEqual([]);
    expect(await flags(v)).toEqual([]);
});

// Platform behaviour, pinned: zero rows never reach the viz. Studio swaps the
// panel for its no-results placeholder and does not mount the iframe, so
// nothing stale or half-interpolated is shown. (10.6 labels the placeholder
// with a Warning icon, 10.4 does not, so the check is that nothing mounts.)
test('empty results: Studio shows its no-results placeholder, not a stale panel', async ({ page }) => {
    let dispatched = false;
    page.on('request', (r) => {
        if (r.method() === 'POST' && /\/search\/(v2\/)?jobs(\?|$)/.test(r.url()) && (r.postData() || '').includes('where')) dispatched = true;
    });
    await page.goto('/en-GB/account/login');
    await page.fill('input[name="username"]', USER);
    await page.fill('input[name="password"]', PASS);
    await page.press('input[name="password"]', 'Enter');
    await page.waitForURL((u) => /^\/[^/]+\/(app|launcher|home)\b/.test(new URL(u).pathname), { timeout: 60000 });
    await page.goto(`/en-GB/app/${APP}/html_e2e_empty`);
    await expect.poll(() => dispatched, { timeout: 60000 }).toBe(true);
    await page.waitForTimeout(15000);
    for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        expect(await f.$('#e2e-empty').catch(() => null)).toBeNull();
    }
});

test('wrong field names, nulls and strings render as text or empty, never a crash', async ({ page }) => {
    const v = await openView(page, 'html_e2e_malformed', '#e2e-bad');
    // b3 proves the search result arrived (and the viz did not stop at b1/b2).
    await expect(v.frame.locator('#b3')).toHaveText('[not a number]', { timeout: 60000 });
    await expect(v.frame.locator('#b1')).toHaveText('[]');
    await expect(v.frame.locator('#b2')).toHaveText('[]');
    await expect(v.frame.locator('#b4')).toHaveText('[5]');
    expect(v.vizErrors()).toEqual([]);
});

test('a non-string template and an unknown theme fall back to the defaults', async ({ page }) => {
    const v = await openView(page, 'html_e2e_badopts', 'text=Configure the HTML Template');
    await expect.poll(() => v.frame.evaluate(() => document.body.innerText), { timeout: 60000 }).toContain('Configure the HTML Template');
    const text = await v.frame.evaluate(() => document.body.innerText);
    expect(text).not.toContain('[object Object]');
    expect(v.vizErrors()).toEqual([]);
});

test('a re-run with different results updates the panel both ways, no stale value', async ({ page }) => {
    test.setTimeout(240000);
    const v = await openView(page, 'html_e2e_rerun', '#e2e-rerun');
    // Exact text each time: a stale or doubled render would not match.
    await expect(v.frame.locator('#e2e-rerun')).toHaveText(/^\[PHASE_[AB]\]$/, { timeout: 60000 });
    const first = (await v.frame.locator('#e2e-rerun').textContent()) === '[PHASE_A]' ? 'A' : 'B';
    const other = first === 'A' ? 'B' : 'A';
    await expect(v.frame.locator('#e2e-rerun')).toHaveText(`[PHASE_${other}]`, { timeout: 90000 });
    await expect(v.frame.locator('#e2e-rerun')).toHaveText(`[PHASE_${first}]`, { timeout: 90000 });
    await expect(v.frame.locator('#e2e-rerun')).toHaveCount(1);
});
