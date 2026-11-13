const express = require('express');
const {
    registerUser,
    loginUser,
    allUsers,
    getUserProfile,
    updateProfile,
    getRingtone,
    saveRingtone,
    deleteRingtone,
} = require('./authController');
const { protect } = require('../../middleware/authMiddleware');
const router = express.Router();

// Auth routes
router.post('/register', registerUser);
router.post('/login', loginUser);

// Update user profile route MUST come before the root GET route
router.put('/profile', protect, updateProfile);
router.get('/ringtone', protect, getRingtone);
router.put('/ringtone', protect, saveRingtone);
router.delete('/ringtone', protect, deleteRingtone);

router.get('/:userId', protect, getUserProfile);

// User search route (GET /api/users?search=nameOrEmail)
router.get('/', protect, allUsers);

module.exports = router;