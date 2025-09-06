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
    
    const fullUrl = `${ORCHESTRATOR_BASE_URL}${endpoint}`;
    
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
      throw new Error('Network error. Please check your connection and try again.');
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
    handleOrchestratorError(error, 'create in-app wallet');
    return null;
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
      bundler_balance: bundlerBalance
    };
    
    if (idempotencyKey) {
      requestData.idempotency_key = idempotencyKey;
    }
    
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
console.log('🔗 Base URL:', ORCHESTRATOR_BASE_URL);
console.log('🔗 Available functions:', Object.keys(window.OrchestratorAPI || {}));

// Auto-setup notification listener when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupNotificationListener);
} else {
  setupNotificationListener();
}
