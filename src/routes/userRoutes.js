const express = require('express');
const router = express.Router();
const { 
  registerUser, 
  loginUser, 
  getUserProfile, 
  getWalletBalance, 
  updateWalletBalance, 
  getTransactions, 
  submitDeposit,
  requestWithdrawal,
  saveBankDetails,
  getBankDetails,
  sendSmsOtp,
  verifySmsOtp,
  resendSmsOtp,
  checkUserExists,
  getReferralDetails,
  applyReferralCode,
  transferCommissionToWallet,
  getKhaiwalPlayers,
  addKhaiwalPlayer,
  updateKhaiwalPlayer,
  deleteKhaiwalPlayer,
  logKhaiwalPlayerBet,
  getKhaiwalPlayerLedger,
  uploadApkChunk
} = require('../controllers/userController');

router.post('/upload-apk-chunk', uploadApkChunk);
router.get('/check', checkUserExists);
router.get('/referral-details', getReferralDetails);
router.post('/apply-referral', applyReferralCode);
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/send-otp', sendSmsOtp);
router.post('/verify-otp', verifySmsOtp);
router.post('/resend-otp', resendSmsOtp);
router.get('/profile', getUserProfile);
router.get('/wallet/balance', getWalletBalance);
router.post('/wallet/balance', updateWalletBalance);
router.get('/wallet/transactions', getTransactions);
router.post('/deposit', submitDeposit);
router.post('/deposit/request', submitDeposit);
router.post('/withdraw/request', requestWithdrawal);
router.get('/bank-details', getBankDetails);
router.post('/bank-details/save', saveBankDetails);
router.post('/commission/transfer', transferCommissionToWallet);

// Khaiwal Management Routes
router.get('/khaiwal/players', getKhaiwalPlayers);
router.post('/khaiwal/players', addKhaiwalPlayer);
router.post('/khaiwal/players/update', updateKhaiwalPlayer);
router.put('/khaiwal/players/:playerId', updateKhaiwalPlayer);
router.post('/khaiwal/players/delete', deleteKhaiwalPlayer);
router.delete('/khaiwal/players/:playerId', deleteKhaiwalPlayer);
router.post('/khaiwal/log-player-bet', logKhaiwalPlayerBet);
router.get('/khaiwal/players/:playerId/ledger', getKhaiwalPlayerLedger);

module.exports = router;
