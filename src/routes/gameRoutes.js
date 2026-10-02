const express = require('express');
const router = express.Router();
const { placeBet, getMyBets, getResults, getChartResults } = require('../controllers/gameController');
const { getGameSchedules, getBannerConfig, updateBannerConfig, getBannersList, getLivePlayers } = require('../controllers/adminController');

router.get('/results', getResults);
router.get('/chart-results', getChartResults);
router.get('/schedules', getGameSchedules);
router.get('/banner', getBannerConfig);
router.get('/banners', getBannersList);
router.post('/banner', updateBannerConfig);
router.get('/live-players', getLivePlayers);
router.post('/bet', placeBet);
router.get('/my-bets', getMyBets);

module.exports = router;
