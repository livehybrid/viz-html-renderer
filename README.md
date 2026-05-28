# viz-html-renderer

A Splunk **Dashboard Studio** custom visualization that renders **arbitrary HTML** inside a panel. Solves the long-standing problem that Splunk's built-in `splunk.markdown` viz strips `<span>`, `<svg>`, inline `style`, and most non-text HTML — making it impossible to embed inline SVG, custom badges, or styled markup driven by search results.

Built on Splunk 10.4's new **`framework_type = studio_visualization`** custom-viz framework, which exposes a postMessage-based runtime (`globalThis.DashboardExtensionAPI`) to the iframe-sandboxed viz.

## What's in the app

The package is a single Splunk app containing **one custom visualization** (`html_renderer`), plus the conf and metadata files Splunk needs to register it.

| Path | Role |
|---|---|
| `app.manifest` | Splunkbase metadata (license, author, version, classification). |
| `default/app.conf` | App-level config (label, version, package id). |
| `default/visualizations.conf` | The viz stanza. `framework_type = studio_visualization` is what flips Splunk into the modern iframe loader path. |
| `metadata/default.meta` | Permissions — exports the viz to all apps system-wide. |
| `appserver/static/visualizations/html_renderer/visualization.js` | The viz itself. Plain JS — boots, finds `globalThis.DashboardExtensionAPI`, subscribes to options/data/theme/tokens, renders the resulting HTML into `#root`. |
| `appserver/static/visualizations/html_renderer/config.json` | The Studio framework config: `optionsSchema` (the three options below) and `editorConfig` (the side-panel editor UI Splunk renders for the dashboard author). |
| `appserver/static/visualizations/html_renderer/visualization.css` | Empty placeholder; the viz styles itself inline using the resolved theme palette. |
| `appserver/static/visualizations/html_renderer/formatter.html` | Legacy classic-viz formatter. Harmless on Splunk 10.4 (the studio framework reads `config.json` and ignores this file); kept so the app also installs cleanly on older Splunk versions that don't yet support the studio framework. |

## Options

The viz exposes three options the dashboard author can set:

| Option | Type | Default | What it does |
|---|---|---|---|
| `htmlTemplate` | string (textarea) | sample HTML | The HTML to render. Supports `{{field_name}}` placeholders interpolated from the first row of the primary data source. |
| `theme` | enum: `auto` / `light` / `dark` | `auto` | Sets CSS variables `--text`, `--bg`, `--accent` that the author's HTML can use. `auto` follows the dashboard theme. |
| `allowScripts` | boolean | `false` | Bypasses the built-in sanitiser. See "Scripts and the iframe sandbox" below. |

### CSS variables exposed to the author's HTML

| Variable | Light value | Dark value |
|---|---|---|
| `--text` | `#1a1a1a` | `#e6edf3` |
| `--bg` | `#ffffff` | `#0b0f14` |
| `--accent` | `#0070d2` | `#00d4aa` |

Use them in inline styles, e.g. `style="color:var(--accent);background:var(--bg)"`.

## Scripts and the iframe sandbox

Dashboard Studio loads custom visualizations inside an iframe with `sandbox="allow-scripts"`. That means:

**JavaScript *does* execute** when `allowScripts = true` — inline `<script>` tags fire, `on*` handlers work, you can pull in a chart library from a CDN and render inside the panel.

What the sandbox costs you, even when scripts are allowed:

- No access to `window.parent` (the iframe is cross-origin to the dashboard page).
- No cookies sent on outbound requests.
- No top-level navigation.
- `fetch()` is monkey-patched: same-origin requests get proxied via `postMessage` to the parent so they still reach Splunk's REST API, but you have no direct DOM contact with the rest of the dashboard.

What the sandbox still permits with `allowScripts = true`:

- Inline `<script>` tags execute.
- `on*` handlers fire.
- Animations, third-party chart libraries from a CDN, timers, anything DOM-local.
- Outbound `fetch` to external origins.

So you *can* drop a `<script>` that pulls in D3 from a CDN and renders an animated chart inside the panel. It just can't affect the rest of the dashboard.

**Default is `allowScripts = false`**, in which case the viz strips `<script>` tags, `on*` attributes, and `javascript:` URLs before rendering. That's the right default for header banners, SVG art, KPI tiles — anything that doesn't need JS.

## Use in a Dashboard Studio dashboard

```json
{
  "visualizations": {
    "viz_html_1": {
      "type": "viz-html-renderer.html_renderer",
      "title": "Carbon Intensity",
      "dataSources": { "primary": "carbon_ds" },
      "options": {
        "htmlTemplate": "<div style=\"padding:12px;color:var(--text);background:var(--bg)\"><h2 style=\"color:var(--accent);margin:0 0 6px\">{{region}}</h2><p style=\"margin:0;font-size:28px;font-weight:600\">{{intensity}} gCO2/kWh</p><p style=\"margin:4px 0 0;opacity:0.7\">Updated {{updated_at}}</p></div>",
        "theme": "auto",
        "allowScripts": false
      }
    }
  },
  "dataSources": {
    "carbon_ds": {
      "type": "ds.search",
      "options": {
        "query": "| inputlookup carbon_intensity.csv | head 1 | table region intensity updated_at"
      }
    }
  }
}
```

Or just drag **Add → Custom → HTML Renderer** onto the canvas and paste your HTML into the editor.

## Install

Package the app and upload via **Splunk Web → Manage Apps → Install app from file**, or drop into `$SPLUNK_HOME/etc/apps/` and restart Splunk.

```bash
tar --exclude='.git' --exclude='node_modules' \
    -czf viz-html-renderer.tar.gz viz-html-renderer/
```

Releases are built by the GitHub Actions workflow at `.github/workflows/splunk-app-ci.yml`.

## Requirements

- **Splunk Enterprise 10.4+** or Splunk Cloud Platform with the `splunk-dashboard-studio` app at the matching version, for the studio framework path to be available.
- On older Splunk (10.2 / 10.3), the viz registers as a regular custom visualization but options will not reach the iframe — bind HTML through search results in that case.

## Why this app exists

Splunk's built-in `splunk.markdown` visualization renders Markdown but aggressively strips most HTML — `<span>`, `<svg>`, inline `style`, custom data attributes — which makes it impossible to build pixel-perfect KPI cards, inline SVG sparklines, or styled status badges. This visualization is the escape hatch: paste your HTML, bind it to a search via `{{token}}` interpolation, and Splunk renders it untouched.

Built for the **Splunk Dashboard Contest 2026** entry, packaged for publication on **Splunkbase**.

## License

Apache 2.0.
