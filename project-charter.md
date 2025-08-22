# Chckmte — Project Charter

This document provides the definitive technical specification and project plan for Chckmte. It incorporates and refines the concepts from the original `project-proposal.md`.

---

## 1. Updates from Initial Proposal
The primary architectural change from the initial proposal is the consolidation of the frontend SPA and backend API into a **single, unified full-stack application**.

- **Original Plan:** A separate React SPA (`apps/web`) and Cloudflare Worker (`apps/api`).
- **Revised Plan:** A single Vite project that handles both client and server code, leveraging the `@cloudflare/vite-plugin`. This simplifies the development environment, build process, and deployment target. The entire application will be deployed as a single unit to Cloudflare Pages.

---

## 2. Executive Summary
Chckmte is a stateless browser app for controlled, auditable spreadsheet "check-ins." It uses a provider-agnostic architecture to connect to a user's cloud storage, starting with Microsoft OneDrive/SharePoint. The entire application is a unified full-stack project deployed to Cloudflare Pages, with all configuration stored directly within the spreadsheet itself.

---

## 3. Core Architecture
- **Model:** A single, unified full-stack application.
- **Framework:** Vite with `@cloudflare/vite-plugin`.
- **Frontend:** React SPA (TypeScript, Vite, Tailwind CSS).
- **Backend:** Cloudflare Worker API, colocated within the same Vite project.
- **Hosting:** Deployed monolithically to Cloudflare Pages.
- **State:** The API is stateless. No database is used. Session state is managed via an encrypted refresh-token cookie.

### 3.1. Technical Architecture & Request Flow
From an engineering perspective, the unified Vite setup provides a streamlined request lifecycle for both local development and production.

-   **Development:**
    1.  The user interacts with the React SPA in the browser. The Vite dev server provides Hot Module Replacement (HMR) for the frontend code.
    2.  When the SPA makes an API call (e.g., to `/api/checkin`), the request is intercepted by the `@cloudflare/vite-plugin`.
    3.  The plugin forwards the request to the backend Worker code (e.g., `src/worker.ts`), which runs in a local `workerd` process that accurately simulates the Cloudflare environment. HMR is also active for this backend code.
    4.  The Worker handler executes its logic (e.g., calling the external Microsoft Graph API).
    5.  The response is returned through the same path to the SPA.

-   **Production (on Cloudflare Pages):**
    1.  The `vite build` command compiles the React SPA into static assets and the Worker code into a single `_worker.js` file.
    2.  Cloudflare Pages serves the static assets from its edge network.
    3.  Any request that does not match a static asset is automatically routed to the `_worker.js` function, which handles all dynamic API logic.

---

## 4. User Workflow (Frontend)
1.  **Sign-In:** User signs into their Microsoft account. The backend handles the OAuth 2.0 callback, sets an encrypted session cookie, and redirects to the SPA.
2.  **File Selection:** The user selects an Excel file from their OneDrive or a connected SharePoint site.
3.  **Configuration:**
    - If a `_chckmte_config` worksheet is found, the user is prompted to either use the existing configuration or define a new one.
    - If no configuration is found, the user is guided through mapping the required columns (e.g., ID, First Name, Check-in Timestamp).
4.  **Check-in:** The user enters or scans an ID. The app displays the corresponding name for verification.
5.  **Confirmation:** Upon confirmation, a request is sent to the backend, which generates a server-side timestamp and writes it to the appropriate cell in the spreadsheet.
6.  **Feedback:** The UI shows a success message. Any warnings (e.g., header drift) are surfaced to the user.
*Client-side state is kept in memory and is intentionally lost on refresh.*

---

## 5. Authentication & Security
- **Provider:** Microsoft OAuth 2.0 (Authorization Code flow with PKCE).
- **Session Cookie:** An encrypted, `httpOnly`, `Secure`, `SameSite=Lax` refresh-token cookie (AES-GCM) maintains the session. The encryption key is a Worker secret.
- **Microsoft Graph Scopes:** `User.Read`, `Files.ReadWrite`, `offline_access`.
- **CORS:** The backend will be configured to allow requests only from the application's own origin.
- **CSRF:** Protection is provided by the OAuth `state` parameter and the `SameSite=Lax` cookie policy.
- **Input Validation:** All API inputs (ID fields, file IDs) will be strictly sanitized and validated. Configuration JSON will be validated against a Zod schema.

---

## 6. Spreadsheet Integration (Microsoft Graph)
- **Concurrency:** Workbook sessions (`workbook-session-id`) will be used for all write operations to ensure data consistency.
- **Row Targeting:** Rows are identified at runtime by searching for a unique ID value in the user-mapped ID column. This is resilient to sorting, filtering, and row insertions/deletions.
- **In-File Configuration:**
    - **Storage:** Config is stored as a JSON string in cell `A1` of a hidden worksheet named `_chckmte_config`.
    - **Integrity:** The config schema will be versioned. Both header names and cell addresses are stored to detect drift.
- **Timestamps:** Timestamps are generated server-side in ISO 8601 format (UTC) and written as text to avoid Excel date/time formatting issues.

### 6.1. Provider-Agnostic Design
A core architectural principle is to keep the application logic decoupled from any specific spreadsheet provider. This is accomplished by introducing a **provider translation layer**.

- **Goal:** Enable future integration of additional providers (such as Google Sheets) without requiring changes to the core business logic.
- **Implementation:** All spreadsheet operations (e.g., `findRowById`, `writeTimestamp`) are routed through a standardized internal interface. A provider-specific **translator** is responsible for converting these standardized calls into the appropriate API requests for its provider (e.g., Microsoft Graph API calls).
- **Initial Scope:** The first implementation will focus exclusively on the Microsoft Graph translator.

---

## 7. Development Workflow
- **Package Manager:** `pnpm` with workspaces.
- **Local Development:** A single `vite dev` command launches the full stack with hot-reloading for both frontend and backend.
- **Code Quality:** Enforced with TypeScript, ESLint, and Prettier, managed via Husky pre-commit hooks.

---

## 8. Deployment & Operations
- **Target Platform:** Cloudflare Pages.
- **Process:** Automated deployments will be triggered by pushes to the main git branch.
- **Environment Variables:** Secrets (`MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `ENCRYPTION_KEY`, `APP_ORIGIN`) will be managed as secrets in the Cloudflare dashboard.
- **Tooling:** This project will leverage MCP server tools within the Cursor IDE to enable direct, secure interaction with Cloudflare for deployment and management tasks.

---

## 9. Future Roadmap
- **Google Sheets Support:** Add a parallel provider for Google Sheets, implementing a shared provider interface.
- **Accessibility & UX:** Introduce keyboard-first navigation and Text-to-Speech (TTS) for scanned names.
- **Undo Functionality:** Implement a session-based single-step undo feature.
- **Audit Trail:** Provide an option to export a session's check-in history as a CSV file.
