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
    
    // Try to get existing user
    let user = await DatabaseAPI.getUserByWalletId(walletId);
    
    if (!user) {
      // Show registration prompt for new users
      showRegistrationPrompt();
      return;
    }
    
    currentUser = user;
    console.log('✅ User initialized:', user);
    
    // Update balance display from database
    updateBalanceDisplay(user.balance_sol, user.balance_spl);
    
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
    
    // Get updated user data from database
    const updatedUser = await DatabaseAPI.getUserByWalletId(currentUser.user_wallet_id);
    
    if (updatedUser) {
      currentUser = updatedUser;
      console.log('🔄 User data refreshed:', updatedUser);
      
      // Update balance display
      updateBalanceDisplay(updatedUser.balance_sol, updatedUser.balance_spl);
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
    
    // Show dashboard
    document.getElementById('dashboard').style.display = 'grid';
    
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
  
  const formattedSol = DatabaseAPI.formatBalance(solBalance);
  const formattedSpl = DatabaseAPI.formatBalance(splBalance);
  
  if (solBalanceEl) solBalanceEl.textContent = formattedSol;
  if (splBalanceEl) splBalanceEl.textContent = formattedSpl;
  if (profileSolEl) profileSolEl.textContent = formattedSol;
  if (profileSplEl) profileSplEl.textContent = formattedSpl;
}

/**
 * Show/hide dashboard
 */
function hideDashboard() {
  document.getElementById('dashboard').style.display = 'none';
  hideRegistrationPrompt();
}

/**
 * Show registration prompt for unregistered users
 */
function showRegistrationPrompt() {
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
          <h3>Create In-App Wallet</h3>
        </div>
        <div class="card-content">
          <div class="registration-content">
            <div class="registration-icon">
              <span class="material-symbols-outlined">account_balance_wallet</span>
            </div>
            <h4>Welcome to Solanafied!</h4>
            <p>Your wallet is connected, but you need to create an in-app wallet to access all features.</p>
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
                Create In-App Wallet
              </button>
              <button id="refresh-registration-btn" class="secondary-button">
                <span class="material-symbols-outlined">refresh</span>
                Check Status
              </button>
            </div>
            <p class="registration-note">
              <span class="material-symbols-outlined">info</span>
              Your in-app wallet will be created securely by our backend system.
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
    // Update user ID display
    document.getElementById('user-id').textContent = DatabaseAPI.truncateAddress(currentUser.user_wallet_id);
    
    // Load data in parallel
    await Promise.all([
      loadBundlers(),
      loadMotherWallets(),
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
    
    if (bundlers.length === 0) {
      bundlersList.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-outlined">inventory_2</span>
          <p>No bundlers found</p>
          <button onclick="createBundler()" class="empty-action-btn">Create your first bundler</button>
        </div>
      `;
      return;
    }
    
    bundlersList.innerHTML = bundlers.map(bundler => `
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
          <span class="status-chip ${bundler.is_active ? 'active' : 'inactive'}">
            ${bundler.is_active ? 'Active' : 'Inactive'}
          </span>
          <button class="icon-button" onclick="toggleBundlerStatus(${bundler.id}, ${!bundler.is_active})">
            <span class="material-symbols-outlined">
              ${bundler.is_active ? 'pause' : 'play_arrow'}
            </span>
          </button>
        </div>
      </div>
    `).join('');
    
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
 * Load mother wallets data
 */
async function loadMotherWallets(filter = 'all') {
  try {
    const walletsList = document.getElementById('mother-wallets-list');
    walletsList.innerHTML = '<div class="loading-state"><div class="spinner"></div><span>Loading wallets...</span></div>';
    
    const wallets = await DatabaseAPI.getMotherWallets(filter);
    
    if (wallets.length === 0) {
      walletsList.innerHTML = `
        <div class="empty-state">
          <span class="material-symbols-outlined">folder</span>
          <p>No ${filter === 'all' ? '' : filter} wallets found</p>
        </div>
      `;
      return;
    }
    
    walletsList.innerHTML = wallets.map(wallet => `
      <div class="list-item" data-wallet-id="${wallet.id}">
        <div class="list-item-icon">
          <span class="material-symbols-outlined">folder</span>
        </div>
        <div class="list-item-content">
          <div class="list-item-title">${DatabaseAPI.truncateAddress(wallet.public_key)}</div>
          <div class="list-item-subtitle">
            Balance: ${DatabaseAPI.formatBalance(wallet.balance_sol)} SOL
          </div>
        </div>
        <div class="list-item-trailing">
          <span class="status-chip ${wallet.is_available ? 'available' : 'assigned'}">
            ${wallet.is_available ? 'Available' : 'Assigned'}
          </span>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('❌ Failed to load mother wallets:', error);
    document.getElementById('mother-wallets-list').innerHTML = `
      <div class="error-state">
        <span class="material-symbols-outlined">error</span>
        <p>Failed to load wallets</p>
        <button onclick="loadMotherWallets('${filter}')" class="retry-btn">Retry</button>
      </div>
    `;
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
    
    // Create in-app wallet via orchestrator
    const result = await OrchestratorAPI.createInAppWallet(walletId);
    
    if (result) {
      // Refresh user data from database
      await refreshUserData();
      
      // Hide registration prompt and show dashboard
      hideRegistrationPrompt();
      await loadDashboardData();
      setupRealtimeSubscriptions();
      
      // Show in-app wallet details and funding prompt
      showInAppWalletCreated(result.inAppPublicKey, result.balanceSol);
    }
    
  } catch (error) {
    console.error('❌ Failed to create in-app wallet:', error);
    showSnackbar('Failed to create in-app wallet', 'error');
  }
}

/**
 * Show in-app wallet created success with funding prompt
 */
function showInAppWalletCreated(inAppPublicKey, balanceSol) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'wallet-created-modal';
  
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <span class="material-symbols-outlined" style="color: var(--md-sys-color-success);">check_circle</span>
        <h3>In-App Wallet Created!</h3>
      </div>
      <div class="modal-body">
        <div class="wallet-created-content">
          <div class="success-icon">
            <span class="material-symbols-outlined">account_balance_wallet</span>
          </div>
          <h4>Your in-app wallet is ready!</h4>
          <p>Your new in-app wallet has been created and registered in the database.</p>
          
          <div class="wallet-details">
            <div class="detail-item">
              <label>In-App Public Key:</label>
              <div class="key-display">
                <span class="key-text">${DatabaseAPI.truncateAddress(inAppPublicKey, 8, 8)}</span>
                <button class="copy-btn" onclick="copyToClipboard('${inAppPublicKey}')">
                  <span class="material-symbols-outlined">content_copy</span>
                </button>
              </div>
            </div>
            <div class="detail-item">
              <label>Current Balance:</label>
              <span class="balance-display">${balanceSol} SOL</span>
            </div>
          </div>
          
          <div class="funding-prompt">
            <div class="prompt-icon">
              <span class="material-symbols-outlined">send</span>
            </div>
            <h5>Next Steps:</h5>
            <ol class="steps-list">
              <li>Send SOL to your in-app wallet address above</li>
              <li>Click "Verify Balance" once you've sent the funds</li>
              <li>You need at least 1 SOL to create bundlers</li>
            </ol>
          </div>
          
          <div class="modal-actions">
            <button class="secondary-button" onclick="copyToClipboard('${inAppPublicKey}')">
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
        <h3>Fund Your In-App Wallet</h3>
      </div>
      <div class="modal-body">
        <div class="funding-content">
          <div class="balance-status">
            <div class="balance-item">
              <label>Current Balance:</label>
              <span class="balance-value">${DatabaseAPI.formatBalance(currentUser.balance_sol)} SOL</span>
            </div>
            <div class="balance-item">
              <label>Required for Bundlers:</label>
              <span class="balance-value required">1+ SOL</span>
            </div>
          </div>
          
          <div class="funding-instructions">
            <h5>To create bundlers, you need:</h5>
            <ul class="requirements-list">
              <li>More than 1 SOL in your in-app wallet</li>
              <li>Additional SOL for each bundler you create</li>
              <li>Each bundler requires integer amounts (1, 2, 3 SOL, etc.)</li>
            </ul>
          </div>
          
          <div class="wallet-address-display">
            <label>Send SOL to this address:</label>
            <div class="key-display">
              <span class="key-text">${DatabaseAPI.truncateAddress(currentUser.in_app_public_key, 8, 8)}</span>
              <button class="copy-btn" onclick="copyToClipboard('${currentUser.in_app_public_key}')">
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
      showSnackbar('User still not registered. Please create your in-app wallet first.', 'warning');
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
    if (!currentUser || !OrchestratorAPI) {
      showSnackbar('Please create an in-app wallet first', 'warning');
      return;
    }
    
    // Check if user has sufficient balance (must be > 1 SOL as per workflow)
    if (parseFloat(currentUser.balance_sol) <= 1) {
      showSnackbar('You need more than 1 SOL to create a bundler. Please fund your in-app wallet first.', 'warning');
      showFundingPrompt();
      return;
    }
    
    const bundlerBalance = prompt(`Enter bundler balance (SOL):\n\nAvailable: ${currentUser.balance_sol} SOL\nMinimum: 1 SOL`);
    if (!bundlerBalance || isNaN(bundlerBalance)) return;
    
    const balance = parseInt(bundlerBalance);
    if (balance < 1) {
      showSnackbar('Minimum bundler balance is 1 SOL', 'error');
      return;
    }
    
    if (balance > parseFloat(currentUser.balance_sol)) {
      showSnackbar('Insufficient balance in your in-app wallet', 'error');
      return;
    }
    
    // Create bundler via orchestrator
    const result = await OrchestratorAPI.createBundler(currentUser.user_wallet_id, balance);
    
    if (result) {
      // Refresh data
      await refreshUserData();
      await loadBundlers();
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
      showSnackbar('Please create an in-app wallet first', 'warning');
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
    console.error('❌ Failed to check bundler status:', error);
    showSnackbar('Failed to check bundler status', 'error');
  }
}

/**
 * Show token creation form
 */
function showTokenCreationForm() {
  const formHtml = `
    <div class="modal-overlay" id="token-form-modal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>Create Token on Pump.fun</h3>
          <button class="modal-close" onclick="closeTokenForm()">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
        <div class="modal-body">
          <form id="token-creation-form">
            <div class="form-group">
              <label for="token-name">Token Name *</label>
              <input type="text" id="token-name" required maxlength="50">
            </div>
            <div class="form-group">
              <label for="token-symbol">Token Symbol *</label>
              <input type="text" id="token-symbol" required maxlength="10" style="text-transform: uppercase;">
            </div>
            <div class="form-group">
              <label for="token-description">Description</label>
              <textarea id="token-description" rows="3" maxlength="500"></textarea>
            </div>
            <div class="form-group">
              <label for="token-logo">Logo (Base64 or URL)</label>
              <input type="text" id="token-logo" placeholder="data:image/png;base64,... or https://...">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="token-twitter">Twitter</label>
                <input type="text" id="token-twitter" placeholder="@username">
              </div>
              <div class="form-group">
                <label for="token-telegram">Telegram</label>
                <input type="text" id="token-telegram" placeholder="@username">
              </div>
            </div>
            <div class="form-group">
              <label for="token-website">Website</label>
              <input type="url" id="token-website" placeholder="https://...">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="dev-buy-amount">Dev Buy Amount (SOL)</label>
                <input type="number" id="dev-buy-amount" step="0.1" min="0" value="0.1">
              </div>
              <div class="form-group">
                <label for="slippage">Slippage (%)</label>
                <input type="number" id="slippage" step="0.1" min="0.1" max="50" value="1.0">
              </div>
            </div>
            <div class="form-group">
              <label for="priority-fee">Priority Fee (SOL)</label>
              <input type="number" id="priority-fee" step="0.000001" min="0" value="0.000005">
            </div>
            <div class="form-actions">
              <button type="button" class="secondary-button" onclick="closeTokenForm()">Cancel</button>
              <button type="submit" class="primary-button">Create Token</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', formHtml);
  
  // Add form submit handler
  document.getElementById('token-creation-form').addEventListener('submit', handleTokenCreation);
}

/**
 * Close token creation form
 */
function closeTokenForm() {
  const modal = document.getElementById('token-form-modal');
  if (modal) {
    modal.remove();
  }
}

/**
 * Handle token creation form submission
 */
async function handleTokenCreation(event) {
  event.preventDefault();
  
  try {
    const formData = new FormData(event.target);
    
    const tokenData = {
      name: document.getElementById('token-name').value.trim(),
      symbol: document.getElementById('token-symbol').value.trim().toUpperCase(),
      description: document.getElementById('token-description').value.trim(),
      logoBase64: document.getElementById('token-logo').value.trim(),
      twitter: document.getElementById('token-twitter').value.trim(),
      telegram: document.getElementById('token-telegram').value.trim(),
      website: document.getElementById('token-website').value.trim(),
      devBuyAmount: document.getElementById('dev-buy-amount').value,
      slippage: parseFloat(document.getElementById('slippage').value),
      priorityFee: document.getElementById('priority-fee').value
    };
    
    if (!tokenData.name || !tokenData.symbol) {
      showSnackbar('Token name and symbol are required', 'error');
      return;
    }
    
    closeTokenForm();
    
    // Create token via orchestrator
    const result = await OrchestratorAPI.createAndBuyToken(currentUser.user_wallet_id, tokenData);
    
    if (result) {
      // Refresh data
      await refreshUserData();
      await loadBundlers();
      await loadTokens();
    }
    
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
      showSnackbar('Please create an in-app wallet first', 'warning');
      return;
    }
    
    const result = await OrchestratorAPI.verifyInAppBalance(currentUser.user_wallet_id);
    
    if (result && result.balanceUpdated) {
      // Refresh user data
      await refreshUserData();
      await loadDashboardData();
    }
    
  } catch (error) {
    console.error('❌ Failed to verify balance:', error);
    showSnackbar('Failed to verify balance', 'error');
  }
}

/**
 * Transfer SOL to owner wallet
 */
async function transferToOwner() {
  try {
    if (!currentUser || !OrchestratorAPI) {
      showSnackbar('Please create an in-app wallet first', 'warning');
      return;
    }
    
    if (parseFloat(currentUser.balance_sol) <= 0) {
      showSnackbar('No SOL available to transfer', 'warning');
      return;
    }
    
    const amount = prompt(`Enter amount to transfer (SOL):\n\nAvailable: ${currentUser.balance_sol} SOL`);
    if (!amount || isNaN(amount)) return;
    
    const transferAmount = parseFloat(amount);
    if (transferAmount <= 0) {
      showSnackbar('Transfer amount must be greater than 0', 'error');
      return;
    }
    
    if (transferAmount > parseFloat(currentUser.balance_sol)) {
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
 * Refresh bundlers
 */
async function refreshBundlers() {
  await loadBundlers();
  showSnackbar('Bundlers refreshed', 'success');
}

/**
 * Copy wallet address to clipboard
 */
async function copyAddress() {
  try {
    if (!currentWallet) return;
    
    await navigator.clipboard.writeText(currentWallet.publicKey.toString());
    showSnackbar('Address copied to clipboard', 'success');
    
  } catch (error) {
    console.error('❌ Failed to copy address:', error);
    showSnackbar('Failed to copy address', 'error');
  }
}

// ========== REAL-TIME UPDATES ==========

/**
 * Set up real-time subscriptions
 */
function setupRealtimeSubscriptions() {
  if (!currentUser || !DatabaseAPI) return;
  
  try {
    // Subscribe to bundler changes
    const bundlerSub = DatabaseAPI.subscribeToBundlerChanges(
      currentUser.user_wallet_id,
      (payload) => {
        console.log('📡 Bundler update received:', payload);
        loadBundlers(); // Refresh bundlers list
      }
    );
    
    if (bundlerSub) subscriptions.push(bundlerSub);
    
    // Subscribe to mother wallet changes
    const walletSub = DatabaseAPI.subscribeToMotherWalletChanges((payload) => {
      console.log('📡 Mother wallet update received:', payload);
      loadMotherWallets(); // Refresh wallets list
    });
    
    if (walletSub) subscriptions.push(walletSub);
    
    console.log('✅ Real-time subscriptions set up');
    
  } catch (error) {
    console.error('❌ Failed to set up subscriptions:', error);
  }
}

// ========== THEME MANAGEMENT ==========

/**
 * Toggle dark/light theme
 */
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  
  // Update theme toggle icon
  const themeToggle = document.getElementById('theme-toggle');
  const icon = themeToggle.querySelector('.material-symbols-outlined');
  icon.textContent = newTheme === 'dark' ? 'light_mode' : 'dark_mode';
}

/**
 * Initialize theme from localStorage or system preference
 */
function initializeTheme() {
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
  
  document.documentElement.setAttribute('data-theme', theme);
  
  // Update theme toggle icon
  const themeToggle = document.getElementById('theme-toggle');
  const icon = themeToggle.querySelector('.material-symbols-outlined');
  icon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
}

// ========== FAB MENU ==========

/**
 * Toggle FAB menu
 */
function toggleFabMenu() {
  const fabMenu = document.getElementById('fab-menu');
  const fab = document.getElementById('main-fab');
  
  fabMenu.classList.toggle('open');
  
  // Rotate FAB icon
  const icon = fab.querySelector('.material-symbols-outlined');
  icon.style.transform = fabMenu.classList.contains('open') ? 'rotate(45deg)' : 'rotate(0deg)';
}

// ========== FILTER HANDLING ==========

/**
 * Handle filter chip clicks
 */
function handleFilterClick(event) {
  if (!event.target.classList.contains('chip')) return;
  
  const filterChips = event.target.parentElement;
  const allChips = filterChips.querySelectorAll('.chip');
  
  // Remove active class from all chips
  allChips.forEach(chip => chip.classList.remove('active'));
  
  // Add active class to clicked chip
  event.target.classList.add('active');
  
  // Get filter value and reload data
  const filter = event.target.getAttribute('data-filter');
  loadMotherWallets(filter);
}

// ========== EVENT LISTENERS ==========

/**
 * Set up all event listeners
 */
function setupEventListeners() {
  // Wallet connection
  document.getElementById('wallet-connect').addEventListener('click', connectWallet);
  
  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  
  // FAB menu
  document.getElementById('main-fab').addEventListener('click', toggleFabMenu);
  
  // Filter chips
  document.querySelector('.filter-chips').addEventListener('click', handleFilterClick);
  
  // Snackbar dismiss
  document.querySelector('.snackbar-action').addEventListener('click', () => {
    document.getElementById('snackbar').classList.remove('show');
  });
  
  // Close FAB menu when clicking outside
  document.addEventListener('click', (event) => {
    const fab = document.getElementById('main-fab');
    const fabMenu = document.getElementById('fab-menu');
    
    if (!fab.contains(event.target) && !fabMenu.contains(event.target)) {
      fabMenu.classList.remove('open');
      fab.querySelector('.material-symbols-outlined').style.transform = 'rotate(0deg)';
    }
  });
  
  // Handle wallet account changes
  if (window.solana) {
    window.solana.on('accountChanged', (publicKey) => {
      if (publicKey) {
        console.log('👤 Account changed:', publicKey.toString());
        // Reconnect with new account
        location.reload();
      } else {
        // Wallet disconnected
        disconnectWallet();
      }
    });
  }
}

// ========== INITIALIZATION ==========

/**
 * Initialize the application
 */
function initializeApp() {
  console.log('🚀 Initializing Solanafied...');
  
  // Initialize theme
  initializeTheme();
  
  // Set up event listeners
  setupEventListeners();
  
  // Check if wallet was previously connected
  if (window.solana && window.solana.isConnected) {
    console.log('🔗 Wallet was previously connected, attempting to reconnect...');
    connectWallet();
  }
  
  console.log('✅ Solanafied initialized successfully');
}

// ========== DOM READY ==========

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}

// Export functions for global access
window.SolanafiedApp = {
  connectWallet,
  disconnectWallet,
  toggleBundlerStatus,
  createBundler,
  addToken,
  refreshBundlers,
  copyAddress,
  toggleTheme
};
