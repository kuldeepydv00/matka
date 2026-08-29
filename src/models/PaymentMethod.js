const mongoose = require('mongoose');

const paymentMethodSchema = new mongoose.Schema({
  name: { type: String, required: true },
  upi_id: { type: String, required: true },
  merchant_name: { type: String, default: 'Matka Official' },
  ordering: { type: Number, default: 1 },
  status: { type: String, enum: ['Active', 'Inactive', 'active', 'inactive'], default: 'Active' },
  updateDate: { type: String }
}, {
  strict: false,
  timestamps: true
});

const PaymentMethod = mongoose.models.PaymentMethod || mongoose.model('PaymentMethod', paymentMethodSchema);
module.exports = PaymentMethod;
