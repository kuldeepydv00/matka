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
            if (!registeredUsers.some(u => u.mobile.slice(-10) === cleanMobile)) {
              registeredUsers.push({
                id: dbU._id.toString(),
                name: dbU.name || dbU.username || `User ${cleanMobile.slice(-4)}`,
                mobile: cleanMobile,
                password: dbU.password || '123',
                balance: dbU.wallet_balance || 0.00,
                status: 'Active',
                createdAt: '12:00 AM',
                createdDateKey: '2026-08-18'
              });
            }
          }
        });
        console.log(`[MongoDB] Loaded ${dbUsers.length} users from Cloud Database into memory.`);
      }
    } catch (e) { }
  } catch (error) {
    console.log(`MongoDB not connected (${error.message}). Running server with in-memory storage fallback.`);
  }
};

module.exports = connectDB;
