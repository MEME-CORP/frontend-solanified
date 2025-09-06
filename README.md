# 🚀 Solanafied - Unified Solana Ecosystem DApp

A Material 3-designed decentralized application for managing your Solana ecosystem with an ant-colony-inspired interface that provides intelligent asset management across multiple wallets and bundlers.

![Solanafied Banner](https://via.placeholder.com/1200x400/9945FF/FFFFFF?text=Solanafied+-+Unified+Solana+Ecosystem)

## ✨ Features

### 🔐 Wallet Integration
- **Multi-Wallet Support**: Connect with Phantom, Solflare, and other Solana wallets
- **Real-time Balance Updates**: Live SOL and SPL token balance tracking
- **Secure Connection**: Non-custodial wallet integration with secure key management

### 📊 Asset Management
- **Bundler System**: Create and manage token bundlers for organized asset grouping
- **Mother/Child Wallets**: Hierarchical wallet structure for advanced fund management
- **Token Portfolio**: Track and manage your SPL token holdings
- **Real-time Updates**: Live database synchronization with instant UI updates

### 🎨 User Experience
- **Material 3 Design**: Modern, accessible interface following Google's latest design system
- **Ant Colony Patterns**: Unique background patterns inspired by efficient ant colony organization
- **Dark/Light Mode**: Automatic theme switching with manual override
- **Mobile-First**: Responsive design optimized for all screen sizes
- **WCAG AA Compliant**: Fully accessible with high contrast support

### 🔄 Real-time Features
- **Live Data Sync**: Instant updates when bundler status or wallet balances change
- **WebSocket Integration**: Real-time database subscriptions via Supabase
- **Automatic Refresh**: Smart data refreshing without manual intervention

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3 (Material 3), Vanilla JavaScript
- **Blockchain**: Solana Web3.js for wallet integration and balance queries
- **Database**: Supabase (PostgreSQL) with real-time subscriptions
- **Design System**: Material 3 with custom Solana brand colors
- **Accessibility**: WCAG AA compliant with screen reader support

## 📋 Prerequisites

Before setting up Solanafied, ensure you have:

1. **Solana Wallet**: Install [Phantom](https://phantom.app/) or [Solflare](https://solflare.com/)
2. **Supabase Account**: Sign up at [supabase.com](https://supabase.com)
3. **Web Server**: Any local web server (Live Server, Python's http.server, etc.)

## 🚀 Quick Setup

### 1. Database Setup

1. **Create Supabase Project**:
   - Go to [supabase.com](https://supabase.com) and create a new project
   - Note your project URL and anon key

2. **Set up Database Schema**:
   - Open the SQL editor in your Supabase dashboard
   - Copy and paste the contents of `database_structure.txt`
   - Execute the SQL to create all tables, functions, and triggers

3. **Configure Row Level Security (Optional)**:
   ```sql
   -- Enable RLS on all tables
   ALTER TABLE users ENABLE ROW LEVEL SECURITY;
   ALTER TABLE bundlers ENABLE ROW LEVEL SECURITY;
   ALTER TABLE tokens ENABLE ROW LEVEL SECURITY;
   
   -- Add policies as needed for your security requirements
   ```

### 2. Application Configuration

1. **Update Database Credentials**:
   - Open `database.js`
   - Replace `YOUR_SUPABASE_URL` with your Supabase project URL
   - Replace `YOUR_SUPABASE_ANON_KEY` with your Supabase anon key

   ```javascript
   const SUPABASE_URL = 'https://your-project.supabase.co';
   const SUPABASE_ANON_KEY = 'your-anon-key-here';
   ```

2. **Configure Solana Network** (Optional):
   - Open `script.js`
   - Find the `updateWalletBalance()` function
   - Change the cluster if needed:
   ```javascript
   const connection = new solanaWeb3.Connection(
     solanaWeb3.clusterApiUrl('mainnet-beta'), // or 'devnet' for testing
     'confirmed'
   );
   ```

### 3. Launch Application

1. **Serve Files**:
   ```bash
   # Using Python 3
   python -m http.server 8000
   
   # Using Node.js (with http-server)
   npx http-server
   
   # Or use VS Code Live Server extension
   ```

2. **Open in Browser**:
   - Navigate to `http://localhost:8000`
   - The application should load with the Solanafied interface

## 🎯 Usage Guide

### Getting Started

1. **Connect Wallet**:
   - Click "Connect Wallet" in the top-right corner
   - Select your preferred Solana wallet (Phantom recommended)
   - Approve the connection request

2. **Dashboard Overview**:
   - **Profile Card**: Shows your wallet address and balances
   - **Bundlers Card**: Manage your token bundlers
   - **Mother Wallets Card**: View available and assigned wallets
   - **Tokens Card**: Track your SPL token portfolio

### Managing Bundlers

1. **Create Bundler**:
   - Click the floating action button (FAB) in the bottom-right
   - Select "Create Bundler"
   - Enter a token name for organization

2. **Toggle Bundler Status**:
   - Click the play/pause button next to any bundler
   - Active bundlers will show as "Active" with a green status

### Working with Wallets

1. **View Mother Wallets**:
   - Use filter chips to show All, Available, or Assigned wallets
   - Each wallet shows its public key and SOL balance
   - Availability status indicates if the wallet is assigned to a bundler

2. **Real-time Updates**:
   - Wallet balances update automatically
   - Status changes reflect immediately across the interface

### Token Management

1. **Add Tokens**:
   - Click the FAB and select "Add Token"
   - Enter token name and symbol
   - Tokens will appear in your portfolio

## 🔧 Database Schema Overview

The application uses a sophisticated database schema designed for crypto wallet management:

### Core Tables

- **`users`**: User profiles linked to wallet addresses
- **`mother_wallets`**: Primary wallets with availability tracking
- **`child_wallets`**: Sub-wallets linked to mother wallets
- **`bundlers`**: Token grouping system for asset organization
- **`assigned_mother_wallets`**: Junction table for wallet-bundler relationships
- **`tokens`**: SPL token registry with metadata

### Key Features

- **Automatic Balance Aggregation**: Triggers maintain calculated balances
- **Availability Tracking**: Mother wallets automatically marked as available/assigned
- **Data Consistency**: Foreign key constraints ensure referential integrity
- **Real-time Updates**: Database triggers enable live UI updates

## 🎨 Customization

### Theming

The application supports extensive theming through CSS custom properties:

```css
:root {
  --md-sys-color-primary: #9945FF;    /* Solana Purple */
  --md-sys-color-secondary: #14F195;  /* Solana Teal */
  --md-sys-color-tertiary: #FF6B9D;   /* Accent Pink */
}
```

### Ant Colony Patterns

Customize the background patterns by modifying:

```css
:root {
  --colony-primary: rgba(153, 69, 255, 0.1);
  --colony-secondary: rgba(20, 241, 149, 0.05);
  --colony-grid-size: 20px;
}
```

## 🔒 Security Considerations

### Wallet Security
- **Non-Custodial**: Your private keys never leave your wallet
- **Read-Only Access**: Application only requests public key and signature permissions
- **Secure Communication**: All wallet interactions use standard Solana wallet adapters

### Database Security
- **Environment Variables**: Store Supabase credentials securely in production
- **Row Level Security**: Implement RLS policies for multi-user scenarios
- **API Key Management**: Use service role keys only on secure backends

### Best Practices
- Never store private keys in the database
- Validate all user inputs before database operations
- Use HTTPS in production environments
- Implement proper error handling for failed transactions

## 🐛 Troubleshooting

### Common Issues

1. **"No Solana wallet found"**:
   - Install Phantom or Solflare wallet extension
   - Refresh the page after installation

2. **"Database not initialized"**:
   - Check Supabase credentials in `database.js`
   - Ensure database schema is properly set up
   - Verify network connectivity to Supabase

3. **"Failed to load data"**:
   - Check browser console for detailed error messages
   - Verify database tables exist and have correct permissions
   - Ensure wallet is properly connected

4. **Balance not updating**:
   - Check Solana network status
   - Verify RPC endpoint is responsive
   - Try refreshing the connection

### Debug Mode

Enable detailed logging by opening browser console and running:

```javascript
localStorage.setItem('debug', 'true');
location.reload();
```

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines:

1. **Fork the Repository**
2. **Create Feature Branch**: `git checkout -b feature/amazing-feature`
3. **Commit Changes**: `git commit -m 'Add amazing feature'`
4. **Push to Branch**: `git push origin feature/amazing-feature`
5. **Open Pull Request**

### Development Guidelines

- Follow Material 3 design principles
- Maintain WCAG AA accessibility standards
- Write comprehensive error handling
- Include JSDoc comments for functions
- Test on multiple screen sizes and browsers

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Solana Foundation** for the robust blockchain infrastructure
- **Material Design Team** for the comprehensive design system
- **Supabase Team** for the excellent real-time database platform
- **Phantom Wallet** for the seamless wallet integration

## 📞 Support

Need help? Reach out through:

- **GitHub Issues**: Report bugs and request features
- **Documentation**: Check this README for common solutions
- **Community**: Join the Solana developer community

---

**Built with ❤️ for the Solana ecosystem**

*Solanafied - Where efficiency meets elegance in decentralized asset management*
