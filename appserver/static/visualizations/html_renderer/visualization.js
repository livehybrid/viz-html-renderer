/*
 * HTML Renderer — Splunk Dashboard Studio Custom Visualization
 *
 * Studio framework (visualizations.conf: framework_type = studio_visualization).
 * Runs inside Splunk's iframe sandbox alongside studio.js, which exposes
 * globalThis.DashboardExtensionAPI with addOptionsListener,
 * addDataSourcesListener, addThemeListener, etc.
 *
 * Options:
 *   - htmlTemplate (string)   HTML to render. Supports {{field}} interpolation
 *                             from the first row of the primary data source.
 *   - allowScripts (boolean)  Skip the script/on-attr sanitiser. Default false.
 *   - theme        (string)   'auto' | 'light' | 'dark'. Default 'auto'.
 *
 * Data contract:
 *   Optional. If a primary data source is bound, fields from the first row are
 *   available for {{field}} interpolation in htmlTemplate.
 */
(function () {
    'use strict';

    var DEFAULT_TEMPLATE =
        '<div style="padding:16px;font-family:Inter,Segoe UI,system-ui,sans-serif;color:var(--text)">' +
        '<div style="font-weight:600;color:var(--accent);margin-bottom:6px">HTML Renderer</div>' +
        '<div style="font-size:12px;line-height:1.5;opacity:0.8">' +
        'Configure the HTML Template in the panel editor.' +
        '</div></div>';

    function sanitise(html) {
        if (!html) return '';
        var out = String(html);
        out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        out = out.replace(/<script\b[^>]*\/?>/gi, '');
        out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        out = out.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
        return out;
    }

    function paletteFor(theme) {
        var t = String(theme || 'auto').toLowerCase();
        if (t === 'auto') {
            try {
                t = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
                    ? 'light' : 'dark';
            } catch (e) { t = 'dark'; }
        }
        if (t === 'light') {
            return { text: '#1a1a1a', bg: '#ffffff', accent: '#0070d2' };
        }
        return { text: '#e6edf3', bg: '#0b0f14', accent: '#00d4aa' };
    }

    function firstRowFields(state) {
        // Studio shape: state.dataSources = {dataSources: {primary: {data: ...}}, loading: bool}
        var sources = state && (state.dataSources || state);
        if (sources && sources.dataSources) sources = sources.dataSources;
        var primary = sources && sources.primary && sources.primary.data;
        if (!primary || !primary.fields) return {};
        var fields = primary.fields;
        var columns = primary.columns || [];
        var out = {};
        for (var i = 0; i < fields.length; i++) {
            var name = (fields[i] && fields[i].name) || fields[i];
            var col = columns[i] || [];
            out[name] = col.length > 0 ? col[0] : '';
        }
        return out;
    }

    function interpolate(template, row) {
        return String(template || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, function (_, k) {
            var v = row[k];
            return (v === null || v === undefined) ? '' : String(v);
        });
    }

    function executeScripts(container) {
        var scripts = container.querySelectorAll('script');
        for (var i = 0; i < scripts.length; i++) {
            var old = scripts[i];
            var s = document.createElement('script');
            for (var a = 0; a < old.attributes.length; a++) {
                s.setAttribute(old.attributes[a].name, old.attributes[a].value);
            }
            s.text = old.textContent;
            old.parentNode.replaceChild(s, old);
        }
    }

    function setRootStyles(root, palette) {
        root.style.color = palette.text;
        root.style.background = palette.bg;
        root.style.width = '100%';
        root.style.height = '100%';
        root.style.overflow = 'auto';
        root.style.boxSizing = 'border-box';
        root.style.setProperty('--text', palette.text);
        root.style.setProperty('--bg', palette.bg);
        root.style.setProperty('--accent', palette.accent);
    }

    function bootWhenReady() {
        var api = globalThis.DashboardExtensionAPI;
        if (!api) {
            setTimeout(bootWhenReady, 25);
            return;
        }

        var root = document.getElementById('root');
        if (!root) {
            setTimeout(bootWhenReady, 25);
            return;
        }

        var state = {
            options: {},
            dataSources: null,
            theme: null
        };

        function render() {
            // Studio delivers options nested under .options and data sources
            // nested under .dataSources — see studio.js handleOptionsUpdate /
            // handleDataSourcesUpdate which call setIframeState(KEY, event.data).
            var raw = state.options || {};
            var opts = raw.options || raw;  // accept both nested and flat shapes
            var template = opts.htmlTemplate || DEFAULT_TEMPLATE;
            var themeOverride = opts.theme;

            // Merge: panel theme option > dashboard theme > 'auto'
            var resolvedTheme = themeOverride;
            if (!resolvedTheme || resolvedTheme === 'auto') {
                if (state.theme && state.theme.theme) {
                    resolvedTheme = state.theme.theme;
                }
            }

            var row = firstRowFields(state.dataSources);
            var html = interpolate(template, row);
            // Remove debug log on success path

            if (!opts.allowScripts) html = sanitise(html);

            setRootStyles(root, paletteFor(resolvedTheme));
            root.innerHTML = html;

            // Setting innerHTML does NOT execute <script> tags. When the author
            // has opted in via allowScripts, re-create each script node so the
            // browser runs it (inline and external src both supported).
            if (opts.allowScripts) executeScripts(root);
        }

        // Subscribe to all relevant state
        if (typeof api.addOptionsListener === 'function') {
            api.addOptionsListener(function (next) {
                state.options = next || {};
                render();
            });
        }
        if (typeof api.addDataSourcesListener === 'function') {
            api.addDataSourcesListener(function (next) {
                state.dataSources = next || null;
                render();
            });
        }
        if (typeof api.addThemeListener === 'function') {
            api.addThemeListener(function (next) {
                state.theme = next || null;
                render();
            });
        }

        // Initial pull in case listeners fired before we subscribed.
        try {
            if (typeof api.getOptions === 'function') state.options = api.getOptions() || {};
            if (typeof api.getDataSources === 'function') state.dataSources = api.getDataSources() || null;
            if (typeof api.getTheme === 'function') state.theme = api.getTheme() || null;
        } catch (e) {}

        render();
    }

    bootWhenReady();
})();
