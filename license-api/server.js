import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const customersDir = path.join(rootDir, 'licenses', 'customers');

const app = express();
app.use(express.json());

const port = parseInt(process.env.PORT || '4100', 10);
const apiToken = process.env.LICENSE_API_TOKEN || '';
const signingSecret = process.env.LICENSE_SIGNING_SECRET || 'change-me';

function assertAuth(req, res, next) {
    if (!apiToken) return next();
    const token = req.headers['x-license-api-token'];
    if (token !== apiToken) {
        return res.status(401).json({ success: false, error: 'Unauthorized token' });
    }
    return next();
}

function signPayload(payload) {
    const body = JSON.stringify(payload);
    return crypto.createHmac('sha256', signingSecret).update(body).digest('hex');
}

async function loadCustomers() {
    const entries = await fs.readdir(customersDir);
    const data = [];
    for (const item of entries) {
        if (!item.endsWith('.json')) continue;
        const full = path.join(customersDir, item);
        const raw = await fs.readFile(full, 'utf-8');
        data.push(JSON.parse(raw));
    }
    return data;
}

async function findByLicenseKey(licenseKey) {
    const customers = await loadCustomers();
    return customers.find((customer) => customer.license.licenseKey === licenseKey) || null;
}

async function findByActivation(activationCode, customerCode) {
    const customers = await loadCustomers();
    return customers.find(
        (customer) =>
            customer.customerCode === customerCode &&
            customer.activationCode === activationCode
    ) || null;
}

function toLicensePayload(customer) {
    return {
        licenseKey: customer.license.licenseKey,
        customerId: customer.customerId,
        customerCode: customer.customerCode,
        packageName: customer.plan,
        status: customer.status,
        expiresAt: customer.expiresAt,
        messagesLimit: customer.license.messagesLimit,
        messagesUsed: customer.license.messagesUsed,
        includesChatbot: Boolean(customer.features?.CHATBOT),
        features: Object.entries(customer.features || {}).map(([featureCode, enabled]) => ({
            feature_code: featureCode,
            is_enabled: Boolean(enabled),
            usage_limit: null,
            usage_count: 0
        }))
    };
}

app.get('/health', (_req, res) => {
    res.json({ success: true, service: 'license-api', status: 'ok' });
});

app.post('/v1/licenses/activate', assertAuth, async (req, res) => {
    const { activationCode, customerCode } = req.body || {};
    if (!activationCode || !customerCode) {
        return res.status(400).json({ success: false, error: 'activationCode and customerCode are required' });
    }

    const customer = await findByActivation(activationCode, customerCode);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'Activation data not found' });
    }

    if (customer.status !== 'active') {
        return res.status(403).json({ success: false, error: `License is ${customer.status}` });
    }

    const license = toLicensePayload(customer);
    const payload = { success: true, license };
    return res.json({ ...payload, signature: signPayload(payload) });
});

app.post('/v1/licenses/validate', assertAuth, async (req, res) => {
    const { licenseKey } = req.body || {};
    if (!licenseKey) {
        return res.status(400).json({ success: false, error: 'licenseKey is required' });
    }

    const customer = await findByLicenseKey(licenseKey);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'License not found' });
    }

    if (customer.status !== 'active') {
        return res.status(403).json({ success: false, error: `License is ${customer.status}` });
    }

    const license = toLicensePayload(customer);
    const payload = { success: true, license };
    return res.json({ ...payload, signature: signPayload(payload) });
});

app.get('/v1/licenses/info', assertAuth, async (req, res) => {
    const licenseKey = req.query.licenseKey;
    if (!licenseKey) {
        return res.status(400).json({ success: false, error: 'licenseKey is required' });
    }

    const customer = await findByLicenseKey(licenseKey);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'License not found' });
    }

    const data = toLicensePayload(customer);
    const payload = { success: true, data };
    return res.json({ ...payload, signature: signPayload(payload) });
});

app.post('/v1/licenses/usage', assertAuth, async (req, res) => {
    const { licenseKey, messagesUsed } = req.body || {};
    if (!licenseKey || typeof messagesUsed !== 'number') {
        return res.status(400).json({ success: false, error: 'licenseKey and messagesUsed(number) are required' });
    }

    const customer = await findByLicenseKey(licenseKey);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'License not found' });
    }

    const nextUsed = Math.max(0, customer.license.messagesUsed + messagesUsed);
    customer.license.messagesUsed = nextUsed;

    const filePath = path.join(customersDir, `${customer.customerCode}.json`);
    await fs.writeFile(filePath, JSON.stringify(customer, null, 2), 'utf-8');

    const license = toLicensePayload(customer);
    const payload = { success: true, license };
    return res.json({ ...payload, signature: signPayload(payload) });
});

app.listen(port, () => {
    console.log(`License API listening on http://localhost:${port}`);
});
