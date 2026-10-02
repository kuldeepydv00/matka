const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    const { registeredUsers, memoryBets, bannersListStore, saveDiskStore } = require('../store');

    // 1. Load all registered users from MongoDB Atlas
    try {
      const User = require('../models/User');
      const dbUsers = await User.find({});
      if (dbUsers && dbUsers.length > 0) {
        dbUsers.forEach(dbU => {
          if (dbU.mobile) {
            const cleanMobile = dbU.mobile.replace(/[^0-9]/g, '').slice(-10);
            let existing = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
            if (!existing) {
              existing = {
                id: dbU._id.toString(),
                name: dbU.name || dbU.username || `User ${cleanMobile.slice(-4)}`,
                mobile: cleanMobile,
                password: dbU.password || '123',
                balance: dbU.wallet_balance || 0.00,
                deposit_balance: dbU.deposit_balance !== undefined ? dbU.deposit_balance : (dbU.wallet_balance || 0.00),
                winning_balance: dbU.winning_balance !== undefined ? dbU.winning_balance : 0.00,
                bonus_balance: dbU.bonus_balance !== undefined ? dbU.bonus_balance : 200.00,
                commission_balance: dbU.commission_balance !== undefined ? dbU.commission_balance : 0.00,
                status: 'Active',
                referral_code: dbU.referral_code || `REF${cleanMobile}`,
                referred_by: dbU.referred_by || null,
                createdAt: dbU.createdAt ? new Date(dbU.createdAt).toISOString() : new Date().toISOString()
              };
              registeredUsers.push(existing);
            } else {
              if (dbU.referral_code) existing.referral_code = dbU.referral_code;
              if (dbU.referred_by) existing.referred_by = dbU.referred_by;
              if (dbU.deposit_balance !== undefined) existing.deposit_balance = dbU.deposit_balance;
              if (dbU.winning_balance !== undefined) existing.winning_balance = dbU.winning_balance;
              if (dbU.bonus_balance !== undefined) existing.bonus_balance = dbU.bonus_balance;
              if (dbU.commission_balance !== undefined) existing.commission_balance = dbU.commission_balance;
              if (dbU.wallet_balance !== undefined && dbU.wallet_balance > existing.balance) {
                existing.balance = dbU.wallet_balance;
              }
            }
          }
        });
        console.log(`[MongoDB] Loaded ${dbUsers.length} users from Cloud Database into memory.`);
      }
    } catch (e) {
      console.error('[MongoDB] User Hydration Error:', e.message);
    }

    // 2. Load all bets from MongoDB Atlas
    try {
      const Bet = require('../models/Bet');
      const dbBets = await Bet.find({}).sort({ created_at: -1 });
      if (dbBets && dbBets.length > 0) {
        dbBets.forEach(dbB => {
          const betId = dbB._id.toString();
          const dbMob = String(dbB.mobile || dbB.user || '').replace(/[^0-9]/g, '').slice(-10);
          const dbTime = dbB.created_at ? new Date(dbB.created_at).getTime() : (dbB.createdAt ? new Date(dbB.createdAt).getTime() : 0);

          const existing = memoryBets.find(b => {
            if (String(b._id || b.id) === betId) return true;
            const bMob = String(b.user || b.mobile || '').replace(/[^0-9]/g, '').slice(-10);
            const bTime = b.created_at ? new Date(b.created_at).getTime() : (b.timestamp || 0);
            if (bMob && dbMob && bMob === dbMob && b.game_name === dbB.game_name && String(b.number) === String(dbB.number) && Math.abs((b.bet_amount || b.amount || 0) - (dbB.bet_amount || 0)) < 0.01 && (bTime === 0 || dbTime === 0 || Math.abs(bTime - dbTime) < 30000)) {
              b._id = betId;
              b.id = betId;
              if (dbB.status && dbB.status !== 'pending') b.status = dbB.status;
              if (dbB.win_amount && dbB.win_amount > 0) b.win_amount = dbB.win_amount;
              return true;
            }
            return false;
          });

          if (!existing) {
            let extractedTs = null;
            if (dbB.created_at && !isNaN(new Date(dbB.created_at).getTime())) extractedTs = new Date(dbB.created_at).toISOString();
            else if (dbB.createdAt && !isNaN(new Date(dbB.createdAt).getTime())) extractedTs = new Date(dbB.createdAt).toISOString();
            else if (dbB.date && !isNaN(new Date(dbB.date).getTime())) extractedTs = new Date(dbB.date).toISOString();
            else {
              const rawId = String(betId || '');
              const match = rawId.match(/\d{12,14}/);
              if (match) {
                const num = parseInt(match[0]);
                if (!isNaN(num) && num > 10000000000) extractedTs = new Date(num).toISOString();
              }
            }

            memoryBets.push({
              _id: betId,
              id: betId,
              game_name: dbB.game_name,
              category: dbB.game_name,
              bet_type: dbB.bet_type || 'Single Jodi',
              gameType: dbB.bet_type || 'Single Jodi',
              number: dbB.number,
              bet_amount: dbB.bet_amount,
              amount: dbB.bet_amount,
              potential_payout: dbB.potential_payout || (dbB.bet_amount * 95),
              win_amount: dbB.win_amount || 0,
              status: dbB.status || 'pending',
              user: dbB.user || dbB.mobile || 'User',
              mobile: dbB.mobile || dbB.user || '',
              phone: dbB.mobile || '1111111131',
              ...(extractedTs ? { date: extractedTs, created_at: extractedTs } : {})
            });
          }
        });
        console.log(`[MongoDB] Loaded ${dbBets.length} bets from Cloud Database into memory.`);
      }
    } catch (e) {
      console.error('[MongoDB] Bet Hydration Error:', e.message);
    }

    // 3. Load all saved banners list from MongoDB
    try {
      const BannersListModel = mongoose.models.BannersList || mongoose.model('BannersList', new mongoose.Schema({}, { strict: false }));
      const dbBanners = await BannersListModel.find({}).lean();
      if (dbBanners && dbBanners.length > 0) {
        bannersListStore.length = 0;
        bannersListStore.push(...dbBanners);
        console.log(`[MongoDB] Loaded ${dbBanners.length} saved banners list from Cloud Database into memory.`);
      }
    } catch (e) {
      console.error('[MongoDB] Banners List Hydration Error:', e.message);
    }

    saveDiskStore();
  } catch (error) {
    console.log(`MongoDB not connected (${error.message}). Running server with in-memory storage fallback.`);
  }
};

module.exports = connectDB;
