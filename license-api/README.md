# SoftwareBank License API

Simple API layer between GitHub-controlled license files and client devices.

## Run

1. Copy `.env.example` to `.env`.
2. Install deps:
   - `npm install`
3. Start API:
   - `npm start`

## Endpoints

- `POST /v1/licenses/activate`
- `POST /v1/licenses/validate`
- `GET /v1/licenses/info?licenseKey=...`
- `POST /v1/licenses/usage`
- `GET /health`
