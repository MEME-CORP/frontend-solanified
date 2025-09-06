# 🧪 Testing User Registration Flow

## Test Scenarios

### Scenario 1: New User (Not Registered)

1. **Setup**: Make sure your database is empty or the test wallet is not in the `users` table
2. **Connect Phantom Wallet**: Click "Connect Wallet"
3. **Expected Result**: 
   - ✅ Wallet connects successfully
   - ✅ Shows "Wallet connected! Please create your in-app wallet to continue."
   - ✅ Registration prompt appears with:
     - Welcome message
     - Feature list (bundlers, wallets, tokens, analytics)
     - "Create In-App Wallet" button
     - "Check Again" button
   - ❌ Dashboard is hidden
   - ❌ No bundler/token data loads

### Scenario 2: Existing User (Registered)

1. **Setup**: Ensure the test wallet exists in the `users` table in your database
2. **Connect Phantom Wallet**: Click "Connect Wallet"
3. **Expected Result**:
   - ✅ Wallet connects successfully
   - ✅ Shows "Welcome back!" message
   - ✅ Full dashboard appears with user data
   - ✅ Bundlers, tokens, and wallets load
   - ❌ Registration prompt is hidden

### Scenario 3: Registration Check Flow

1. **Start**: Connect with unregistered wallet (see registration prompt)
2. **Backend Action**: Manually add the wallet to the `users` table in database:
   ```sql
   INSERT INTO users (user_wallet_id, in_app_private_key, in_app_public_key, balance_sol, balance_spl) 
   VALUES ('YOUR_WALLET_ADDRESS', 'temp_private_key', 'YOUR_WALLET_ADDRESS', 0, 0);
   ```
3. **Frontend Action**: Click "Check Again" button
4. **Expected Result**:
   - ✅ Shows "Registration confirmed! Welcome to Solanafied!"
   - ✅ Registration prompt disappears
   - ✅ Full dashboard loads

## Console Output to Look For

### Unregistered User:
```
🔍 Checking user registration for: Abc1...xyz9
👤 User not found in database - registration required
```

### Registered User:
```
🔍 Checking user registration for: Abc1...xyz9
✅ User found in database: {id: 1, wallet_id: "Abc1...xyz9", balance_sol: "0.000", balance_spl: "0.000"}
📊 Loading dashboard data for registered user...
```

## Manual Database Testing

### Check if user exists:
```sql
SELECT * FROM users WHERE user_wallet_id = 'YOUR_PHANTOM_WALLET_ADDRESS';
```

### Add test user:
```sql
INSERT INTO users (user_wallet_id, in_app_private_key, in_app_public_key, balance_sol, balance_spl) 
VALUES ('YOUR_PHANTOM_WALLET_ADDRESS', 'temp_private_key', 'YOUR_PHANTOM_WALLET_ADDRESS', 0, 0);
```

### Remove test user:
```sql
DELETE FROM users WHERE user_wallet_id = 'YOUR_PHANTOM_WALLET_ADDRESS';
```

## UI Elements to Verify

### Registration Prompt Should Show:
- 🎯 Large wallet icon with gradient background
- 📝 "Welcome to Solanafied!" heading
- 📋 Feature list with icons
- 🔘 Two buttons: "Create In-App Wallet" and "Check Again"
- ℹ️ Info note about backend handling

### Connected Wallet Card Should Always Show:
- 🔗 Connection indicator (green dot)
- 📍 Truncated wallet address
- 💰 SOL and SPL balances
- 📋 Copy address button

### Dashboard Should Only Show When Registered:
- 👤 Profile card with user info
- 📦 Bundlers list
- 📁 Mother wallets with filters
- 🪙 Tokens list

## Error Handling to Test

1. **Database Connection Issues**: Disconnect internet, should show appropriate error
2. **Wallet Connection Failures**: Cancel wallet connection, should handle gracefully
3. **Invalid Wallet States**: Test with different wallet states

## Backend Integration Points

The "Create In-App Wallet" button currently shows a placeholder message. In production, this should:

1. Call your backend API endpoint
2. Generate secure wallet keys
3. Store user in database
4. Return success/failure status
5. Automatically refresh the registration check

Example implementation:
```javascript
// In handleCreateWallet function, replace the placeholder with:
const response = await fetch('/api/create-wallet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    walletAddress: currentWallet.publicKey.toString() 
  })
});

if (response.ok) {
  await handleRefreshRegistration();
} else {
  throw new Error('Backend wallet creation failed');
}
```
