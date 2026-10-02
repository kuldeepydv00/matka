const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI;

async function clearAllUserData() {
  console.log('--- Starting Complete User Data Cleanup ---');

  // 1. Clear MongoDB Collections
  if (mongoUri) {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log('[MongoDB] Connected to database successfully');
      
      const targetCollections = [
        'users',
        'bets',
        'transactions',
        'depositrequests',
        'withdrawalrequests',
        'resultrecords',
        'draws',
        'notifications'
      ];

      for (const name of targetCols) {
        const res = await mongoose.connection.db.collection(name).deleteMany({});
        console.log(`[MongoDB] Cleared collection '${name}': deleted ${res.deletedCount} documents`);
      }
      await mongoose.disconnect();
      console.log('[MongoDB] Finished wiping user collections.');
    } catch (e) {
      console.error('[MongoDB Error during cleanup]:', e.message);
    }
  } else {
    console.log('[MongoDB] No MONGODB_URI found, skipping cloud DB.');
  }

  // 2. Clear Local & Server dataStore.json
  const storePath = path.join(__dirname, 'src', 'dataStore.json');
  let data = {};
  if (fs.existsSync(storePath)) {
    try {
      const raw = fs.readFileSync(storePath, 'utf-8');
      data = JSON.parse(raw);
    } catch (err) {
      data = {};
    }
  }

  // Reset user arrays and tables
  data.registeredUsers = [];
  data.userWalletStore = {
    balance: 0.00,
    name: '',
    mobile: ''
  };
  data.memoryDeposits = [];
  data.memoryWithdrawals = [];
  data.memoryBets = [];
  data.memoryGameLedger = [];
  data.memoryNotifications = [];
  data.declaredResultsMap = {};
  data.memoryResultsHistory = [];

  // Ensure default configs are intact
  if (!data.bannerConfig) {
    data.bannerConfig = {
      enabled: true,
      title: "95X MATKA SATTA",
      subtitle: "आपका भरोसा, हमारी पहचान",
      referralText: "केवल 5 प्लेइंग यूजर को रिफर करें और पाएं ₹500 बोनस",
      commissionText: "4% लाइफटाइम कमिशन आपकी टीम के हर दांव पर",
      minDeposit: "100",
      minWithdrawal: "200",
      imageUrl: "https://95xmatka.com/app_header.png"
    };
  } else {
    if (!data.bannerConfig.imageUrl) {
      data.bannerConfig.imageUrl = "https://95xmatka.com/app_header.png";
    }
  }

  if (!data.referralConfig) {
    data.referralConfig = {
      enabled: true,
      signupBonus: 50,
      commissionPercentage: 4
    };
  }

  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log('[Disk Store] All user data, bets, wallets, ledgers, deposits, withdrawals & results wiped from dataStore.json');
  console.log('[Cleanup Complete] Server is completely fresh and ready.');
}

clearAllUserData();
