const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 3000
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Load all registered users from MongoDB Atlas
    try {
      const User = require('../models/User');
      const dbUsers = await User.find({});
      if (dbUsers && dbUsers.length > 0) {
        const { registeredUsers } = require('../store');
        dbUsers.forEach(dbU => {
          if (dbU.mobile) {
            const cleanMobile = dbU.mobile.replace(/[^0-9]/g, '').slice(-10);
            let existing = registeredUsers.find(u => u.mobile.replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
            if (!existing) {
              existing = {
                id: dbU._id.toString(),
                name: dbU.name || dbU.username || `User ${cleanMobile.slice(-4)}`,
                mobile: cleanMobile,
                password: dbU.password || '123',
                balance: dbU.wallet_balance || 0.00,
                status: 'Active',
                referral_code: dbU.referral_code || `REF${cleanMobile}`,
                referred_by: dbU.referred_by || null,
                createdAt: '12:00 AM',
                createdDateKey: '2026-08-18'
              };
              registeredUsers.push(existing);
            } else {
              if (dbU.referral_code) existing.referral_code = dbU.referral_code;
              if (dbU.referred_by) existing.referred_by = dbU.referred_by;
              if (dbU.wallet_balance !== undefined && dbU.wallet_balance > existing.balance) {
                existing.balance = dbU.wallet_balance;
              }
            }
          }
        });
        console.log(`[MongoDB] Loaded ${dbUsers.length} users with referral codes from Cloud Database into memory.`);
      }
    } catch (e) { }
  } catch (error) {
    console.log(`MongoDB not connected (${error.message}). Running server with in-memory storage fallback.`);
  }
};

module.exports = connectDB;
