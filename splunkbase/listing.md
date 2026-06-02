# HTML Renderer — Splunkbase listing copy

> Source of truth for the Splunkbase listing fields. Keep in sync with each release.
> Compatibility: Splunk Enterprise 9.0+ or Splunk Cloud with Dashboard Studio.

## Short Description (max 380 chars)

Render arbitrary HTML inside a Dashboard Studio panel. Supports `{{field}}` interpolation from search results, theme-aware CSS variables, inline SVG, and optional (off-by-default) script execution. Ideal for branded headers, status badges, rich tables, callouts and bespoke layouts Studio can't otherwise produce.

## Summary (max 3000 chars)

Dashboard Studio's markdown panel is deliberately limited — no styled spans, no inline SVG, no data-driven HTML. **HTML Renderer** fills that gap with a custom visualization that renders a HTML template you control, optionally populated from your search results.

Use it for branded dashboard headers, "● LIVE" status badges, colour-coded callouts, custom legends, KPI ribbons, inline SVG diagrams/floor-plans, and any rich layout the native panels can't express. Values from the primary data source can be injected with simple `{{field}}` placeholders, so the HTML can reflect live search results (e.g. `Last update: {{latest_time}}`).

The renderer is **theme-aware** — it exposes Splunk's CSS variables so your markup automatically matches light/dark dashboards. Script execution is **disabled by default** and only enabled via an explicit, clearly-labelled "Allow Scripts (DANGEROUS)" option, so the default behaviour is safe static HTML.

Standard `studio_visualization` custom viz, dependency-free.

## Details

1. Add the **HTML Renderer** viz to a Dashboard Studio panel.
2. Optionally point it at a search whose fields you want to interpolate.
3. Set options in the Configuration panel:
   - **HTML Template** (`htmlTemplate`) — your HTML markup. Use `{{fieldName}}` to inject values from the first result row. Inline `<style>`, `<svg>` and theme CSS variables are supported.
   - **Theme** (`theme`) — how the panel adapts to the dashboard theme.
   - **Allow Scripts** (`allowScripts`) — leave **off** unless you fully trust the template; enabling it permits `<script>` execution and should only be used with content you author.

Example template:

```html
<div style="font:600 14px/1.4 sans-serif;color:#f97316">● LIVE — {{count}} events</div>
```

## Installation

1. Install the app and refresh Splunk Web (no restart needed for a custom viz).
2. **HTML Renderer** appears in Dashboard Studio → Add chart → Custom.

On-prem and Splunk Cloud supported.

## Troubleshooting

- **Raw HTML/markup shown as text:** confirm you're using the HTML Renderer viz (not the markdown panel), and that the markup is in the **HTML Template** option.
- **`{{field}}` shows literally:** the field isn't present in the first result row; check the search returns that field, or remove the placeholder.
- **Scripts not running:** that's intentional — enable **Allow Scripts** only for trusted content.
- **Colours don't match the theme:** use the exposed CSS variables (or the Theme option) rather than hard-coded colours.
