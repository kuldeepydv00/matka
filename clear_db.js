const mongoose = require('mongoose');
const ResultRecord = require('./src/models/ResultRecord');
const dotenv = require('dotenv');
dotenv.config();

const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/numberbetting";

async function clearRecords() {
  try {
    await mongoose.connect(mongoUri);
    console.log('[MongoDB] Connected to database');
    const res = await ResultRecord.deleteMany({});
    console.log(`[MongoDB] Deleted ${res.deletedCount} result records`);
    await mongoose.disconnect();
  } catch (e) {
    console.error('[MongoDB Error]', e);
  }
}

clearRecords();
