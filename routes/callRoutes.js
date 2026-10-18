const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { logCall, getCallHistory } = require('../controllers/callController');

router.post('/', protect, logCall);
router.get('/', protect, getCallHistory);

module.exports = router;