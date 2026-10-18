const assert = require('node:assert/strict');
const { test } = require('node:test');
const jwt = require('jsonwebtoken');
const Conversation = require('../models/Conversation');
const { protect } = require('../middleware/authMiddleware');
const { findConversationForMember } = require('../utils/conversationAccess');
const { emitToConversationMembers } = require('../utils/realtime');

test('authentication middleware normalizes the token ID as _id', () => {
  const userId = '507f1f77bcf86cd799439011';
  const token = jwt.sign({ id: userId }, 'test-secret');
  const req = { headers: { authorization: `Bearer ${token}` } };
  let nextCalled = false;
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'test-secret';
  try {
    protect(req, res, () => {
      nextCalled = true;
    });
  } finally {
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
  }

  assert.equal(nextCalled, true);
  assert.equal(String(req.user._id), userId);
});

test('conversation lookup rejects invalid IDs without querying', async () => {
  const originalFindOne = Conversation.findOne;
  let queryCalled = false;
  Conversation.findOne = () => {
    queryCalled = true;
    return Promise.resolve(null);
  };

  try {
    assert.equal(await findConversationForMember('invalid', '507f1f77bcf86cd799439011'), null);
    assert.equal(queryCalled, false);
  } finally {
    Conversation.findOne = originalFindOne;
  }
});

test('conversation lookup includes the authenticated member in its query', async () => {
  const userId = '507f1f77bcf86cd799439011';
  const conversationId = '507f191e810c19729de860ea';
  const originalFindOne = Conversation.findOne;
  let query;
  Conversation.findOne = (filter) => {
    query = filter;
    return Promise.resolve({ _id: conversationId });
  };

  try {
    const result = await findConversationForMember(conversationId, userId);
    assert.equal(result._id, conversationId);
    assert.deepEqual(query, { _id: conversationId, members: userId });
  } finally {
    Conversation.findOne = originalFindOne;
  }
});

test('conversation events are delivered once to each distinct member room', () => {
  const emitted = [];
  const io = {
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };

  emitToConversationMembers(io, {
    members: [
      '507f1f77bcf86cd799439011',
      { _id: '507f191e810c19729de860ea' },
      '507f1f77bcf86cd799439011',
    ],
  }, 'receive_message', { _id: 'message-id' });

  assert.deepEqual(emitted, [
    { room: 'user:507f1f77bcf86cd799439011', event: 'receive_message', payload: { _id: 'message-id' } },
    { room: 'user:507f191e810c19729de860ea', event: 'receive_message', payload: { _id: 'message-id' } },
  ]);
});
