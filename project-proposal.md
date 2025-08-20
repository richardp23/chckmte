## Chckmte — Project Proposal (Stateless Online Spreadsheet Check‑in)

### Executive summary
Chckmte is a browser app that helps operators perform controlled, auditable updates to a spreadsheet’s “check‑in” column. Users sign into their Microsoft account, select a file from OneDrive/SharePoint, map columns, and then perform check‑ins that write timestamps back to the sheet. The app is stateless: no database, no server‑side storage of spreadsheet data. Only sign‑in persists via a secure session mechanism.

---

### Final decisions
- Architecture: Thin stateless proxy ("Chckmte Proxy") + static SPA. No DB. Only provider sign‑in persists.
- Hosting:
  - SPA: React + Vite + Tailwind, hosted on Cloudflare Pages at `app.chckmte.com`.
  - API/BFF: Cloudflare Workers at `api.chckmte.com`.
- Auth and session persistence:
  - Microsoft OAuth 2.0 Authorization Code with PKCE.
  - Encrypted refresh‑token cookie (httpOnly, Secure, SameSite=Lax) stored in the browser; 4‑hour default lifetime (balances security with usability).
  - AES‑GCM encryption using a server secret stored as a Worker secret; rotate periodically.
- Spreadsheet providers:
  - Initial: Microsoft Graph Excel APIs (OneDrive/SharePoint).
  - Later: Google Sheets via the same provider interface.
- In‑file configuration storage:
  - Hidden worksheet `_chckmte_config` with a named range `ChckmteConfig`.
  - Single‑cell plain JSON in `A1` (supports optional base64 wrapper in the future).
- Target range model (writes):
  - Header‑based (sheet may not be a formal table). User maps each column by header name and header cell address; we store both and validate on load. If drift is detected (name vs cell mismatch), warn and allow remap.
  - If a formal table exists, we may optionally anchor to it for stability, but it is not required.
- Timestamp behavior:
  - Overwrite timestamp cell always (last‑write‑wins is acceptable).
  - Timestamp generated server‑side in ISO 8601 format (e.g., `2023-10-27T14:30:00-04:00` or `2023-10-27T18:30:00Z`). This is an unambiguous, international standard.
  - Write as text to avoid Excel re‑interpretation issues.
- Config detection UX:
  - If `ChckmteConfig` is found, prompt: "Use existing Chckmte config or define a new one?" Recommend using it when collaborating.

### Data validation
- **Input Sanitization & Validation**:
  - ID Fields: Trim whitespace, validate format/length (alphanumeric, max 50 chars), reject empty/invalid characters.
  - Configuration JSON: Use Zod for schema validation to ensure structure integrity.
  - Spreadsheet Data: Type checking (string/number), range validation, sanitization to prevent injection.
- **Content Security**:
  - XSS Prevention: Sanitize all user inputs before display using DOMPurify.
  - Injection Protection: Validate and escape inputs to prevent formula injection in Excel.
  - File Validation: Check file types, scan for malicious content, enforce size limits.
- **Business Logic Validation**:
  - ID Matching: Exact match validation with configurable case sensitivity.
  - Timestamp Format: Strict format validation (ISO 8601) before writing.
  - Cell Reference Validation: Verify Excel cell references are valid and within bounds.
- **Configuration Integrity**:
  - Schema Versioning: Include version numbers and migration logic for future compatibility.
  - Checksum Validation: Add CRC32 checksums to detect tampering.
  - Signature Validation: Optional cryptographic signing of config data for added security.

---

### Provider & permissions
- Microsoft Graph scopes (delegated): `User.Read`, `Files.ReadWrite`, `offline_access`.
- Tenancy: multi‑tenant supported (e.g., authorize against `common`), or single‑tenant if preferred.
- OneDrive/SharePoint support:
  - OneDrive: `me/drive/items/{itemId}`.
  - SharePoint/Teams: `sites/{siteId}/drives/{driveId}/items/{itemId}`.
  - Admin consent may be required in some orgs for SharePoint. Graph usage itself is free; users need their own Microsoft plans.

---

### Concurrency model (Microsoft Graph Excel)
- Sessions: Create a workbook session and pass `workbook-session-id` on subsequent calls.
- `persistChanges=true`: Writes in the session are committed to the workbook (not ephemeral). This improves consistency and performance without exclusive locks; Excel still allows coauthoring.
- Conflict handling:
  - The API identifies the target row by searching for the exact `idValue` in the mapped ID column immediately before writing (single resolve → write). This is resilient to sorting, insertions, or deletions.
  - We only write to the mapped timestamp cell on the matched row.
  - Optional: read-after-write verification to detect if the ID cell no longer matches `idValue`; if mismatch, surface a warning (no auto-undo).
  - Last‑write‑wins is acceptable for this column by design (we always overwrite).
  - Retry/backoff on HTTP 429/5xx; short retries if workbook is busy/locked.

Note: Microsoft Graph for Excel does not expose a stable per‑cell GUID/ID. Targeting is done by resolving the row at runtime (by `idValue`) and computing the cell address, or by addressing a Table column by name when a formal table exists. This avoids drift when rows are inserted, deleted, or sorted.

---

### In‑file config schema (plain JSON in `A1` of `_chckmte_config`)
Example keys (illustrative, not exhaustive):

```json
{
  "version": 1,
  "target": {
    "type": "headerRange",
    "sheetName": "Sheet1",
    "headerRow": 2
  },
  "mapping": {
    "id": { "headerName": "UID", "headerCell": "A1" },
    "firstName": { "headerName": "FIRST_NAME", "headerCell": "C1" },
    "lastName": { "headerName": "LAST_NAME", "headerCell": "B1" },
    "checkIn": { "headerName": "CHECK-IN", "headerCell": "D1" }
  },
  "timestamp": {
    "timezone": "America/New_York"
  }
}
```

Notes:
- Store both header name and header cell; validate on load; warn on drift.
- We match IDs exactly as present in the selected ID column (trim whitespace only).
- The `timestamp.timezone` key is a user preference for display; all timestamps are written to the sheet in ISO 8601 format.

---

### API surface (initial)
- `GET /auth/login` → start Microsoft sign‑in (PKCE).
- `GET /auth/callback` → handle OAuth callback; encrypt and set refresh‑token cookie; redirect to SPA.
- `GET /files` → list accessible files (Graph: OneDrive/SharePoint).
- `GET /sheets?fileId=...` → list sheets/preview headers.
- `GET /config?fileId=...` → read `ChckmteConfig` if present.
- `POST /config` → write/update config into `_chckmte_config`.
- `POST /preview` → preview N rows for mapping validation.
- `POST /checkin` → `{ fileId, idValue }` → Find row by `idValue`, write server‑generated timestamp to mapped column.

---

### Frontend (SPA)
- Tech: React + Vite + Tailwind.
- Flow:
  1) Sign into Microsoft → cookie set.
  2) Choose file → sheet.
  3) If config found → prompt to use or define new; else map columns and save config.
  4) Enter/scan ID → show name → Confirm → write timestamp (overwrite).
  5) Show success; surface drift warnings if header name/cell changed.
- State: kept only in memory; lost on refresh by design (config lives in the sheet).

---

### Security
- Encrypted refresh‑token cookie:
  - httpOnly; Secure; SameSite=Lax; Domain: `.chckmte.com`; Path: `/`; Max‑Age: 4 hours (14400 seconds).
  - AES‑GCM via Web Crypto; key stored as Worker secret; consider quarterly rotation.
  - On token refresh from Microsoft, rotate cookie contents.
- CORS: allow only `https://app.chckmte.com` (and localhost in dev). Enforce `Origin` checks.
- CSRF: OAuth `state` param; callbacks restricted to our domain; SameSite=Lax mitigates CSRF.

---

### Local development
- **Environment Setup**:
  - Frontend (React + Vite): `npm install` then `npm run dev` (serves on http://localhost:5173).
  - API (Cloudflare Workers): `npx wrangler dev` (serves on http://localhost:8787).
  - Microsoft app registration redirect URI: `http://localhost:8787/auth/callback`.
  - Dev cookies: no `Secure` flag; `Domain=localhost`.
- **Code Quality Gates**:
  - ESLint: `npm run lint` for code style.
  - Prettier: `npm run format` for consistent formatting.
  - TypeScript: `npm run type-check` for type validation.
  - Pre-commit Hooks: Husky with lint-staged to run checks before commits.
- **Testing Workflow**:
  - Unit Tests: `npm run test:unit` (Jest + React Testing Library).
  - Integration Tests: `npm run test:integration` (test API endpoints with mocked responses).
  - E2E Tests: `npm run test:e2e` (Playwright for user flows).
  - Coverage: `npm run test:coverage` to track test coverage.
- **Git Workflow**:
  - Feature branches from `develop`, PR reviews required, squash merges.
  - Semantic commit messages.

---

### Deployment (Cloudflare)
- SPA → Cloudflare Pages (`app.chckmte.com`):
  - Build: `npm run build` → `dist/`.
- API → Cloudflare Workers (`api.chckmte.com`):
  - `wrangler.toml` route for `api.chckmte.com/*`.
  - Secrets: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`, `ENCRYPTION_KEY`.
  - Node compatibility: not required for our plan; Workers web APIs (fetch, Web Crypto) suffice. Node shims available if needed per docs: [Workers Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/).
- DNS: `app` and `api` subdomains on `chckmte.com`.
- Cost: Pages/Workers typically $0 for small personal projects; scale‑based pricing if needed later. Microsoft Graph usage is free; users’ Microsoft plans apply.

---

### Alternatives and portability
- If not using Cloudflare: same design works on Vercel/Netlify/Deno Deploy with the encrypted refresh‑token cookie approach and standard `fetch`/Web Crypto.
- If we later need server‑side session storage: prefer Cloudflare Durable Objects over KV for strong consistency; or use a managed Redis. (Out of scope now.)

---

### Risks & mitigations
- Cookie size limits (~4 KB): If a provider returns an unusually long refresh token, fall back to a tiny server store (e.g., Durable Object) to keep tokens server‑side.
- Header drift / merged cells: We store both header name and cell; warn on drift; provide quick remap UI.
- Throttling/locks in Excel APIs: Implement exponential backoff on 429/5xx and quick retries for busy workbook operations.
- Cross‑tenant SharePoint access: Some orgs require admin consent; surface clear errors and guidance.

---

### Roadmap (future)
- Add Google Sheets provider with shared `SheetsProvider` interface.
- Speak names (TTS) and keyboard‑first optimizations for scanning.
- Optional single‑step undo in session.
- Optional Durable Object session store or Redis if we introduce multi‑region scaling.
- Exportable audit trail (kept in memory per session or written to a separate CSV as needed).

---

### Environment variables (API)
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `MS_TENANT_ID` (or `common` for multi‑tenant)
- `ENCRYPTION_KEY` (AES‑GCM secret; base64‑encoded)
- `APP_ORIGIN` (e.g., `https://app.chckmte.com`)

