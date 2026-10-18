const express = require('express');
const { registerUser, loginUser, allUsers, getUserProfile, updateProfile } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware'); 
const router = express.Router();

// Auth routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Update user profile route MUST come before the root GET route
router.put('/profile', protect, updateProfile);

router.get('/:userId', protect, getUserProfile);

// User search route (GET /api/users?search=nameOrEmail)
router.get('/', protect, allUsers);

module.exports = router;