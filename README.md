# viz-html-renderer

A Splunk **Dashboard Studio** custom visualization that renders **arbitrary HTML**
inside a panel — inline SVG, theme-aware styled markup, KPI cards, status badges,
and (optionally) live scripts, all driven by your search results.

It solves a long-standing gap: Splunk's built-in **Markdown** viz strips `<span>`,
`<svg>`, inline `style`, and most non-text HTML, and the built-in **Image** viz can
only show a *static* picture. HTML Renderer gives you the full HTML/CSS/SVG canvas
**plus** `{{field}}` interpolation from searches, theme variables, and scripts.

Built on Splunk 10.4's **`framework_type = studio_visualization`** custom-viz
framework, which exposes a postMessage runtime (`globalThis.DashboardExtensionAPI`)
to the iframe-sandboxed viz.

> **Try it immediately:** after installing, open the **HTML Renderer** app from the
> Splunk app menu — it ships a **Showcase** dashboard with live, annotated examples
> of every technique below. See [Built-in showcase dashboard](#built-in-showcase-dashboard).

---

## Framework: `studio_visualization` — Dashboard Studio only

This viz uses Splunk 10.4's **`studio_visualization`** framework type. Understanding
what that means prevents two common mistakes:

### It only works in Dashboard Studio (not Classic XML dashboards)

`framework_type = studio_visualization` (set in `visualizations.conf`) tells
Splunk to use the **Studio iframe loader** (`studio.js`). That loader only runs
inside Dashboard Studio panels — it does not exist in Classic XML dashboards.
If you try to add this viz to a Classic XML dashboard, it will not render.

Use it in Dashboard Studio by adding `"type": "viz-html-renderer.html_renderer"` to
a visualization definition, or via **Add → Custom → HTML Renderer** in the
Studio editor.

### Why 10.4+ (and not older Splunk)

`framework_type = studio_visualization` was **introduced in Splunk Enterprise
10.4.0**. The key was not present in visualizations.conf.spec on earlier releases.

On Splunk 10.2 / 10.3, the entry in `visualizations.conf` still registers the viz
app, but:

- The unknown `framework_type` falls back to legacy behavior (`legacy_visualization`).
- Under legacy behavior, the `studio.js` loader is never used.
- Panel options (your `htmlTemplate`, `theme`, `allowScripts`) **are not delivered**
  to the iframe — the viz would only ever show the default placeholder.
- `config.json` is ignored; Splunk looks for `formatter.html` instead (which we
  ship as a harmless fallback, but it can't make options reach the viz).

In short: the app installs on older Splunk but the options system doesn't work,
making it functionally useless below 10.4.

### How it differs from a v1 legacy custom viz

| | Legacy (`legacy_visualization`) | This app (`studio_visualization`) |
|---|---|---|
| **Works in** | Classic XML dashboards + Dashboard Studio | Dashboard Studio only |
| **Options delivery in Studio** | ❌ Not delivered to iframe | ✅ Full options via `DashboardExtensionAPI` |
| **Options delivery in Classic** | ✅ Via `this.getCurrentOptions()` | N/A |
| **Config UI** | `formatter.html` (HTML form) | `config.json` (`optionsSchema` + `editorConfig`) |
| **Entry point** | AMD module extending `SplunkVisualizationBase` (Backbone) | Plain JS reading `globalThis.DashboardExtensionAPI` |
| **Iframe loader** | `legacy.js` | `studio.js` |
| **Min Splunk version** | 10.2+ | **10.4+** |

The critical issue with legacy vizs in Studio is item 2 in the table: when a legacy
viz is hosted inside a Dashboard Studio panel, panel options are **not delivered to
the iframe**. `getOptions` is not exposed by the legacy loader. This is why a
`studio_visualization` is the only viable approach for a Dashboard Studio viz that
needs configurable options.

---

## Quick start

1. Install the app (see [Build & install](#build--install)).
2. Open any Dashboard Studio dashboard in edit mode.
3. **Add → Visualizations → Custom → HTML Renderer**, drop it on the canvas.
4. Paste your HTML into the **HTML Template** field in the editor panel.
5. (Optional) bind a search to the panel and reference fields with `{{field_name}}`.

---

## Options

The viz exposes three options, all editable in the Dashboard Studio side panel
(under **HTML**, **Appearance**, **Security**):

| Option | Type | Default | What it does |
|---|---|---|---|
| `htmlTemplate` | string (textarea) | sample HTML | The HTML to render. Supports `{{field}}` placeholders interpolated from the first row of the primary data source. |
| `theme` | enum: `auto` / `light` / `dark` | `auto` | Sets CSS variables `--text`, `--bg`, `--accent`. `auto` follows the dashboard theme. |
| `allowScripts` | boolean | `false` | Bypasses the sanitiser **and executes `<script>` tags**. See [Scripts & the iframe sandbox](#scripts--the-iframe-sandbox). |

### CSS variables exposed to your HTML

| Variable | Light | Dark |
|---|---|---|
| `--text` | `#1a1a1a` | `#e6edf3` |
| `--bg` | `#ffffff` | `#0b0f14` |
| `--accent` | `#0070d2` | `#00d4aa` |

Use them in inline styles, e.g. `style="color:var(--accent);background:var(--bg)"`,
so your panel adapts when the dashboard theme changes.

---

## Examples

All snippets go in the **HTML Template** option. They are sanitised unless noted.

### 1. Theme-aware card (no data)

```html
<div style="padding:16px;color:var(--text)">
  <h3 style="margin:0 0 8px;color:var(--accent)">Theme-aware card</h3>
  <p style="margin:0;opacity:.85">Follows the dashboard light/dark theme.</p>
</div>
```

### 2. Data-bound KPI tile (`{{field}}` interpolation)

Bind a search returning one row with fields `region, intensity, status, updated`
(e.g. `| makeresults | eval region="UK", intensity=142, status="Moderate", updated=strftime(now(),"%H:%M")`):

```html
<div style="padding:18px;color:var(--text)">
  <div style="font-size:13px;text-transform:uppercase;opacity:.6">{{region}} carbon intensity</div>
  <div style="font-size:46px;font-weight:700;color:var(--accent)">{{intensity}}
    <span style="font-size:16px;opacity:.7">gCO2/kWh</span></div>
  <span style="padding:3px 10px;border-radius:12px;background:var(--accent);color:var(--bg)">{{status}}</span>
  <div style="font-size:11px;opacity:.5;margin-top:10px">Updated {{updated}}</div>
</div>
```

Each `{{field}}` is replaced with the matching value from the **first row** of the
primary data source. Missing fields render as empty strings.

### 3. Inline SVG gauge (impossible in the Markdown viz)

```html
<svg viewBox="0 0 120 120" width="150" height="150">
  <circle cx="60" cy="60" r="50" fill="none" stroke="var(--text)" stroke-opacity=".12" stroke-width="14"/>
  <circle cx="60" cy="60" r="50" fill="none" stroke="var(--accent)" stroke-width="14"
          stroke-linecap="round" stroke-dasharray="226 314" transform="rotate(-90 60 60)"/>
  <text x="60" y="58" text-anchor="middle" font-size="26" font-weight="700" fill="var(--text)">72%</text>
  <text x="60" y="76" text-anchor="middle" font-size="10" fill="var(--text)" opacity=".6">renewable</text>
</svg>
```

`stroke-dasharray="ARC CIRCUMFERENCE"` where circumference = `2 × π × r`
(here `2 × π × 50 ≈ 314`); set `ARC = fraction × circumference`.

### 4. Status badges

```html
<div style="display:flex;flex-wrap:wrap;gap:8px;padding:16px">
  <span style="padding:5px 11px;border-radius:14px;border:1px solid #2ec27e;color:#2ec27e">Operational</span>
  <span style="padding:5px 11px;border-radius:14px;border:1px solid #f5a623;color:#f5a623">Degraded</span>
  <span style="padding:5px 11px;border-radius:14px;border:1px solid var(--accent);color:var(--accent)">Maintenance</span>
</div>
```

### 5. Live script (requires `allowScripts = true`)

```html
<div id="clk" style="font-size:40px;font-weight:700;color:var(--accent)">--:--:--</div>
<script>
  (function(){function t(){document.getElementById('clk').textContent=new Date().toLocaleTimeString();}
   t();setInterval(t,1000);})();
</script>
```

> `<script>` tags inserted via HTML do not run by default (the browser ignores
> scripts set via `innerHTML`). When `allowScripts = true`, the viz re-creates each
> script node so it **executes** — this is also how you can load a chart library
> from a CDN (`<script src="https://cdn…">`) and render inside the panel.

### Full Dashboard Studio JSON

```json
{
  "visualizations": {
    "viz_kpi": {
      "type": "viz-html-renderer.html_renderer",
      "title": "Carbon Intensity",
      "dataSources": { "primary": "carbon_ds" },
      "options": {
        "htmlTemplate": "<div style=\"padding:12px;color:var(--text)\"><h2 style=\"color:var(--accent)\">{{region}}</h2><p>{{intensity}} gCO2/kWh</p></div>",
        "theme": "auto",
        "allowScripts": false
      }
    }
  },
  "dataSources": {
    "carbon_ds": {
      "type": "ds.search",
      "options": { "query": "| makeresults | eval region=\"UK\", intensity=142" }
    }
  }
}
```

> **Note the dot in the type id:** `viz-html-renderer.html_renderer`. A colon
> (`viz-html-renderer:html_renderer`) silently fails to resolve.

---

## Scripts & the iframe sandbox

Dashboard Studio loads custom visualizations inside an `<iframe sandbox="allow-scripts">`.

**With `allowScripts = true`:**
- Inline `<script>` tags execute (the viz re-creates them after injection).
- `on*` handlers fire; you can use timers, animations, and CDN chart libraries.
- Outbound `fetch` to external origins works.

**What the sandbox costs you (always):**
- No `window.parent` access (the iframe is cross-origin to the dashboard page).
- No cookies on outbound requests.
- No top-level navigation.
- `fetch()` is monkey-patched: same-origin requests are proxied via `postMessage`
  so they still reach Splunk's REST API, but you have no DOM contact with the rest
  of the dashboard.

**Default is `allowScripts = false`** — the viz strips `<script>` tags, `on*`
attributes, and `javascript:` URLs. That's the right default for banners, SVG art,
and KPI tiles. Only enable scripts for HTML you author or trust.

---

## Image viz vs HTML Renderer

You *can* embed a **static** SVG in the built-in **Image** viz using a
`data:image/svg+xml;utf8,…` URI. Reach for **HTML Renderer** when you also need:

- `{{field}}` interpolation from search results,
- theme-aware CSS variables (`--text` / `--bg` / `--accent`),
- interactive scripts (live updates, CDN chart libs),
- arbitrary multi-element layout (cards, badge grids, mixed text + SVG).

---

## Built-in showcase dashboard

The app ships a **Showcase** dashboard (`default/data/ui/views/html_renderer_showcase.xml`)
with live, annotated examples of every technique above. After install:

- Open the **HTML Renderer** app from Splunk's app menu (the app is UI-visible and
  its nav — `default/data/ui/nav/default.xml` — defaults to the showcase view), **or**
- go directly to `/en-US/app/viz-html-renderer/html_renderer_showcase`.

The dashboard is a Dashboard Studio (framework v2) definition and validates clean
against the current Studio schema.

---

## Build & install

### Install a release

Download the packaged `.tar.gz` from the GitHub Releases page (built by
`.github/workflows/splunk-app-ci.yml`) and install via
**Splunk Web → Manage Apps → Install app from file**, then restart Splunk.

### Build from source

```bash
# from the directory containing viz-html-renderer/
rsync -a --exclude='.git' --exclude='.github' --exclude='.gitignore' \
      --exclude='.gitattributes' --exclude='node_modules' --exclude='*.tar.gz' \
      viz-html-renderer/ stage/viz-html-renderer/
find stage/viz-html-renderer -type d -exec chmod 755 {} \;
find stage/viz-html-renderer -type f -exec chmod 644 {} \;
tar -C stage -czf viz-html-renderer.tar.gz viz-html-renderer/
```

Excluding dotfiles and normalising permissions keeps the package
**AppInspect-clean** for Splunk Cloud (`cloud`, `private_victoria`, `future` tags).

### Install via REST (no UI)

```bash
curl -sk -u admin:PASS https://localhost:8089/services/apps/local \
  -d name=/path/to/viz-html-renderer.tar.gz -d filename=true -d update=true
```

### Use

After install the app appears in the app menu. Use the viz on **any** dashboard in
**any** app — `metadata/default.meta` exports it system-wide. In a Studio dashboard:
**Add → Visualizations → Custom → HTML Renderer**.

---

## Requirements

- **Splunk Enterprise 10.4+** — this is the version that introduced
  `framework_type = studio_visualization` in `visualizations.conf`. The option
  is not present in earlier Splunk releases; installing on 10.2/10.3 registers
  the app but delivers no panel options to the iframe (see
  [Framework section](#framework-studio_visualization--dashboard-studio-only)).
- **Dashboard Studio** — the viz is Dashboard Studio-only. It does not render in
  Classic XML dashboards. Dashboard Studio ships as the `splunk-dashboard-studio`
  app bundled with Splunk Enterprise 10.4+ and available on Splunk Cloud Platform.

---

## Repository layout

| Path | Role |
|---|---|
| `default/app.conf` | App config — `is_visible = true`, label, version, package id. |
| `default/visualizations.conf` | Viz stanza. `framework_type = studio_visualization` selects the modern iframe loader. |
| `default/data/ui/views/html_renderer_showcase.xml` | The built-in showcase dashboard. |
| `default/data/ui/nav/default.xml` | App nav, defaulting to the showcase. |
| `metadata/default.meta` | Permissions — exports the viz system-wide (`sc_admin` for Splunk Cloud). |
| `appserver/static/visualizations/html_renderer/visualization.js` | The viz. Plain JS; subscribes to `DashboardExtensionAPI` options/data/theme; interpolates `{{field}}`; sanitises or executes scripts. |
| `appserver/static/visualizations/html_renderer/config.json` | Studio config: `optionsSchema` + `editorConfig` (the side-panel editor UI). |
| `appserver/static/visualizations/html_renderer/formatter.html` | Legacy fallback; ignored by the studio framework. |
| `.github/workflows/splunk-app-ci.yml` | CI: package → AppInspect → publish release. |

---

## Why this app exists

Built for the **Splunk Dashboard Contest 2026** and packaged for **Splunkbase**.
Splunk's `splunk.markdown` viz strips most HTML, making pixel-perfect KPI cards,
inline SVG, and styled badges impossible. This visualization is the escape hatch:
paste HTML, bind it to a search via `{{token}}` interpolation, and Splunk renders
it untouched.

## License

Apache 2.0.
