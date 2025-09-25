# K6 Test Scripts for AdonisJS Lelang

Minimal k6 scripts to load-test an AdonisJS backend for Lelang:
- `src/register-and-approve.js`: register pembeli accounts and approve them as admin
- `src/bid.js`: place bids (`/pembeli/pengajuan-lelang`) using a pool of approved users

## Prerequisites
- Node.js and k6 installed
- AdonisJS backend running (no `/api` prefix assumed)
- Known admin account

## Common Environment Variables
- `BASE_URL` (required): e.g. `http://localhost:8000`
- `USER_PREFIX` (default: `k6buyer`)
- `USER_DOMAIN` (default: `example.com`)
- `USER_PASSWORD` (default: `Password123!`)
- `USER_EMAIL_SUFFIX`: suffix to keep emails unique across runs, e.g. `run1`

Use Windows PowerShell environment variable syntax.

---

## Register and Approve
Script: `src/register-and-approve.js`

Required env:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Optional env:
- `REGISTER_PATH` (default: `/pembeli/register`)
- `ADMIN_LOGIN_PATH` (default: `/auth/login`)
- `USER_PROFILE_PATH` (default: `/auth/profile`)
- `ADMIN_APPROVE_FMT` (default: `/admin/verifikasi-pembeli/{id}/approve`)
- `INCLUDE_NOREK` = `1` to include `nomor_rekening` field
- `COUNT` (default: `100`) and `START_INDEX` (default: `1`)
- `DEBUG` = `1` to print debug logs

Example (smoke 4 akun):
```powershell
$env:BASE_URL="http://localhost:8000"
$env:ADMIN_EMAIL="admin@lelang.com"
$env:ADMIN_PASSWORD="admin123"
$env:COUNT="4"
$env:START_INDEX="1"
$env:USER_EMAIL_SUFFIX="run1"
$env:DEBUG="1"

k6 run .\src\register-and-approve.js
```

Notes:
- Registration payload uses snake_case fields: `alamat_pembeli`, `telepon_pembeli`, optional `nomor_rekening`.
- Approval uses minimal proven request: `POST /admin/verifikasi-pembeli/{id}/approve` with empty body and only `Authorization` header.

---

## Bid (Pengajuan Lelang)
Script: `src/bid.js`

Required env:
- `LELANG_ID`: target lelang ID
- Ensure users exist and are approved. Use the same `USER_PREFIX`, `USER_DOMAIN`, and `USER_EMAIL_SUFFIX` as used during register.

Optional env:
- `USER_LOGIN_PATH` (default: `/auth/login`)
- `BID_PATH` (default: `/pembeli/pengajuan-lelang`)
- `USER_COUNT` (default: `100`) size of the user pool
- `TOTAL_BIDS` (default: `1000`) total bid requests to send
- `MIN_BID` (default: `10000`)
- `MAX_BID` (default: `100000`)
- `BID_STEP` (default: `250`) bid increments (script enforces multiple of this)
- `LOGIN_TIMEOUT` (default: `120s`)
- `REQ_TIMEOUT` (default: `30s`)

Smoke example (10 users, 50 bids):
```powershell
$env:BASE_URL="http://localhost:3333"
$env:LELANG_ID="1"

$env:USER_PREFIX="k6buyer"
$env:USER_DOMAIN="example.com"
$env:USER_PASSWORD="Password123!"
$env:USER_COUNT="10"
$env:USER_EMAIL_SUFFIX="run1"

$env:TOTAL_BIDS="50"
$env:MIN_BID="10000"
$env:MAX_BID="100000"
$env:BID_STEP="250"

$env:LOGIN_TIMEOUT="120s"
$env:REQ_TIMEOUT="30s"

k6 run .\src\bid.js
```

Full run example (10 users, 1000 bids):
```powershell
$env:USER_COUNT="10"
$env:TOTAL_BIDS="1000"

k6 run .\src\bid.js
```

---

## Tips
- Use `USER_EMAIL_SUFFIX` to avoid duplicate email errors across runs (e.g., `run2`, `run3`).
- If the DB/backend is under pressure, consider reducing concurrency or tuning the database.
- `src/bid.js` pre-logins users in `setup()` and caches tokens; it retries once on HTTP 401.
