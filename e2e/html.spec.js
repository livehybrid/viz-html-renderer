/*
 * End-to-end check: the packaged app, installed on a real Splunk, renders the
 * HTML Renderer viz inside a Dashboard Studio dashboard in a real (headless)
 * browser — AND sanitises a hostile template while doing so.
 *
 * The Studio dashboard is created via REST in beforeAll. Gotchas encoded here
 * (learned on AirspaceWatch/realtime-clock): viz `type` is
 * `<app-dir>.<viz-folder>` with NO `splunk.` prefix, the dashboard XML wrapper
 * needs version="2", and Studio custom vizzes render inside a sandboxed iframe
 * so every assertion must search all frames.
 */
const { test, expect, request } = require('@playwright/test');

const MGMT_URL = process.env.SPLUNK_MGMT_URL || 'https://localhost:8089';
const USER = process.env.SPLUNK_USER || 'admin';
const PASS = process.env.SPLUNK_PASSWORD || 'Changeme1!';
const APP = 'viz-html-renderer';
const VIEW = 'html_e2e';

// The template exercises the three things that matter: {{field}} interpolation
// from a real search, and two live injection attempts (script element + on*
// attribute) that the sanitiser must strip before they reach the DOM.
const TEMPLATE =
    '<div id="e2e-marker" style="padding:12px;color:var(--text)">' +
    '<h2 id="e2e-msg">{{message}}</h2>' +
    '<script>window.__pwned_script = true;</script>' +
    '<img src="x" onerror="window.__pwned_handler = true;">' +
    '</div>';

const definition = {
    version: '2',
    title: 'HTML Renderer E2E',
    description: 'Playwright render + sanitisation check for the HTML Renderer viz',
    dataSources: {
        primary_ds: {
            type: 'ds.search',
            options: { query: '| makeresults | eval message="Hello from e2e" | table message' },
            name: 'e2e message',
        },
    },
    visualizations: {
        viz_html: {
            type: `${APP}.html_renderer`,
            dataSources: { primary: 'primary_ds' },
            options: { htmlTemplate: TEMPLATE, theme: 'dark' },
            title: 'HTML Renderer',
        },
    },
    inputs: {},
    defaults: {},
    layout: {
        type: 'grid',
        options: {},
        structure: [
            { item: 'viz_html', type: 'block', position: { x: 0, y: 0, w: 600, h: 400 } },
        ],
    },
};

const DASHBOARD_XML =
    `<dashboard version="2" theme="dark"><label>HTML Renderer E2E</label>` +
    `<definition><![CDATA[${JSON.stringify(definition)}]]></definition></dashboard>`;

test.beforeAll(async () => {
    const api = await request.newContext({
        baseURL: MGMT_URL,
        ignoreHTTPSErrors: true,
        httpCredentials: { username: USER, password: PASS },
    });
    // Create, or update if a previous run left it behind.
    const create = await api.post(`/servicesNS/${USER}/${APP}/data/ui/views?output_mode=json`, {
        form: { name: VIEW, 'eai:data': DASHBOARD_XML },
    });
    if (!create.ok()) {
        const update = await api.post(
            `/servicesNS/${USER}/${APP}/data/ui/views/${VIEW}?output_mode=json`,
            { form: { 'eai:data': DASHBOARD_XML } }
        );
        if (!update.ok()) {
            throw new Error(
                `could not create/update dashboard: ${create.status()} then ${update.status()}: ${await update.text()}`
            );
        }
    }
    await api.dispose();
});

// Studio custom vizzes run in a sandboxed iframe — search every frame.
async function findMarker(page, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const f of page.frames()) {
            try {
                const h = await f.$('#e2e-marker');
                if (h) return { frame: f, handle: h };
            } catch (_) { /* frame may detach mid-poll */ }
        }
        await page.waitForTimeout(2000);
    }
    console.log('frames at timeout:', page.frames().map((f) => f.url()));
    return null;
}

test('HTML Renderer renders and sanitises on a Studio dashboard', async ({ page }) => {
    const consoleAll = [];
    const consoleErrors = [];
    page.on('console', (msg) => {
        consoleAll.push(`${msg.type()}: ${msg.text()}`.slice(0, 300));
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('response', (r) => {
        if (r.status() >= 400 || /visualization\.js|html_renderer/.test(r.url())) {
            console.log(`HTTP ${r.status()} ${r.url()}`);
        }
    });

    // Splunk web form login
    await page.goto('/en-GB/account/login');
    await page.fill('input[name="username"]', USER);
    await page.fill('input[name="password"]', PASS);
    await page.press('input[name="password"]', 'Enter');
    await page.waitForURL(/\/(app|launcher|home)/, { timeout: 60000 });

    // Open the dashboard and wait for the viz to draw (in any frame)
    await page.goto(`/en-GB/app/${APP}/${VIEW}`);
    const found = await findMarker(page, 120000);
    if (!found) {
        console.log('--- console messages (last 50) ---');
        consoleAll.slice(-50).forEach((l) => console.log(l));
        for (const f of page.frames()) {
            if (f === page.mainFrame()) continue;
            console.log(`--- frame content: ${f.url()} ---`);
            try { console.log((await f.content()).slice(0, 3000)); }
            catch (e) { console.log('frame content unavailable:', e.message); }
        }
    }
    expect(found, 'no #e2e-marker found in any frame — see logged diagnostics').not.toBeNull();

    // Interpolation from the real search worked end to end
    await expect(found.frame.locator('#e2e-msg')).toHaveText('Hello from e2e', { timeout: 60000 });

    // Sanitisation held in the real browser: neither payload executed and no
    // script element reached the panel DOM.
    const verdict = await found.frame.evaluate(() => ({
        script: window.__pwned_script === true,
        handler: window.__pwned_handler === true,
        scriptTags: document.querySelectorAll('#e2e-marker script').length,
        onattrs: document.querySelectorAll('#e2e-marker [onerror]').length,
    }));
    expect(verdict).toEqual({ script: false, handler: false, scriptTags: 0, onattrs: 0 });

    // Render proof artifact
    await page.screenshot({ path: 'e2e-results/html-render.png' });

    // Surface (but tolerate) console noise; hard-fail only on our own module
    const vizErrors = consoleErrors.filter((e) => /html_renderer|visualization\.js/.test(e));
    console.log(`console errors total=${consoleErrors.length}, viz-specific=${vizErrors.length}`);
    expect(vizErrors).toEqual([]);
});
