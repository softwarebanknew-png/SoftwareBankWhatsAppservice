# SoftwareBank WhatsApp Service Control Repo

This folder is intended to be uploaded to a private GitHub repository.

## Purpose

- Keep all customer licenses under version control.
- Manage feature toggles from GitHub.
- Drive runtime behavior through `license-api`.

## Main Folders

- `licenses/customers`: one file per customer.
- `plans`: plan templates.
- `features`: feature catalog.
- `manifest`: control metadata.
- `license-api`: API consumed by client devices.

## Quick Flow

1. Edit customer JSON in `licenses/customers`.
2. Commit + push to GitHub.
3. Run/redeploy `license-api`.
4. Client validates license and syncs features.

## Batch Test on GitHub

- Batch script: `scripts/license-batch-report.js`
- Workflow: `.github/workflows/license-batch-report.yml`
- Generated reports:
  - `reports/license-batch-report.json`
  - `reports/license-batch-report.html`
