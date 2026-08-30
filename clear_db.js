const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/numberbetting";

async function clearRecords() {
  try {
    await mongoose.connect(mongoUri);
    console.log('[MongoDB] Connected to database');
    
    // Clear only specific transaction/user collections, preserving config collections (banners, paymentmethods, etc.)
    const targetCollections = ['users', 'bets', 'transactions', 'depositrequests', 'withdrawalrequests', 'resultrecords', 'draws'];
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      if (targetCollections.includes(key.toLowerCase())) {
        await collections[key].deleteMany({});
        console.log(`[MongoDB] Cleared collection: ${key}`);
      } else {
        console.log(`[MongoDB] Preserved configuration collection: ${key}`);
      }
    }
    
    // Clear user-related fake data in dataStore.json
    const storePath = path.join(__dirname, 'src', 'dataStore.json');
    if (fs.existsSync(storePath)) {
      const raw = fs.readFileSync(storePath, 'utf-8');
      const data = JSON.parse(raw);
      
      data.registeredUsers = [];
      data.userWalletStore = {};
      data.memoryDeposits = [];
      data.memoryWithdrawals = [];
      data.memoryBets = [];
      data.declaredResultsMap = {};
      
      fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log('[Disk Store] Wiped user-related fake data from dataStore.json');
    }

    await mongoose.disconnect();
    console.log('[Cleanup] All database records and fake store data cleared successfully.');
  } catch (e) {
    console.error('[MongoDB Error]', e);
  }
}

clearRecords();

