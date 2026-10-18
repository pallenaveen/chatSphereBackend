const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');

const findConversationForMember = (conversationId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    return null;
  }

  return Conversation.findOne({ _id: conversationId, members: userId });
};

module.exports = { findConversationForMember };
