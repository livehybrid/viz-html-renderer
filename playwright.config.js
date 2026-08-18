// Playwright config for the e2e render check against the docker Splunk.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './e2e',
    timeout: 180000,
    retries: 1,
    outputDir: 'e2e-results',
    use: {
        baseURL: process.env.SPLUNK_WEB_URL || 'http://localhost:8000',
        ignoreHTTPSErrors: true,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    reporter: [['list']],
});
