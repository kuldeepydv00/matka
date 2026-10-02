const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Configuration
router.get('/config', paymentController.getPaymentConfig);

// EKQR Endpoints
router.post('/ekqr/create-order', paymentController.createEkqrOrder);
router.post('/ekqr/check-status', paymentController.checkEkqrStatus);
router.all('/ekqr/webhook', paymentController.handleEkqrWebhook);

module.exports = router;
