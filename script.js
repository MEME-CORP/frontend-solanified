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
    
    // Check user registration status
    const userRegistered = await checkUserRegistration();
    
    if (userRegistered) {
      // User is registered, check balance and show appropriate UI
      const balance = currentUser.balance_sol || 0;
      
      if (balance >= 1) {
        // User has sufficient balance, load full dashboard
        await loadDashboardData();
        setupRealtimeSubscriptions();
        showSnackbar('Welcome back! Ready to create bundlers.', 'success');
      } else {
        // User has in-app wallet but insufficient balance
        showFundingPrompt();
        showSnackbar(`Welcome back! Please fund your in-app wallet (${DatabaseAPI.formatBalance(balance)} SOL). You need ≥1 SOL to create bundlers.`, 'warning');
      }
    } else {
      // User not registered, show registration prompt
      showRegistrationPrompt();
      showSnackbar('Wallet connected! Please create your in-app wallet to continue.', 'info');
    }
    
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
 * Check if user is registered in the database
 */
async function checkUserRegistration() {
  try {
    if (!currentWallet) {
      throw new Error('Wallet not connected');
    }
    
    // Ensure database is initialized
    if (!DatabaseAPI) {
      throw new Error('Database API not available. Please ensure the page is fully loaded.');
    }
    
    // Try to initialize database if not already done
    if (!DatabaseAPI.initialize()) {
      throw new Error('Failed to initialize database connection. Please check your internet connection.');
    }
    
    const walletId = currentWallet.publicKey.toString();
    showLoadingOverlay(true, 'Checking registration...');
    
    console.log('🔍 Checking user registration for:', DatabaseAPI.truncateAddress(walletId));
    
    // Try to get existing user by wallet address
    const user = await DatabaseAPI.getUserByWalletId(walletId);
    
    if (user) {
      // User is registered
      console.log('✅ User found in database:', {
        id: user.id,
        wallet_id: DatabaseAPI.truncateAddress(user.user_wallet_id),
        in_app_public_key: DatabaseAPI.truncateAddress(user.in_app_public_key),
        balance_sol: user.balance_sol,
        balance_spl: user.balance_spl
      });
      
      currentUser = user;
      
      // Update balance from blockchain to get latest data
      await updateInAppWalletBalance();
      
      return true;
    } else {
      // User not registered
      console.log('👤 User not found in database - registration required');
      currentUser = null;
      return false;
    }
    
  } catch (error) {
    console.error('❌ Failed to check user registration:', error);
    
    let message = 'Failed to check registration status';
    if (error.message.includes('Database API not available')) {
      message = 'Database connection failed. Please refresh the page and try again.';
    } else if (error.message.includes('Failed to initialize database')) {
      message = 'Cannot connect to database. Please check your internet connection.';
    }
    
    showSnackbar(message, 'error');
    return false;
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Update wallet balance from blockchain (for main wallet)
 */
async function updateWalletBalance() {
  try {
    if (!currentWallet) return;
    
    // Create connection to Solana cluster
    const rpcEndpoint = (window.ENV && window.ENV.SOLANA_RPC_ENDPOINT) 
      ? window.ENV.SOLANA_RPC_ENDPOINT 
      : solanaWeb3.clusterApiUrl('mainnet-beta');
      
    const connection = new solanaWeb3.Connection(rpcEndpoint, 'confirmed');
    
    // Get SOL balance
    const balance = await connection.getBalance(currentWallet.publicKey);
    const solBalance = balance / solanaWeb3.LAMPORTS_PER_SOL;
    
    console.log(`💰 Main wallet balance: ${solBalance} SOL`);
    
    // Update UI
    updateBalanceDisplay(solBalance, 0);
    
  } catch (error) {
    console.error('❌ Failed to update main wallet balance:', error);
  }
}

/**
 * Update in-app wallet balance from database
 */
async function updateInAppWalletBalance() {
  try {
    if (!currentUser || !DatabaseAPI) return 0;
    
    console.log('💰 Checking in-app wallet balance from database...');
    
    // Get latest user data from database
    const user = await DatabaseAPI.getUserByWalletId(currentUser.user_wallet_id);
    
    if (user) {
      // Update current user object with latest data
      currentUser.balance_sol = user.balance_sol;
      currentUser.balance_spl = user.balance_spl;
      
      console.log(`💰 In-app wallet balance: ${user.balance_sol} SOL, ${user.balance_spl} SPL`);
      
      // Update UI with in-app wallet balance
      updateInAppBalanceDisplay(user.balance_sol, user.balance_spl);
      
      return user.balance_sol;
    } else {
      console.error('❌ User not found in database');
      return 0;
    }
    
  } catch (error) {
    console.error('❌ Failed to update in-app wallet balance:', error);
    return 0;
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
 * Update balance display (for main wallet)
 */
function updateBalanceDisplay(solBalance, splBalance) {
  const solBalanceEl = document.getElementById('sol-balance');
  const splBalanceEl = document.getElementById('spl-balance');
  
  const formattedSol = DatabaseAPI.formatBalance(solBalance);
  const formattedSpl = DatabaseAPI.formatBalance(splBalance);
  
  if (solBalanceEl) solBalanceEl.textContent = formattedSol;
  if (splBalanceEl) splBalanceEl.textContent = formattedSpl;
}

/**
 * Update in-app wallet balance display
 */
function updateInAppBalanceDisplay(solBalance, splBalance) {
  const profileSolEl = document.getElementById('profile-sol');
  const profileSplEl = document.getElementById('profile-spl');
  const inAppBalanceEl = document.getElementById('in-app-balance');
  
  const formattedSol = DatabaseAPI.formatBalance(solBalance);
  const formattedSpl = DatabaseAPI.formatBalance(splBalance);
  
  if (profileSolEl) profileSolEl.textContent = formattedSol;
  if (profileSplEl) profileSplEl.textContent = formattedSpl;
  if (inAppBalanceEl) inAppBalanceEl.textContent = formattedSol;
  
  // Update bundler creation button based on balance
  updateBundlerCreationUI(solBalance);
}

/**
 * Update bundler creation UI based on balance
 */
function updateBundlerCreationUI(solBalance) {
  const createBundlerBtn = document.getElementById('create-bundler-btn');
  const balanceWarning = document.getElementById('balance-warning');
  
  if (createBundlerBtn) {
    if (solBalance >= 1) {
      createBundlerBtn.disabled = false;
      createBundlerBtn.classList.remove('disabled');
      createBundlerBtn.innerHTML = `
        <span class="material-symbols-outlined">inventory_2</span>
        Create Bundler
      `;
    } else {
      createBundlerBtn.disabled = true;
      createBundlerBtn.classList.add('disabled');
      createBundlerBtn.innerHTML = `
        <span class="material-symbols-outlined">block</span>
        Need ≥1 SOL to Create Bundler
      `;
    }
  }
  
  if (balanceWarning) {
    if (solBalance < 1) {
      balanceWarning.style.display = 'block';
      balanceWarning.innerHTML = `
        <span class="material-symbols-outlined">warning</span>
        You need at least 1 SOL in your in-app wallet to create a bundler. Current balance: ${DatabaseAPI.formatBalance(solBalance)} SOL
      `;
    } else {
      balanceWarning.style.display = 'none';
    }
  }
}

/**
 * Show/hide dashboard
 */
function hideDashboard() {
  document.getElementById('dashboard').style.display = 'none';
  hideRegistrationPrompt();
  hideFundingPrompt();
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
            <p>Your Phantom wallet is connected, but you need to create an in-app wallet to access all features.</p>
            <p>This will allow you to:</p>
            <ul class="feature-list">
              <li><span class="material-symbols-outlined">inventory_2</span> Create and manage bundlers</li>
              <li><span class="material-symbols-outlined">folder</span> Access mother and child wallets</li>
              <li><span class="material-symbols-outlined">token</span> Manage your token portfolio</li>
              <li><span class="material-symbols-outlined">analytics</span> View detailed analytics</li>
            </ul>
            <div class="registration-actions">
              <button id="create-wallet-btn" class="primary-button">
                <span class="material-symbols-outlined">add</span>
                Create In-App Wallet
              </button>
              <button id="refresh-registration-btn" class="secondary-button">
                <span class="material-symbols-outlined">refresh</span>
                Check Again
              </button>
            </div>
            <p class="registration-note">
              <span class="material-symbols-outlined">info</span>
              Your in-app wallet will be handled securely by our backend system.
            </p>
          </div>
        </div>
      </div>
    `;
    
    // Insert after wallet status section
    const walletStatus = document.getElementById('wallet-status');
    walletStatus.parentNode.insertBefore(registrationPrompt, walletStatus.nextSibling);
    
    // Add event listeners
    document.getElementById('create-wallet-btn').addEventListener('click', handleCreateWallet);
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
 * Show funding prompt for users with in-app wallet but insufficient balance
 */
function showFundingPrompt() {
  // Hide dashboard and registration prompt
  document.getElementById('dashboard').style.display = 'none';
  hideRegistrationPrompt();
  
  // Show funding prompt
  let fundingPrompt = document.getElementById('funding-prompt');
  
  if (!fundingPrompt) {
    // Create funding prompt if it doesn't exist
    fundingPrompt = document.createElement('section');
    fundingPrompt.id = 'funding-prompt';
    fundingPrompt.className = 'funding-prompt';
    fundingPrompt.innerHTML = `
      <div class="card funding-card">
        <div class="card-header">
          <span class="material-symbols-outlined">account_balance_wallet</span>
          <h3>Fund Your In-App Wallet</h3>
        </div>
        <div class="card-content">
          <div class="funding-content">
            <div class="wallet-info">
              <div class="info-row">
                <span class="label">In-App Wallet Address:</span>
                <div class="wallet-address-container">
                  <span id="funding-wallet-address" class="wallet-address">${currentUser ? DatabaseAPI.truncateAddress(currentUser.in_app_public_key) : ''}</span>
                  <button onclick="copyInAppAddress()" class="icon-button copy-btn" title="Copy address">
                    <span class="material-symbols-outlined">content_copy</span>
                  </button>
                </div>
              </div>
              <div class="info-row">
                <span class="label">Current Balance:</span>
                <span id="funding-current-balance" class="balance-value">${currentUser ? DatabaseAPI.formatBalance(currentUser.balance_sol) : '0.000'} SOL</span>
              </div>
              <div class="info-row">
                <span class="label">Required Balance:</span>
                <span class="balance-required">≥1.000 SOL</span>
              </div>
            </div>
            <div class="funding-instructions">
              <h4>📋 Instructions:</h4>
              <ol>
                <li>Copy your in-app wallet address above</li>
                <li>Send at least 1 SOL to this address from your main wallet or exchange</li>
                <li>Wait for the backend system to detect and update your balance</li>
                <li>Click "Check Balance" to refresh your balance from our database</li>
                <li>Once you have ≥1 SOL, you can create bundlers</li>
              </ol>
              <div class="funding-note">
                <span class="material-symbols-outlined">info</span>
                <span>Balance updates are managed by our backend system and may take a few minutes to reflect.</span>
              </div>
            </div>
            <div class="funding-actions">
              <button id="check-balance-btn" class="primary-button">
                <span class="material-symbols-outlined">refresh</span>
                Check Balance
              </button>
              <button id="copy-address-btn" class="secondary-button" onclick="copyInAppAddress()">
                <span class="material-symbols-outlined">content_copy</span>
                Copy Address
              </button>
            </div>
            <div id="balance-warning" class="warning-message" style="display: none;">
              <span class="material-symbols-outlined">warning</span>
              <span>You need at least 1 SOL to create bundlers</span>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Insert after wallet status section
    const walletStatus = document.getElementById('wallet-status');
    walletStatus.parentNode.insertBefore(fundingPrompt, walletStatus.nextSibling);
    
    // Add event listeners
    document.getElementById('check-balance-btn').addEventListener('click', handleCheckBalance);
  }
  
  // Update wallet info if user exists
  if (currentUser) {
    const addressEl = document.getElementById('funding-wallet-address');
    const balanceEl = document.getElementById('funding-current-balance');
    
    if (addressEl) addressEl.textContent = DatabaseAPI.truncateAddress(currentUser.in_app_public_key);
    if (balanceEl) balanceEl.textContent = `${DatabaseAPI.formatBalance(currentUser.balance_sol)} SOL`;
  }
  
  fundingPrompt.style.display = 'block';
}

/**
 * Hide funding prompt
 */
function hideFundingPrompt() {
  const fundingPrompt = document.getElementById('funding-prompt');
  if (fundingPrompt) {
    fundingPrompt.style.display = 'none';
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
  if (!currentUser || !DatabaseAPI) {
    console.log('⚠️ Cannot load dashboard data: user not registered or database not available');
    return;
  }
  
  console.log('📊 Loading dashboard data for registered user...');
  
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
 * Handle create wallet button click
 */
async function handleCreateWallet() {
  try {
    if (!currentWallet) {
      throw new Error('No wallet connected');
    }

    showLoadingOverlay(true, 'Creating in-app wallet...');
    
    const walletAddress = currentWallet.publicKey.toString();
    console.log('🔨 Creating in-app wallet for:', DatabaseAPI.truncateAddress(walletAddress));
    
    // Call the API to create in-app wallet
    const response = await fetch('https://orquestador-solanified.onrender.com/api/orchestrator/create-wallet-in-app', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        user_wallet_id: walletAddress
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('✅ In-app wallet creation initiated:', result);
    
    // Show initial success message
    showSnackbar('In-app wallet creation initiated. Please wait...', 'info');
    
    // Start polling for wallet creation completion
    const walletCreated = await pollForWalletCreation(walletAddress, 30000); // 30 second timeout
    
    if (walletCreated) {
      // Wallet creation confirmed
      showSnackbar('In-app wallet created successfully!', 'success');
      
      // Check registration status again
      const userRegistered = await checkUserRegistration();
      
      if (userRegistered) {
        // User is now registered, hide registration prompt and show funding prompt
        hideRegistrationPrompt();
        showFundingPrompt();
        showSnackbar('Welcome to Solanafied! Please fund your in-app wallet to start creating bundlers.', 'success');
      } else {
        // Something went wrong, ask user to refresh
        showSnackbar('Wallet created but registration not confirmed. Please refresh.', 'warning');
      }
    } else {
      // Timeout or error during polling
      showSnackbar('Wallet creation taking longer than expected. Please check again in a moment.', 'warning');
    }
    
  } catch (error) {
    console.error('❌ Failed to create in-app wallet:', error);
    
    let message = 'Failed to create in-app wallet';
    if (error.message.includes('Failed to fetch')) {
      message = 'Cannot connect to server. Please check your internet connection and try again.';
    } else if (error.message.includes('HTTP 400')) {
      message = 'Invalid wallet address or request data';
    } else if (error.message.includes('HTTP 409')) {
      message = 'Wallet already exists. Please try refreshing your registration status.';
    } else if (error.message.includes('HTTP 500')) {
      message = 'Server error. Please try again later or contact support.';
    } else if (error.message) {
      message = error.message;
    }
    
    showSnackbar(message, 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Poll for wallet creation completion using backend notifications
 */
async function pollForWalletCreation(walletAddress, timeout = 30000) {
  const startTime = Date.now();
  const pollInterval = 2000; // Poll every 2 seconds
  
  console.log('🔄 Starting to poll for wallet creation notifications...');
  
  while (Date.now() - startTime < timeout) {
    try {
      // Update loading message
      showLoadingOverlay(true, 'Waiting for wallet creation to complete...');
      
      // Check for notifications from backend
      const notifications = await checkForNotifications(walletAddress);
      
      // Look for wallet creation notification
      const walletCreatedNotification = notifications.find(n => 
        n.type === 'WALLET_CREATED' && n.user_wallet_id === walletAddress
      );
      
      if (walletCreatedNotification) {
        console.log('✅ Wallet creation notification received!', walletCreatedNotification);
        return true;
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
    } catch (error) {
      console.error('❌ Error during notification polling:', error);
      // Continue polling despite errors
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }
  
  console.log('⏱️ Notification polling timeout reached');
  return false;
}

/**
 * Check for notifications from the server
 */
async function checkForNotifications(userWalletId) {
  try {
    const response = await fetch(`/api/notifications?user_wallet_id=${encodeURIComponent(userWalletId)}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      return result.notifications || [];
    } else {
      throw new Error(result.error || 'Failed to fetch notifications');
    }
    
  } catch (error) {
    console.error('❌ Failed to check notifications:', error);
    return [];
  }
}

/**
 * Handle refresh registration status
 */
async function handleRefreshRegistration() {
  try {
    const userRegistered = await checkUserRegistration();
    
    if (userRegistered) {
      // User is now registered, check balance and show appropriate UI
      const balance = currentUser.balance_sol || 0;
      
      hideRegistrationPrompt();
      
      if (balance >= 1) {
        // User has sufficient balance, load full dashboard
        await loadDashboardData();
        setupRealtimeSubscriptions();
        showSnackbar('Registration confirmed! Welcome to Solanafied!', 'success');
      } else {
        // User has in-app wallet but insufficient balance
        showFundingPrompt();
        showSnackbar(`Registration confirmed! Please fund your in-app wallet (${DatabaseAPI.formatBalance(balance)} SOL). You need ≥1 SOL to create bundlers.`, 'warning');
      }
    } else {
      showSnackbar('User still not registered. Please create your in-app wallet first.', 'warning');
    }
    
  } catch (error) {
    console.error('❌ Failed to refresh registration:', error);
    showSnackbar('Failed to check registration status', 'error');
  }
}

/**
 * Handle balance check for funding prompt
 */
async function handleCheckBalance() {
  try {
    if (!currentUser) {
      throw new Error('No user logged in');
    }
    
    showLoadingOverlay(true, 'Checking balance from database...');
    
    // Update balance from database
    const newBalance = await updateInAppWalletBalance();
    
    // Update UI
    const balanceEl = document.getElementById('funding-current-balance');
    if (balanceEl) {
      balanceEl.textContent = `${DatabaseAPI.formatBalance(newBalance)} SOL`;
    }
    
    if (newBalance >= 1) {
      // User now has sufficient balance
      hideFundingPrompt();
      await loadDashboardData();
      setupRealtimeSubscriptions();
      showSnackbar(`Great! Your balance is now ${DatabaseAPI.formatBalance(newBalance)} SOL. You can create bundlers!`, 'success');
    } else {
      showSnackbar(`Balance updated: ${DatabaseAPI.formatBalance(newBalance)} SOL. You still need ≥1 SOL to create bundlers.`, 'info');
    }
    
  } catch (error) {
    console.error('❌ Failed to check balance:', error);
    showSnackbar('Failed to check balance', 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Copy in-app wallet address to clipboard
 */
async function copyInAppAddress() {
  try {
    if (!currentUser || !currentUser.in_app_public_key) {
      throw new Error('No in-app wallet address available');
    }
    
    await navigator.clipboard.writeText(currentUser.in_app_public_key);
    showSnackbar('In-app wallet address copied to clipboard', 'success');
    
  } catch (error) {
    console.error('❌ Failed to copy address:', error);
    showSnackbar('Failed to copy address', 'error');
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
    const tokenName = prompt('Enter token name for the bundler:');
    if (!tokenName || !tokenName.trim()) return;
    
    showLoadingOverlay(true, 'Creating bundler...');
    
    await DatabaseAPI.createBundler(currentUser.user_wallet_id, tokenName.trim());
    
    // Refresh bundlers list
    await loadBundlers();
    
  } catch (error) {
    console.error('❌ Failed to create bundler:', error);
    showSnackbar('Failed to create bundler', 'error');
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Add new token
 */
async function addToken() {
  try {
    const name = prompt('Enter token name:');
    if (!name || !name.trim()) return;
    
    const symbol = prompt('Enter token symbol:');
    if (!symbol || !symbol.trim()) return;
    
    showLoadingOverlay(true, 'Adding token...');
    
    const tokenData = {
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      description: null,
      dev_buy_amount: 0
    };
    
    await DatabaseAPI.createToken(currentUser.user_wallet_id, tokenData);
    
    // Refresh tokens list
    await loadTokens();
    
  } catch (error) {
    console.error('❌ Failed to add token:', error);
    showSnackbar('Failed to add token', 'error');
  } finally {
    showLoadingOverlay(false);
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
  checkUserRegistration,
  handleCreateWallet,
  handleRefreshRegistration,
  handleCheckBalance,
  copyInAppAddress,
  pollForWalletCreation,
  checkForNotifications,
  toggleBundlerStatus,
  createBundler,
  addToken,
  refreshBundlers,
  copyAddress,
  toggleTheme
};
