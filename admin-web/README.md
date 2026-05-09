# SoftwareBank Admin Web (GitHub-only mode)

Mobile-first control panel that writes directly to GitHub using GitHub Contents API.

## 1) Requirements

- GitHub repository containing:
  - `licenses/customers/*.json`
  - `plans/plans.json`
  - `features/catalog.json`
- Fine-grained PAT with repository contents write access.

## 2) Run Admin Web

From repository root (`SoftwareBankWhatsAppservice`) so assets paths resolve:

```bash
npx serve . -l 5500
```

Open:
- `http://localhost:5500/admin-web/`

## 3) Dashboard configuration fields

Inside the dashboard fill:
- **GitHub Owner**: e.g. `softwarebanknew-png`
- **Repository Name**: e.g. `SoftwareBankWhatsAppservice`
- **Branch**: e.g. `main`
- **GitHub Token**: PAT with write permission

Then click:
- **Test GitHub Connection**
- **Validate Required Paths**
- **Auto-Fix Required Paths**
- **Create First Sample Customer**
- **Copy Activation Data**

You will see a clear status message:
- success (connected)
- failure with probable reason (bad token / missing repo / wrong branch)

`Validate Required Paths` checks existence of:
- `licenses/customers`
- `plans/plans.json`
- `features/catalog.json`

`Auto-Fix Required Paths` can auto-create:
- `plans/plans.json` (default starter plans)
- `features/catalog.json` (default starter features)

Note: `licenses/customers` folder cannot be auto-created by GitHub API alone; if missing, create it once in repository.

`Create First Sample Customer` creates:
- `licenses/customers/SB-FIRST-001.json`
- with ready activation/license values for immediate client testing.

`Copy Activation Data` copies the latest sample activation details to clipboard:
- customerCode
- activationCode
- licenseKey

## 4) What happens on each action

Any create/update/delete action from UI directly commits file updates to GitHub via API:
- customers -> `licenses/customers/<code>.json`
- plans -> `plans/plans.json`
- features -> `features/catalog.json`

## Security note

- Token is stored in browser localStorage for convenience.
- Use this dashboard only for your own admin account/device.
- Rotate token periodically.
