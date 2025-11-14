/**
 * SOLANAFIED - MAIN APPLICATION LOGIC
 * 
 * This file contains the core functionality for the Solanafied dApp including:
 * - Solana wallet connection (Phantom, Solflare, etc.)
 * - UI state management
 * - Data fetching and display
 * - User interactions
 */

// ========== GLOBAL STATE ==========

let currentWallet = null;
let currentUser = null;
let isConnected = false;
let subscriptions = [];
let devWalletPollInterval = null;
let isDevWalletPolling = false;
let bundlerProgressInterval = null;
let bundlerProgressModal = null;
let bundlerAvailableModal = null;
let bundlerProgressPhase = 0;
let currentTheme = 'light';

const DEV_WALLET_POLL_INTERVAL_MS = 20000;
const BUNDLER_PROGRESS_STEP_DURATION_MS = 90000;
const DEV_WALLET_REQUIRED_MESSAGE = 'Your developer wallet is still being set up. Please wait a moment.';
const DEV_WALLET_MIN_SOL_FOR_TOKENS = 0.1;
const TOKEN_LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const THEME_STORAGE_KEY = 'solanafied-theme';

function mergeUserData(partialUser = {}) {
  const existing = currentUser || {};
  const merged = { ...existing };

  Object.keys(partialUser).forEach((key) => {
    if (partialUser[key] !== undefined) {
      merged[key] = partialUser[key];
    }
  });

  if (!merged.dev_wallet_status) {
    merged.dev_wallet_status = merged.dev_public_key ? 'ready' : existing.dev_wallet_status || 'pending';
  }

  if (partialUser.dev_wallet_ready_in_seconds === undefined && existing.dev_wallet_ready_in_seconds !== undefined) {
    merged.dev_wallet_ready_in_seconds = existing.dev_wallet_ready_in_seconds;
  }

  currentUser = merged;
  return currentUser;
}

// ========== LONG-RUN OPERATION HELPERS ==========

function showBundlerProgressModal(totalSteps) {
  if (bundlerProgressModal) {
    bundlerProgressModal.remove();
  }

  bundlerProgressModal = document.createElement('div');
  bundlerProgressModal.className = 'modal-overlay';
  bundlerProgressModal.id = 'bundler-progress-modal';

  bundlerProgressModal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <span class="material-symbols-outlined">schedule</span>
        <h3>Creating Bundler...</h3>
      </div>
      <div class="modal-body">
        <p>This process is sequential and may take several minutes. Please keep this tab open.</p>
        <div class="progress-steps" id="bundler-progress-steps"></div>
        <div class="progress-bar"><div class="progress" id="bundler-progress-bar"></div></div>
      </div>
    </div>
  `;

  document.body.appendChild(bundlerProgressModal);
  updateBundlerProgress(0, totalSteps);
}

function showBundlerAvailableModal(balanceSol = 0) {
  if (bundlerAvailableModal) {
    bundlerAvailableModal.remove();
  }

  bundlerAvailableModal = document.createElement('div');
  bundlerAvailableModal.className = 'modal-overlay';
  bundlerAvailableModal.id = 'bundler-available-modal';

  bundlerAvailableModal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <span class="material-symbols-outlined">check_circle</span>
        <h3>Bundler Available</h3>
      </div>
      <div class="modal-body">
        <p>Your bundler is available with a balance of ${balanceSol} SOL.</p>
      </div>
    </div>
  `;

  document.body.appendChild(bundlerAvailableModal);
}

function closeBundlerAvailableModal() {
  if (!bundlerAvailableModal) {
    bundlerAvailableModal = document.getElementById('bundler-available-modal');
  }

  if (bundlerAvailableModal) {
    bundlerAvailableModal.remove();
    bundlerAvailableModal = null;
  }
}

/**
 * Verify developer wallet balances
 */
async function checkDeveloperBalance() {
  try {
    if (!currentUser || !OrchestratorAPI) {
      showSnackbar('Please create a distributor wallet first', 'warning');
      return;
    }

    if (!currentUser.dev_public_key) {
      showSnackbar(DEV_WALLET_REQUIRED_MESSAGE, 'warning');
      return;
    }

    const result = await OrchestratorAPI.verifyDevWalletBalance(currentUser.user_wallet_id);

    if (result) {
      // Persist balances optimistically while waiting for Supabase sync
      if (DatabaseAPI?.updateUserDevBalances) {
        await DatabaseAPI.updateUserDevBalances(
          currentUser.user_wallet_id,
          result.currentBalance ?? currentUser.dev_balance_sol,
          result.currentSplBalance ?? currentUser.dev_balance_spl
        );
      }

      await refreshUserData();
      showSnackbar('Developer balances refreshed.', 'success');
    }
  } catch (error) {
    console.error('❌ Failed to verify developer balance:', error);
    showSnackbar('Failed to verify developer balance', 'error');
  }
}

function updateBundlerProgress(stepIndex, totalSteps) {
  const stepsContainer = document.getElementById('bundler-progress-steps');
  const progressBar = document.getElementById('bundler-progress-bar');
  if (!stepsContainer || !progressBar) return;

  const steps = Array.from({ length: totalSteps }, (_, idx) => idx + 1);

  stepsContainer.innerHTML = steps.map((step) => {
    const state = step <= stepIndex ? 'completed' : step === stepIndex + 1 ? 'active' : 'pending';
    return `
      <div class="progress-step ${state}">
        <span>${step}</span>
      </div>
    `;
  }).join('');

  const progressPercent = Math.min((stepIndex / totalSteps) * 100, 100);
  progressBar.style.width = `${progressPercent}%`;
}

function closeBundlerProgressModal() {
  if (bundlerProgressInterval) {
    clearInterval(bundlerProgressInterval);
    bundlerProgressInterval = null;
  }
  if (bundlerProgressModal) {
    bundlerProgressModal.remove();
    bundlerProgressModal = null;
  }
  bundlerProgressPhase = 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(error) {
  if (!error) return false;
  if (error.name === 'AbortError') return true;
  const message = (error.message || '').toLowerCase();
  return message.includes('timed out') || message.includes('timeout');
}

async function waitForBundlerCreation(initialCount, timeoutMs = 240000, pollIntervalMs = 10000) {
  if (!currentUser || !DatabaseAPI) return null;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const bundlers = await DatabaseAPI.getUserBundlers(currentUser.user_wallet_id);
      if (Array.isArray(bundlers) && bundlers.length > initialCount) {
        return bundlers[0];
      }
    } catch (error) {
      console.error('❌ Failed to poll bundler creation status:', error);
    }
    await delay(pollIntervalMs);
  }

  return null;
}

function ensureDevWalletStatusElement() {
  let statusEl = document.getElementById('dev-wallet-status');
  if (!statusEl) return null;
  return statusEl;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

function validateTokenFormData(tokenData = {}) {
  const errors = [];
  if (!tokenData.name) {
    errors.push('Token name is required.');
  }
  if (!tokenData.symbol) {
    errors.push('Token symbol is required.');
  }
  if (tokenData.symbol && tokenData.symbol.length > 5) {
    errors.push('Token symbol must be 5 characters or fewer.');
  }
  if (tokenData.devBuyAmount < 0.05) {
    errors.push('Dev buy amount must be at least 0.05 SOL.');
  }
  if (tokenData.logoFile && tokenData.logoFile.size > TOKEN_LOGO_MAX_BYTES) {
    errors.push('Logo file must be smaller than 2 MB.');
  }
  return errors;
}

function showDevWalletStatus(message, state = 'info') {
  const statusEl = ensureDevWalletStatusElement();
  if (!statusEl) return;
  statusEl.className = `dev-wallet-status ${state}`;
  statusEl.innerHTML = `
    <span class="material-symbols-outlined">
      ${state === 'success' ? 'check_circle' : 'hourglass_top'}
    </span>
    <p>${message}</p>
  `;
  statusEl.style.display = 'flex';
}

function hideDevWalletStatus() {
  const statusEl = document.getElementById('dev-wallet-status');
  if (statusEl) {
    statusEl.style.display = 'none';
    statusEl.className = 'dev-wallet-status info';
    statusEl.textContent = '';
  }
}

function applyTheme(theme, persist = true) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeToggleIcon();
  if (persist) {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

function toggleTheme() {
  const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(nextTheme);
}

function updateThemeToggleIcon() {
  const themeToggleBtn = document.getElementById('theme-toggle');
  if (!themeToggleBtn) return;
  const icon = themeToggleBtn.querySelector('.material-symbols-outlined');
  if (!icon) return;
  if (currentTheme === 'dark') {
    icon.textContent = 'light_mode';
    themeToggleBtn.setAttribute('aria-label', 'Switch to light theme');
  } else {
    icon.textContent = 'dark_mode';
    themeToggleBtn.setAttribute('aria-label', 'Switch to dark theme');
  }
}

async function pollForDevWallet() {
  if (!currentUser || !DatabaseAPI) return;

  try {
    const latestUser = await DatabaseAPI.getUserByWalletId(currentUser.user_wallet_id);
    if (latestUser) {
      mergeUserData(latestUser);
      updateBalanceDisplay(latestUser.distributor_balance_sol, latestUser.distributor_balance_spl);
      if (latestUser.dev_public_key) {
        updateDevWalletStatus(latestUser);
        return;
      }
    }
  } catch (error) {
    console.error('❌ Failed to poll developer wallet status:', error);
  }
}

function startDevWalletPolling() {
  if (!currentUser || !DatabaseAPI) return;

  stopDevWalletPolling();
  isDevWalletPolling = true;
  pollForDevWallet();
  const etaMs = (currentUser?.dev_wallet_ready_in_seconds || 0) * 1000;
  const interval = Math.max(DEV_WALLET_POLL_INTERVAL_MS, etaMs || DEV_WALLET_POLL_INTERVAL_MS);
  devWalletPollInterval = setInterval(pollForDevWallet, interval);
}

function stopDevWalletPolling() {
  if (devWalletPollInterval) {
    clearInterval(devWalletPollInterval);
    devWalletPollInterval = null;
  }
  isDevWalletPolling = false;
}

function updateDevWalletStatus(user) {
  if (!user) return;

  const status = user.dev_wallet_status || (user.dev_public_key ? 'ready' : currentUser?.dev_wallet_status || 'pending');
  const eta = user.dev_wallet_ready_in_seconds ?? currentUser?.dev_wallet_ready_in_seconds ?? null;

  mergeUserData({
    dev_public_key: user.dev_public_key,
    dev_wallet_status: status,
    dev_wallet_ready_in_seconds: eta
  });

  if (status === 'ready' && user.dev_public_key) {
    showDevWalletStatus('Developer wallet ready for token creation.', 'success');
    stopDevWalletPolling();
  } else {
    const etaText = eta ? ` (~${Math.ceil(eta / 60)} min)` : ' (Est. 2 minutes)';
    showDevWalletStatus(`Preparing developer wallet...${etaText}`, 'info');
    startDevWalletPolling();
  }
}

// ========== WALLET CONNECTION ==========

/**
 * Check if Phantom wallet is installed
 */
function isPhantomInstalled() {
  return window.solana && window.solana.isPhantom;
}

/**
 * Get available Solana wallet providers
 */
function getWalletProviders() {
  const providers = [];
  
  if (window.solana && window.solana.isPhantom) {
    providers.push({ name: 'Phantom', provider: window.solana });
  }
  
  if (window.solflare && window.solflare.isSolflare) {
    providers.push({ name: 'Solflare', provider: window.solflare });
  }
  
  // Add more wallet providers as needed
  
  return providers;
}

/**
 * Connect to Solana wallet
 */
async function connectWallet() {
  try {
    showLoadingOverlay(true, 'Connecting to wallet...');
    
    // Check for available wallets
    const providers = getWalletProviders();
    
    if (providers.length === 0) {
      throw new Error('No Solana wallet found. Please install Phantom wallet.');
    }
    
    // Use the first available provider (Phantom preferred)
    const walletProvider = providers[0].provider;
    
    // Request connection
    const response = await walletProvider.connect();
    currentWallet = response;
    
    console.log('✅ Wallet connected:', response.publicKey.toString());
    
    // Update UI
    isConnected = true;
    updateWalletUI();
    
    // Initialize or get user from database
    await initializeUser();
    
    // Load dashboard data
    await loadDashboardData();
    
    // Set up real-time subscriptions
    setupRealtimeSubscriptions();
    
    showSnackbar('Wallet connected successfully!', 'success');
    
  } catch (error) {
    console.error('❌ Failed to connect wallet:', error);
    
    let message = 'Failed to connect wallet';
    if (error.message.includes('User rejected')) {
      message = 'Connection cancelled by user';
    } else if (error.message.includes('No Solana wallet')) {
      message = 'Please install a Solana wallet (Phantom recommended)';
    }
    
    showSnackbar(message, 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

async function showSellSplTokenModal(arg) {
  try {
    if (!currentUser) {
      showSnackbar('Connect your wallet first', 'warning');
      return;
    }

    let source = 'distributor';
    let bundlerId = null;

    if (typeof arg === 'object' && arg !== null) {
      source = arg.source || source;
      bundlerId = arg.bundlerId ?? null;
    } else if (typeof arg === 'string') {
      if (arg.toLowerCase() === 'developer' || arg.toLowerCase() === 'dev') {
        source = 'developer';
      }
    } else if (typeof arg === 'number') {
      bundlerId = arg;
    }

    let balance = 0;

    if (source === 'developer') {
      balance = parseFloat(currentUser?.dev_balance_spl || '0');
    } else if (bundlerId) {
      const targetId = Number(bundlerId);
      const bundler = currentUser?.bundlers?.find((b) => Number(b.id) === targetId);
      balance = parseFloat(bundler?.total_balance_spl || '0');
    } else {
      balance = parseFloat(currentUser?.distributor_balance_spl || '0');
    }

    if (balance <= 0) {
      if (bundlerId) {
        await refreshBundlers();
        const targetId = Number(bundlerId);
        const refreshedBundler = !Number.isNaN(targetId)
          ? currentUser?.bundlers?.find((b) => Number(b.id) === targetId)
          : null;
        const refreshedBalance = parseFloat(refreshedBundler?.total_balance_spl || '0');
        if (refreshedBalance <= 0) {
          showSnackbar('No SPL tokens available to sell.', 'warning');
          return;
        }
        balance = refreshedBalance;
      } else {
        showSnackbar('No SPL tokens available to sell.', 'warning');
        return;
      }
    }

    if (sellSplModal) {
      sellSplModal.remove();
    }

    sellSplModal = document.createElement('div');
    sellSplModal.className = 'modal-overlay';
    sellSplModal.id = 'sell-spl-modal';
    sellSplModal.dataset.source = source;
    if (bundlerId) {
      sellSplModal.dataset.bundlerId = bundlerId;
    }

    const walletLabel = source === 'developer' ? 'Developer Wallet' : 'Distributor Wallet';

    sellSplModal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <span class="material-symbols-outlined">sell</span>
          <h3>Sell SPL (${walletLabel})</h3>
        </div>
        <div class="modal-body">
          <p>Available SPL balance: <strong>${DatabaseAPI.formatBalance(balance)}</strong></p>
          <div class="form-group">
            <label for="sell-spl-percent">Sell Percentage</label>
            <input id="sell-spl-percent" type="number" min="1" max="100" step="1" value="50" />
            <small>Enter a value between 1 and 100</small>
          </div>
          <div class="modal-actions">
            <button class="secondary-button" type="button" onclick="closeSellSplModal()">
              <span class="material-symbols-outlined">close</span>
              Cancel
            </button>
            <button class="primary-button" type="button" onclick="confirmSellSplFromModal()">
              <span class="material-symbols-outlined">sell</span>
              Sell Tokens
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(sellSplModal);
    const percentInput = sellSplModal.querySelector('#sell-spl-percent');
    if (percentInput) {
      percentInput.focus();
    }
  } catch (error) {
    console.error('❌ Failed to show sell SPL modal:', error);
    showSnackbar('Failed to open sell modal', 'error');
  }
}

function closeSellSplModal() {
  if (sellSplModal) {
    sellSplModal.remove();
    sellSplModal = null;
  }
}

async function confirmSellSplFromModal() {
  if (!sellSplModal) return;
  const percentInput = sellSplModal.querySelector('#sell-spl-percent');
  const percent = parseFloat(percentInput?.value || '0');
  if (isNaN(percent) || percent <= 0 || percent > 100) {
    showSnackbar('Enter a valid percentage between 1 and 100.', 'warning');
    return;
  }

  const source = sellSplModal.dataset.source || 'distributor';
  const bundlerId = sellSplModal.dataset.bundlerId || null;
  closeSellSplModal();
  await executeSellSpl(percent, source, bundlerId);
}

async function executeSellSpl(percent, source = 'distributor', bundlerId = null) {
  try {
    if (!currentUser || !OrchestratorAPI) {
      showSnackbar('Please create a distributor wallet first', 'warning');
      return;
    }

    if (source === 'developer' && !currentUser.dev_public_key) {
      showSnackbar('Developer wallet is not ready yet.', 'warning');
      return;
    }

    let response = null;

    if (source === 'bundler') {
      showLoadingOverlay(true, 'Submitting bundler sell order...');
      response = await OrchestratorAPI.sellCreatedToken(currentUser.user_wallet_id, percent);
    } else {
      const options = source === 'developer' ? { walletType: 'developer' } : { walletType: 'distributor' };
      response = await OrchestratorAPI.sellSplFromWallet(currentUser.user_wallet_id, percent, options);
    }

    if (response) {
      await refreshUserData();
      if (source === 'bundler') {
        await loadBundlers();
        showSnackbar(`Sell order (${percent}%) submitted for bundler.`, 'success');
      } else {
        showSnackbar(`Sell order (${percent}%) submitted for ${source === 'developer' ? 'developer' : 'distributor'} wallet.`, 'success');
      }
    }
  } catch (error) {
    console.error('❌ Failed to sell SPL tokens:', error);
  } finally {
    if (source === 'bundler') {
      showLoadingOverlay(false);
    }
  }
}

function sellDevSpl() {
  showSellSplTokenModal({ source: 'developer' });
}

function sellDistributorSpl() {
  showSellSplTokenModal({ source: 'distributor' });
}

/**
 * Disconnect wallet
 */
async function disconnectWallet() {
  try {
    if (currentWallet && window.solana) {
      await window.solana.disconnect();
    }
    
    // Clean up subscriptions
    subscriptions.forEach(sub => {
      if (sub && typeof sub.unsubscribe === 'function') {
        sub.unsubscribe();
      }
    });
    subscriptions = [];
    
    // Reset state
    currentWallet = null;
    currentUser = null;
    isConnected = false;
    
    // Update UI
    updateWalletUI();
    hideDashboard();
    
    showSnackbar('Wallet disconnected', 'info');
    
  } catch (error) {
    console.error('❌ Failed to disconnect wallet:', error);
    showSnackbar('Failed to disconnect wallet', 'error');
  }
}

/**
 * Initialize or get user from database
 */
async function initializeUser() {
  try {
    if (!currentWallet || !DatabaseAPI) {
      throw new Error('Wallet not connected or database not available');
    }

    const walletId = currentWallet.publicKey.toString();
    console.log('[App] initializeUser start for wallet', walletId);

    // Try to get existing user
    let user = await DatabaseAPI.getUserByWalletId(walletId);

    if (!user) {
      console.log('[App] No user record found, showing registration prompt');
      showRegistrationPrompt();
      return;
    }

    console.log('[App] User record found, merging data');
    mergeUserData(user);
    hideRegistrationPrompt();
    showDashboard();
    console.log('✅ User initialized:', user);
    
    // Update balance display from database
    updateBalanceDisplay(user.distributor_balance_sol, user.distributor_balance_spl);
    updateDevWalletStatus(user);
    
  } catch (error) {
    console.error('❌ Failed to initialize user:', error);
    showSnackbar('Failed to initialize user data', 'error');
  }
}

/**
 * Refresh user data from database
 */
async function refreshUserData() {
  try {
    if (!currentUser || !DatabaseAPI) return;

    console.log('[App] refreshUserData for', currentUser.user_wallet_id);
    const updatedUser = await DatabaseAPI.getUserByWalletId(currentUser.user_wallet_id);

    if (updatedUser) {
      console.log('[App] refreshUserData received user, merging and updating UI');
      mergeUserData(updatedUser);
      hideRegistrationPrompt();
      showDashboard();
      console.log('🔄 User data refreshed:', updatedUser);
      
      // Update balance display
      updateBalanceDisplay(updatedUser.distributor_balance_sol, updatedUser.distributor_balance_spl);
      updateDevWalletStatus(updatedUser);
    }
    
  } catch (error) {
    console.error('❌ Failed to refresh user data:', error);
  }
}

// ========== UI MANAGEMENT ==========

/**
 * Update wallet connection UI
 */
function updateWalletUI() {
  const connectBtn = document.getElementById('wallet-connect');
  const walletStatus = document.getElementById('wallet-status');
  const walletAddress = document.getElementById('wallet-address');
  
  if (isConnected && currentWallet) {
    // Update connect button
    connectBtn.innerHTML = `
      <span class="material-symbols-outlined">check_circle</span>
      <span class="wallet-text">Connected</span>
    `;
    connectBtn.classList.add('connected');
    connectBtn.onclick = disconnectWallet;
    
    // Show wallet status card
    walletStatus.style.display = 'block';
    walletAddress.textContent = DatabaseAPI.truncateAddress(currentWallet.publicKey.toString());
    
  } else {
    // Reset connect button
    connectBtn.innerHTML = `
      <span class="material-symbols-outlined">account_balance_wallet</span>
      <span class="wallet-text">Connect Wallet</span>
    `;
    connectBtn.classList.remove('connected');
    connectBtn.onclick = connectWallet;
    
    // Hide wallet status card
    walletStatus.style.display = 'none';
  }
}

/**
 * Update balance display
 */
function updateBalanceDisplay(solBalance, splBalance) {
  const solBalanceEl = document.getElementById('sol-balance');
  const splBalanceEl = document.getElementById('spl-balance');
  const profileSolEl = document.getElementById('profile-sol');
  const profileSplEl = document.getElementById('profile-spl');
  const sellSplBtn = document.getElementById('sell-spl-btn');
  const distributorKeyEl = document.getElementById('distributor-public-key');
  const devWalletChip = document.getElementById('dev-wallet-chip');
  const devWalletChipText = document.getElementById('dev-wallet-chip-text');
  const devWalletProfile = document.getElementById('dev-wallet-profile');
  const devWalletAddressBtn = document.getElementById('dev-wallet-address');
  const devSolBalanceEl = document.getElementById('dev-sol-balance');
  const devSplBalanceEl = document.getElementById('dev-spl-balance');
  const sellDevSplBtn = document.getElementById('sell-dev-spl-btn');
  const checkDevBalanceBtn = document.getElementById('check-dev-balance-btn');

  
  const formattedSol = DatabaseAPI.formatBalance(solBalance);
  const formattedSpl = DatabaseAPI.formatBalance(splBalance);
  
  if (solBalanceEl) solBalanceEl.textContent = formattedSol;
  if (splBalanceEl) splBalanceEl.textContent = formattedSpl;
  if (profileSolEl) profileSolEl.textContent = formattedSol;
  if (profileSplEl) profileSplEl.textContent = formattedSpl;
  if (distributorKeyEl && currentUser?.distributor_public_key) {
    distributorKeyEl.textContent = DatabaseAPI.truncateAddress(currentUser.distributor_public_key);
  }
  if (devWalletChip) {
    if (currentUser?.dev_public_key) {
      devWalletChip.style.display = 'none';
    } else {
      devWalletChip.style.display = 'flex';
      if (devWalletChipText) {
        const eta = currentUser?.dev_wallet_ready_in_seconds;
        devWalletChipText.textContent = eta
          ? `Preparing developer wallet... (~${Math.ceil(eta / 60)} min)`
          : 'Preparing developer wallet... (Est. 2 minutes)';
      }
    }
  }
  if (devWalletProfile) {
    const hasDevWallet = currentUser?.dev_public_key;
    devWalletProfile.style.display = hasDevWallet ? 'flex' : 'none';
    if (hasDevWallet && devWalletAddressBtn) {
      devWalletAddressBtn.querySelector('.link-button-text').textContent = DatabaseAPI.truncateAddress(currentUser.dev_public_key, 6, 6);
      devWalletAddressBtn.onclick = () => copyToClipboard(currentUser.dev_public_key);
    }
    if (devSolBalanceEl) {
      devSolBalanceEl.textContent = DatabaseAPI.formatBalance(currentUser?.dev_balance_sol);
    }
    if (devSplBalanceEl) {
      devSplBalanceEl.textContent = DatabaseAPI.formatBalance(currentUser?.dev_balance_spl);
    }
    if (sellDevSplBtn) {
      const hasDevSpl = parseFloat(currentUser?.dev_balance_spl || '0') > 0;
      sellDevSplBtn.style.display = hasDevSpl ? 'flex' : 'none';
    }
  }
  if (checkDevBalanceBtn) {
    checkDevBalanceBtn.style.display = currentUser?.dev_public_key ? 'flex' : 'none';
  }
  // Show/hide sell SPL button based on SPL balance
  if (sellSplBtn) {
    const hasSplTokens = parseFloat(splBalance) > 0;
    sellSplBtn.style.display = hasSplTokens ? 'flex' : 'none';
  }
}

function initializeTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  currentTheme = storedTheme || (prefersDark ? 'dark' : 'light');
  applyTheme(currentTheme, false);

  const themeToggleBtn = document.getElementById('theme-toggle');
  if (themeToggleBtn && !themeToggleBtn.dataset.initialized) {
    themeToggleBtn.addEventListener('click', toggleTheme);
    themeToggleBtn.dataset.initialized = 'true';
    updateThemeToggleIcon();
  }
}

/**
 * Show/hide dashboard
 */
function hideDashboard() {
  document.getElementById('dashboard').style.display = 'none';
  hideRegistrationPrompt();
  hideDevWalletStatus();
}

function showDashboard() {
  const dashboard = document.getElementById('dashboard');
  if (dashboard) {
    dashboard.style.display = 'grid';
  }
}

/**
 * Show registration prompt for unregistered users
 */
function showRegistrationPrompt() {
  console.log('[UI] showRegistrationPrompt invoked');
  // Hide dashboard
  document.getElementById('dashboard').style.display = 'none';
  
  // Show registration prompt
  let registrationPrompt = document.getElementById('registration-prompt');
  
  if (!registrationPrompt) {
    // Create registration prompt if it doesn't exist
    registrationPrompt = document.createElement('section');
    registrationPrompt.id = 'registration-prompt';
    registrationPrompt.className = 'registration-prompt';
    registrationPrompt.innerHTML = `
      <div class="card registration-card">
        <div class="card-header">
          <span class="material-symbols-outlined">person_add</span>
          <h3>Create Distributor Wallet</h3>
        </div>
        <div class="card-content">
          <div class="registration-content">
            <div class="registration-icon">
              <span class="material-symbols-outlined">account_balance_wallet</span>
            </div>
            <h4>Welcome to Solanafied!</h4>
            <p>Your wallet is connected, but you need to create a distributor wallet to access all features.</p>
            <p>This will allow you to:</p>
            <ul class="feature-list">
              <li><span class="material-symbols-outlined">inventory_2</span> Create and manage bundlers</li>
              <li><span class="material-symbols-outlined">folder</span> Access mother and child wallets</li>
              <li><span class="material-symbols-outlined">token</span> Create tokens on Pump.fun</li>
              <li><span class="material-symbols-outlined">analytics</span> View detailed analytics</li>
            </ul>
            <div class="registration-actions">
              <button id="create-wallet-btn" class="primary-button">
                <span class="material-symbols-outlined">add</span>
                Create Distributor Wallet
              </button>
              <button id="refresh-registration-btn" class="secondary-button">
                <span class="material-symbols-outlined">refresh</span>
                Check Status
              </button>
            </div>
            <p class="registration-note">
              <span class="material-symbols-outlined">info</span>
              Your distributor wallet will be created securely by our backend system while your developer wallet prepares in the background.
            </p>
          </div>
        </div>
      </div>
    `;
    
    // Insert after wallet status section
    const walletStatus = document.getElementById('wallet-status');
    walletStatus.parentNode.insertBefore(registrationPrompt, walletStatus.nextSibling);
    
    // Add event listeners
    document.getElementById('create-wallet-btn').addEventListener('click', handleCreateInAppWallet);
    document.getElementById('refresh-registration-btn').addEventListener('click', handleRefreshRegistration);
  }
  
  registrationPrompt.style.display = 'block';
}

/**
 * Hide registration prompt
 */
function hideRegistrationPrompt() {
  console.log('[UI] hideRegistrationPrompt invoked');
  const registrationPrompt = document.getElementById('registration-prompt');
  if (registrationPrompt) {
    registrationPrompt.style.display = 'none';
  }
}

/**
 * Show loading overlay
 */
function showLoadingOverlay(show, message = 'Loading...') {
  const overlay = document.getElementById('loading-overlay');
  const messageEl = overlay.querySelector('span');
  
  if (show) {
    messageEl.textContent = message;
    overlay.classList.add('show');
  } else {
    overlay.classList.remove('show');
  }
}

/**
 * Show snackbar notification
 */
function showSnackbar(message, type = 'info') {
  const snackbar = document.getElementById('snackbar');
  const messageEl = snackbar.querySelector('.snackbar-message');
  
  messageEl.textContent = message;
  
  // Add type-specific styling
  snackbar.className = `snackbar ${type}`;
  snackbar.classList.add('show');
  
  // Auto-hide after 4 seconds
  setTimeout(() => {
    snackbar.classList.remove('show');
  }, 4000);
}

// ========== DATA LOADING ==========

/**
 * Load all dashboard data
 */
async function loadDashboardData() {
  if (!currentUser || !DatabaseAPI) return;
  
  try {
    // Update in-app public key display
    const distributorLabel = document.getElementById('distributor-public-key');
    if (distributorLabel) {
      distributorLabel.textContent = DatabaseAPI.truncateAddress(currentUser.distributor_public_key);
    }
    const devWalletChip = document.getElementById('dev-wallet-chip');
    const devWalletProfile = document.getElementById('dev-wallet-profile');
    if (devWalletChip) {
      devWalletChip.style.display = currentUser.dev_public_key ? 'none' : 'flex';
    }
    if (devWalletProfile) {
      devWalletProfile.style.display = currentUser.dev_public_key ? 'flex' : 'none';
    }
    
    // Load data in parallel
    await Promise.all([
      loadBundlers(),
      loadTokens()
    ]);
    
  } catch (error) {
    console.error('❌ Failed to load dashboard data:', error);
    showSnackbar('Failed to load some data', 'warning');
  }
}

/**
 * Load bundlers data
 */
async function loadBundlers() {
  try {
    const bundlersList = document.getElementById('bundlers-list');
    bundlersList.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading bundlers...</span></div>';
    
    const bundlers = await DatabaseAPI.getUserBundlers(currentUser.user_wallet_id);
    mergeUserData({ bundlers });
    
    // Filter out inactive bundlers - only show active ones
    const activeBundlers = bundlers.filter(bundler => bundler.is_active);
    
    if (activeBundlers.length === 0) {
      bundlersList.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-outlined">inventory_2</span>
          <p>No active bundlers found</p>
          <button onclick="createBundler()" class="empty-action-btn">Create your first bundler</button>
        </div>
      `;
      return;
    }
    
    bundlersList.innerHTML = activeBundlers.map(bundler => {
      const hasSplTokens = parseFloat(bundler.total_balance_spl) > 0;
      
      return `
        <div class="list-item" data-bundler-id="${bundler.id}">
          <div class="list-item-icon">
            <span class="material-symbols-outlined">inventory_2</span>
          </div>
          <div class="list-item-content">
            <div class="list-item-title">${bundler.token_name || 'Unnamed Bundler'}</div>
            <div class="list-item-subtitle">
              SOL: ${DatabaseAPI.formatBalance(bundler.total_balance_sol)} | 
              SPL: ${DatabaseAPI.formatBalance(bundler.total_balance_spl)}
            </div>
          </div>
          <div class="list-item-trailing">
            ${hasSplTokens ? `
              <button class="secondary-button sell-token-btn" onclick="showSellSplTokenModal(${bundler.id})">
                <span class="material-symbols-outlined">sell</span>
                Sell Token
              </button>
            ` : ''}
            <span class="status-chip active">
              Active
            </span>
            <button class="icon-button" onclick="toggleBundlerStatus(${bundler.id}, false)">
              <span class="material-symbols-outlined">
                pause
              </span>
            </button>
          </div>
        </div>
      `;
    }).join('');
    
  } catch (error) {
    console.error('❌ Failed to load bundlers:', error);
    document.getElementById('bundlers-list').innerHTML = `
      <div class="error-state">
        <span class="material-symbols-outlined">error</span>
        <p>Failed to load bundlers</p>
        <button onclick="loadBundlers()" class="retry-btn">Retry</button>
      </div>
    `;
  }
}

/**
 * Refresh bundlers data
 */
async function refreshBundlers() {
  if (!currentUser || !DatabaseAPI) return;
  try {
    await loadBundlers();
  } catch (error) {
    console.error('❌ Failed to refresh bundlers:', error);
    showSnackbar('Failed to refresh bundlers', 'error');
  }
}

/**
 * Load tokens data
 */
async function loadTokens() {
  try {
    const tokensList = document.getElementById('tokens-list');
    tokensList.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading tokens...</span></div>';
    
    const tokens = await DatabaseAPI.getUserTokens(currentUser.user_wallet_id);
    
    if (tokens.length === 0) {
      tokensList.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-outlined">token</span>
          <p>No tokens found</p>
          <button onclick="addToken()" class="empty-action-btn">Add your first token</button>
        </div>
      `;
      return;
    }
    
    tokensList.innerHTML = tokens.map(token => `
      <div class="list-item" data-token-id="${token.id}">
        <div class="list-item-icon">
          ${token.image_url ? 
            `<img src="${token.image_url}" alt="${token.name}" style="width: 100%; height: 100%; border-radius: var(--radius-sm);">` :
            `<span class="material-symbols-outlined">token</span>`
          }
        </div>
        <div class="list-item-content">
          <div class="list-item-title">${token.name} (${token.symbol})</div>
          <div class="list-item-subtitle">
            ${token.description ? DatabaseAPI.truncateAddress(token.description, 30, 0) : 'No description'}
          </div>
        </div>
        <div class="list-item-trailing">
          <span class="balance-value">${DatabaseAPI.formatBalance(token.dev_buy_amount)}</span>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('❌ Failed to load tokens:', error);
    document.getElementById('tokens-list').innerHTML = `
      <div class="error-state">
        <span class="material-symbols-outlined">error</span>
        <p>Failed to load tokens</p>
        <button onclick="loadTokens()" class="retry-btn">Retry</button>
      </div>
    `;
  }
}

// ========== REGISTRATION HANDLERS ==========

/**
 * Handle create in-app wallet
 */
async function handleCreateInAppWallet() {
  try {
    if (!currentWallet || !OrchestratorAPI) {
      throw new Error('Wallet not connected or orchestrator not available');
    }

    const walletId = currentWallet.publicKey.toString();

    // Always ensure we have the latest user record before attempting creation
    let existingUser = currentUser;
    if (!existingUser && DatabaseAPI) {
      existingUser = await DatabaseAPI.getUserByWalletId(walletId);
      if (existingUser) {
        mergeUserData(existingUser);
      }
    }

    if (existingUser?.distributor_public_key) {
      showSnackbar('Distributor wallet already exists for this user.', 'info');
      hideRegistrationPrompt();
      await refreshUserData();
      await loadDashboardData();
      updateDevWalletStatus(existingUser);
      return;
    }

    // Create in-app wallet via orchestrator
    const result = await OrchestratorAPI.createInAppWallet(walletId);
    
    if (result) {
      // Merge immediate data from orchestrator so UI doesn't wait for DB replication
      mergeUserData({
        user_wallet_id: walletId,
        distributor_public_key: result.distributorPublicKey,
        distributor_balance_sol: result.distributorBalanceSol,
        dev_public_key: result.devPublicKey,
        dev_wallet_status: result.devWalletStatus,
        dev_wallet_ready_in_seconds: result.devWalletReadyInSeconds
      });
      
      // Refresh user data from database
      await refreshUserData();
      
      // Hide registration prompt and show dashboard
      hideRegistrationPrompt();
      await loadDashboardData();
      setupRealtimeSubscriptions();
      
      // Show distributor/dev wallet details and funding prompt
      showInAppWalletCreated({
        distributorPublicKey: result.distributorPublicKey,
        distributorBalanceSol: result.distributorBalanceSol,
        devWalletStatus: result.devWalletStatus,
        devPublicKey: result.devPublicKey,
        devWalletReadyInSeconds: result.devWalletReadyInSeconds
      });
    }
    
  } catch (error) {
    console.error('❌ Failed to create in-app wallet:', error);

    const alreadyExists = typeof error?.message === 'string' && error.message.includes('already has an in-app wallet');
    if (alreadyExists && DatabaseAPI) {
      const latestUser = await DatabaseAPI.getUserByWalletId(currentWallet?.publicKey?.toString());
      if (latestUser?.distributor_public_key) {
        mergeUserData(latestUser);
        hideRegistrationPrompt();
        await loadDashboardData();
        updateDevWalletStatus(latestUser);
        showSnackbar('Distributor wallet already exists for this user.', 'info');
        return;
      }
    }

    showSnackbar('Failed to create in-app wallet', 'error');
  }
}

/**
 * Show in-app wallet created success with funding prompt
 */
function showInAppWalletCreated({
  distributorPublicKey,
  distributorBalanceSol,
  devWalletStatus = 'pending',
  devPublicKey = null,
  devWalletReadyInSeconds = null
}) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'wallet-created-modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <span class="material-symbols-outlined" style="color: var(--md-sys-color-success);">check_circle</span>
        <h3>Distributor Wallet Created!</h3>
      </div>
      <div class="modal-body">
        <div class="wallet-created-content">
          <div class="success-icon">
            <span class="material-symbols-outlined">account_balance_wallet</span>
          </div>
          <h4>Your distributor wallet is ready!</h4>
          <p>Your funding wallet has been created and registered. We'll prepare your developer wallet next.</p>
          
          <div class="wallet-details">
            <div class="detail-item">
              <label>Distributor Public Key:</label>
              <div class="key-display">
                <span class="key-text">${DatabaseAPI.truncateAddress(distributorPublicKey, 8, 8)}</span>
                <button class="copy-btn" onclick="copyToClipboard('${distributorPublicKey}')">
                  <span class="material-symbols-outlined">content_copy</span>
                </button>
              </div>
            </div>
            <div class="detail-item">
              <label>Current Distributor Balance:</label>
              <span class="balance-display">${DatabaseAPI.formatBalance(distributorBalanceSol)} SOL</span>
            </div>
            <div class="detail-item">
              <label>Developer Wallet Status:</label>
              <span class="status-chip ${devWalletStatus === 'ready' ? 'success' : 'warning'}">
                ${devWalletStatus === 'ready' ? 'Ready' : 'Provisioning'}
              </span>
            </div>
            ${devPublicKey ? `
              <div class="detail-item">
                <label>Developer Public Key:</label>
                <div class="key-display">
                  <span class="key-text">${DatabaseAPI.truncateAddress(devPublicKey, 8, 8)}</span>
                  <button class="copy-btn" onclick="copyToClipboard('${devPublicKey}')">
                    <span class="material-symbols-outlined">content_copy</span>
                  </button>
                </div>
              </div>
            ` : ''}
          </div>
          
          ${devWalletStatus !== 'ready' ? `
            <div class="dev-wallet-countdown">
              <span class="material-symbols-outlined">hourglass_top</span>
              <p>Your developer wallet will be ready shortly.${devWalletReadyInSeconds ? ` Estimated time: ${Math.ceil(devWalletReadyInSeconds / 60)} minute(s).` : ''}</p>
            </div>
          ` : ''}
          
          <div class="funding-prompt">
            <div class="prompt-icon">
              <span class="material-symbols-outlined">send</span>
            </div>
            <h5>Next Steps:</h5>
            <ol class="steps-list">
              <li>Send SOL to your distributor wallet address above</li>
              <li>Click "Verify Balance" once you've sent the funds</li>
              <li>You need at least 1 SOL to create bundlers</li>
            </ol>
          </div>
          
          <div class="modal-actions">
            <button class="secondary-button" onclick="copyToClipboard('${distributorPublicKey}')">
              <span class="material-symbols-outlined">content_copy</span>
              Copy Address
            </button>
            <button class="primary-button" onclick="closeWalletCreatedModal()">
              <span class="material-symbols-outlined">done</span>
              Got it!
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Show success snackbar
  showSnackbar('In-app wallet created successfully! Please fund it to continue.', 'success');
}

/**
 * Close wallet created modal
 */
function closeWalletCreatedModal() {
  const modal = document.getElementById('wallet-created-modal');
  if (modal) {
    modal.remove();
  }
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showSnackbar('Address copied to clipboard!', 'success');
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    showSnackbar('Failed to copy address', 'error');
  }
}

/**
 * Generate UUID v4 for idempotency key
 */
function generateIdempotencyKey() {
  // Generate UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Show bundler creation success details
 */
function showBundlerCreationSuccess(result) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'bundler-success-modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <span class="material-symbols-outlined" style="color: var(--md-sys-color-success);">check_circle</span>
        <h3>Bundler Created Successfully!</h3>
      </div>
      <div class="modal-body">
        <div class="bundler-success-content">
          <div class="success-icon">
            <span class="material-symbols-outlined">inventory_2</span>
          </div>
          <h4>Your bundler is ready for token creation!</h4>
          <p>The bundler has been created and mother wallets have been allocated and funded.</p>
          
          <div class="bundler-details">
            <div class="detail-row">
              <label>Bundler ID:</label>
              <span class="detail-value">#${result.bundlerId}</span>
            </div>
            <div class="detail-row">
              <label>Total Balance:</label>
              <span class="detail-value">${result.totalBalanceSol} SOL</span>
            </div>
            <div class="detail-row">
              <label>Mother Wallets Allocated:</label>
              <span class="detail-value">${result.allocatedMotherWallets?.length || 0}</span>
            </div>
          </div>
          
          <div class="next-steps">
            <h5>What happens next:</h5>
            <ul class="steps-list">
              <li>✅ Mother wallets have been funded with 1 SOL each</li>
              <li>✅ Child wallets have been distributed with randomized amounts</li>
              <li>✅ Your bundler is now active and ready for token creation</li>
              <li>🎯 You can now create tokens on Pump.fun using this bundler</li>
            </ul>
          </div>
          
          <div class="modal-actions">
            <button class="secondary-button" onclick="closeBundlerSuccessModal()">
              <span class="material-symbols-outlined">close</span>
              Close
            </button>
            <button class="primary-button" onclick="closeBundlerSuccessModal(); addToken();">
              <span class="material-symbols-outlined">token</span>
              Create Token
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  bundlerAvailableModal = modal;
}

/**
 * Close bundler success modal
 */
function closeBundlerSuccessModal() {
  const modal = document.getElementById('bundler-success-modal');
  if (modal) {
    modal.remove();
  }
}

let tokenCreationModal = null;
let sellSplModal = null;

function showTokenCreationForm() {
  if (tokenCreationModal) {
    tokenCreationModal.remove();
  }

  tokenCreationModal = document.createElement('div');
  tokenCreationModal.className = 'modal-overlay';
  tokenCreationModal.id = 'token-creation-modal';

  tokenCreationModal.innerHTML = `
    <div class="modal-content token-modal">
      <div class="modal-header">
        <span class="material-symbols-outlined">token</span>
        <h3>Create Token</h3>
      </div>
      <div class="modal-body token-modal-grid">
        <form id="token-creation-form" class="token-form" autocomplete="off">
          <section class="token-form-section">
            <div class="section-heading">
              <h4>Brand Basics</h4>
              <p>These details appear on Pump.fun and Solanafied dashboards.</p>
            </div>
            <div class="form-row two-col">
              <div class="form-group">
                <label for="token-name">Token Name</label>
                <input id="token-name" name="token-name" type="text" placeholder="e.g. Solanafied" maxlength="32" required />
              </div>
              <div class="form-group">
                <label for="token-symbol">Symbol</label>
                <input id="token-symbol" name="token-symbol" type="text" maxlength="5" placeholder="e.g. SOLFD" required />
              </div>
            </div>
            <div class="form-group">
              <label for="token-description">Description</label>
              <textarea id="token-description" name="token-description" rows="3" maxlength="240" placeholder="Tell us about your token"></textarea>
              <small>Max 240 characters.</small>
            </div>
            <div class="form-group">
              <label>Token Logo</label>
              <label for="token-logo" class="token-logo-dropzone">
                <input id="token-logo" name="token-logo" type="file" accept="image/*" hidden />
                <div class="dropzone-icon">
                  <span class="material-symbols-outlined">upload</span>
                </div>
                <div>
                  <p>Drop an image or click to browse</p>
                  <small>PNG, JPG, GIF up to 2 MB</small>
                </div>
              </label>
            </div>
          </section>

          <section class="token-form-section">
            <div class="section-heading">
              <h4>Social Links</h4>
              <p>Optional links help future holders research quickly.</p>
            </div>
            <div class="form-group">
              <label for="token-twitter">Twitter URL</label>
              <input id="token-twitter" name="token-twitter" type="url" placeholder="https://twitter.com/yourproject" />
            </div>
            <div class="form-group">
              <label for="token-telegram">Telegram URL</label>
              <input id="token-telegram" name="token-telegram" type="url" placeholder="https://t.me/yourproject" />
            </div>
            <div class="form-group">
              <label for="token-website">Website</label>
              <input id="token-website" name="token-website" type="url" placeholder="https://yourproject.com" />
            </div>
          </section>

          <section class="token-form-section">
            <div class="section-heading">
              <h4>Pump.fun Parameters</h4>
              <p>These controls affect the launch economics.</p>
            </div>
            <div class="form-row two-col">
              <div class="form-group">
                <label for="dev-buy-amount">Dev Buy Amount (SOL)</label>
                <input id="dev-buy-amount" name="dev-buy-amount" type="number" min="0.05" max="5" step="0.01" placeholder="0.20" value="0.20" required />
                <small>Must be ≤ your developer wallet SOL balance.</small>
              </div>
              <div class="form-group">
                <label for="slippage">Slippage (%)</label>
                <input id="slippage" name="slippage" type="number" min="0.5" max="5" step="0.1" value="1.0" />
              </div>
            </div>
            <div class="form-group">
              <label for="priority-fee">Priority Fee (SOL)</label>
              <input id="priority-fee" name="priority-fee" type="number" min="0" step="0.000001" value="0.000005" />
              <small>Higher fees speed up confirmation on congested slots.</small>
            </div>
          </section>

          <div class="modal-actions">
            <button type="button" class="secondary-button" onclick="closeTokenCreationForm()">
              <span class="material-symbols-outlined">close</span>
              Cancel
            </button>
            <button type="submit" class="primary-button">
              <span class="material-symbols-outlined">rocket_launch</span>
              Create Token
            </button>
          </div>
        </form>

        <aside class="token-preview-panel" aria-live="polite">
          <div class="token-preview-card">
            <div class="preview-logo" id="token-preview-logo">
              <span class="material-symbols-outlined">token</span>
            </div>
            <div class="preview-meta">
              <h4 id="token-preview-name">Your token name</h4>
              <p id="token-preview-symbol">SYMB</p>
            </div>
            <p id="token-preview-description">Add a compelling description to help holders understand your mission.</p>
            <ul class="preview-socials" id="token-preview-socials">
              <li data-social="twitter" class="hidden"><span class="material-symbols-outlined">alternate_email</span> twitter.com</li>
              <li data-social="telegram" class="hidden"><span class="material-symbols-outlined">forum</span> telegram</li>
              <li data-social="website" class="hidden"><span class="material-symbols-outlined">language</span> website</li>
            </ul>
            <div class="preview-pump-params">
              <div>
                <label>Dev Buy</label>
                <strong id="preview-dev-buy">0.20 SOL</strong>
              </div>
              <div>
                <label>Slippage</label>
                <strong id="preview-slippage">1.0%</strong>
              </div>
              <div>
                <label>Priority Fee</label>
                <strong id="preview-priority-fee">0.000005</strong>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  `;

  document.body.appendChild(tokenCreationModal);

  const form = tokenCreationModal.querySelector('#token-creation-form');
  form.addEventListener('submit', handleTokenCreationSubmit, { once: true });
  form.addEventListener('input', () => updateTokenPreview(form));

  const logoInput = form.querySelector('#token-logo');
  if (logoInput && !logoInput.dataset.initialized) {
    logoInput.addEventListener('change', handleTokenLogoChange);
    logoInput.dataset.initialized = 'true';
  }

  updateTokenPreview(form);
}

function closeTokenCreationForm() {
  if (tokenCreationModal) {
    const form = tokenCreationModal.querySelector('#token-creation-form');
    if (form) {
      form.removeEventListener('submit', handleTokenCreationSubmit);
    }
    tokenCreationModal.remove();
    tokenCreationModal = null;
  }
}

async function handleTokenCreationSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);

  const tokenData = {
    name: formData.get('token-name')?.trim(),
    symbol: formData.get('token-symbol')?.trim(),
    description: formData.get('token-description')?.trim(),
    twitter: formData.get('token-twitter')?.trim(),
    telegram: formData.get('token-telegram')?.trim(),
    website: formData.get('token-website')?.trim(),
    devBuyAmount: parseFloat(formData.get('dev-buy-amount')) || 0,
    slippage: parseFloat(formData.get('slippage')) || 1.0,
    priorityFee: formData.get('priority-fee')?.trim() || '0.000005',
    logoFile: formData.get('token-logo')
  };

  if (tokenData.logoFile && tokenData.logoFile.size === 0) {
    tokenData.logoFile = null;
  }

  const validationErrors = validateTokenFormData(tokenData);
  if (validationErrors.length) {
    showSnackbar(validationErrors[0], 'error');
    return;
  }

  closeTokenCreationForm();
  await submitTokenCreation(tokenData);
}

function updateTokenPreview(form) {
  if (!tokenCreationModal) return;
  const previewName = tokenCreationModal.querySelector('#token-preview-name');
  const previewSymbol = tokenCreationModal.querySelector('#token-preview-symbol');
  const previewDescription = tokenCreationModal.querySelector('#token-preview-description');
  const previewDevBuy = tokenCreationModal.querySelector('#preview-dev-buy');
  const previewSlippage = tokenCreationModal.querySelector('#preview-slippage');
  const previewPriority = tokenCreationModal.querySelector('#preview-priority-fee');
  const socialsList = tokenCreationModal.querySelector('#token-preview-socials');

  const name = form.querySelector('#token-name')?.value?.trim() || 'Your token name';
  const symbol = form.querySelector('#token-symbol')?.value?.trim() || 'SYMB';
  const description = form.querySelector('#token-description')?.value?.trim() || 'Add a compelling description to help holders understand your mission.';
  const devBuy = form.querySelector('#dev-buy-amount')?.value || '0.20';
  const slippage = form.querySelector('#slippage')?.value || '1.0';
  const priorityFee = form.querySelector('#priority-fee')?.value || '0.000005';

  if (previewName) previewName.textContent = name;
  if (previewSymbol) previewSymbol.textContent = symbol.toUpperCase();
  if (previewDescription) previewDescription.textContent = description;
  if (previewDevBuy) previewDevBuy.textContent = `${devBuy} SOL`;
  if (previewSlippage) previewSlippage.textContent = `${slippage}%`;
  if (previewPriority) previewPriority.textContent = priorityFee;

  if (socialsList) {
    ['twitter', 'telegram', 'website'].forEach((social) => {
      const value = form.querySelector(`#token-${social}`)?.value?.trim();
      const item = socialsList.querySelector(`[data-social="${social}"]`);
      if (item) {
        if (value) {
          const hostname = value.replace(/https?:\/\//, '').split('/')[0] || value;
          item.classList.remove('hidden');
          item.querySelector('span.material-symbols-outlined').nextSibling?.remove;
          item.lastChild?.remove;
          item.textContent = hostname;
          item.prepend(item.dataset.iconElement || document.createElement('span'));
        } else {
          item.classList.add('hidden');
        }
      }
    });
  }
}

function handleTokenLogoChange(event) {
  const file = event.target?.files?.[0];
  const previewLogo = tokenCreationModal?.querySelector('#token-preview-logo');
  if (!previewLogo) return;

  if (file) {
    const img = document.createElement('img');
    img.alt = 'Token logo preview';
    img.className = 'preview-logo-image';
    const reader = new FileReader();
    reader.onload = () => {
      img.src = reader.result;
      previewLogo.innerHTML = '';
      previewLogo.appendChild(img);
    };
    reader.readAsDataURL(file);
  } else {
    previewLogo.innerHTML = '<span class="material-symbols-outlined">token</span>';
  }
}

async function submitTokenCreation(tokenData) {
  if (!currentUser || !OrchestratorAPI || !DatabaseAPI) {
    showSnackbar('Missing wallet context. Please reconnect and try again.', 'error');
    return;
  }

  try {
    if (!currentUser.dev_public_key) {
      showSnackbar(DEV_WALLET_REQUIRED_MESSAGE, 'warning');
      return;
    }

    const devBalance = parseFloat(currentUser?.dev_balance_sol || '0');
    if (devBalance < DEV_WALLET_MIN_SOL_FOR_TOKENS) {
      showSnackbar(`Developer wallet needs at least ${DEV_WALLET_MIN_SOL_FOR_TOKENS} SOL before creating tokens.`, 'warning');
      return;
    }

    if (tokenData.devBuyAmount > devBalance) {
      showSnackbar('Dev buy amount exceeds developer wallet SOL balance.', 'error');
      return;
    }

    const logoBase64 = tokenData.logoFile ? await readFileAsBase64(tokenData.logoFile) : '';

    const payload = {
      name: tokenData.name,
      symbol: tokenData.symbol,
      description: tokenData.description || '',
      twitter: tokenData.twitter || '',
      telegram: tokenData.telegram || '',
      website: tokenData.website || '',
      devBuyAmount: tokenData.devBuyAmount.toString(),
      slippage: tokenData.slippage,
      priorityFee: tokenData.priorityFee || '0.000005',
      logoBase64
    };

    const orchestratorResponse = await OrchestratorAPI.createAndBuyToken(currentUser.user_wallet_id, payload);
    if (!orchestratorResponse) {
      return;
    }

    const tokenRecord = {
      name: tokenData.name,
      symbol: tokenData.symbol,
      description: tokenData.description || null,
      image_url: orchestratorResponse.image_url || orchestratorResponse.imageUrl || null,
      twitter: tokenData.twitter || null,
      telegram: tokenData.telegram || null,
      website: tokenData.website || null,
      dev_buy_amount: tokenData.devBuyAmount,
      contract_address: orchestratorResponse.contract_address || orchestratorResponse.contractAddress || null
    };

    await DatabaseAPI.createToken(currentUser.user_wallet_id, tokenRecord);
    await refreshUserData();
    await loadTokens();
    showSnackbar(`Token "${tokenData.name}" saved to dashboard`, 'success');
  } catch (error) {
    if (error?.code === 'DEV_WALLET_NOT_READY') {
      showSnackbar('Developer wallet is still being prepared. Please try again shortly.', 'warning');
      updateDevWalletStatus(currentUser);
    } else {
      console.error('❌ Failed to submit token creation:', error);
      showSnackbar('Failed to create token', 'error');
    }
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Show bundler balance input modal with integer validation
 */
function showBundlerBalanceInput() {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'bundler-balance-modal';
    
    const maxBalance = Math.floor(parseFloat(currentUser.balance_sol));
    
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <span class="material-symbols-outlined">inventory_2</span>
          <h3>Create Bundler</h3>
        </div>
        <div class="modal-body">
          <div class="bundler-balance-input">
            <p>Enter the SOL amount for your bundler (integers only)</p>
            
            <div class="balance-info">
              <div class="info-row">
                <label>Available Balance:</label>
                <span class="balance-value">${currentUser.distributor_balance_sol} SOL</span>
              </div>
              <div class="info-row">
                <label>Maximum Allowed:</label>
                <span class="balance-value">${maxBalance} SOL</span>
              </div>
              <div class="info-row">
                <label>Minimum Required:</label>
                <span class="balance-value">1 SOL</span>
              </div>
            </div>
            
            <div class="form-group">
              <label for="bundler-balance-input">Bundler Balance (SOL)</label>
              <input 
                type="number" 
                id="bundler-balance-input" 
                min="1" 
                max="${maxBalance}" 
                step="1" 
                placeholder="Enter integer value (e.g., 3)"
                class="balance-input"
              />
              <div class="input-help">
                Only whole numbers (integers) are allowed
              </div>
              <div class="error-message" id="balance-error" style="display: none;"></div>
            </div>
            
            <div class="modal-actions">
              <button class="secondary-button" onclick="closeBundlerBalanceModal()">
                <span class="material-symbols-outlined">close</span>
                Cancel
              </button>
              <button class="primary-button" onclick="validateAndSubmitBalance()">
                <span class="material-symbols-outlined">add</span>
                Create Bundler
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Focus on input
    setTimeout(() => {
      const input = document.getElementById('bundler-balance-input');
      if (input) {
        input.focus();
        
        // Add real-time validation
        input.addEventListener('input', function() {
          validateBundlerBalanceInput();
        });
        
        // Handle Enter key
        input.addEventListener('keypress', function(e) {
          if (e.key === 'Enter') {
            validateAndSubmitBalance();
          }
        });
      }
    }, 100);
    
    // Store resolve function globally for button handlers
    window.bundlerBalanceResolve = resolve;
  });
}

/**
 * Validate bundler balance input in real-time
 */
function validateBundlerBalanceInput() {
  const input = document.getElementById('bundler-balance-input');
  const errorDiv = document.getElementById('balance-error');
  const submitBtn = document.querySelector('#bundler-balance-modal .primary-button');
  
  if (!input || !errorDiv || !submitBtn) return;
  
  const value = input.value.trim();
  const maxBalance = Math.floor(parseFloat(currentUser.distributor_balance_sol));
  
  // Clear previous error
  errorDiv.style.display = 'none';
  errorDiv.textContent = '';
  input.classList.remove('error');
  submitBtn.disabled = false;
  
  if (!value) {
    return; // Empty is okay, we'll validate on submit
  }
  
  // Check if it's a valid integer
  if (!/^[0-9]+$/.test(value)) {
    showInputError('Only whole numbers (integers) are allowed');
    return;
  }
  
  const balance = parseInt(value);
  
  // Check minimum
  if (balance < 1) {
    showInputError('Minimum bundler balance is 1 SOL');
    return;
  }
  
  // Check maximum
  if (balance > maxBalance) {
    showInputError(`Maximum available balance is ${maxBalance} SOL`);
    return;
  }
  
  function showInputError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    input.classList.add('error');
    submitBtn.disabled = true;
  }
}

/**
 * Validate and submit bundler balance
 */
function validateAndSubmitBalance() {
  console.log('🔄 [DEBUG] validateAndSubmitBalance called');
  
  const input = document.getElementById('bundler-balance-input');
  if (!input) {
    console.error('❌ [DEBUG] bundler-balance-input not found');
    return;
  }
  
  const value = input.value.trim();
  const maxBalance = Math.floor(parseFloat(currentUser.balance_sol));
  
  if (!value) {
    showSnackbar('Please enter a bundler balance', 'warning');
    return;
  }
  
  if (!/^[0-9]+$/.test(value)) {
    showSnackbar('Only whole numbers (integers) are allowed', 'error');
    return;
  }
  
  const balance = parseInt(value);
  
  if (balance < 1) {
    showSnackbar('Minimum bundler balance is 1 SOL', 'error');
    return;
  }
  
  if (balance > maxBalance) {
    showSnackbar(`Maximum available balance is ${maxBalance} SOL`, 'error');
    return;
  }
  
  // Valid balance, close modal and resolve
  console.log('✅ [DEBUG] Valid balance entered:', balance);
  console.log('✅ [DEBUG] Resolving promise with balance:', balance);
  
  // Set flag to indicate successful submission
  window.bundlerBalanceSubmitted = true;
  
  if (window.bundlerBalanceResolve) {
    console.log('✅ [DEBUG] Calling resolve function');
    window.bundlerBalanceResolve(balance);
    window.bundlerBalanceResolve = null;
  } else {
    console.error('❌ [DEBUG] bundlerBalanceResolve function not found');
  }
  
  closeBundlerBalanceModal();
}

/**
 * Close bundler balance input modal
 */
function closeBundlerBalanceModal() {
  console.log('🔄 [DEBUG] closeBundlerBalanceModal called');
  
  const modal = document.getElementById('bundler-balance-modal');
  if (modal) {
    console.log('✅ [DEBUG] Removing modal from DOM');
    modal.remove();
  } else {
    console.log('❌ [DEBUG] Modal not found in DOM');
  }
  
  // Clean up resolve function only if called from cancel
  // Don't resolve with null if called from successful submission
  if (window.bundlerBalanceResolve && !window.bundlerBalanceSubmitted) {
    console.log('🔄 [DEBUG] User cancelled, resolving with null');
    window.bundlerBalanceResolve(null);
    window.bundlerBalanceResolve = null;
  }
  
  // Reset the submitted flag
  window.bundlerBalanceSubmitted = false;
}

/**
 * Show funding prompt when user needs to add SOL
 */
function showFundingPrompt() {
  if (!currentUser) return;
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'funding-prompt-modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <span class="material-symbols-outlined" style="color: var(--md-sys-color-warning);">account_balance_wallet</span>
        <h3>Fund Your Distributor Wallet</h3>
      </div>
      <div class="modal-body">
        <div class="funding-content">
          <div class="balance-status">
            <div class="balance-item">
              <label>Current Balance:</label>
              <span class="balance-value">${DatabaseAPI.formatBalance(currentUser.distributor_balance_sol)} SOL</span>
            </div>
            <div class="balance-item">
              <label>Required for Bundlers:</label>
              <span class="balance-value required">≥1 SOL</span>
            </div>
          </div>
          
          <div class="funding-instructions">
            <h5>To create bundlers, you need:</h5>
            <ul class="requirements-list">
              <li>At least 1 SOL in your distributor wallet</li>
              <li>Additional SOL for each bundler you create</li>
              <li>Each bundler requires integer amounts (1, 2, 3 SOL, etc.)</li>
            </ul>
          </div>
          
          <div class="wallet-address-display">
            <label>Send SOL to this address:</label>
            <div class="key-display">
              <span class="key-text">${DatabaseAPI.truncateAddress(currentUser.distributor_public_key, 8, 8)}</span>
              <button class="copy-btn" onclick="copyDistributorAddress()">
                <span class="material-symbols-outlined">content_copy</span>
              </button>
            </div>
          </div>
          
          <div class="modal-actions">
            <button class="secondary-button" onclick="closeFundingPrompt()">
              <span class="material-symbols-outlined">close</span>
              Later
            </button>
            <button class="primary-button" onclick="verifyBalance(); closeFundingPrompt();">
              <span class="material-symbols-outlined">refresh</span>
              Verify Balance
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

/**
 * Close funding prompt modal
 */
function closeFundingPrompt() {
  const modal = document.getElementById('funding-prompt-modal');
  if (modal) {
    modal.remove();
  }
}

/**
 * Handle refresh registration status
 */
async function handleRefreshRegistration() {
  try {
    if (!currentWallet) return;
    
    const walletId = currentWallet.publicKey.toString();
    
    // Check if user exists in database now
    const user = await DatabaseAPI.getUserByWalletId(walletId);
    
    if (user) {
      currentUser = user;
      hideRegistrationPrompt();
      await loadDashboardData();
      setupRealtimeSubscriptions();
      showSnackbar('Registration confirmed! Welcome to Solanafied!', 'success');
    } else {
      showSnackbar('User still not registered. Please create your distributor wallet first.', 'warning');
    }
    
  } catch (error) {
    console.error('❌ Failed to refresh registration:', error);
    showSnackbar('Failed to check registration status', 'error');
  }
}

// ========== USER ACTIONS ==========

/**
 * Toggle bundler status
 */
async function toggleBundlerStatus(bundlerId, newStatus) {
  try {
    showLoadingOverlay(true, 'Updating bundler...');
    
    await DatabaseAPI.updateBundlerStatus(bundlerId, newStatus);
    
    // Refresh bundlers list
    await loadBundlers();
    
  } catch (error) {
    console.error('❌ Failed to toggle bundler status:', error);
    showSnackbar('Failed to update bundler status', 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Create new bundler
 */
async function createBundler() {
  try {
    console.log('🚀 [DEBUG] createBundler called');
    console.log('🚀 [DEBUG] currentUser:', currentUser);
    console.log('🚀 [DEBUG] OrchestratorAPI available:', !!OrchestratorAPI);
    console.log('🚀 [DEBUG] OrchestratorAPI.createBundler type:', typeof OrchestratorAPI?.createBundler);
    
    if (!currentUser || !OrchestratorAPI) {
      console.log('❌ [DEBUG] Missing currentUser or OrchestratorAPI');
      showSnackbar('Please create a distributor wallet first', 'warning');
      return;
    }
    
    // Check if user has sufficient balance (must be >= 1 SOL as per workflow)
    if (parseFloat(currentUser.distributor_balance_sol) < 1) {
      showSnackbar('You need at least 1 SOL to create a bundler. Please fund your distributor wallet first.', 'warning');
      showFundingPrompt();
      return;
    }
    
    // Show bundler balance input modal
    console.log('🔄 [DEBUG] Showing bundler balance input modal');
    const balance = await showBundlerBalanceInput();
    console.log('📥 [DEBUG] Received balance from modal:', balance);
    
    if (!balance) {
      console.log('❌ [DEBUG] No balance received, user cancelled or invalid input');
      return; // User cancelled or invalid input
    }
    
    // Generate idempotency key for reliability
    const idempotencyKey = generateIdempotencyKey();
    
    console.log('📤 [BUNDLER_CREATION] Sending request to orchestrator:', {
      user_wallet_id: currentUser.user_wallet_id,
      bundler_balance: balance,
      idempotency_key: idempotencyKey
    });
    
    // Create bundler via orchestrator
    console.log('🔄 [DEBUG] Calling OrchestratorAPI.createBundler with:', {
      userWalletId: currentUser.user_wallet_id,
      balance: balance,
      idempotencyKey: idempotencyKey
    });
    
    const result = await OrchestratorAPI.createBundler(currentUser.user_wallet_id, balance, idempotencyKey);
    
    console.log('📥 [DEBUG] API call result:', result);
    
    if (result) {
      console.log('✅ [BUNDLER_CREATION] Success response:', result);
      
      // Show success message with details
      showSnackbar(`Bundler created successfully! Allocated ${result.allocatedMotherWallets?.length || 'N/A'} mother wallets`, 'success');
      
      // Refresh data
      await refreshUserData();
      await loadBundlers();
      
      // Show bundler creation success details
      showBundlerCreationSuccess(result);
    } else {
      console.log('❌ [DEBUG] API returned null/falsy result');
    }
    
  } catch (error) {
    console.error('❌ Failed to create bundler:', error);
    showSnackbar('Failed to create bundler', 'error');
  }
}

/**
 * Create token on Pump.fun
 */
async function addToken() {
  try {
    if (!currentUser || !OrchestratorAPI) {
      showSnackbar('Please create a distributor wallet first', 'warning');
      return;
    }

    // Ensure developer wallet is ready
    if (!currentUser.dev_public_key) {
      showSnackbar(DEV_WALLET_REQUIRED_MESSAGE, 'warning');
      return;
    }

    const devBalance = parseFloat(currentUser?.dev_balance_sol || '0');
    if (isNaN(devBalance) || devBalance < DEV_WALLET_MIN_SOL_FOR_TOKENS) {
      showSnackbar(`Developer wallet needs at least ${DEV_WALLET_MIN_SOL_FOR_TOKENS} SOL before creating tokens.`, 'warning');
      return;
    }

    // Check if user has active bundler
    const bundlers = await DatabaseAPI.getUserBundlers(currentUser.user_wallet_id);
    const activeBundler = bundlers.find(b => b.is_active);

    if (!activeBundler) {
      showSnackbar('You need an active bundler to create tokens', 'warning');
      return;
    }
    
    // Show token creation form
    showTokenCreationForm();
  } catch (error) {
    console.error('❌ Failed to create token:', error);
    showSnackbar('Failed to create token', 'error');
  }
}

/**
 * Verify in-app wallet balance
 */
async function verifyBalance() {
  try {
    if (!currentUser || !OrchestratorAPI) {
      showSnackbar('Please create a distributor wallet first', 'warning');
      return;
    }
    
    showLoadingOverlay(true, 'Verifying balance...');
    
    const result = await OrchestratorAPI.verifyInAppBalance(currentUser.user_wallet_id);
    
    if (result && result.balanceUpdated) {
      // Refresh user data to get updated balance
      await refreshUserData();
      await loadDashboardData();
      
      // Check if balance now meets bundler creation requirements
      const newBalance = parseFloat(result.currentBalance);
      
      if (newBalance >= 1) {
        showSnackbar(`Balance verified: ${result.currentBalance} SOL - You can now create bundlers!`, 'success');
        
        // Show bundler creation prompt if balance is sufficient
        showBundlerCreationAvailable(newBalance);
      } else {
        showSnackbar(`Balance verified: ${result.currentBalance} SOL - Need at least 1 SOL for bundlers`, 'info');
      }
    } else if (result) {
      showSnackbar(`Balance unchanged: ${result.currentBalance} SOL`, 'info');
    }
    
  } catch (error) {
    console.error('❌ Failed to verify balance:', error);
    showSnackbar('Failed to verify distributor balance', 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Show bundler creation available prompt
 */
function showBundlerCreationAvailable(balance) {
  if (bundlerAvailableModal) {
    bundlerAvailableModal.remove();
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'bundler-available-modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <span class="material-symbols-outlined" style="color: var(--md-sys-color-success);">check_circle</span>
        <h3>Ready to Create Bundlers!</h3>
      </div>
      <div class="modal-body">
        <div class="bundler-available-content">
          <div class="success-icon">
            <span class="material-symbols-outlined">inventory_2</span>
          </div>
          <h4>Your wallet is funded!</h4>
          <p>You now have sufficient balance to create bundlers and start token operations.</p>
          
          <div class="balance-display-large">
            <label>Available Balance:</label>
            <span class="balance-value">${DatabaseAPI.formatBalance(balance)} SOL</span>
          </div>
          
          <div class="bundler-info">
            <h5>Bundler Creation Rules:</h5>
            <ul class="info-list">
              <li><strong>Integer amounts only:</strong> 1, 2, 3, 4 SOL, etc.</li>
              <li><strong>Distributor wallet purpose:</strong> Each bundler becomes a distributor wallet for token creation</li>
              <li><strong>Mother wallet allocation:</strong> 1 SOL = 1 mother wallet assigned</li>
              <li><strong>Child wallet distribution:</strong> Each mother wallet has 4 child wallets</li>
            </ul>
          </div>
          
          <div class="modal-actions">
            <button class="secondary-button" onclick="closeBundlerAvailableModal()">
              <span class="material-symbols-outlined">close</span>
              Later
            </button>
            <button class="primary-button" onclick="closeBundlerAvailableModal(); createBundler();">
              <span class="material-symbols-outlined">inventory_2</span>
              Create Bundler
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

/**
 * Transfer SOL to owner wallet
 */
async function transferToOwner() {
  try {
    if (!currentUser || !OrchestratorAPI) {
      showSnackbar('Please create a distributor wallet first', 'warning');
      return;
    }

    if (parseFloat(currentUser.distributor_balance_sol) <= 0) {
      showSnackbar('No SOL available to transfer', 'warning');
      return;
    }

    const amount = prompt(`Enter amount to transfer (SOL):\n\nAvailable: ${currentUser.distributor_balance_sol} SOL`);
    if (!amount || isNaN(amount)) return;

    const transferAmount = parseFloat(amount);
    if (transferAmount <= 0) {
      showSnackbar('Transfer amount must be greater than 0', 'error');
      return;
    }

    if (transferAmount > parseFloat(currentUser.distributor_balance_sol)) {
      showSnackbar('Insufficient balance', 'error');
      return;
    }
    
    const result = await OrchestratorAPI.transferToOwner(currentUser.user_wallet_id, transferAmount);
    
    if (result) {
      // Refresh data
      await refreshUserData();
    }
    
  } catch (error) {
    console.error('❌ Failed to transfer to owner:', error);
    showSnackbar('Failed to transfer SOL', 'error');
  }
}

/**
 * Copy connected wallet address to clipboard
 */
async function copyAddress() {
  try {
    const walletAddress = currentWallet?.publicKey?.toString();
    if (!walletAddress) {
      showSnackbar('Connect a wallet first', 'warning');
      return;
    }

    await navigator.clipboard.writeText(walletAddress);
    showSnackbar('Wallet address copied to clipboard', 'success');
  } catch (error) {
    console.error('❌ Failed to copy wallet address:', error);
    showSnackbar('Failed to copy wallet address', 'error');
  }
}

/**
 * Copy distributor wallet address to clipboard
 */
async function copyDistributorAddress() {
  try {
    if (!currentUser || !currentUser.distributor_public_key) return;
    await navigator.clipboard.writeText(currentUser.distributor_public_key);
    showSnackbar('Distributor wallet address copied to clipboard', 'success');
  } catch (error) {
    console.error('❌ Failed to copy distributor address:', error);
    showSnackbar('Failed to copy distributor address', 'error');
  }
}

async function copyDevWalletAddress() {
  try {
    if (!currentUser || !currentUser.dev_public_key) return;
    await navigator.clipboard.writeText(currentUser.dev_public_key);
    showSnackbar('Developer wallet address copied to clipboard', 'success');
  } catch (error) {
    console.error('❌ Failed to copy developer address:', error);
    showSnackbar('Failed to copy developer address', 'error');
  }
}

// ========== REAL-TIME UPDATES ==========

// ========== REALTIME SUBSCRIPTIONS ==========

function setupRealtimeSubscriptions() {
  if (!DatabaseAPI || typeof DatabaseAPI.getUserByWalletId !== 'function') return;
  if (!currentUser || !supabaseClient) return;

  teardownRealtimeSubscriptions();

  try {
    // Subscribe to bundler updates
    const bundlerSub = supabaseClient
      .channel('bundlers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bundlers', filter: `user_wallet_id=eq.${currentUser.user_wallet_id}` }, async () => {
        await loadBundlers();
      })
      .subscribe();

    // Subscribe to user balance updates
    const userSub = supabaseClient
      .channel('users-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `user_wallet_id=eq.${currentUser.user_wallet_id}` }, async () => {
        await refreshUserData();
      })
      .subscribe();

    subscriptions.push(bundlerSub, userSub);
  } catch (error) {
    console.error('❌ Failed to set up realtime subscriptions:', error);
  }
}

function teardownRealtimeSubscriptions() {
  if (!subscriptions.length) return;
  subscriptions.forEach((sub) => {
    if (sub && typeof sub.unsubscribe === 'function') {
      sub.unsubscribe();
    } else if (sub && typeof supabaseClient?.removeChannel === 'function') {
      supabaseClient.removeChannel(sub);
    }
  });
  subscriptions = [];
}

// ... rest of the code remains the same ...

// Export functions for global access
window.SolanafiedApp = {
  connectWallet,
  disconnectWallet,
  toggleBundlerStatus,
  createBundler,
  addToken,
  refreshBundlers,
  copyAddress,
  copyDistributorAddress,
  copyDevWalletAddress,
  toggleTheme
};

function initializeApp() {
  console.log('🚀 Initializing Solanafied...');
  initializeTheme();

  const connectBtn = document.getElementById('wallet-connect');
  if (connectBtn && !connectBtn.dataset.initialized) {
    connectBtn.addEventListener('click', connectWallet);
    connectBtn.dataset.initialized = 'true';
  }

  const themeToggleBtn = document.getElementById('theme-toggle');
  if (themeToggleBtn && !themeToggleBtn.dataset.initialized) {
    themeToggleBtn.addEventListener('click', toggleTheme);
    themeToggleBtn.dataset.initialized = 'true';
    updateThemeToggleIcon();
  }

  updateWalletUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
