const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const messageController = require('../controllers/messageController');

// GET /api/messages/contacts - Get unique chat contacts
router.get('/contacts', auth, messageController.getContacts);

// GET /api/messages/history/:phone - Get full history with a contact
router.get('/history/:phone', auth, messageController.getHistory);

// POST /api/messages/webhook - Handle incoming Twilio messages
router.post('/webhook', messageController.handleWebhook);

// POST /api/messages/send - Send a message from chat UI
router.post('/send', auth, messageController.sendMessage);

module.exports = router;
