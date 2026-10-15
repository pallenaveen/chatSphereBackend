const express = require('express');
const {
  accessChat,
  fetchChats,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  deleteChat,
  markMessagesAsRead,
  toggleFavorite
} = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// Fetch all chats and access 1-on-1 chat
router.get('/', protect, fetchChats);
router.post('/', protect, accessChat);

// Conversation status and read receipts
router.put('/favorite/:id', protect, toggleFavorite);
router.put('/read/:chatId', protect, markMessagesAsRead);

// Delete chat
router.delete('/:id', protect, deleteChat);

// Group Chat Operations
router.post('/group', protect, createGroupChat);

// Group Details & Avatar Updates (handles both rename and avatar updates)
router.put('/rename', protect, renameGroup);
router.put('/group/avatar', protect, renameGroup);

// Member Management Routes (supporting both /group/add and /groupadd aliases)
router.put('/group/add', protect, addToGroup);
router.put('/groupadd', protect, addToGroup);

router.put('/group/remove', protect, removeFromGroup);
router.put('/groupremove', protect, removeFromGroup);

module.exports = router;