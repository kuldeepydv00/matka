const express = require('express');
const router = express.Router();
const {
  getStats,
  getUsers,
  getBetMatrix,
  getAdminBets,
  updateAdminBid,
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
  editGameResult,
  getResultsHistory,
  getDeclaredResults,
  updateUserWallet,
  getBannerConfig,
  updateBannerConfig,
  getBannersList,
  saveBannersList,
  getAppVersionConfig,
  updateAppVersionConfig,
  getSettingsConfig,
  updateSettingsConfig,
  getReferralConfig,
  updateReferralConfig,
  getReferralStats,
  adminLogin,
  verifyAdminOtp,
  getAdminAdmins,
  getAdminWinnings,
  getGameLedger,
  getCommissionLogs,
  getLeaderboard,
  getPayouts,
  getPackages,
  getPaymentMethods,
  savePaymentMethod,
  deletePaymentMethod,
  toggleActivePaymentMethod,
  sendCustomNotification,
  getNotifications,
  deleteNotification
} = require('../controllers/adminController');

router.get('/notifications', getNotifications);
router.post('/send-notification', sendCustomNotification);
router.delete('/notifications/:id', deleteNotification);

router.post('/login', adminLogin);
router.post('/verify-otp', verifyAdminOtp);
router.get('/admins', getAdminAdmins);
router.get('/winnings', getAdminWinnings);
router.get('/game-ledger', getGameLedger);
router.get('/commission-logs', getCommissionLogs);
router.get('/leaderboard', getLeaderboard);
router.get('/payouts', getPayouts);
router.get('/packages', getPackages);
router.get('/payment-methods', getPaymentMethods);
router.post('/payment-methods', savePaymentMethod);
router.post('/payment-methods/save', savePaymentMethod);
router.delete('/payment-methods/:id', deletePaymentMethod);
router.post('/payment-methods/:id/toggle', toggleActivePaymentMethod);

router.get('/paymentMethods', getPaymentMethods);
router.post('/paymentMethods', savePaymentMethod);
router.delete('/paymentMethods/:id', deletePaymentMethod);
router.post('/paymentMethods/:id/toggle', toggleActivePaymentMethod);

router.get('/banner', getBannerConfig);
router.post('/update-banner', updateBannerConfig);
router.get('/banners', getBannersList);
router.post('/update-banners-list', saveBannersList);
router.get('/app-version', getAppVersionConfig);
router.post('/update-app-version', updateAppVersionConfig);
router.get('/settings', getSettingsConfig);
router.post('/update-settings', updateSettingsConfig);
router.get('/referral-config', getReferralConfig);
router.post('/update-referral-config', updateReferralConfig);
router.get('/referral-stats', getReferralStats);
router.get('/stats', getStats);
router.get('/users', getUsers);
router.get('/matrix', getBetMatrix);
router.get('/bets', getAdminBets);
router.get('/bids', getAdminBets);
router.post('/update-bid', updateAdminBid);
router.get('/schedules', getGameSchedules);
router.post('/update-schedule', updateGameSchedule);
router.post('/update-user-wallet', updateUserWallet);
router.post('/declare-result', declareGameResult);
router.post('/clear-result', clearGameResult);
router.post('/edit-result', editGameResult);
router.get('/results-history', getResultsHistory);
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
