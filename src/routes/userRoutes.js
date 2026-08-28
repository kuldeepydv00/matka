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
  sendSmsOtp,
  verifySmsOtp,
  checkUserExists,
  getReferralDetails
} = require('../controllers/userController');

router.get('/check', checkUserExists);
router.get('/referral-details', getReferralDetails);
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/send-otp', sendSmsOtp);
router.post('/verify-otp', verifySmsOtp);
router.get('/profile', getUserProfile);
router.get('/wallet/balance', getWalletBalance);
router.post('/wallet/balance', updateWalletBalance);
router.get('/wallet/transactions', getTransactions);
router.post('/deposit', submitDeposit);
router.post('/deposit/request', submitDeposit);
router.post('/withdraw/request', requestWithdrawal);

module.exports = router;
