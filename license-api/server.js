import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import cors from 'cors';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const customersDir = path.join(rootDir, 'licenses', 'customers');
const plansPath = path.join(rootDir, 'plans', 'plans.json');
const featuresPath = path.join(rootDir, 'features', 'catalog.json');
const activityLogPath = path.join(__dirname, 'admin-activity.json');

const app = express();
const allowedOrigins = (process.env.ADMIN_WEB_ORIGIN || '*')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('CORS blocked for this origin'));
    }
}));
app.use(express.json());

const port = parseInt(process.env.PORT || '4100', 10);
const apiToken = process.env.LICENSE_API_TOKEN || '';
const adminToken = process.env.ADMIN_API_TOKEN || '';
const signingSecret = process.env.LICENSE_SIGNING_SECRET || 'change-me';
const gitSyncEnabled = process.env.GIT_SYNC_ENABLED === 'true';
const gitSyncBranch = process.env.GIT_SYNC_BRANCH || 'main';
const gitSyncRemote = process.env.GIT_SYNC_REMOTE || 'origin';
const gitSyncAuthor = process.env.GIT_SYNC_AUTHOR || 'softwarebank-bot';

function runGit(args) {
    const result = spawnSync('git', args, {
        cwd: rootDir,
        encoding: 'utf-8'
    });

    if (result.status !== 0) {
        const err = result.stderr || result.stdout || 'git command failed';
        throw new Error(err.trim());
    }
    return result.stdout?.trim() || '';
}

function ensureSafeGitPath(targetPath) {
    const fullPath = path.resolve(targetPath);
    if (!fullPath.startsWith(rootDir)) {
        throw new Error(`Unsafe git path: ${targetPath}`);
    }
    return path.relative(rootDir, fullPath).replace(/\\/g, '/');
}

async function syncChangesToGitHub(commitMessage, changedPaths = []) {
    if (!gitSyncEnabled) return { synced: false, reason: 'disabled' };

    const gitDirExists = await fs
        .access(path.join(rootDir, '.git'))
        .then(() => true)
        .catch(() => false);
    if (!gitDirExists) return { synced: false, reason: 'no_git_repo' };

    const safePaths = changedPaths.map(ensureSafeGitPath);
    if (safePaths.length > 0) {
        runGit(['add', ...safePaths]);
    } else {
        runGit(['add', '.']);
    }

    const staged = runGit(['diff', '--cached', '--name-only']);
    if (!staged) return { synced: false, reason: 'no_changes' };

    runGit(['commit', '-m', `[${gitSyncAuthor}] ${commitMessage}`]);
    runGit(['push', gitSyncRemote, gitSyncBranch]);
    return { synced: true, reason: 'ok' };
}

function assertAuth(req, res, next) {
    if (!apiToken) return next();
    const token = req.headers['x-license-api-token'];
    if (token !== apiToken) {
        return res.status(401).json({ success: false, error: 'Unauthorized token' });
    }
    return next();
}

function assertAdminAuth(req, res, next) {
    if (!adminToken) {
        return res.status(500).json({ success: false, error: 'ADMIN_API_TOKEN is not configured' });
    }
    const headerToken = req.headers['x-admin-token'];
    const authHeader = req.headers.authorization || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const token = headerToken || bearerToken;
    if (token !== adminToken) {
        return res.status(401).json({ success: false, error: 'Unauthorized admin token' });
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

async function loadPlans() {
    const raw = await fs.readFile(plansPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.plans || [];
}

async function writePlans(plans) {
    await fs.writeFile(plansPath, JSON.stringify({ plans }, null, 2), 'utf-8');
}

async function loadFeatureCatalog() {
    const raw = await fs.readFile(featuresPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.features || [];
}

async function writeFeatureCatalog(features) {
    await fs.writeFile(featuresPath, JSON.stringify({ features }, null, 2), 'utf-8');
}

async function loadActivityLog() {
    try {
        const raw = await fs.readFile(activityLogPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.items)) return [];
        return parsed.items;
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

async function writeActivityLog(items) {
    await fs.writeFile(activityLogPath, JSON.stringify({ items }, null, 2), 'utf-8');
}

async function addActivity(type, title, details = {}) {
    const entries = await loadActivityLog();
    const record = {
        id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        type,
        title,
        details,
        createdAt: new Date().toISOString()
    };
    entries.unshift(record);
    await writeActivityLog(entries.slice(0, 300));
}

async function finalizeAdminMutation({
    type,
    title,
    details = {},
    commitMessage,
    changedPaths = []
}) {
    await addActivity(type, title, details);
    const gitResult = await syncChangesToGitHub(commitMessage, [
        ...changedPaths,
        activityLogPath
    ]);
    return gitResult;
}

async function findByLicenseKey(licenseKey) {
    const customers = await loadCustomers();
    return customers.find((customer) => customer.license.licenseKey === licenseKey) || null;
}

async function findCustomerByCode(customerCode) {
    const filePath = path.join(customersDir, `${customerCode}.json`);
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function saveCustomer(customer) {
    const filePath = path.join(customersDir, `${customer.customerCode}.json`);
    await fs.writeFile(filePath, JSON.stringify(customer, null, 2), 'utf-8');
}

async function removeCustomer(customerCode) {
    const filePath = path.join(customersDir, `${customerCode}.json`);
    await fs.unlink(filePath);
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

function normalizeCode(input) {
    return String(input || '')
        .trim()
        .replace(/\s+/g, '-')
        .toUpperCase();
}

function buildFeatureMap(enabledCodes, catalog) {
    const selected = new Set((enabledCodes || []).map((item) => String(item).trim()));
    const map = {};
    for (const feature of catalog) {
        map[feature.code] = selected.has(feature.code);
    }
    return map;
}

function formatCustomer(customer) {
    return {
        customerId: customer.customerId,
        customerCode: customer.customerCode,
        activationCode: customer.activationCode,
        plan: customer.plan,
        status: customer.status,
        expiresAt: customer.expiresAt,
        license: customer.license || {},
        features: customer.features || {}
    };
}

function nextCustomerId(customers) {
    const maxId = customers.reduce((max, item) => Math.max(max, Number(item.customerId) || 0), 0);
    return maxId + 1;
}

function sanitizeStatus(value) {
    const normalized = String(value || '').toLowerCase();
    if (['active', 'suspended', 'expired'].includes(normalized)) return normalized;
    return 'active';
}

app.get('/health', (_req, res) => {
    res.json({ success: true, service: 'license-api', status: 'ok' });
});

app.get('/v1/admin/bootstrap', assertAdminAuth, async (_req, res) => {
    const [customers, plans, features, activity] = await Promise.all([
        loadCustomers(),
        loadPlans(),
        loadFeatureCatalog(),
        loadActivityLog()
    ]);
    const now = Date.now();
    const expiringSoon = customers.filter((item) => {
        const expires = new Date(item.expiresAt).getTime();
        return expires >= now && expires - now <= 1000 * 60 * 60 * 24 * 30;
    }).length;
    const counts = {
        customers: customers.length,
        active: customers.filter((item) => item.status === 'active').length,
        suspended: customers.filter((item) => item.status === 'suspended').length,
        expiringSoon
    };
    return res.json({
        success: true,
        data: {
            counts,
            customers: customers.map(formatCustomer),
            plans,
            features,
            activity: activity.slice(0, 60)
        }
    });
});

app.get('/v1/admin/customers', assertAdminAuth, async (_req, res) => {
    const customers = await loadCustomers();
    return res.json({ success: true, data: customers.map(formatCustomer) });
});

app.post('/v1/admin/customers', assertAdminAuth, async (req, res) => {
    const customers = await loadCustomers();
    const plans = await loadPlans();
    const featureCatalog = await loadFeatureCatalog();
    const customerCode = normalizeCode(req.body?.customerCode);
    const planCode = String(req.body?.plan || '').trim().toLowerCase();
    if (!customerCode || !planCode) {
        return res.status(400).json({ success: false, error: 'customerCode and plan are required' });
    }
    const existing = customers.find((item) => item.customerCode === customerCode);
    if (existing) {
        return res.status(409).json({ success: false, error: 'Customer already exists' });
    }
    const plan = plans.find((item) => String(item.code).toLowerCase() === planCode);
    if (!plan) {
        return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    const featureCodes = req.body?.featureCodes || plan.features || [];
    const customer = {
        customerId: nextCustomerId(customers),
        customerCode,
        activationCode: req.body?.activationCode || `ACT-${customerCode}-${new Date().getFullYear()}`,
        plan: plan.code,
        status: sanitizeStatus(req.body?.status),
        expiresAt: req.body?.expiresAt || new Date(Date.now() + (1000 * 60 * 60 * 24 * 365)).toISOString(),
        license: {
            licenseKey: req.body?.licenseKey || `LIC-${customerCode}`,
            messagesLimit: Number(req.body?.messagesLimit ?? plan.messagesLimit ?? 0),
            messagesUsed: Number(req.body?.messagesUsed ?? 0)
        },
        features: buildFeatureMap(featureCodes, featureCatalog)
    };
    await saveCustomer(customer);
    const gitResult = await finalizeAdminMutation({
        type: 'customer_created',
        title: `Created customer ${customerCode}`,
        details: { customerCode, plan: plan.code },
        commitMessage: `Create customer ${customerCode}`,
        changedPaths: [path.join(customersDir, `${customer.customerCode}.json`)]
    });
    return res.status(201).json({ success: true, data: formatCustomer(customer), gitSync: gitResult });
});

app.put('/v1/admin/customers/:customerCode', assertAdminAuth, async (req, res) => {
    const customerCode = normalizeCode(req.params.customerCode);
    const customer = await findCustomerByCode(customerCode);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    if (req.body?.plan) {
        const plans = await loadPlans();
        const requestedPlan = String(req.body.plan).trim().toLowerCase();
        if (!plans.some((item) => String(item.code).toLowerCase() === requestedPlan)) {
            return res.status(404).json({ success: false, error: 'Plan not found' });
        }
        customer.plan = requestedPlan;
    }
    if (req.body?.activationCode) customer.activationCode = String(req.body.activationCode).trim();
    if (req.body?.expiresAt) customer.expiresAt = new Date(req.body.expiresAt).toISOString();
    if (req.body?.status) customer.status = sanitizeStatus(req.body.status);
    if (typeof req.body?.messagesLimit === 'number') customer.license.messagesLimit = req.body.messagesLimit;
    if (typeof req.body?.messagesUsed === 'number') customer.license.messagesUsed = req.body.messagesUsed;
    if (req.body?.licenseKey) customer.license.licenseKey = String(req.body.licenseKey).trim();
    await saveCustomer(customer);
    const gitResult = await finalizeAdminMutation({
        type: 'customer_updated',
        title: `Updated customer ${customerCode}`,
        details: { customerCode },
        commitMessage: `Update customer ${customerCode}`,
        changedPaths: [path.join(customersDir, `${customer.customerCode}.json`)]
    });
    return res.json({ success: true, data: formatCustomer(customer), gitSync: gitResult });
});

app.delete('/v1/admin/customers/:customerCode', assertAdminAuth, async (req, res) => {
    const customerCode = normalizeCode(req.params.customerCode);
    const customer = await findCustomerByCode(customerCode);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    await removeCustomer(customerCode);
    const gitResult = await finalizeAdminMutation({
        type: 'customer_deleted',
        title: `Deleted customer ${customerCode}`,
        details: { customerCode },
        commitMessage: `Delete customer ${customerCode}`,
        changedPaths: [path.join(customersDir, `${customerCode}.json`)]
    });
    return res.json({ success: true, gitSync: gitResult });
});

app.get('/v1/admin/licenses', assertAdminAuth, async (_req, res) => {
    const customers = await loadCustomers();
    const data = customers.map((customer) => ({
        customerCode: customer.customerCode,
        status: customer.status,
        expiresAt: customer.expiresAt,
        plan: customer.plan,
        activationCode: customer.activationCode,
        licenseKey: customer.license?.licenseKey,
        messagesLimit: customer.license?.messagesLimit ?? 0,
        messagesUsed: customer.license?.messagesUsed ?? 0
    }));
    return res.json({ success: true, data });
});

app.put('/v1/admin/licenses/:customerCode', assertAdminAuth, async (req, res) => {
    const customerCode = normalizeCode(req.params.customerCode);
    const customer = await findCustomerByCode(customerCode);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    if (req.body?.status) customer.status = sanitizeStatus(req.body.status);
    if (req.body?.expiresAt) customer.expiresAt = new Date(req.body.expiresAt).toISOString();
    if (typeof req.body?.messagesLimit === 'number') customer.license.messagesLimit = req.body.messagesLimit;
    if (typeof req.body?.messagesUsed === 'number') customer.license.messagesUsed = req.body.messagesUsed;
    if (req.body?.activationCode) customer.activationCode = String(req.body.activationCode).trim();
    await saveCustomer(customer);
    const gitResult = await finalizeAdminMutation({
        type: 'license_updated',
        title: `Updated license for ${customerCode}`,
        details: { customerCode },
        commitMessage: `Update license ${customerCode}`,
        changedPaths: [path.join(customersDir, `${customer.customerCode}.json`)]
    });
    return res.json({ success: true, data: formatCustomer(customer), gitSync: gitResult });
});

app.post('/v1/admin/licenses/:customerCode/actions', assertAdminAuth, async (req, res) => {
    const customerCode = normalizeCode(req.params.customerCode);
    const customer = await findCustomerByCode(customerCode);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    const action = String(req.body?.action || '').toLowerCase();
    if (action === 'activate') customer.status = 'active';
    if (action === 'suspend') customer.status = 'suspended';
    if (action === 'extend30') {
        const base = new Date(customer.expiresAt).getTime() || Date.now();
        customer.expiresAt = new Date(base + (1000 * 60 * 60 * 24 * 30)).toISOString();
    }
    if (action === 'resetusage') customer.license.messagesUsed = 0;
    if (!['activate', 'suspend', 'extend30', 'resetusage'].includes(action)) {
        return res.status(400).json({ success: false, error: 'Unknown action' });
    }
    await saveCustomer(customer);
    const gitResult = await finalizeAdminMutation({
        type: 'license_action',
        title: `Applied ${action} to ${customerCode}`,
        details: { customerCode, action },
        commitMessage: `License action ${action} for ${customerCode}`,
        changedPaths: [path.join(customersDir, `${customer.customerCode}.json`)]
    });
    return res.json({ success: true, data: formatCustomer(customer), gitSync: gitResult });
});

app.get('/v1/admin/features', assertAdminAuth, async (_req, res) => {
    const features = await loadFeatureCatalog();
    return res.json({ success: true, data: features });
});

app.post('/v1/admin/features', assertAdminAuth, async (req, res) => {
    const features = await loadFeatureCatalog();
    const code = normalizeCode(req.body?.code);
    const name = String(req.body?.name || '').trim();
    if (!code || !name) {
        return res.status(400).json({ success: false, error: 'code and name are required' });
    }
    if (features.some((item) => item.code === code)) {
        return res.status(409).json({ success: false, error: 'Feature already exists' });
    }
    const next = [...features, { code, name }];
    await writeFeatureCatalog(next);
    const gitResult = await finalizeAdminMutation({
        type: 'feature_created',
        title: `Added feature ${code}`,
        details: { code },
        commitMessage: `Create feature ${code}`,
        changedPaths: [featuresPath]
    });
    return res.status(201).json({ success: true, data: { code, name }, gitSync: gitResult });
});

app.put('/v1/admin/features/:code', assertAdminAuth, async (req, res) => {
    const code = normalizeCode(req.params.code);
    const features = await loadFeatureCatalog();
    const idx = features.findIndex((item) => item.code === code);
    if (idx === -1) {
        return res.status(404).json({ success: false, error: 'Feature not found' });
    }
    const name = String(req.body?.name || '').trim();
    if (!name) {
        return res.status(400).json({ success: false, error: 'name is required' });
    }
    features[idx] = { ...features[idx], name };
    await writeFeatureCatalog(features);
    const gitResult = await finalizeAdminMutation({
        type: 'feature_updated',
        title: `Updated feature ${code}`,
        details: { code },
        commitMessage: `Update feature ${code}`,
        changedPaths: [featuresPath]
    });
    return res.json({ success: true, data: features[idx], gitSync: gitResult });
});

app.post('/v1/admin/customers/:customerCode/features/:featureCode/toggle', assertAdminAuth, async (req, res) => {
    const customerCode = normalizeCode(req.params.customerCode);
    const featureCode = normalizeCode(req.params.featureCode);
    const customer = await findCustomerByCode(customerCode);
    if (!customer) {
        return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    customer.features = customer.features || {};
    const nextEnabled = typeof req.body?.enabled === 'boolean'
        ? req.body.enabled
        : !Boolean(customer.features[featureCode]);
    customer.features[featureCode] = nextEnabled;
    await saveCustomer(customer);
    const gitResult = await finalizeAdminMutation({
        type: 'feature_toggled',
        title: `Set ${featureCode} for ${customerCode}`,
        details: { customerCode, featureCode, enabled: nextEnabled },
        commitMessage: `Toggle feature ${featureCode} for ${customerCode}`,
        changedPaths: [path.join(customersDir, `${customer.customerCode}.json`)]
    });
    return res.json({
        success: true,
        data: { customerCode, featureCode, enabled: nextEnabled },
        gitSync: gitResult
    });
});

app.get('/v1/admin/plans', assertAdminAuth, async (_req, res) => {
    const plans = await loadPlans();
    return res.json({ success: true, data: plans });
});

app.post('/v1/admin/plans', assertAdminAuth, async (req, res) => {
    const plans = await loadPlans();
    const code = String(req.body?.code || '').trim().toLowerCase();
    if (!code) {
        return res.status(400).json({ success: false, error: 'code is required' });
    }
    if (plans.some((item) => String(item.code).toLowerCase() === code)) {
        return res.status(409).json({ success: false, error: 'Plan already exists' });
    }
    const plan = {
        code,
        messagesLimit: Number(req.body?.messagesLimit ?? 0),
        features: Array.isArray(req.body?.features) ? req.body.features : []
    };
    plans.push(plan);
    await writePlans(plans);
    const gitResult = await finalizeAdminMutation({
        type: 'plan_created',
        title: `Created plan ${code}`,
        details: { code },
        commitMessage: `Create plan ${code}`,
        changedPaths: [plansPath]
    });
    return res.status(201).json({ success: true, data: plan, gitSync: gitResult });
});

app.put('/v1/admin/plans/:code', assertAdminAuth, async (req, res) => {
    const code = String(req.params.code || '').trim().toLowerCase();
    const plans = await loadPlans();
    const idx = plans.findIndex((item) => String(item.code).toLowerCase() === code);
    if (idx === -1) {
        return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    const current = plans[idx];
    const next = {
        ...current,
        code,
        messagesLimit: Number(req.body?.messagesLimit ?? current.messagesLimit ?? 0),
        features: Array.isArray(req.body?.features) ? req.body.features : current.features
    };
    plans[idx] = next;
    await writePlans(plans);
    const gitResult = await finalizeAdminMutation({
        type: 'plan_updated',
        title: `Updated plan ${code}`,
        details: { code },
        commitMessage: `Update plan ${code}`,
        changedPaths: [plansPath]
    });
    return res.json({ success: true, data: next, gitSync: gitResult });
});

app.delete('/v1/admin/plans/:code', assertAdminAuth, async (req, res) => {
    const code = String(req.params.code || '').trim().toLowerCase();
    const plans = await loadPlans();
    const filtered = plans.filter((item) => String(item.code).toLowerCase() !== code);
    if (filtered.length === plans.length) {
        return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    await writePlans(filtered);
    const gitResult = await finalizeAdminMutation({
        type: 'plan_deleted',
        title: `Deleted plan ${code}`,
        details: { code },
        commitMessage: `Delete plan ${code}`,
        changedPaths: [plansPath]
    });
    return res.json({ success: true, gitSync: gitResult });
});

app.get('/v1/admin/activity', assertAdminAuth, async (_req, res) => {
    const activity = await loadActivityLog();
    return res.json({ success: true, data: activity.slice(0, 80) });
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
