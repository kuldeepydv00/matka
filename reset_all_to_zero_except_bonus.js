const mongoose = require('mongoose');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const mongoUri = process.env.MONGODB_URI;

async function resetAllDataToZeroExceptBonus() {
  console.log('--- Resetting All Data To Zero (Bonus Remaining 800) ---');

  // 1. Clear MongoDB Collections if connected
  if (mongoUri) {
    try {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
      console.log('[MongoDB] Connected to database successfully');

      const targetCollections = [
        'bets',
        'transactions',
        'depositrequests',
        'withdrawalrequests',
        'notifications'
      ];

      for (const name of targetCollections) {
        try {
          const res = await mongoose.connection.db.collection(name).deleteMany({});
          console.log(`[MongoDB] Cleared collection '${name}': deleted ${res.deletedCount} documents`);
        } catch (e) {
          console.log(`[MongoDB] Collection '${name}' skip/error:`, e.message);
        }
      }

      // Update all users in DB: reset balances to 0, bonus to 200
      try {
        const User = require('./src/models/User');
        await User.updateMany({}, {
          $set: {
            wallet_balance: 0.00,
            deposit_balance: 0.00,
            winning_balance: 0.00,
            commission_balance: 0.00,
            bonus_balance: 200.00
          }
        });
        console.log('[MongoDB] Updated user balances: wallet=0, deposit=0, winning=0, commission=0, bonus=200');
      } catch (e) {
        console.log('[MongoDB User Update error]:', e.message);
      }

      await mongoose.disconnect();
      console.log('[MongoDB] Finished wiping transactions/bets/deposits.');
    } catch (e) {
      console.error('[MongoDB Cleanup Error]:', e.message);
    }
  }

  // 2. Clear Local & Server dataStore.json across all target paths
  const targetPaths = [
    path.join(__dirname, 'dataStore.json'),
    path.join(__dirname, 'src', 'dataStore.json'),
    '/var/www/matka-backend/dataStore.json',
    '/var/www/matka-backend/src/dataStore.json'
  ];

  targetPaths.forEach(targetFile => {
    if (fs.existsSync(targetFile)) {
      try {
        const raw = fs.readFileSync(targetFile, 'utf-8');
        const data = JSON.parse(raw);

        data.memoryDeposits = [];
        data.memoryWithdrawals = [];
        data.memoryBets = [];
        data.memoryGameLedger = [];
        data.memoryNotifications = [];

        if (Array.isArray(data.registeredUsers)) {
          data.registeredUsers.forEach(u => {
            u.balance = 0.00;
            u.deposit_balance = 0.00;
            u.winning_balance = 0.00;
            u.commission_balance = 0.00;
            u.bonus_balance = 200.00;
          });
        }

        data.userWalletStore = {
          balance: 0.00,
          name: '',
          mobile: ''
        };

        fs.writeFileSync(targetFile, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`[Disk Store] Successfully reset file: ${targetFile}`);
      } catch (err) {
        console.error(`[Disk Store] Error updating ${targetFile}:`, err.message);
      }
    }
  });

  console.log('--- Reset Complete ---');
}

resetAllDataToZeroExceptBonus();
