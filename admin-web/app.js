const state = {
    ghOwner: localStorage.getItem('sb_gh_owner') || 'softwarebanknew-png',
    ghRepo: localStorage.getItem('sb_gh_repo') || 'SoftwareBankWhatsAppservice',
    ghBranch: localStorage.getItem('sb_gh_branch') || 'main',
    ghToken: localStorage.getItem('sb_gh_token') || '',
    lastActivationData: JSON.parse(localStorage.getItem('sb_last_activation_data') || 'null'),
    customers: [],
    plans: [],
    features: [],
    activity: [],
    counts: { customers: 0, active: 0, suspended: 0, expiringSoon: 0 }
};

const nodes = {
    configForm: document.getElementById('configForm'),
    ghOwner: document.getElementById('ghOwner'),
    ghRepo: document.getElementById('ghRepo'),
    ghBranch: document.getElementById('ghBranch'),
    ghToken: document.getElementById('ghToken'),
    testGithubBtn: document.getElementById('testGithubBtn'),
    validatePathsBtn: document.getElementById('validatePathsBtn'),
    autoFixPathsBtn: document.getElementById('autoFixPathsBtn'),
    createSampleCustomerBtn: document.getElementById('createSampleCustomerBtn'),
    copyActivationBtn: document.getElementById('copyActivationBtn'),
    githubStatus: document.getElementById('githubStatus'),
    refreshBtn: document.getElementById('refreshBtn'),
    kpis: document.getElementById('kpis'),
    dashboard: document.getElementById('dashboard'),
    customers: document.getElementById('customers'),
    licenses: document.getElementById('licenses'),
    features: document.getElementById('features'),
    plans: document.getElementById('plans'),
    activity: document.getElementById('activity'),
    toastHost: document.getElementById('toastHost'),
    drawer: document.getElementById('drawer'),
    drawerTitle: document.getElementById('drawerTitle'),
    drawerBody: document.getElementById('drawerBody'),
    drawerBackdrop: document.getElementById('drawerBackdrop'),
    drawerCloseBtn: document.getElementById('drawerCloseBtn')
};

nodes.ghOwner.value = state.ghOwner;
nodes.ghRepo.value = state.ghRepo;
nodes.ghBranch.value = state.ghBranch;
nodes.ghToken.value = state.ghToken;

function toast(message, isError = false) {
    const el = document.createElement('div');
    el.className = `toast ${isError ? 'error' : ''}`;
    el.textContent = message;
    nodes.toastHost.appendChild(el);
    setTimeout(() => el.remove(), 3200);
}

function setGithubStatus(message, kind = 'neutral') {
    nodes.githubStatus.textContent = `الحالة: ${message}`;
    nodes.githubStatus.classList.remove('ok', 'fail');
    if (kind === 'ok') nodes.githubStatus.classList.add('ok');
    if (kind === 'fail') nodes.githubStatus.classList.add('fail');
}

function setLastActivationData(data) {
    state.lastActivationData = data;
    localStorage.setItem('sb_last_activation_data', JSON.stringify(data));
}

async function githubApi(path, options = {}) {
    if (!state.ghToken) throw new Error('GitHub token is required');
    const response = await fetch(`https://api.github.com${path}`, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${state.ghToken}`,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.message || `GitHub API error ${response.status}`);
    }
    return payload;
}

function repoPath(filePath) {
    return `/repos/${state.ghOwner}/${state.ghRepo}/contents/${filePath}`;
}

async function getFile(filePath) {
    const data = await githubApi(`${repoPath(filePath)}?ref=${encodeURIComponent(state.ghBranch)}`);
    const content = atob((data.content || '').replace(/\n/g, ''));
    return { sha: data.sha, data: JSON.parse(content) };
}

async function putFile(filePath, content, message) {
    let sha = undefined;
    try {
        const existing = await githubApi(`${repoPath(filePath)}?ref=${encodeURIComponent(state.ghBranch)}`);
        sha = existing.sha;
    } catch (_) {
        sha = undefined;
    }

    await githubApi(repoPath(filePath), {
        method: 'PUT',
        body: {
            message,
            branch: state.ghBranch,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
            ...(sha ? { sha } : {})
        }
    });
}

async function deleteFile(filePath, message) {
    const existing = await githubApi(`${repoPath(filePath)}?ref=${encodeURIComponent(state.ghBranch)}`);
    await githubApi(repoPath(filePath), {
        method: 'DELETE',
        body: {
            message,
            branch: state.ghBranch,
            sha: existing.sha
        }
    });
}

function normalizeCode(input) {
    return String(input || '').trim().replace(/\s+/g, '-').toUpperCase();
}

function addActivityLocal(type, title) {
    state.activity.unshift({
        id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        type,
        title,
        createdAt: new Date().toISOString()
    });
    state.activity = state.activity.slice(0, 100);
}

function statusChip(status) {
    const current = (status || 'active').toLowerCase();
    return `<span class="chip ${current}">${current}</span>`;
}

function sectionTitle(title, subtitle, actionLabel = '', actionKey = '') {
    const actionBtn = actionLabel && actionKey
        ? `<button class="btn btn-primary" type="button" data-open-drawer="${actionKey}">${actionLabel}</button>`
        : '';
    return `
        <div class="section-head">
            <div>
                <h3>${title}</h3>
                <p class="mini">${subtitle}</p>
            </div>
            ${actionBtn}
        </div>
    `;
}

function featureSummary(featureMap) {
    return Object.entries(featureMap || {})
        .filter(([, enabled]) => enabled)
        .map(([code]) => code)
        .join(', ');
}

function featureCodesInput(raw) {
    return String(raw || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function renderKPIs() {
    const items = [
        ['Customers', state.counts.customers],
        ['Active', state.counts.active],
        ['Suspended', state.counts.suspended],
        ['Expiring 30d', state.counts.expiringSoon]
    ];
    nodes.kpis.innerHTML = items.map(([label, value]) => `
        <article class="kpi-card glass">
            <strong>${value}</strong>
            <p>${label}</p>
        </article>
    `).join('');
}

function renderDashboard() {
    const topCustomers = [...state.customers].slice(0, 5);
    nodes.dashboard.innerHTML = `
        ${sectionTitle('Quick Overview', 'Operational cockpit snapshot')}
        <div class="list">
            ${topCustomers.map((customer) => `
                <article class="row">
                    <div class="row-title">
                        <strong>${customer.customerCode}</strong>
                        ${statusChip(customer.status)}
                    </div>
                    <div class="mini">Plan: ${customer.plan} | Expires: ${new Date(customer.expiresAt).toLocaleDateString()}</div>
                    <div class="mini">Enabled: ${featureSummary(customer.features) || 'None'}</div>
                </article>
            `).join('')}
        </div>
    `;
}

function renderCustomers() {
    nodes.customers.innerHTML = `
        ${sectionTitle('Customers', 'Create, edit, delete, and search customer records', 'Add Customer', 'customer:new')}
        <input id="customerSearch" type="search" placeholder="Search by code or plan" />
        <div id="customerList" class="list"></div>
    `;
    renderCustomerRows('');
}

function renderCustomerRows(filterText) {
    const list = document.getElementById('customerList');
    if (!list) return;
    const search = String(filterText || '').toLowerCase().trim();
    const filtered = state.customers.filter((item) => {
        if (!search) return true;
        return item.customerCode.toLowerCase().includes(search) || item.plan.toLowerCase().includes(search);
    });
    list.innerHTML = filtered.map((customer) => `
        <article class="row">
            <div class="row-title">
                <strong>${customer.customerCode}</strong>
                ${statusChip(customer.status)}
            </div>
            <div class="mini">Plan: ${customer.plan} | Expires: ${new Date(customer.expiresAt).toLocaleDateString()}</div>
            <div class="mini">Messages: ${customer.license.messagesUsed}/${customer.license.messagesLimit}</div>
            <div class="actions">
                <button class="btn btn-primary" type="button" data-open-drawer="customer:edit:${customer.customerCode}">Edit</button>
                <button class="btn btn-danger" type="button" data-delete="${customer.customerCode}">Delete</button>
            </div>
        </article>
    `).join('') || '<p class="mini">No customers found.</p>';
}

function renderLicenses() {
    nodes.licenses.innerHTML = `
        ${sectionTitle('Licenses', 'Update status, expiry, limits, and one-tap actions')}
        <div class="list">
            ${state.customers.map((customer) => `
                <article class="row">
                    <div class="row-title">
                        <strong>${customer.customerCode}</strong>
                        ${statusChip(customer.status)}
                    </div>
                    <div class="mini">Expires: ${new Date(customer.expiresAt).toLocaleDateString()} | Plan: ${customer.plan}</div>
                    <div class="mini">Messages: ${customer.license.messagesUsed}/${customer.license.messagesLimit}</div>
                    <div class="actions">
                        <button class="btn btn-primary" type="button" data-open-drawer="license:edit:${customer.customerCode}">Edit License</button>
                        <button class="btn btn-success" type="button" data-license-action="${customer.customerCode}:activate">Activate</button>
                        <button class="btn btn-danger" type="button" data-license-action="${customer.customerCode}:suspend">Suspend</button>
                        <button class="btn btn-warn" type="button" data-license-action="${customer.customerCode}:extend30">Extend 30d</button>
                    </div>
                </article>
            `).join('')}
        </div>
    `;
}

function renderFeatures() {
    nodes.features.innerHTML = `
        ${sectionTitle('Features', 'Enable or disable capabilities per customer', 'Add Feature', 'feature:new')}
        <div class="list">
            ${state.customers.map((customer) => `
                <article class="row">
                    <div class="row-title">
                        <strong>${customer.customerCode}</strong>
                        <span class="mini">${customer.plan}</span>
                    </div>
                    <div class="actions">
                        ${state.features.map((feature) => {
                            const enabled = Boolean(customer.features?.[feature.code]);
                            return `
                                <button class="btn ${enabled ? 'btn-success' : 'btn-warn'}" type="button"
                                    data-toggle-feature="${customer.customerCode}:${feature.code}">
                                    ${feature.code}
                                </button>
                            `;
                        }).join('')}
                    </div>
                </article>
            `).join('')}
        </div>
    `;
}

function renderPlans() {
    nodes.plans.innerHTML = `
        ${sectionTitle('Plans', 'Manage package templates and feature sets', 'Add Plan', 'plan:new')}
        <div class="list">
            ${state.plans.map((plan) => `
                <article class="row">
                    <div class="row-title">
                        <strong>${plan.code}</strong>
                        <span class="mini">${plan.messagesLimit} msgs</span>
                    </div>
                    <div class="mini">Features: ${(plan.features || []).join(', ') || 'None'}</div>
                    <div class="actions">
                        <button class="btn btn-primary" type="button" data-open-drawer="plan:edit:${plan.code}">Edit Plan</button>
                        <button class="btn btn-danger" type="button" data-delete-plan="${plan.code}">Delete</button>
                    </div>
                </article>
            `).join('')}
        </div>
    `;
}

function renderActivity() {
    nodes.activity.innerHTML = `
        ${sectionTitle('Activity', 'Recent admin operations timeline')}
        <div class="list">
            ${state.activity.map((item) => `
                <article class="activity-item">
                    <strong>${item.title}</strong>
                    <div class="mini">${item.type} - ${new Date(item.createdAt).toLocaleString()}</div>
                </article>
            `).join('') || '<p class="mini">No activity yet.</p>'}
        </div>
    `;
}

function renderAll() {
    renderKPIs();
    renderDashboard();
    renderCustomers();
    renderLicenses();
    renderFeatures();
    renderPlans();
    renderActivity();
}

async function loadBootstrap() {
    const [plansFile, featuresFile] = await Promise.all([
        getFile('plans/plans.json'),
        getFile('features/catalog.json')
    ]);

    const folder = await githubApi(`${repoPath('licenses/customers')}?ref=${encodeURIComponent(state.ghBranch)}`);
    const jsonFiles = (folder || []).filter((item) => item.type === 'file' && item.name.endsWith('.json'));
    const customers = [];
    for (const file of jsonFiles) {
        const loaded = await getFile(`licenses/customers/${file.name}`);
        customers.push(loaded.data);
    }

    state.customers = customers;
    state.plans = plansFile.data.plans || [];
    state.features = featuresFile.data.features || [];
    const now = Date.now();
    state.counts = {
        customers: state.customers.length,
        active: state.customers.filter((i) => i.status === 'active').length,
        suspended: state.customers.filter((i) => i.status === 'suspended').length,
        expiringSoon: state.customers.filter((i) => {
            const exp = new Date(i.expiresAt).getTime();
            return exp >= now && exp - now <= 1000 * 60 * 60 * 24 * 30;
        }).length
    };
    renderAll();
}

async function testGithubConnection() {
    if (!state.ghOwner || !state.ghRepo || !state.ghBranch || !state.ghToken) {
        setGithubStatus('بيانات GitHub غير مكتملة', 'fail');
        throw new Error('Please fill owner/repo/branch/token first');
    }

    setGithubStatus('جاري فحص الاتصال...', 'neutral');
    try {
        const repoInfo = await githubApi(`/repos/${state.ghOwner}/${state.ghRepo}`);
        await githubApi(`${repoPath('plans/plans.json')}?ref=${encodeURIComponent(state.ghBranch)}`);
        setGithubStatus(`متصل بنجاح (${repoInfo.full_name})`, 'ok');
        return true;
    } catch (error) {
        const text = String(error.message || '');
        let friendly = text;
        if (/401|403|Bad credentials|Resource not accessible/i.test(text)) {
            friendly = 'Token غير صالح أو لا يملك صلاحية Contents write';
        } else if (/404/i.test(text)) {
            friendly = 'الريبو أو البرانش أو مسار الملفات غير موجود';
        }
        setGithubStatus(friendly, 'fail');
        throw error;
    }
}

async function validateRequiredPaths() {
    if (!state.ghOwner || !state.ghRepo || !state.ghBranch || !state.ghToken) {
        throw new Error('Please fill owner/repo/branch/token first');
    }

    const checks = [
        { name: 'licenses/customers', path: 'licenses/customers' },
        { name: 'plans/plans.json', path: 'plans/plans.json' },
        { name: 'features/catalog.json', path: 'features/catalog.json' }
    ];

    const results = [];
    for (const item of checks) {
        try {
            await githubApi(`${repoPath(item.path)}?ref=${encodeURIComponent(state.ghBranch)}`);
            results.push({ ...item, ok: true });
        } catch (error) {
            results.push({ ...item, ok: false, reason: error.message });
        }
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
        const summary = failed.map((f) => `${f.name}: ${f.reason}`).join(' | ');
        throw new Error(`Missing/invalid required paths -> ${summary}`);
    }

    return results;
}

function defaultFeatureCatalog() {
    return {
        features: [
            { code: 'SEND_TEXT', name: 'Send Text Messages' },
            { code: 'SEND_PDF', name: 'Send PDF Files' },
            { code: 'SEND_IMAGE', name: 'Send Images' },
            { code: 'SEND_BULK', name: 'Bulk Sending' },
            { code: 'CHATBOT', name: 'Chatbot' },
            { code: 'REPORTS', name: 'Reports' }
        ]
    };
}

function defaultPlans() {
    return {
        plans: [
            {
                code: 'basic',
                messagesLimit: 5000,
                features: ['SEND_TEXT', 'SEND_PDF', 'REPORTS']
            },
            {
                code: 'pro',
                messagesLimit: 25000,
                features: ['SEND_TEXT', 'SEND_PDF', 'SEND_IMAGE', 'SEND_BULK', 'CHATBOT', 'REPORTS']
            }
        ]
    };
}

async function autoFixRequiredPaths() {
    if (!state.ghOwner || !state.ghRepo || !state.ghBranch || !state.ghToken) {
        throw new Error('Please fill owner/repo/branch/token first');
    }

    const actions = [];

    try {
        await githubApi(`${repoPath('plans/plans.json')}?ref=${encodeURIComponent(state.ghBranch)}`);
    } catch (_) {
        await putFile('plans/plans.json', defaultPlans(), 'Initialize plans/plans.json');
        actions.push('Created plans/plans.json');
    }

    try {
        await githubApi(`${repoPath('features/catalog.json')}?ref=${encodeURIComponent(state.ghBranch)}`);
    } catch (_) {
        await putFile('features/catalog.json', defaultFeatureCatalog(), 'Initialize features/catalog.json');
        actions.push('Created features/catalog.json');
    }

    // Folder-only path cannot be created directly on GitHub; validate existence.
    try {
        await githubApi(`${repoPath('licenses/customers')}?ref=${encodeURIComponent(state.ghBranch)}`);
    } catch (_) {
        throw new Error('Folder licenses/customers is missing. Create it once in repository and retry.');
    }

    return actions;
}

async function createFirstSampleCustomer() {
    await validateRequiredPaths();
    const sampleCode = 'SB-FIRST-001';
    const filePath = `licenses/customers/${sampleCode}.json`;

    try {
        await githubApi(`${repoPath(filePath)}?ref=${encodeURIComponent(state.ghBranch)}`);
        return {
            created: false,
            customerCode: sampleCode,
            activationCode: `ACT-${sampleCode}-2026`,
            licenseKey: `LIC-${sampleCode}`
        };
    } catch (_) {
        // file not found -> create it
    }

    const plansFile = await getFile('plans/plans.json');
    const featuresFile = await getFile('features/catalog.json');
    const proPlan = (plansFile.data.plans || []).find((p) => p.code === 'pro')
        || (plansFile.data.plans || [])[0]
        || { code: 'basic', messagesLimit: 5000, features: [] };

    const featureSet = new Set(proPlan.features || []);
    for (const f of (featuresFile.data.features || [])) {
        if (f.code === 'SEND_TEXT') featureSet.add('SEND_TEXT');
    }

    const customer = {
        customerId: Math.max(0, ...state.customers.map((c) => c.customerId || 0)) + 1,
        customerCode: sampleCode,
        activationCode: `ACT-${sampleCode}-2026`,
        plan: proPlan.code,
        status: 'active',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        license: {
            licenseKey: `LIC-${sampleCode}`,
            messagesLimit: Number(proPlan.messagesLimit || 5000),
            messagesUsed: 0
        },
        features: Object.fromEntries((featuresFile.data.features || []).map((f) => [f.code, featureSet.has(f.code)]))
    };

    await putFile(filePath, customer, `Create first sample customer ${sampleCode}`);
    addActivityLocal('sample_customer_created', `Created sample customer ${sampleCode}`);
    return {
        created: true,
        customerCode: sampleCode,
        activationCode: customer.activationCode,
        licenseKey: customer.license.licenseKey
    };
}

function customerFormTemplate(customer = null) {
    const enabled = customer
        ? Object.entries(customer.features || {}).filter(([, v]) => v).map(([k]) => k)
        : [];
    return `
        <form class="grid-form drawer-customer-form" data-customer="${customer?.customerCode || ''}">
            <label>Customer Code<input name="customerCode" value="${customer?.customerCode || ''}" ${customer ? 'disabled' : ''} required /></label>
            <label>Plan
                <select name="plan">
                    ${state.plans.map((plan) => `<option value="${plan.code}" ${customer?.plan === plan.code ? 'selected' : ''}>${plan.code}</option>`).join('')}
                </select>
            </label>
            <label>Status
                <select name="status">
                    ${['active', 'suspended', 'expired'].map((status) => `<option value="${status}" ${customer?.status === status ? 'selected' : ''}>${status}</option>`).join('')}
                </select>
            </label>
            <label>Expires At<input name="expiresAt" type="date" value="${(customer?.expiresAt || '').slice(0, 10)}" /></label>
            <label>Activation Code<input name="activationCode" value="${customer?.activationCode || ''}" /></label>
            <label>License Key<input name="licenseKey" value="${customer?.license?.licenseKey || ''}" /></label>
            <label>Messages Limit<input name="messagesLimit" type="number" value="${customer?.license?.messagesLimit ?? 0}" /></label>
            <label>Features (comma-separated codes)<input name="featureCodes" value="${enabled.join(',')}" /></label>
            <button class="btn btn-primary" type="submit">${customer ? 'Save customer' : 'Create customer'}</button>
        </form>
    `;
}

function licenseFormTemplate(customer) {
    return `
        <form class="grid-form drawer-license-form" data-code="${customer.customerCode}">
            <label>Status
                <select name="status">
                    ${['active', 'suspended', 'expired'].map((status) => `<option value="${status}" ${customer.status === status ? 'selected' : ''}>${status}</option>`).join('')}
                </select>
            </label>
            <label>Expires At<input type="date" name="expiresAt" value="${customer.expiresAt.slice(0, 10)}" /></label>
            <label>Messages Limit<input type="number" name="messagesLimit" value="${customer.license.messagesLimit}" /></label>
            <label>Messages Used<input type="number" name="messagesUsed" value="${customer.license.messagesUsed}" /></label>
            <button class="btn btn-primary" type="submit">Save License</button>
        </form>
    `;
}

function planFormTemplate(plan = null) {
    return `
        <form class="grid-form drawer-plan-form" data-plan="${plan?.code || ''}">
            <label>Code<input name="code" ${plan ? 'disabled' : ''} value="${plan?.code || ''}" required /></label>
            <label>Messages Limit<input type="number" name="messagesLimit" value="${plan?.messagesLimit ?? 0}" /></label>
            <label>Features (comma-separated)<input name="features" value="${(plan?.features || []).join(',')}" /></label>
            <button class="btn btn-primary" type="submit">${plan ? 'Save plan' : 'Create plan'}</button>
        </form>
    `;
}

function featureFormTemplate() {
    return `
        <form class="grid-form drawer-feature-form">
            <label>Feature Code<input name="code" required placeholder="NEW_FEATURE" /></label>
            <label>Feature Name<input name="name" required placeholder="Readable name" /></label>
            <button class="btn btn-primary" type="submit">Add feature</button>
        </form>
    `;
}

function openDrawer(title, bodyHtml) {
    nodes.drawerTitle.textContent = title;
    nodes.drawerBody.innerHTML = bodyHtml;
    nodes.drawer.classList.add('open');
}

function closeDrawer() {
    nodes.drawer.classList.remove('open');
    nodes.drawerBody.innerHTML = '';
}

function openDrawerFromKey(key) {
    if (key === 'customer:new') {
        openDrawer('Create Customer', customerFormTemplate(null));
        return;
    }
    if (key === 'feature:new') {
        openDrawer('Add Feature', featureFormTemplate());
        return;
    }
    if (key === 'plan:new') {
        openDrawer('Create Plan', planFormTemplate(null));
        return;
    }
    if (key.startsWith('customer:edit:')) {
        const customerCode = key.split(':')[2];
        const customer = state.customers.find((item) => item.customerCode === customerCode);
        if (customer) openDrawer(`Edit ${customerCode}`, customerFormTemplate(customer));
        return;
    }
    if (key.startsWith('license:edit:')) {
        const customerCode = key.split(':')[2];
        const customer = state.customers.find((item) => item.customerCode === customerCode);
        if (customer) openDrawer(`License ${customerCode}`, licenseFormTemplate(customer));
        return;
    }
    if (key.startsWith('plan:edit:')) {
        const code = key.split(':')[2];
        const plan = state.plans.find((item) => item.code === code);
        if (plan) openDrawer(`Edit plan ${code}`, planFormTemplate(plan));
    }
}

function bindTabs() {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach((btn) => btn.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach((panel) => panel.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });
}

document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    try {
        if (form.id === 'configForm') {
            state.ghOwner = nodes.ghOwner.value.trim();
            state.ghRepo = nodes.ghRepo.value.trim();
            state.ghBranch = nodes.ghBranch.value.trim();
            state.ghToken = nodes.ghToken.value.trim();
            localStorage.setItem('sb_gh_owner', state.ghOwner);
            localStorage.setItem('sb_gh_repo', state.ghRepo);
            localStorage.setItem('sb_gh_branch', state.ghBranch);
            localStorage.setItem('sb_gh_token', state.ghToken);
            await testGithubConnection();
            await loadBootstrap();
            toast('Connected to GitHub successfully');
            return;
        }

        if (form.classList.contains('drawer-customer-form')) {
            const data = new FormData(form);
            const customerCode = String(data.get('customerCode') || '').trim();
            const body = {
                customerCode: normalizeCode(customerCode),
                plan: String(data.get('plan') || '').trim(),
                status: String(data.get('status') || '').trim(),
                expiresAt: data.get('expiresAt') ? new Date(`${data.get('expiresAt')}T00:00:00.000Z`).toISOString() : undefined,
                activationCode: String(data.get('activationCode') || '').trim(),
                licenseKey: String(data.get('licenseKey') || '').trim(),
                messagesLimit: Number(data.get('messagesLimit') || 0),
                featureCodes: featureCodesInput(data.get('featureCodes'))
            };
            if (form.dataset.customer) {
                const filePath = `licenses/customers/${normalizeCode(form.dataset.customer)}.json`;
                const current = await getFile(filePath);
                const merged = {
                    ...current.data,
                    ...body,
                    customerCode: normalizeCode(form.dataset.customer),
                    license: {
                        ...(current.data.license || {}),
                        licenseKey: body.licenseKey || current.data.license?.licenseKey || `LIC-${normalizeCode(form.dataset.customer)}`,
                        messagesLimit: body.messagesLimit,
                        messagesUsed: current.data.license?.messagesUsed || 0
                    },
                    features: Object.fromEntries(state.features.map((f) => [f.code, body.featureCodes.includes(f.code)]))
                };
                await putFile(filePath, merged, `Update customer ${normalizeCode(form.dataset.customer)}`);
                addActivityLocal('customer_updated', `Updated customer ${normalizeCode(form.dataset.customer)}`);
                toast('Customer updated');
            } else {
                const filePath = `licenses/customers/${body.customerCode}.json`;
                const plan = state.plans.find((p) => p.code === body.plan);
                const customer = {
                    customerId: Math.max(0, ...state.customers.map((c) => c.customerId || 0)) + 1,
                    customerCode: body.customerCode,
                    activationCode: body.activationCode || `ACT-${body.customerCode}-${new Date().getFullYear()}`,
                    plan: body.plan,
                    status: body.status || 'active',
                    expiresAt: body.expiresAt || new Date(Date.now() + 31536000000).toISOString(),
                    license: {
                        licenseKey: body.licenseKey || `LIC-${body.customerCode}`,
                        messagesLimit: Number(body.messagesLimit || plan?.messagesLimit || 0),
                        messagesUsed: 0
                    },
                    features: Object.fromEntries(state.features.map((f) => [f.code, body.featureCodes.includes(f.code)]))
                };
                await putFile(filePath, customer, `Create customer ${body.customerCode}`);
                addActivityLocal('customer_created', `Created customer ${body.customerCode}`);
                toast('Customer created');
            }
            closeDrawer();
            await loadBootstrap();
            return;
        }

        if (form.classList.contains('drawer-license-form')) {
            const data = new FormData(form);
            const code = form.dataset.code;
            const filePath = `licenses/customers/${normalizeCode(code)}.json`;
            const current = await getFile(filePath);
            current.data.status = String(data.get('status') || current.data.status || 'active');
            current.data.expiresAt = new Date(`${data.get('expiresAt')}T00:00:00.000Z`).toISOString();
            current.data.license = current.data.license || {};
            current.data.license.messagesLimit = Number(data.get('messagesLimit') || 0);
            current.data.license.messagesUsed = Number(data.get('messagesUsed') || 0);
            await putFile(filePath, current.data, `Update license ${normalizeCode(code)}`);
            addActivityLocal('license_updated', `Updated license ${normalizeCode(code)}`);
            toast('License updated');
            closeDrawer();
            await loadBootstrap();
            return;
        }

        if (form.classList.contains('drawer-feature-form')) {
            const data = new FormData(form);
            const file = await getFile('features/catalog.json');
            const code = normalizeCode(data.get('code'));
            const name = String(data.get('name') || '').trim();
            if (file.data.features.some((item) => item.code === code)) {
                throw new Error('Feature already exists');
            }
            file.data.features.push({ code, name });
            await putFile('features/catalog.json', file.data, `Create feature ${code}`);
            addActivityLocal('feature_created', `Added feature ${code}`);
            toast('Feature added');
            closeDrawer();
            await loadBootstrap();
            return;
        }

        if (form.classList.contains('drawer-plan-form')) {
            const data = new FormData(form);
            const code = form.dataset.plan;
            const body = {
                code: String(data.get('code') || '').trim().toLowerCase(),
                messagesLimit: Number(data.get('messagesLimit') || 0),
                features: featureCodesInput(data.get('features'))
            };
            const file = await getFile('plans/plans.json');
            if (code) {
                const idx = file.data.plans.findIndex((p) => p.code === code);
                if (idx === -1) throw new Error('Plan not found');
                file.data.plans[idx] = { ...file.data.plans[idx], ...body, code };
                await putFile('plans/plans.json', file.data, `Update plan ${code}`);
                addActivityLocal('plan_updated', `Updated plan ${code}`);
                toast('Plan updated');
            } else {
                if (file.data.plans.some((p) => p.code === body.code)) {
                    throw new Error('Plan already exists');
                }
                file.data.plans.push(body);
                await putFile('plans/plans.json', file.data, `Create plan ${body.code}`);
                addActivityLocal('plan_created', `Created plan ${body.code}`);
                toast('Plan created');
            }
            closeDrawer();
            await loadBootstrap();
        }
    } catch (error) {
        toast(error.message, true);
    }
});

document.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    try {
        if (target.dataset.openDrawer) {
            openDrawerFromKey(target.dataset.openDrawer);
            return;
        }
        if (target.dataset.delete) {
            const customerCode = target.dataset.delete;
            if (!confirm(`Delete ${customerCode}?`)) return;
            await deleteFile(`licenses/customers/${normalizeCode(customerCode)}.json`, `Delete customer ${normalizeCode(customerCode)}`);
            addActivityLocal('customer_deleted', `Deleted customer ${normalizeCode(customerCode)}`);
            toast('Customer deleted');
            await loadBootstrap();
            return;
        }
        if (target.dataset.licenseAction) {
            const [customerCode, action] = target.dataset.licenseAction.split(':');
            const filePath = `licenses/customers/${normalizeCode(customerCode)}.json`;
            const current = await getFile(filePath);
            if (action === 'activate') current.data.status = 'active';
            if (action === 'suspend') current.data.status = 'suspended';
            if (action === 'extend30') {
                const base = new Date(current.data.expiresAt).getTime() || Date.now();
                current.data.expiresAt = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString();
            }
            await putFile(filePath, current.data, `License action ${action} for ${normalizeCode(customerCode)}`);
            addActivityLocal('license_action', `Applied ${action} to ${normalizeCode(customerCode)}`);
            toast('License action applied');
            await loadBootstrap();
            return;
        }
        if (target.dataset.toggleFeature) {
            const [customerCode, featureCode] = target.dataset.toggleFeature.split(':');
            const filePath = `licenses/customers/${normalizeCode(customerCode)}.json`;
            const current = await getFile(filePath);
            current.data.features = current.data.features || {};
            current.data.features[featureCode] = !Boolean(current.data.features[featureCode]);
            await putFile(filePath, current.data, `Toggle feature ${featureCode} for ${normalizeCode(customerCode)}`);
            addActivityLocal('feature_toggled', `Set ${featureCode} for ${normalizeCode(customerCode)}`);
            toast('Feature toggled');
            await loadBootstrap();
            return;
        }
        if (target.dataset.deletePlan) {
            const code = target.dataset.deletePlan;
            if (!confirm(`Delete plan ${code}?`)) return;
            const file = await getFile('plans/plans.json');
            file.data.plans = file.data.plans.filter((p) => p.code !== code);
            await putFile('plans/plans.json', file.data, `Delete plan ${code}`);
            addActivityLocal('plan_deleted', `Deleted plan ${code}`);
            toast('Plan deleted');
            await loadBootstrap();
        }
    } catch (error) {
        toast(error.message, true);
    }
});

document.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === 'customerSearch') {
        renderCustomerRows(target.value);
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nodes.drawer.classList.contains('open')) {
        closeDrawer();
    }
});

nodes.drawerBackdrop.addEventListener('click', closeDrawer);
nodes.drawerCloseBtn.addEventListener('click', closeDrawer);

nodes.refreshBtn.addEventListener('click', async () => {
    try {
        await loadBootstrap();
        toast('Data refreshed');
    } catch (error) {
        toast(error.message, true);
    }
});

nodes.testGithubBtn.addEventListener('click', async () => {
    try {
        state.ghOwner = nodes.ghOwner.value.trim();
        state.ghRepo = nodes.ghRepo.value.trim();
        state.ghBranch = nodes.ghBranch.value.trim();
        state.ghToken = nodes.ghToken.value.trim();
        await testGithubConnection();
        toast('GitHub connection is healthy');
    } catch (error) {
        toast(error.message, true);
    }
});

nodes.validatePathsBtn.addEventListener('click', async () => {
    try {
        state.ghOwner = nodes.ghOwner.value.trim();
        state.ghRepo = nodes.ghRepo.value.trim();
        state.ghBranch = nodes.ghBranch.value.trim();
        state.ghToken = nodes.ghToken.value.trim();
        const checks = await validateRequiredPaths();
        setGithubStatus('Required paths are valid', 'ok');
        toast(`Validated ${checks.length} required paths`);
    } catch (error) {
        setGithubStatus(error.message, 'fail');
        toast(error.message, true);
    }
});

nodes.autoFixPathsBtn.addEventListener('click', async () => {
    try {
        state.ghOwner = nodes.ghOwner.value.trim();
        state.ghRepo = nodes.ghRepo.value.trim();
        state.ghBranch = nodes.ghBranch.value.trim();
        state.ghToken = nodes.ghToken.value.trim();
        const actions = await autoFixRequiredPaths();
        const checks = await validateRequiredPaths();
        setGithubStatus('Required paths fixed/validated successfully', 'ok');
        toast(actions.length ? actions.join(' | ') : `No fixes needed, validated ${checks.length} paths`);
    } catch (error) {
        setGithubStatus(error.message, 'fail');
        toast(error.message, true);
    }
});

nodes.createSampleCustomerBtn.addEventListener('click', async () => {
    try {
        state.ghOwner = nodes.ghOwner.value.trim();
        state.ghRepo = nodes.ghRepo.value.trim();
        state.ghBranch = nodes.ghBranch.value.trim();
        state.ghToken = nodes.ghToken.value.trim();

        const result = await createFirstSampleCustomer();
        await loadBootstrap();
        setLastActivationData({
            customerCode: result.customerCode,
            activationCode: result.activationCode,
            licenseKey: result.licenseKey
        });
        setGithubStatus('Sample customer is ready', 'ok');
        if (result.created) {
            toast(`Sample created: ${result.customerCode} | Activation: ${result.activationCode} | License: ${result.licenseKey}`);
        } else {
            toast(`Sample already exists: ${result.customerCode}`);
        }
    } catch (error) {
        setGithubStatus(error.message, 'fail');
        toast(error.message, true);
    }
});

nodes.copyActivationBtn.addEventListener('click', async () => {
    try {
        const data = state.lastActivationData;
        if (!data) {
            throw new Error('No activation data available yet. Create sample customer first.');
        }
        const text = [
            `customerCode=${data.customerCode}`,
            `activationCode=${data.activationCode}`,
            `licenseKey=${data.licenseKey}`
        ].join('\n');
        await navigator.clipboard.writeText(text);
        toast('Activation data copied to clipboard');
    } catch (error) {
        toast(error.message, true);
    }
});

bindTabs();
if (state.ghToken) {
    loadBootstrap().catch((error) => toast(error.message, true));
    testGithubConnection().catch(() => {});
} else {
    setGithubStatus('غير متصل - أدخل إعدادات GitHub', 'neutral');
}
