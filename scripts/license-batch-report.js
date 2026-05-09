import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const customersDir = path.join(repoRoot, 'licenses', 'customers');
const reportsDir = path.join(repoRoot, 'reports');
const apiDir = path.join(repoRoot, 'license-api');

const port = Number(process.env.LICENSE_API_PORT || 4100);
const baseUrl = `http://localhost:${port}`;

function nowIso() {
    return new Date().toISOString();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(timeoutMs = 30000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const res = await fetch(`${baseUrl}/health`);
            if (res.ok) return true;
        } catch (_) {
            // retry
        }
        await sleep(1000);
    }
    return false;
}

function startApi() {
    return spawn('node', ['server.js'], {
        cwd: apiDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            PORT: String(port),
            LICENSE_SIGNING_SECRET: process.env.LICENSE_SIGNING_SECRET || 'batch-ci-secret'
        }
    });
}

async function stopApi(proc) {
    if (!proc || proc.killed) return;
    proc.kill('SIGTERM');
    await sleep(1000);
    if (!proc.killed) proc.kill('SIGKILL');
}

async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body };
}

function expectedStatusTest(customerStatus, endpointStatus) {
    if (customerStatus === 'active') return endpointStatus === 200;
    return endpointStatus === 403 || endpointStatus === 404;
}

function buildHtml(report) {
    const rows = report.results
        .map((item) => {
            const color = item.passed ? '#14532d' : '#7f1d1d';
            const bg = item.passed ? '#dcfce7' : '#fee2e2';
            return `
      <tr style="background:${bg}">
        <td>${item.customerCode}</td>
        <td>${item.status}</td>
        <td>${item.plan || '-'}</td>
        <td>${item.activate.status}</td>
        <td>${item.validate.status}</td>
        <td>${item.info.status}</td>
        <td style="color:${color};font-weight:700">${item.passed ? 'PASS' : 'FAIL'}</td>
        <td>${item.reason || '-'}</td>
      </tr>`;
        })
        .join('\n');

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>License Batch Report</title>
  <style>
    body{font-family:Segoe UI,Arial,sans-serif;margin:24px;background:#f8fafc;color:#0f172a}
    h1{margin:0 0 12px}
    .meta{margin-bottom:16px}
    table{border-collapse:collapse;width:100%;background:white}
    th,td{border:1px solid #cbd5e1;padding:8px;text-align:left;font-size:13px}
    th{background:#e2e8f0}
  </style>
</head>
<body>
  <h1>License Batch Report</h1>
  <div class="meta">
    <div><b>Generated:</b> ${report.generatedAt}</div>
    <div><b>Total:</b> ${report.summary.total} | <b>Passed:</b> ${report.summary.passed} | <b>Failed:</b> ${report.summary.failed}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Customer</th>
        <th>Status</th>
        <th>Plan</th>
        <th>Activate</th>
        <th>Validate</th>
        <th>Info</th>
        <th>Result</th>
        <th>Reason</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

async function run() {
    let apiProc;
    let apiStartedByScript = false;

    const report = {
        generatedAt: nowIso(),
        summary: {
            total: 0,
            passed: 0,
            failed: 0
        },
        results: []
    };

    try {
        const alreadyUp = await waitForHealth(2500);
        if (!alreadyUp) {
            apiProc = startApi();
            apiStartedByScript = true;
            apiProc.stdout.on('data', (c) => process.stdout.write(`[license-api] ${c}`));
            apiProc.stderr.on('data', (c) => process.stderr.write(`[license-api:err] ${c}`));
            const healthy = await waitForHealth(30000);
            if (!healthy) throw new Error('License API failed to start');
        }

        const files = await fs.readdir(customersDir);
        const customerFiles = files.filter((f) => f.endsWith('.json'));

        for (const fileName of customerFiles) {
            const fullPath = path.join(customersDir, fileName);
            const raw = await fs.readFile(fullPath, 'utf-8');
            const customer = JSON.parse(raw);

            const payload = {
                activationCode: customer.activationCode,
                customerCode: customer.customerCode
            };

            const activate = await fetchJson(`${baseUrl}/v1/licenses/activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const validate = await fetchJson(`${baseUrl}/v1/licenses/validate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ licenseKey: customer.license?.licenseKey })
            });

            const info = await fetchJson(
                `${baseUrl}/v1/licenses/info?licenseKey=${encodeURIComponent(customer.license?.licenseKey || '')}`
            );

            const statusRulesOk =
                expectedStatusTest(customer.status, activate.status) &&
                expectedStatusTest(customer.status, validate.status) &&
                info.status === 200;

            const reason = statusRulesOk
                ? ''
                : `Expected behavior mismatch for status=${customer.status}`;

            report.results.push({
                customerCode: customer.customerCode,
                status: customer.status,
                plan: customer.plan,
                activate: { status: activate.status, success: Boolean(activate.body?.success) },
                validate: { status: validate.status, success: Boolean(validate.body?.success) },
                info: { status: info.status, success: Boolean(info.body?.success) },
                passed: statusRulesOk,
                reason
            });
        }

        report.summary.total = report.results.length;
        report.summary.passed = report.results.filter((r) => r.passed).length;
        report.summary.failed = report.summary.total - report.summary.passed;

        await fs.mkdir(reportsDir, { recursive: true });
        const jsonPath = path.join(reportsDir, 'license-batch-report.json');
        const htmlPath = path.join(reportsDir, 'license-batch-report.html');
        await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
        await fs.writeFile(htmlPath, buildHtml(report), 'utf-8');

        console.log(`Report JSON: ${jsonPath}`);
        console.log(`Report HTML: ${htmlPath}`);
        console.log(
            `Summary: total=${report.summary.total}, passed=${report.summary.passed}, failed=${report.summary.failed}`
        );

        if (report.summary.failed > 0) {
            process.exitCode = 1;
        }
    } finally {
        if (apiStartedByScript) {
            await stopApi(apiProc);
        }
    }
}

run().catch((error) => {
    console.error('Batch report failed:', error);
    process.exit(1);
});
