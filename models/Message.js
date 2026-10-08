const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    direction: {
        type: String,
        enum: ['inbound', 'outbound'],
        required: true
    },
    from: {
        type: String,
        required: true
    },
    to: {
        type: String,
        required: true
    },
    body: {
        type: String,
        required: true
    },
    isWhatsApp: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        default: 'received'
    },
    sid: {
        type: String,
        unique: true,
        sparse: true
    },
    read: {
        type: Boolean,
        default: false
    },
    created_by: {
        type: mongoose.Schema.Types.Mixed,
        index: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Index for faster queries
MessageSchema.index({ from: 1, to: 1, timestamp: -1 });

module.exports = mongoose.model('Message', MessageSchema);
