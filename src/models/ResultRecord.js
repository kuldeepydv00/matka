const mongoose = require('mongoose');

const resultRecordSchema = new mongoose.Schema({
  game_name: { type: String, required: true },
  winning_number: { type: String, required: true },
  date_key: { type: String, required: true },
  declared_at: { type: Date, default: Date.now }
}, {
  timestamps: true
});

resultRecordSchema.index({ game_name: 1, date_key: 1 }, { unique: true });

const ResultRecord = mongoose.model('ResultRecord', resultRecordSchema);
module.exports = ResultRecord;
