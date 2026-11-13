const emitToConversationMembers = (io, conversation, event, payload) => {
  const memberIds = new Set(
    conversation.members.map((member) => String(member._id || member))
  );

  for (const memberId of memberIds) {
    io.to(`user:${memberId}`).emit(event, payload);
  }
};

module.exports = { emitToConversationMembers };
