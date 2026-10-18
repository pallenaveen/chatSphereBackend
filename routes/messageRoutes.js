const express = require('express');
const { 
  sendMessage, 
  allMessages, 
  markAsRead, 
  markDelivered,
  editMessage, 
  deleteMessage 
} = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');
const router = express.Router();

router.route('/').post(protect, sendMessage);
router.route('/read').put(protect, markAsRead);
router.route('/:id/delivered').put(protect, markDelivered);
router.route('/:conversationId').get(protect, allMessages);

// Edit and Delete individual message endpoints
router.route('/:id')
  .put(protect, editMessage)
  .delete(protect, deleteMessage);

module.exports = router;