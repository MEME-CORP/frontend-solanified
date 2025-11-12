### **Plan: Frontend Integration for Two-Wallet System (Distributor + Dev)**

- **Scope**
  - Adapt the frontend to recognize and interact with the new two-wallet system: the user-facing `Distributor Wallet` and the internal `Dev Wallet`.
  - Update all UI text, data models, and API calls to replace the old "in-app wallet" concept with the "Distributor Wallet".
  - Implement robust UI/UX feedback to handle the new long-running processes, specifically the 2-minute delay in Dev Wallet creation and the multi-minute delays during bundler funding.
  - Ensure the user flow for creating wallets, funding, creating bundlers, and creating tokens is clear and provides appropriate guidance.

- **Implementation Sequence**
  - Update local documentation (`database_structure.txt`).
  - Modify the data layer (`database.js`) to use the new database schema.
  - Update the API service layer (`orchestrator.js`) to handle new API responses, errors, and long timeouts.
  - Refactor the core application logic (`script.js`) to manage the new state and user flows.
  - Update UI elements in `index.html` to reflect the new terminology and add necessary status indicators.

### **Database Schema Update**

- **File**: `database_structure.txt`
- **Description**: "Align the frontend's database documentation with the backend's new two-wallet schema for `users`."
- **Actions**:
  - In the `CREATE TABLE IF NOT EXISTS users` definition, rename the existing `in_app` wallet columns to represent the 'Distributor Wallet'.
    - `in_app_private_key` → `distributor_private_key`
    - `in_app_public_key` → `distributor_public_key`
    - `balance_sol` → `distributor_balance_sol`
    - `balance_spl` → `distributor_balance_spl`
  - Add new columns for the 'Dev Wallet'.
    - Add `dev_private_key` TEXT NULL
    - Add `dev_public_key` TEXT NULL
    - Add `dev_balance_sol` money9 NOT NULL DEFAULT 0
    - Add `dev_balance_spl` money9 NOT NULL DEFAULT 0

### **Frontend Data Layer Changes**

- **File**: `database.js`
- **Description**: "Update client-side data access functions to read from and write to the new two-wallet structure in the `users` table."
- **Tasks**:
  - **Task**: "Update `getUserByWalletId`"
    - **Actions**:
      - No changes to the function signature are needed, but all calling code must be updated to reference `data.distributor_public_key` instead of `data.in_app_public_key`, and `data.distributor_balance_sol` instead of `data.balance_sol`.
  - **Task**: "Update User Creation/Update Logic"
    - **Actions**:
      - Remove the `upsertUser` function, as user creation is now handled exclusively by the backend's `create-wallet-in-app` endpoint.
      - Create new specific balance update functions: `updateUserDistributorBalances(walletId, sol, spl)` and `updateUserDevBalances(walletId, sol, spl)`.
      - Refactor the existing `updateUserBalances` to call `updateUserDistributorBalances` to maintain backward compatibility where it's called, but plan to phase it out.
  - **Task**: "Update `getDashboardSummary`"
    - **Actions**:
      - Ensure this function correctly retrieves and displays the `distributor_balance_sol` and `distributor_balance_spl` as the main user balances. The Dev Wallet balance should be considered internal and not displayed to the user.

### **Frontend Service Layer Changes**

- **File**: `orchestrator.js`
- **Description**: "Adapt API service calls to handle new backend endpoints, responses, error conditions, and significantly longer timeouts for long-running processes."
- **Tasks**:
  - **Task**: "Update `createInAppWallet` function"
    - **Actions**:
      - Modify the function to correctly handle the response, which now contains `distributor_public_key`. The frontend should treat this as the primary in-app wallet address for the user to fund.
      - The function should return `{ distributorPublicKey: response.distributor_public_key }`.
  - **Task**: "Update `createBundler` function"
    - **Actions**:
      - The API request remains the same, but the operation now takes a very long time (1-2 minutes per mother wallet).
      - Increase the timeout in `makeOrchestratorRequest` specifically for this call. The timeout should be dynamic based on the `bundlerBalance`. A safe value would be `(bundlerBalance * 150000)` ms (2.5 minutes per wallet).
      - Modify the call in `script.js` to pass this extended timeout to `makeOrchestratorRequest`.
  - **Task**: "Update `createAndBuyToken` function"
    - **Actions**:
      - Modify the error handling to specifically catch the `DEV_WALLET_NOT_READY` error code from the backend.
      - If this error is caught, the function should throw a specific, user-friendly error (e.g., "Developer wallet is not ready. Please wait a minute and try again.") that the UI can display.
  - **Task**: "Update `verifyInAppBalance` function"
    - **Actions**:
      - No changes to the API call itself are needed, as the backend now correctly checks the Distributor Wallet balance.
      - Ensure the response, which contains `current_balance_sol` from the Distributor wallet, is handled correctly by the UI.

### **UI/UX and Core Logic Changes**

- **File**: `script.js` & `index.html`
- **Description**: "Overhaul the UI and user flow to provide clear feedback about the two-wallet system and manage user expectations during long-running backend processes."
- **Tasks**:
  - **Task**: "Update Wallet Creation and Registration Flow"
    - **Actions**:
      - In `index.html`, rename UI labels from "In-App Wallet" to a more descriptive term like "Funding Wallet" or "Distributor Wallet".
      - In `script.js`, within `handleCreateInAppWallet`, after a successful API call:
        - Immediately display the `distributorPublicKey` to the user as their main funding address.
        - Show a persistent, non-blocking status indicator on the dashboard (e.g., a small spinner with text) that says: "Preparing developer wallet... (Est. 2 minutes)".
        - Implement a polling mechanism (e.g., `setInterval`) that calls `DatabaseAPI.getUserByWalletId` every 20 seconds to check if `currentUser.dev_public_key` is populated. Once it is, remove the status indicator.
  - **Task**: "Implement Graceful Handling for Long Bundler Creation"
    - **Actions**:
      - In `script.js`, modify the `createBundler` function's UX.
      - Instead of a simple loading overlay, create a more detailed progress modal.
      - When the `createBundler` API call is initiated, show a modal that says: "Creating Bundler... This process is sequential and may take several minutes. Please do not close or refresh the page."
      - Add a simple progress indicator within the modal. Since the backend doesn't provide progress, simulate it. For a `bundler_balance` of `N`, you can display "Step 1 of N: Funding wallets...", and slowly update the progress bar over `N * 1.5` minutes. This provides crucial feedback and prevents the user from thinking the app is frozen.
  - **Task**: "Update Token Creation Flow"
    - **Actions**:
      - In `script.js`, within the `addToken` function (or wherever the token creation form is triggered):
        - Before showing the form, check if `currentUser.dev_public_key` is populated.
        - If it's `null`, show a snackbar message: "Your developer wallet is still being set up. Please wait a moment." and do not open the form.
      - In `handleTokenCreation`, add a `catch` block for the `createAndBuyToken` API call to handle the `DEV_WALLET_NOT_READY` error and display the appropriate message to the user.
  - **Task**: "Update All Data and UI References"
    - **Actions**:
      - Globally search and replace `in_app_public_key` with `distributor_public_key` for all UI display logic in `script.js` (e.g., in `updateWalletUI`, `copyInAppAddress`).
      - Update `updateBalanceDisplay` to show `currentUser.distributor_balance_sol` and `currentUser.distributor_balance_spl`. The Dev Wallet's balance is not user-facing and should not be displayed.
      - Ensure all functions that rely on user data (`currentUser`) are updated to use the new `distributor_*` field names.