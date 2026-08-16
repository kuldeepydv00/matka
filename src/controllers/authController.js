const User = require('../models/User');
const generateToken = require('../utils/generateToken');

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  const { name, email, phone, password } = req.body;

  try {
    const userExists = await User.findOne({ $or: [{ email }, { phone }] });

    if (userExists) {
      return res.status(400).json({ message: 'User with this email or phone already exists' });
    }

    const user = await User.create({
      name,
      email,
      phone,
      password_hash: password
    });

    if (user) {
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        wallet_balance: user.wallet_balance,
        role: user.role,
        token: generateToken(user._id)
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  const { identifier, password } = req.body; // identifier can be email or phone

  try {
    const user = await User.findOne({ 
      $or: [{ email: identifier }, { phone: identifier }] 
    });

    if (user && (await user.matchPassword(password))) {
      if (!user.is_active) {
        return res.status(401).json({ message: 'Account disabled. Contact support.' });
      }

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        wallet_balance: user.wallet_balance,
        role: user.role,
        token: generateToken(user._id)
      });
    } else {
      res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { registerUser, loginUser };
