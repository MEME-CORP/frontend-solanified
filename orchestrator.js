/**
 * SOLANAFIED - ORCHESTRATOR API SERVICE
 * 
 * This file handles all communication with the backend orchestrator service.
 * It provides functions for wallet creation, bundler management, and token operations.
 */

// ========== ORCHESTRATOR CONFIGURATION ==========

const ORCHESTRATOR_BASE_URL = 'https://orquestador-solanified.onrender.com';
const API_TIMEOUT = 30000; // 30 seconds for most operations
const LONG_API_TIMEOUT = 120000; // 2 minutes for token creation operations

// ========== UTILITY FUNCTIONS ==========

/**
 * Make HTTP request to orchestrator API
 */
async function makeOrchestratorRequest(endpoint, method = 'POST', data = null, timeout = API_TIMEOUT) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const config = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal
    };
    
    if (data && method !== 'GET') {
      config.body = JSON.stringify(data);
    }
    
    console.log(`📡 [ORCHESTRATOR] Making ${method} request to ${endpoint}`, data);
    
    const response = await fetch(`${ORCHESTRATOR_BASE_URL}${endpoint}`, config);
    clearTimeout(timeoutId);
    
    const responseData = await response.json();
    
    if (!response.ok) {
      throw new Error(responseData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    console.log(`✅ [ORCHESTRATOR] Request successful:`, responseData);
    return responseData;
    
  } catch (error) {
    console.error(`❌ [ORCHESTRATOR] Request failed for ${endpoint}:`, error);
    
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
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
  }
  
  if (typeof showSnackbar === 'function') {
    showSnackbar(userMessage, 'error');
  }
  
  return null;
}

// ========== WALLET OPERATIONS ==========

/**
 * Create in-app wallet for user
 */
async function createInAppWallet(userWalletId) {
  try {
    showLoadingOverlay(true, 'Creating in-app wallet...');
    
    const response = await makeOrchestratorRequest('/api/orchestrator/create-wallet-in-app', 'POST', {
      user_wallet_id: userWalletId
    });
    
    console.log('✅ In-app wallet created successfully:', response);
    showSnackbar('In-app wallet created successfully!', 'success');
    
    return {
      inAppPublicKey: response.in_app_public_key,
      balanceSol: response.balance_sol
    };
    
  } catch (error) {
    return handleOrchestratorError(error, 'create in-app wallet');
  } finally {
    showLoadingOverlay(false);
  }
}

/**
 * Verify and update in-app SOL balance
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
      inAppPublicKey: response.in_app_public_key,
      previousBalance: response.previous_balance_sol,
      currentBalance: response.current_balance_sol,
      balanceUpdated: response.balance_updated
    };
    
  } catch (error) {
    return handleOrchestratorError(error, 'verify balance');
  }
}

// ========== BUNDLER OPERATIONS ==========

/**
 * Create bundler with specified balance
 */
async function createBundler(userWalletId, bundlerBalance, idempotencyKey = null) {
  try {
    console.log('🔧 [ORCHESTRATOR] createBundler called with:', { userWalletId, bundlerBalance, idempotencyKey });
    showLoadingOverlay(true, 'Creating bundler...');
    
    const requestData = {
      user_wallet_id: userWalletId,
      bundler_balance: bundlerBalance
    };
    
    if (idempotencyKey) {
      requestData.idempotency_key = idempotencyKey;
    }
    
    console.log('📡 [ORCHESTRATOR] About to make request with data:', requestData);
    console.log('📡 [ORCHESTRATOR] Request URL:', `${ORCHESTRATOR_BASE_URL}/api/orchestrator/create-bundler`);
    
    const response = await makeOrchestratorRequest('/api/orchestrator/create-bundler', 'POST', requestData);
    
    console.log('✅ Bundler created successfully:', response);
    showSnackbar(`Bundler created with ${response.total_balance_sol} SOL!`, 'success');
    
    return {
      bundlerId: response.bundler_id,
      allocatedMotherWallets: response.allocated_mother_wallets,
      totalBalanceSol: response.total_balance_sol,
      message: response.message
    };
    
  } catch (error) {
    return handleOrchestratorError(error, 'create bundler');
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
    return handleOrchestratorError(error, 'create and buy token');
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
    return handleOrchestratorError(error, 'sell token');
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
    return handleOrchestratorError(error, 'transfer to owner');
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
        inAppPublicKey: notification.in_app_public_key
      });
      
      showSnackbar('In-app wallet created successfully!', 'success');
      
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
      showSnackbar('Balance updated successfully!', 'success');
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
  
  // Bundler operations
  createBundler,
  
  // Token operations
  createAndBuyToken,
  sellToken,
  
  // Transfer operations
  transferToOwner,
  
  // Notification handling
  handleBackendNotification,
  setupNotificationListener,
  
  // Utility
  makeOrchestratorRequest
};

console.log('🔗 Orchestrator API loaded successfully');

// Auto-setup notification listener when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupNotificationListener);
} else {
  setupNotificationListener();
}
