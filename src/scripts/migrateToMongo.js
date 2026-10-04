/**
 * Safe One-Time Migration Script: dataStore.json + Mongo Data -> MongoDB Models
 *
 * NOTE: DO NOT run on live server until confirmed by user.
 * Defaults to DRY RUN unless --execute flag is explicitly passed.
 *
 * Usage:
 *   node backend/src/scripts/migrateToMongo.js [--execute]
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const User = require('../models/User');
const Bet = require('../models/Bet');
const Result = require('../models/Result');
const DepositRequest = require('../models/DepositRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const Setting = require('../models/Setting');

const isExecute = process.argv.includes('--execute');

async function runMigration() {
  console.log(`====================================================`);
  console.log(` MONGODB MIGRATION SCRIPT (${isExecute ? 'EXECUTE MODE' : 'DRY RUN MODE'})`);
  console.log(`====================================================\n`);

  const dataStorePath = path.join(__dirname, '../dataStore.json');
  if (!fs.existsSync(dataStorePath)) {
    console.log(`No dataStore.json found at ${dataStorePath}. Nothing to migrate.`);
    return;
  }

  // 1. Backup local dataStore.json
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(__dirname, `../dataStore.json.bak_migration_${stamp}`);
  fs.copyFileSync(dataStorePath, backupPath);
  console.log(`[1/5] Backed up dataStore.json -> ${backupPath}`);

  // 2. Connect to MongoDB Atlas
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error(`[ERROR] MONGODB_URI missing in .env file.`);
    return;
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log(`[2/5] Connected to MongoDB Atlas at ${mongoose.connection.host}`);

  // 3. Load dataStore.json
  const raw = fs.readFileSync(dataStorePath, 'utf-8');
  let dataStore = {};
  try {
    dataStore = JSON.parse(raw);
  } catch (e) {
    console.error(`[ERROR] Could not parse dataStore.json: ${e.message}`);
    return;
  }

  console.log(`\n[3/5] Inspecting dataStore.json records:`);
  console.log(`  - Users: ${dataStore.registeredUsers?.length || 0}`);
  console.log(`  - Bets: ${dataStore.memoryBets?.length || 0}`);
  console.log(`  - Deposits: ${dataStore.memoryDeposits?.length || 0}`);
  console.log(`  - Withdrawals: ${dataStore.memoryWithdrawals?.length || 0}`);
  console.log(`  - Results History: ${dataStore.memoryResultsHistory?.length || 0}`);

  // 4. Migration statistics
  const stats = {
    usersMigrated: 0,
    betsMigrated: 0,
    depositsMigrated: 0,
    withdrawalsMigrated: 0,
    resultsMigrated: 0,
    settingsMigrated: 0
  };

  // --- A. Users Migration ---
  if (Array.isArray(dataStore.registeredUsers)) {
    for (const u of dataStore.registeredUsers) {
      const cleanMob = String(u.mobile || u.phone || '').replace(/[^0-9]/g, '').slice(-10);
      if (!cleanMob) continue;

      const userDoc = {
        name: u.name || `User ${cleanMob.slice(-4)}`,
        mobile: cleanMob,
        password: u.password || '123',
        wallet_balance: parseFloat(u.balance) || 0.00,
        deposit_balance: parseFloat(u.deposit_balance) || 0.00,
        winning_balance: parseFloat(u.winning_balance) || 0.00,
        bonus_balance: parseFloat(u.bonus_balance) || 200.00,
        commission_balance: parseFloat(u.commission_balance) || 0.00,
        status: u.status || 'Active',
        referral_code: u.referral_code || `REF${cleanMob}`,
        account_number: u.account_number || u.accountNumber || null,
        account_holder_name: u.account_holder_name || u.account_name || u.name || null,
        ifsc_code: u.ifsc_code || u.ifscCode || null,
        bank_name: u.bank_name || u.bankName || 'Bank Account'
      };

      if (isExecute) {
        await User.findOneAndUpdate({ mobile: cleanMob }, { $set: userDoc }, { upsert: true, new: true });
      }
      stats.usersMigrated++;
    }
  }

  // --- B. Bets Migration ---
  if (Array.isArray(dataStore.memoryBets)) {
    for (const b of dataStore.memoryBets) {
      const betId = String(b._id || b.id || '');
      const cleanMob = String(b.user || b.mobile || b.phone || '').replace(/[^0-9]/g, '').slice(-10);
      if (!cleanMob) continue;

      const betDoc = {
        game_name: b.game_name || b.category || 'Delhi Bazar',
        bet_type: b.bet_type || b.gameType || 'Single Jodi',
        number: String(b.number !== undefined ? b.number : ''),
        bet_amount: parseFloat(b.bet_amount || b.amount || 0),
        potential_payout: parseFloat(b.potential_payout || 0),
        win_amount: parseFloat(b.win_amount || 0),
        status: b.status || 'pending',
        user: b.user || cleanMob,
        mobile: cleanMob,
        created_at: b.created_at || b.createdAt || b.date || new Date().toISOString()
      };

      if (isExecute) {
        if (betId && mongoose.Types.ObjectId.isValid(betId)) {
          await Bet.findOneAndUpdate({ _id: betId }, { $set: betDoc }, { upsert: true, new: true });
        } else {
          await Bet.create(betDoc);
        }
      }
      stats.betsMigrated++;
    }
  }

  // --- C. Results Migration ---
  if (Array.isArray(dataStore.memoryResultsHistory)) {
    for (const r of dataStore.memoryResultsHistory) {
      const g = r.category || r.game_name || r.game;
      const dKey = r.date || r.date_key || r.dateKey;
      const num = parseInt(r.number);

      if (g && dKey && !isNaN(num) && r.number !== '--') {
        const canonicalGame = (g.toLowerCase() === 'disawer' || g.toLowerCase() === 'desawar') ? 'Desawar' :
                              (g.toLowerCase() === 'shri ganesh' || g.toLowerCase() === 'shree ganesh') ? 'Shree Ganesh' : g;

        if (isExecute) {
          await Result.findOneAndUpdate(
            { game: canonicalGame, date: dKey },
            { $set: { game: canonicalGame, date: dKey, number: num, declaredAt: r.declaredAt ? new Date(r.declaredAt) : new Date() } },
            { upsert: true, new: true }
          );
        }
        stats.resultsMigrated++;
      }
    }
  }

  // --- D. Settings Migration ---
  if (dataStore.settingsConfig) {
    for (const [k, v] of Object.entries(dataStore.settingsConfig)) {
      if (isExecute) {
        await Setting.findOneAndUpdate({ key: k }, { $set: { key: k, value: v } }, { upsert: true, new: true });
      }
      stats.settingsMigrated++;
    }
  }

  console.log(`\n[4/5] Migration Report Summary:`);
  console.log(`  - Users Processed: ${stats.usersMigrated}`);
  console.log(`  - Bets Processed: ${stats.betsMigrated}`);
  console.log(`  - Results Processed: ${stats.resultsMigrated}`);
  console.log(`  - Settings Processed: ${stats.settingsMigrated}`);

  if (!isExecute) {
    console.log(`\n[5/5] DRY RUN COMPLETED! No database changes were written.`);
    console.log(`      To execute migration on live server, run with: node backend/src/scripts/migrateToMongo.js --execute`);
  } else {
    console.log(`\n[5/5] MIGRATION EXECUTED SUCCESSFULLY ON MONGODB ATLAS!`);
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  runMigration().catch(err => {
    console.error('Migration execution failed:', err);
    process.exit(1);
  });
}

module.exports = runMigration;
