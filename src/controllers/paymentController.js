const { 
  userWalletStore, 
  registeredUsers, 
  memoryDeposits, 
  settingsConfig, 
  saveDiskStore, 
  logLedgerTransaction 
} = require('../store');

const EKQR_API_BASE = 'https://api.ekqr.in/api';
const DEFAULT_KEY = '8f12c3ab-b6d9-4e75-b116-a7de230f0d83';

function getApiKey() {
  return (settingsConfig && settingsConfig.ekqr_api_key) ? settingsConfig.ekqr_api_key : DEFAULT_KEY;
}

function getFormattedDate(date = new Date()) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Reusable helper to credit deposit to user balance idempotently
 */
async function creditSuccessfulDeposit(clientTxnId, utr, gatewayTxnId, extraData = {}) {
  try {
    const rawMobile = String(extraData.customer_mobile || extraData.udf1 || '').replace(/[^0-9]/g, '');
    const cleanMobile = rawMobile.length >= 10 ? rawMobile.slice(-10) : '';

    let dep = memoryDeposits.find(d => 
      (clientTxnId && String(d.client_txn_id) === String(clientTxnId)) || 
      (clientTxnId && String(d._id) === String(clientTxnId)) || 
      (clientTxnId && String(d.order_id) === String(clientTxnId)) ||
      (clientTxnId && d.utr && String(d.utr) === String(clientTxnId)) ||
      (utr && d.utr && String(d.utr) === String(utr)) ||
      (cleanMobile && d.mobile === cleanMobile && parseFloat(d.amount) === parseFloat(extraData.amount || 0) && d.status === 'Pending')
    );

    const mongoose = require('mongoose');

    if (!dep && mongoose.connection.readyState === 1) {
      try {
        const DepositRequest = require('../models/DepositRequest');
        const dbDep = await DepositRequest.findOne({ 
          $or: [
            { utr_number: clientTxnId },
            { utr_number: utr },
            { user_id: cleanMobile, amount: parseFloat(extraData.amount || 0) },
            { _id: mongoose.Types.ObjectId.isValid(clientTxnId) ? clientTxnId : undefined }
          ].filter(Boolean)
        }).sort({ createdAt: -1 });
        if (dbDep) {
          dep = {
            _id: dbDep._id,
            client_txn_id: clientTxnId || dbDep.utr_number,
            user: (dbDep.username && !dbDep.username.startsWith('null')) ? dbDep.username : `User (${cleanMobile || dbDep.user_id || 'N/A'})`,
            username: (dbDep.username && !dbDep.username.startsWith('null')) ? dbDep.username : 'User',
            mobile: cleanMobile || dbDep.user_id || 'N/A',
            amount: parseFloat(dbDep.amount) || 0,
            utr: utr || dbDep.utr_number || clientTxnId,
            utr_number: utr || dbDep.utr_number || clientTxnId,
            status: dbDep.status,
            timestamp: dbDep.createdAt ? new Date(dbDep.createdAt).getTime() : Date.now(),
            created_at: dbDep.createdAt ? new Date(dbDep.createdAt).toISOString() : new Date().toISOString()
          };
          memoryDeposits.unshift(dep);
        }
      } catch (e) {
        console.error('[MongoDB find deposit err]', e.message);
      }
    }

    const numAmt = parseFloat(extraData.amount || (dep ? dep.amount : 0)) || 0;
    const finalMobile = cleanMobile || (dep ? dep.mobile : '');
    const cleanCustName = (extraData.customer_name && !extraData.customer_name.startsWith('null')) ? extraData.customer_name : 'User';

    if (!dep) {
      // Create new approved deposit record if not found
      dep = {
        _id: `dep_${Date.now()}`,
        client_txn_id: clientTxnId,
        user: `${cleanCustName} (${finalMobile || 'N/A'})`,
        username: cleanCustName,
        mobile: finalMobile,
        amount: numAmt,
        method: 'EKQR Automatic UPI',
        gateway: 'EKQR',
        order_id: gatewayTxnId || clientTxnId,
        utr: utr || `UTR_${Date.now()}`,
        utr_number: utr || `UTR_${Date.now()}`,
        status: 'Approved',
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now(),
        created_at: new Date().toISOString()
      };
      memoryDeposits.unshift(dep);
    } else {
      if (dep.status === 'Approved') {
        // Already approved, avoid double credit
        console.log(`[EKQR Deposit] Already credited client_txn_id=${clientTxnId}`);
        return { alreadyApproved: true, deposit: dep };
      }
      dep.status = 'Approved';
      if (utr) {
        dep.utr = utr;
        dep.utr_number = utr;
      }
      if (gatewayTxnId) dep.order_id = gatewayTxnId;
      dep.updated_at = new Date().toISOString();
      dep.timestamp = Date.now();
    }

    // Clean up duplicate memory entries for this exact transaction ID / UTR
    for (let i = memoryDeposits.length - 1; i >= 0; i--) {
      const d = memoryDeposits[i];
      if (d !== dep && d.status === 'Pending' && clientTxnId && (d.client_txn_id === clientTxnId || d.utr === clientTxnId || d.utr_number === clientTxnId)) {
        memoryDeposits.splice(i, 1);
      }
    }

    userWalletStore.balance += numAmt;

    let userObj = registeredUsers.find(u => 
      cleanMobile && String(u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile
    );

    let updatedNewBalance = 0;
    let oldBalVal = 0;
    if (userObj) {
      oldBalVal = userObj.balance || 0;
      // Settle negative winning balance if any
      if ((userObj.winning_balance || 0) < 0) {
        const debt = Math.abs(userObj.winning_balance);
        if (numAmt >= debt) {
          userObj.winning_balance = 0.00;
          userObj.deposit_balance = parseFloat(((userObj.deposit_balance || 0) + (numAmt - debt)).toFixed(2));
        } else {
          userObj.winning_balance = parseFloat((userObj.winning_balance + numAmt).toFixed(2));
        }
      } else {
        userObj.deposit_balance = parseFloat(((userObj.deposit_balance || 0) + numAmt).toFixed(2));
      }
      userObj.balance = parseFloat(((userObj.deposit_balance || 0) + (userObj.winning_balance || 0)).toFixed(2));
      updatedNewBalance = userObj.balance;
    }

    // Sync to MongoDB
    if (mongoose.connection.readyState === 1) {
      try {
        const DepositRequest = require('../models/DepositRequest');
        const User = require('../models/User');
        const Transaction = require('../models/Transaction');

        await DepositRequest.updateOne(
          { $or: [{ utr_number: clientTxnId }, { utr_number: dep.utr }, { _id: dep._id }] },
          { $set: { status: 'approved', utr_number: dep.utr || utr } },
          { upsert: false }
        ).catch(() => {});

        if (cleanMobile) {
          const updatedUser = await User.findOneAndUpdate(
            { mobile: cleanMobile },
            { $inc: { deposit_balance: numAmt, wallet_balance: numAmt } },
            { returnDocument: 'after' }
          );
          if (updatedUser) {
            updatedNewBalance = updatedUser.wallet_balance;
            if (userObj) {
              userObj.balance = updatedUser.wallet_balance;
              userObj.deposit_balance = updatedUser.deposit_balance || userObj.deposit_balance;
            }
          }

          await Transaction.create({
            user_id: cleanMobile,
            username: userObj ? userObj.name : dep.user,
            type: 'deposit',
            amount: numAmt,
            status: 'success',
            reference_id: dep.utr || clientTxnId,
            description: `Auto UPI Deposit (+₹${numAmt})`
          }).catch(() => {});
        }
      } catch (mongoErr) {
        console.error('[MongoDB EKQR Sync Error]', mongoErr.message);
      }
    }

    // Log to Game Ledger
    try {
      logLedgerTransaction({
        user: userObj ? userObj.name : dep.user,
        email: `${cleanMobile || 'user'}@gmail.com`,
        phone: cleanMobile || '9007724336',
        amount: `+${numAmt.toFixed(2)}`,
        transactType: 'Auto UPI Deposit (EKQR)',
        oldBal: { wallet: oldBalVal.toFixed(2), deposit: '0.00', winning: '0.00', commission: '0.00', bonus: '0.00', referral: '0.00' },
        newBal: { wallet: updatedNewBalance.toFixed(2), deposit: (userObj ? userObj.deposit_balance : 0).toFixed(2), winning: '0.00', commission: '0.00', bonus: '0.00', referral: '0.00' },
        gameType: 'EKQR Gateway'
      });
    } catch (e) {}

    saveDiskStore();
    console.log(`[EKQR Deposit Success] Credited ₹${numAmt} to ${cleanMobile || dep.user}. New balance: ₹${updatedNewBalance}`);
    return { success: true, newBalance: updatedNewBalance, deposit: dep };
  } catch (err) {
    console.error('[creditSuccessfulDeposit Error]', err);
    throw err;
  }
}

// @desc    Create an EKQR Payin Order
// @route   POST /api/payment/ekqr/create-order
exports.createEkqrOrder = async (req, res) => {
  try {
    const { amount, mobile, name, email, redirect_url } = req.body;

    const numAmount = parseFloat(amount);
    const minAmt = (settingsConfig && settingsConfig.min_deposit) ? parseFloat(settingsConfig.min_deposit) : 100;
    if (!numAmount || isNaN(numAmount) || numAmount < minAmt) {
      return res.status(400).json({ 
        success: false, 
        message: `Minimum deposit amount is ₹${minAmt}` 
      });
    }

    const rawMobile = String(mobile || '').replace(/[^0-9]/g, '');
    const cleanMobile = rawMobile.length >= 10 ? rawMobile.slice(-10) : '';
    if (!cleanMobile) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required' });
    }

    let userObj = registeredUsers.find(u => (u.mobile || '').replace(/[^0-9]/g, '').slice(-10) === cleanMobile);
    
    // EKQR requires customer_name to be 3-95 alphanumeric characters
    let rawName = String(name || (userObj ? userObj.name : '') || '').trim().replace(/[^a-zA-Z0-9 ]/g, '');
    let customerName = rawName;
    if (customerName.length < 3) {
      customerName = customerName.length > 0 ? `${customerName} User` : `User ${cleanMobile.slice(-4)}`;
    }
    if (customerName.length > 50) {
      customerName = customerName.substring(0, 50);
    }

    // Ensure valid customer_email
    let rawEmail = String(email || (userObj && userObj.email ? userObj.email : '') || '').trim();
    let customerEmail = rawEmail;
    if (!customerEmail.includes('@') || customerEmail.length < 5) {
      customerEmail = `user${cleanMobile}@gmail.com`;
    }

    const clientTxnId = `TXN_${Date.now()}_${cleanMobile}`;
    const formattedDate = getFormattedDate();
    const apiKey = getApiKey();

    const payload = {
      key: apiKey,
      client_txn_id: clientTxnId,
      amount: String(numAmount),
      p_info: 'Wallet Deposit',
      customer_name: customerName,
      customer_email: customerEmail,
      customer_mobile: cleanMobile,
      redirect_url: redirect_url || 'https://95xmatka.com',
      udf1: cleanMobile,
      udf2: 'web',
      udf3: ''
    };

    console.log('[EKQR Create Order Request]', payload);

    const response = await fetch(`${EKQR_API_BASE}/create_order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('[EKQR Create Order Response]', data);

    if (!data.status && data.status !== true) {
      return res.status(400).json({
        success: false,
        message: data.msg || 'Failed to generate UPI payment link with EKQR',
        raw: data
      });
    }

    const orderData = data.data || {};

    // Record pending deposit in memory
    const newDeposit = {
      _id: `dep_${Date.now()}`,
      client_txn_id: clientTxnId,
      utr: clientTxnId,
      utr_number: clientTxnId,
      user: `${customerName} (${cleanMobile})`,
      username: customerName,
      mobile: cleanMobile,
      amount: numAmount,
      method: 'EKQR Automatic UPI',
      gateway: 'EKQR',
      order_id: orderData.order_id || clientTxnId,
      payment_url: orderData.payment_url,
      upi_intent: orderData.upi_intent || {},
      status: 'Pending',
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now(),
      created_at: new Date().toISOString(),
      txn_date: formattedDate
    };

    memoryDeposits.unshift(newDeposit);

    // Save pending in MongoDB
    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const DepositRequest = require('../models/DepositRequest');
        await DepositRequest.create({
          user_id: cleanMobile,
          username: newDeposit.user,
          amount: numAmount,
          utr_number: clientTxnId,
          status: 'pending'
        }).catch(() => {});
      }
    } catch (e) {}

    saveDiskStore();

    return res.status(200).json({
      success: true,
      client_txn_id: clientTxnId,
      txn_date: formattedDate,
      order_id: orderData.order_id,
      payment_url: orderData.payment_url,
      upi_intent: orderData.upi_intent || {},
      upi_id_hash: orderData.upi_id_hash,
      deposit: newDeposit
    });

  } catch (error) {
    console.error('[EKQR Create Order Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while initiating EKQR payment',
      error: error.message
    });
  }
};

// @desc    Check Status of an EKQR Payin Order & Auto Credit if Paid
// @route   POST /api/payment/ekqr/check-status
exports.checkEkqrStatus = async (req, res) => {
  try {
    const { client_txn_id, txn_date } = req.body;
    if (!client_txn_id) {
      return res.status(400).json({ success: false, message: 'client_txn_id is required' });
    }

    // First check memory
    const existing = memoryDeposits.find(d => String(d.client_txn_id) === String(client_txn_id) || String(d._id) === String(client_txn_id));
    if (existing && existing.status === 'Approved') {
      return res.json({
        success: true,
        status: 'success',
        is_approved: true,
        message: 'Payment already approved & credited to wallet',
        deposit: existing
      });
    }

    const dateStr = txn_date || (existing && existing.txn_date) || getFormattedDate();
    const apiKey = getApiKey();

    const payload = {
      key: apiKey,
      client_txn_id: client_txn_id,
      txn_date: dateStr
    };

    console.log('[EKQR Check Status Request]', payload);

    const response = await fetch(`${EKQR_API_BASE}/check_order_status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('[EKQR Check Status Response]', data);

    if (data && (data.status === true || data.status === 'success') && data.data) {
      const orderData = data.data;
      const orderStatus = String(orderData.status || '').toLowerCase();

      if (orderStatus === 'success' || orderStatus === 'completed' || orderStatus === 'txndone') {
        const utr = orderData.upi_txn_id || orderData.bank_ref_num || orderData.id;
        const creditResult = await creditSuccessfulDeposit(client_txn_id, utr, orderData.id, orderData);
        return res.json({
          success: true,
          status: 'success',
          is_approved: true,
          message: 'Payment verified successfully! Balance credited.',
          data: orderData,
          creditResult
        });
      } else if (orderStatus === 'failure' || orderStatus === 'failed') {
        if (existing) existing.status = 'Rejected';
        saveDiskStore();
        return res.json({
          success: false,
          status: 'failure',
          message: 'Payment failed or cancelled',
          data: orderData
        });
      } else {
        return res.json({
          success: true,
          status: 'pending',
          message: 'Payment is pending',
          data: orderData
        });
      }
    } else {
      return res.json({
        success: false,
        status: 'pending',
        message: data.msg || 'Payment check pending',
        raw: data
      });
    }
  } catch (error) {
    console.error('[EKQR Check Status Error]', error);
    return res.status(500).json({
      success: false,
      message: 'Error verifying EKQR order status',
      error: error.message
    });
  }
};

// @desc    Webhook handler for EKQR Gateway Instant Callbacks
// @route   POST /api/payment/ekqr/webhook, POST /api/v1/callbacks/upigateway, GET ...
exports.handleEkqrWebhook = async (req, res) => {
  try {
    const payload = { ...req.query, ...req.body };
    console.log('[EKQR Webhook Callback Received]', JSON.stringify(payload, null, 2));

    const clientTxnId = payload.client_txn_id || payload.clientTxnId || payload.order_id;
    const status = String(payload.status || '').toLowerCase();
    const upiTxnId = payload.upi_txn_id || payload.utr || payload.bank_ref_num || payload.id;
    const gatewayTxnId = payload.id || payload.order_id;

    if (!clientTxnId) {
      console.warn('[EKQR Webhook] No client_txn_id found in webhook payload');
      return res.status(200).json({ status: false, message: 'No client_txn_id provided' });
    }

    if (status === 'success' || status === 'completed' || status === 'txndone' || payload.status === true) {
      await creditSuccessfulDeposit(clientTxnId, upiTxnId, gatewayTxnId, payload);
      return res.status(200).json({ status: true, message: 'Webhook processed & deposit credited successfully' });
    } else {
      console.log(`[EKQR Webhook] Non-success status: ${status} for txn: ${clientTxnId}`);
      let dep = memoryDeposits.find(d => String(d.client_txn_id) === String(clientTxnId));
      if (dep && (status === 'failure' || status === 'failed')) {
        dep.status = 'Rejected';
        saveDiskStore();
      }
      return res.status(200).json({ status: true, message: `Status noted: ${status}` });
    }
  } catch (error) {
    console.error('[EKQR Webhook Processing Error]', error);
    // Always return 200 to prevent EKQR from endlessly retrying erroring callbacks
    return res.status(200).json({ status: false, error: error.message });
  }
};

// @desc    Get public gateway configuration for apps
// @route   GET /api/payment/config
exports.getPaymentConfig = (req, res) => {
  res.json({
    success: true,
    ekqr_enabled: settingsConfig ? (settingsConfig.ekqr_enabled !== false) : true,
    min_deposit: (settingsConfig && settingsConfig.min_deposit) ? parseFloat(settingsConfig.min_deposit) : 100,
    max_deposit: (settingsConfig && settingsConfig.max_deposit) ? parseFloat(settingsConfig.max_deposit) : 50000,
    webhook_url: 'https://95xmatka.com/api/payment/ekqr/webhook'
  });
};

// =========================================================================
// BACKGROUND WORKER: Automatically Poll and Approve Pending EKQR Deposits
// =========================================================================
let isPollingPending = false;
async function pollPendingEkqrDeposits() {
  if (isPollingPending) return;
  isPollingPending = true;
  try {
    const pendingDeposits = memoryDeposits.filter(d => 
      d.status === 'Pending' && 
      (d.gateway === 'EKQR' || d.client_txn_id) &&
      d.client_txn_id
    );

    if (pendingDeposits.length === 0) {
      isPollingPending = false;
      return;
    }

    const apiKey = getApiKey();

    for (const dep of pendingDeposits) {
      try {
        const payload = {
          key: apiKey,
          client_txn_id: dep.client_txn_id,
          txn_date: dep.txn_date || getFormattedDate()
        };

        const response = await fetch(`${EKQR_API_BASE}/check_order_status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (data && (data.status === true || data.status === 'success') && data.data) {
          const orderData = data.data;
          const orderStatus = String(orderData.status || '').toLowerCase();

          if (orderStatus === 'success' || orderStatus === 'completed' || orderStatus === 'txndone') {
            const utr = orderData.upi_txn_id || orderData.bank_ref_num || orderData.id;
            console.log(`[Auto-Poller] Deposit client_txn_id=${dep.client_txn_id} is SUCCESS! Auto-approving ₹${dep.amount}...`);
            await creditSuccessfulDeposit(dep.client_txn_id, utr, orderData.id, orderData);
          } else if (orderStatus === 'failure' || orderStatus === 'failed') {
            console.log(`[Auto-Poller] Deposit client_txn_id=${dep.client_txn_id} is FAILED. Marking rejected.`);
            dep.status = 'Rejected';
            saveDiskStore();
          }
        }
      } catch (err) {
        // Continue to next deposit
      }
    }
  } catch (e) {
    console.error('[pollPendingEkqrDeposits Error]', e.message);
  } finally {
    isPollingPending = false;
  }
}

// Start background poller every 5 seconds
setInterval(pollPendingEkqrDeposits, 5000);

