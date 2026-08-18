const express = require('express');
const router = express.Router();
const {
  getStats,
  getUsers,
  getBetMatrix,
  getGameSchedules,
  updateGameSchedule,
  getDeposits,
  createDepositRequest,
  approveDeposit,
  rejectDeposit,
  getWithdrawals,
  createWithdrawalRequest,
  approveWithdrawal,
  rejectWithdrawal,
  declareGameResult,
  clearGameResult,
  getDeclaredResults,
  updateUserWallet,
  getBannerConfig,
  updateBannerConfig
} = require('../controllers/adminController');

router.get('/banner', getBannerConfig);
router.post('/update-banner', updateBannerConfig);
router.get('/stats', getStats);
router.get('/users', getUsers);
router.get('/matrix', getBetMatrix);
router.get('/schedules', getGameSchedules);
router.post('/update-schedule', updateGameSchedule);
router.post('/update-user-wallet', updateUserWallet);
router.post('/declare-result', declareGameResult);
router.post('/clear-result', clearGameResult);
router.get('/declared-results', getDeclaredResults);

// Deposits routes
router.get('/deposits', getDeposits);
router.post('/deposits/request', createDepositRequest);
router.post('/deposits/:id/approve', approveDeposit);
router.post('/deposits/:id/reject', rejectDeposit);

// Withdrawals routes
router.get('/withdrawals', getWithdrawals);
router.post('/withdrawals/request', createWithdrawalRequest);
router.post('/withdrawals/:id/approve', approveWithdrawal);
router.post('/withdrawals/:id/reject', rejectWithdrawal);

module.exports = router;
