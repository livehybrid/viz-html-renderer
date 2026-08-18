/*
 * Drift guards between the three places the visualization is declared:
 *   - default/visualizations.conf  (Splunk registration)
 *   - appserver/static/visualizations/html_renderer/config.json (Studio editor)
 *   - appserver/static/visualizations/html_renderer/visualization.js (behaviour)
 *
 * On viz-realtime-clock this exact class of drift produced a viz that mounted
 * but never got its options; these tests make the contract explicit.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VIZ_DIR = path.join(ROOT, 'appserver', 'static', 'visualizations', 'html_renderer');

const conf = fs.readFileSync(path.join(ROOT, 'default', 'visualizations.conf'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(VIZ_DIR, 'config.json'), 'utf8'));
const source = fs.readFileSync(path.join(VIZ_DIR, 'visualization.js'), 'utf8');

describe('visualizations.conf registration', () => {
    test('declares the html_renderer stanza matching the viz directory name', () => {
        expect(conf).toMatch(/^\[html_renderer\]$/m);
    });

    test('registers as a Studio visualization', () => {
        expect(conf).toMatch(/^framework_type\s*=\s*studio_visualization$/m);
    });

    test('declares no phantom stanzas for visualizations that do not exist', () => {
        const stanzas = [...conf.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
        const vizDirs = fs
            .readdirSync(path.join(ROOT, 'appserver', 'static', 'visualizations'))
            .filter((d) => fs.statSync(path.join(ROOT, 'appserver', 'static', 'visualizations', d)).isDirectory());
        for (const stanza of stanzas) {
            expect(vizDirs).toContain(stanza.split('.')[0]);
        }
    });
});

describe('config.json options schema', () => {
    const schemaKeys = Object.keys(config.config.optionsSchema);

    test('exposes exactly the options the source implements', () => {
        expect(schemaKeys.sort()).toEqual(['allowScripts', 'htmlTemplate', 'theme']);
    });

    test.each(['htmlTemplate', 'allowScripts', 'theme'])(
        'option %s is read by visualization.js',
        (key) => {
            expect(source).toMatch(new RegExp(`opts\\.${key}\\b`));
        }
    );

    test('every editorConfig option exists in the options schema', () => {
        const editorOptions = [];
        for (const section of config.config.editorConfig) {
            for (const row of section.layout) {
                for (const cell of row) {
                    if (cell.option) editorOptions.push(cell.option);
                }
            }
        }
        expect(editorOptions.length).toBeGreaterThan(0);
        for (const opt of editorOptions) {
            expect(schemaKeys).toContain(opt);
        }
    });

    test('allowScripts defaults to false (sanitiser on) in the schema', () => {
        expect(config.config.optionsSchema.allowScripts.default).toBe(false);
    });
});
