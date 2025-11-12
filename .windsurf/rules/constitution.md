---
trigger: always_on
---

### **Solanafied Agent Constitution**

This constitution governs all modifications to the Solanafied repository. Adhere to these rules to ensure clarity, consistency, and alignment with the project's goals.

#### **Essential Rules: DO**

*   **Treat the Canon as Truth**: The versioned `README.md` and `database_structure.txt` are the project canon. They are the sole source of truth for architecture, features, and data shapes. The canon wins on any conflict.
*   **Validate All Boundaries**: Enforce strict, schema-based validation at every interface: API requests/responses, database interactions, and user inputs.
*   **Work Deterministically**: Ensure all changes are reproducible. Pin dependency versions specified in `index.html` and `package-lock.json`. Handle asynchronous operations with explicit, predictable patterns like polling or subscriptions.
*   **Define Done Rigorously**: A task is "Done" only when it conforms to the canon, implements the required logic from the plan, and provides the specified user feedback (especially for long-running processes).

#### **Essential Rules: DON’T**

*   **Don't Invent Surfaces**: Do not add, remove, or change UI elements, data fields, or API endpoints not specified in the plan.
*   **Don't Create Parallel Patterns**: Do not introduce new ways to fetch data, manage state, or handle API calls. Use the established layers (`database.js`, `orchestrator.js`).
*   **Don't Use Magic**: Avoid opaque mechanisms. Prefer explicit polling (`setInterval`) or Supabase subscriptions for state updates over hidden or implicit data binding. All control flow must be traceable.
*   **Don't Change Contracts First**: Update the canon (`database_structure.txt`, `orchestrator.js` function signatures) *before* implementing logic that depends on the new contract.

### **Project-Specific Directives**

#### **Architecture & Data Model**

*   **Embrace the Two-Wallet System**: All logic and UI must reflect the new model.
    *   The `Distributor Wallet` is the user-facing wallet for funding.
    *   The `Dev Wallet` is the internal, asynchronously-created wallet for token operations.
*   **Respect Layer Separation**:
    *   `script.js`: Manage UI, state, and user interaction flows.
    *   `orchestrator.js`: Handle all communication with the external orchestrator API. No direct `fetch` calls elsewhere.
    *   `database.js`: Manage all direct communication with the Supabase database.
*   **Update the Database Schema**: Modify `database_structure.txt` to reflect the new `users` table structure with `distributor_*` and `dev_*` columns.
*   **Refactor Data Functions**:
    *   Remove `upsertUser`. User creation is now a backend-only concern.
    *   Implement specific balance update functions (`updateUserDistributorBalances`, `updateUserDevBalances`).
    *   Update all data access to use the new column names (e.g., `distributor_public_key`).

#### **User Experience & Asynchronous Flow**

*   **Communicate Long-Running Processes**: Provide clear, non-blocking, and persistent UI feedback for operations that take minutes.
    *   **Dev Wallet Creation**: After creating the Distributor Wallet, display a status indicator on the dashboard: "Preparing developer wallet... (Est. 2 minutes)".
    *   **Bundler Creation**: Use a detailed progress modal indicating that the process is long and sequential. Simulate progress to prevent users from assuming the application is frozen.
*   **Implement Explicit Readiness Checks**:
    *   Use a polling mechanism (`setInterval`) to check the database for the `dev_public_key` to determine when the Dev Wallet is ready.
    *   Prevent users from initiating token creation until the `dev_public_key` is present.
*   **Update All UI Terminology**: Replace all instances of "In-App Wallet" with "Distributor Wallet" or "Funding Wallet" in `index.html` and `script.js`.

#### **API Contracts & Error Handling**

*   **Use Extended Timeouts**: For long-running operations like `createBundler`, use a dynamically calculated, extended timeout in `makeOrchestratorRequest`.
*   **Handle Specific Errors**: Implement explicit error handling in `createAndBuyToken` for the `DEV_WALLET_NOT_READY` error code, displaying a user-friendly message.
*   **Align API Responses**: Update the `createInAppWallet` function in `orchestrator.js` to correctly handle and return the `distributor_public_key`.

#### **Implementation & Style**

*   **Maintain Vanilla Stack**: Implement all features using Vanilla JavaScript, HTML5, and CSS3. Do not introduce new frameworks or large libraries.
*   **Preserve Accessibility**: Ensure all new UI components and changes maintain WCAG AA compliance.
*   **Reuse Utilities**: Use existing utility functions from `database.js` for formatting and truncation to maintain consistency.