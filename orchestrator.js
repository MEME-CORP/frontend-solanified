/**
 * SOLANAFIED - ORCHESTRATOR API SERVICE
 * 
 * This file handles all communication with the backend orchestrator service.
 * It provides functions for wallet creation, bundler management, and token operations.
 */

// ========== ORCHESTRATOR CONFIGURATION ==========

const ORCHESTRATOR_BASE_URL = 'https://orquestador-solanified-6a92.onrender.com';
const API_TIMEOUT = 30000; // 30 seconds for most operations
const LONG_API_TIMEOUT = 120000; // 2 minutes baseline for long operations

function getBundlerTimeoutMs(bundlerBalance) {
  const parsedBalance = Number.parseFloat(bundlerBalance);
  if (Number.isNaN(parsedBalance) || parsedBalance <= 0) {
    return API_TIMEOUT * 4; // fallback of ~2 minutes
  }

/**
 * Verify developer wallet balances (SOL + SPL)
 */
async function verifyDevWalletBalance(userWalletId) {
  try {
    showLoadingOverlay(true, 'Checking developer wallet balance...');

    const response = await makeOrchestratorRequest('/api/orchestrator/verify-dev-wallet-balance', 'POST', {
      user_wallet_id: userWalletId
    });

    console.log('✅ Developer balance verified:', response);

    if (response?.balance_updated) {
      showSnackbar(`Developer balance updated: ${response.current_balance_sol} SOL`, 'success');
    }

    return {
      userWalletId: response?.user_wallet_id,
      devPublicKey: response?.dev_public_key,
      previousBalance: response?.previous_balance_sol,
      currentBalance: response?.current_balance_sol,
      currentSplBalance: response?.current_balance_spl,
      balanceUpdated: response?.balance_updated
    };

  } catch (error) {
    handleOrchestratorError(error, 'verify developer wallet balance');
    return null;
  } finally {
    showLoadingOverlay(false);
  }
}
  return Math.ceil(parsedBalance) * 150000;
}

// ========== UTILITY FUNCTIONS ==========

/**
 * Make HTTP request to orchestrator API
 */
async function makeOrchestratorRequest(endpoint, method = 'POST', data = null, timeout = API_TIMEOUT) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const fullUrl = `${ORCHESTRATOR_BASE_URL}${endpoint}`;
    
    const config = {
      method,
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      signal: controller.signal
    };
    
    if (data && method !== 'GET') {
      config.body = JSON.stringify(data);
    }
    
    console.log(`📡 [ORCHESTRATOR] Making ${method} request to ${fullUrl}`);
    console.log(`📡 [ORCHESTRATOR] Request config:`, config);
    console.log(`📡 [ORCHESTRATOR] Request data:`, data);
    
    const response = await fetch(fullUrl, config);
    clearTimeout(timeoutId);
    
    console.log(`📡 [ORCHESTRATOR] Response status: ${response.status} ${response.statusText}`);
    console.log(`📡 [ORCHESTRATOR] Response headers:`, Object.fromEntries(response.headers.entries()));
    
    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const textResponse = await response.text();
      console.error(`❌ [ORCHESTRATOR] Non-JSON response:`, textResponse);
      throw new Error(`Server returned non-JSON response: ${textResponse.substring(0, 200)}`);
    }
    
    const responseData = await response.json();
    console.log(`📡 [ORCHESTRATOR] Response data:`, responseData);
    
    if (!response.ok) {
      const errorMessage = responseData.error?.message || responseData.message || `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage);
    }
    
    console.log(`✅ [ORCHESTRATOR] Request successful:`, responseData);
    return responseData;
    
  } catch (error) {
    console.error(`❌ [ORCHESTRATOR] Request failed for ${endpoint}:`, error);
    console.error(`❌ [ORCHESTRATOR] Error type:`, error.name);
    console.error(`❌ [ORCHESTRATOR] Error message:`, error.message);
    
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('🚨 [ORCHESTRATOR] Potential CORS issue detected!');
      console.error('🚨 [ORCHESTRATOR] Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      console.error('🔧 [ORCHESTRATOR] To fix CORS, your backend needs these headers:');
      console.error('   Access-Control-Allow-Origin: *');
      console.error('   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
      console.error('   Access-Control-Allow-Headers: Content-Type, Accept');
      throw new Error('CORS error: Backend is not allowing requests from this domain. Check backend CORS configuration.');
    }
    
    throw error;
  }
}

/**
 * Handle orchestrator API errors consistently
 */
function handleOrchestratorError(error, operation) {
  console.error(`❌ [ORCHESTRATOR] Error during ${operation}:`, error);
  
  let userMessage = `Failed to ${operation}`;
  
  if (error.message.includes('timeout') || error.message.includes('AbortError')) {
    userMessage = 'Operation timed out. Please try again.';
  } else if (error.message.includes('network') || error.message.includes('fetch')) {
    userMessage = 'Network error. Please check your connection and try again.';
  } else if (error.message.includes('Insufficient')) {
    userMessage = error.message; // Show balance-related errors directly
  } else if (error.message.includes('not found')) {
    userMessage = 'Requested resource not found.';
  } else if (error.message) {
    userMessage = `Failed to ${operation}: ${error.message}`;
  }
  
  if (typeof showSnackbar === 'function') {
    showSnackbar(userMessage, 'error');
  }
  
  // Re-throw the error so the calling function can handle it
  throw error;
}

// ========== WALLET OPERATIONS ==========

/**
 * Create distributor (funding) wallet for user
 */
async function createInAppWallet(userWalletId) {
  try {
    showLoadingOverlay(true, 'Creating funding wallet...');
    
    const response = await makeOrchestratorRequest('/api/orchestrator/create-wallet-in-app', 'POST', {
      user_wallet_id: userWalletId
    });
    
    console.log('✅ Distributor wallet created successfully:', response);
    showSnackbar('Distributor wallet created successfully!', 'success');
    
    return {
      distributorPublicKey: response.distributor_public_key || response.in_app_public_key,
      distributorBalanceSol: response.distributor_balance_sol ?? response.balance_sol ?? '0',
      devPublicKey: response.dev_public_key || null,
      devWalletStatus: response.dev_wallet_status || (response.dev_public_key ? 'ready' : 'pending'),
      devWalletReadyInSeconds: typeof response.dev_wallet_ready_in_seconds === 'number'
        ? response.dev_wallet_ready_in_seconds
        : null
    };
    
  } catch (error) {
    handleOrchestratorError(error, 'create distributor wallet');
    return null;
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Verify and update distributor wallet SOL balance
 */
async function verifyInAppBalance(userWalletId) {
  try {
    const response = await makeOrchestratorRequest('/api/orchestrator/verify-in-app-sol-balance', 'POST', {
      user_wallet_id: userWalletId
    });
    
    console.log('✅ Balance verified:', response);
    
    if (response.balance_updated) {
      showSnackbar(`Balance updated: ${response.current_balance_sol} SOL`, 'success');
    }
    
    return {
      userWalletId: response.user_wallet_id,
      distributorPublicKey: response.distributor_public_key,
      previousBalance: response.previous_balance_sol,
      currentBalance: response.current_balance_sol,
      balanceUpdated: response.balance_updated
    };
    
  } catch (error) {
    handleOrchestratorError(error, 'verify balance');
    return null;
  }
}

// ========== BUNDLER OPERATIONS ==========

/**
 * Create bundler with specified balance
 */
async function createBundler(userWalletId, bundlerBalance, idempotencyKey = null) {
  try {
    showLoadingOverlay(true, 'Creating bundler...');
    
    const requestData = {
      user_wallet_id: userWalletId,
      bundler_balance: parseInt(bundlerBalance)
    };
    
    if (idempotencyKey) {
      requestData.idempotency_key = idempotencyKey;
    }
    
    const response = await makeOrchestratorRequest(
      '/api/orchestrator/create-bundler',
      'POST',
      requestData,
      getBundlerTimeoutMs(requestData.bundler_balance)
    );
    
    console.log('✅ Bundler created successfully:', response);
    showSnackbar(`Bundler created with ${response.total_balance_sol} SOL!`, 'success');
    
    return {
      bundlerId: response.bundler_id,
      allocatedMotherWallets: response.allocated_mother_wallets,
      totalBalanceSol: response.total_balance_sol,
      message: response.message
    };
    
  } catch (error) {
    handleOrchestratorError(error, 'create bundler');
    return null;
  } finally {
    showLoadingOverlay(false);
  }
}

// ========== TOKEN OPERATIONS ==========

/**
 * Create and buy token on Pump.fun
 */
async function createAndBuyToken(userWalletId, tokenData) {
  try {
    showLoadingOverlay(true, 'Creating token on Pump.fun...');
    
    const requestData = {
      user_wallet_id: userWalletId,
      name: tokenData.name,
      symbol: tokenData.symbol,
      description: tokenData.description || '',
      logo_base64: tokenData.logoBase64 || '',
      twitter: tokenData.twitter || '',
      telegram: tokenData.telegram || '',
      website: tokenData.website || '',
      dev_buy_amount: tokenData.devBuyAmount || '0',
      slippage: tokenData.slippage || 1.0,
      priority_fee: tokenData.priorityFee || '0.000005'
    };
    
    console.log('📡 [TOKEN_API] Final request data being sent:', {
      endpoint: '/api/orchestrator/create-and-buy-token-pumpFun',
      data: {
        ...requestData,
        logo_base64: requestData.logo_base64 ? `${requestData.logo_base64.substring(0, 50)}...` : 'empty'
      }
    });
    
    const response = await makeOrchestratorRequest(
      '/api/orchestrator/create-and-buy-token-pumpFun', 
      'POST', 
      requestData, 
      LONG_API_TIMEOUT
    );
    
    console.log('✅ Token created and purchased successfully:', response);
    showSnackbar(`Token "${tokenData.name}" created successfully!`, 'success');
    
    return response;
    
  } catch (error) {
    if (error && typeof error.message === 'string' && error.message.includes('DEV_WALLET_NOT_READY')) {
      const devWalletError = new Error('Developer wallet is not ready. Please wait a minute and try again.');
      devWalletError.code = 'DEV_WALLET_NOT_READY';
      throw devWalletError;
    }
    handleOrchestratorError(error, 'create and buy token');
    return null;
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Sell created token
 */
async function sellToken(userWalletId, sellPercent) {
  try {
    showLoadingOverlay(true, `Selling ${sellPercent}% of tokens...`);
    
    const response = await makeOrchestratorRequest('/api/orchestrator/sell-created-token', 'POST', {
      user_wallet_id: userWalletId,
      sell_percent: sellPercent
    });
    
    console.log('✅ Token sold successfully:', response);
    showSnackbar(`Successfully sold ${sellPercent}% of tokens!`, 'success');
    
    return response;
    
  } catch (error) {
    handleOrchestratorError(error, 'sell token');
    return null;
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Sell SPL tokens from in-app wallet
 */
async function sellSplFromWallet(userWalletId, sellPercent, options = {}) {
  try {
    console.log('📡 [ORCHESTRATOR] sellSplFromWallet called with:', {
      userWalletId,
      sellPercent,
      walletType: options.walletType || 'distributor',
      endpoint: '/api/orchestrator/sell-spl-from-wallet'
    });
    
    showLoadingOverlay(true, `Selling ${sellPercent}% of SPL tokens from wallet...`);
    
    const requestData = {
      user_wallet_id: userWalletId,
      sell_percent: sellPercent
    };

    if (options.walletType && ['developer', 'distributor'].includes(options.walletType)) {
      requestData.wallet_type = options.walletType;
    }
    
    console.log('📡 [ORCHESTRATOR] Making request with data:', requestData);
    
    const response = await makeOrchestratorRequest('/api/orchestrator/sell-spl-from-wallet', 'POST', requestData);
    
    console.log('✅ [ORCHESTRATOR] SPL tokens sold successfully:', response);
    showSnackbar(`Successfully sold ${sellPercent}% of SPL tokens!`, 'success');
    
    return response;
    
  } catch (error) {
    console.error('❌ [ORCHESTRATOR] Error in sellSplFromWallet:', error);
    handleOrchestratorError(error, 'sell SPL tokens from wallet');
    return null;
  } finally {
    showLoadingOverlay(false);
  }
}

// ========== TRANSFER OPERATIONS ==========

/**
 * Transfer SOL to owner wallet
 */
async function transferToOwner(userWalletId, amountSol) {
  try {
    showLoadingOverlay(true, `Transferring ${amountSol} SOL to your wallet...`);
    
    const response = await makeOrchestratorRequest('/api/orchestrator/transfer-to-owner-wallet', 'POST', {
      user_wallet_id: userWalletId,
      amount_sol: amountSol.toString()
    });
    
    console.log('✅ Transfer completed successfully:', response);
    showSnackbar(`Successfully transferred ${amountSol} SOL to your wallet!`, 'success');
    
    return response;
    
  } catch (error) {
    handleOrchestratorError(error, 'transfer to owner');
    return null;
  } finally {
    showLoadingOverlay(false);
  }
}

// ========== NOTIFICATION HANDLING ==========

/**
 * Handle incoming notifications from backend
 */
function handleBackendNotification(notification) {
  console.log('📢 [NOTIFICATION] Received from backend:', notification);
  
  const { type, message, user_wallet_id } = notification;
  
  switch (type) {
    case 'WALLET_CREATED':
      console.log('✅ [NOTIFICATION] Wallet creation notification:', {
        userWalletId: user_wallet_id,
        distributorPublicKey: notification.distributor_public_key
      });
      
      showSnackbar('Distributor wallet created successfully!', 'success');
      
      // Refresh user data if this is for current user
      if (window.currentUser && window.currentUser.user_wallet_id === user_wallet_id) {
        if (typeof refreshUserData === 'function') {
          refreshUserData();
        }
      }
      break;
      
    case 'BUNDLER_CREATED':
      showSnackbar('Bundler created successfully!', 'success');
      if (typeof loadBundlers === 'function') {
        loadBundlers();
      }
      break;
      
    case 'TOKEN_CREATED':
      showSnackbar(`Token "${notification.token_name}" created successfully!`, 'success');
      if (typeof loadTokens === 'function') {
        loadTokens();
      }
      break;
      
    case 'BALANCE_UPDATED':
      showSnackbar('Distributor wallet balance updated successfully!', 'success');
      if (typeof updateWalletBalance === 'function') {
        updateWalletBalance();
      }
      break;
      
    default:
      showSnackbar(message || 'Notification received', 'info');
  }
}

/**
 * Set up notification listener (for Server-Sent Events or WebSocket)
 */
function setupNotificationListener() {
  // This would be implemented based on your notification system
  // For now, we'll just log that it's ready
  console.log('📡 [NOTIFICATION] Notification listener ready');
  
  // Example implementation for Server-Sent Events:
  /*
  const eventSource = new EventSource(`${ORCHESTRATOR_BASE_URL}/api/notifications/stream`);
  
  eventSource.onmessage = function(event) {
    try {
      const notification = JSON.parse(event.data);
      handleBackendNotification(notification);
    } catch (error) {
      console.error('Failed to parse notification:', error);
    }
  };
  
  eventSource.onerror = function(error) {
    console.error('Notification stream error:', error);
  };
  */
}

// ========== EXPORT FOR GLOBAL ACCESS ==========

// Make functions globally available
window.OrchestratorAPI = {
  // Wallet operations
  createInAppWallet,
  verifyInAppBalance,
  verifyDevWalletBalance,

  // Bundler operations
  createBundler,
  
  // Token operations
  createAndBuyToken,
  sellToken,
  sellSplFromWallet,
  
  // Transfer operations
  transferToOwner,
  
  // Notification handling
  handleBackendNotification,
  setupNotificationListener,
  
  // Utility
  makeOrchestratorRequest,
  
  // Debug utilities
  testOrchestratorConnectivity
};

console.log('🔗 Orchestrator API loaded successfully');
console.log('🔗 Base URL:', ORCHESTRATOR_BASE_URL);
console.log('🔗 Available functions:', Object.keys(window.OrchestratorAPI || {}));

// Test basic connectivity and CORS configuration
async function testOrchestratorConnectivity() {
  console.log('🧪 [CORS_TEST] Testing orchestrator connectivity and CORS...');
  console.log('🧪 [CORS_TEST] Target URL:', ORCHESTRATOR_BASE_URL);
  console.log('🧪 [CORS_TEST] Current origin:', window.location.origin);
  
  try {
    // Test 1: Basic connectivity with HEAD request
    console.log('🧪 [CORS_TEST] Test 1: Basic connectivity (HEAD request)...');
    const headResponse = await fetch(ORCHESTRATOR_BASE_URL, { 
      method: 'HEAD',
      mode: 'cors',
      credentials: 'omit'
    });
    console.log('✅ [CORS_TEST] HEAD request successful:', headResponse.status);
    console.log('✅ [CORS_TEST] Response headers:', Object.fromEntries(headResponse.headers.entries()));
    
    // Test 2: GET request to check if API responds
    console.log('🧪 [CORS_TEST] Test 2: GET request to base URL...');
    const getResponse = await fetch(ORCHESTRATOR_BASE_URL, { 
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Accept': 'application/json'
      }
    });
    console.log('✅ [CORS_TEST] GET request status:', getResponse.status);
    
    // Test 3: OPTIONS preflight request simulation
    console.log('🧪 [CORS_TEST] Test 3: OPTIONS preflight request...');
    const optionsResponse = await fetch(`${ORCHESTRATOR_BASE_URL}/api/orchestrator/create-bundler`, { 
      method: 'OPTIONS',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type'
      }
    });
    console.log('✅ [CORS_TEST] OPTIONS request status:', optionsResponse.status);
    console.log('✅ [CORS_TEST] CORS headers:', {
      'Access-Control-Allow-Origin': optionsResponse.headers.get('Access-Control-Allow-Origin'),
      'Access-Control-Allow-Methods': optionsResponse.headers.get('Access-Control-Allow-Methods'),
      'Access-Control-Allow-Headers': optionsResponse.headers.get('Access-Control-Allow-Headers'),
      'Access-Control-Max-Age': optionsResponse.headers.get('Access-Control-Max-Age')
    });
    
    console.log('🎉 [CORS_TEST] All connectivity tests passed! CORS should be working.');
    
  } catch (error) {
    console.error('❌ [CORS_TEST] Connectivity test failed:', error);
    console.error('❌ [CORS_TEST] Error type:', error.name);
    console.error('❌ [CORS_TEST] Error message:', error.message);
    
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error('🚨 [CORS_TEST] DIAGNOSIS: Network/CORS error detected!');
      console.error('🚨 [CORS_TEST] Possible causes:');
      console.error('   1. Backend server is down or unreachable');
      console.error('   2. CORS is not properly configured on the backend');
      console.error('   3. Backend is not allowing requests from origin:', window.location.origin);
      console.error('   4. Firewall or network blocking the connection');
      
      console.error('🔧 [CORS_TEST] Backend needs these CORS headers:');
      console.error('   Access-Control-Allow-Origin: * (or specific origin)');
      console.error('   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
      console.error('   Access-Control-Allow-Headers: Content-Type, Accept');
    }
  }
}

// Run connectivity test
testOrchestratorConnectivity();

// Auto-setup notification listener when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupNotificationListener);
} else {
  setupNotificationListener();
}
