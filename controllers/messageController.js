const Message = require('../models/Message');
const Customer = require('../models/Customer');
const SmsSettings = require('../models/SmsSettings');
const twilioUtil = require('../utils/twilio');
const mongoose = require('mongoose');

const getOwnerId = (req) => {
    const roleType = req.user.role_type?.toLowerCase();
    if (roleType === "admin") {
        return new mongoose.Types.ObjectId(req.user._id);
    }
    return new mongoose.Types.ObjectId(req.user.created_by);
}

exports.getContacts = async (req, res) => {
    try {
        const ownerId = getOwnerId(req);
        // Aggregate to find unique phone numbers and their last message
        const messages = await Message.aggregate([
            { $match: { created_by: ownerId } },
            { $sort: { timestamp: -1 } },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ["$direction", "inbound"] },
                            "$from",
                            "$to"
                        ]
                    },
                    lastMessage: { $first: "$$ROOT" },
                    unreadCount: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ["$direction", "inbound"] }, { $eq: ["$read", false] }] },
                                1,
                                0
                            ]
                        }
                    }
                }
            },
            { $sort: { "lastMessage.timestamp": -1 } }
        ]);

        // Populate customer names if available
        const contactsWithNames = await Promise.all(messages.map(async (m) => {
            const phone = m._id;
            // Search for customer with this phone belonging to this admin
            const customer = await Customer.findOne({
                created_by: ownerId,
                $or: [
                    { phone: phone },
                    { "additional_contacts.phone": phone }
                ]
            });

            return {
                phone,
                name: customer ? (customer.contact_name || customer.company_name) : phone,
                lastMessage: m.lastMessage.body,
                timestamp: m.lastMessage.timestamp,
                unreadCount: m.unreadCount,
                isWhatsApp: m.lastMessage.isWhatsApp
            };
        }));

        res.json(contactsWithNames);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getHistory = async (req, res) => {
    try {
        const { phone } = req.params;
        const ownerId = getOwnerId(req);

        const messages = await Message.find({
            created_by: ownerId,
            $or: [
                { from: phone },
                { to: phone }
            ]
        }).sort({ timestamp: 1 });

        // Mark as read
        await Message.updateMany(
            { created_by: ownerId, from: phone, direction: 'inbound', read: false },
            { $set: { read: true } }
        );

        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.handleWebhook = async (req, res) => {
    const { From, To, Body, MessageSid } = req.body;
    const isWhatsApp = From.startsWith('whatsapp:');

    try {
        // Clean phone numbers (remove whatsapp: prefix)
        const cleanFrom = From.replace('whatsapp:', '');
        const cleanTo = To.replace('whatsapp:', '');

        // Identify owner by their configured Twilio Number
        const settings = await SmsSettings.findOne({ twilioPhoneNumber: cleanTo });
        const ownerId = settings ? settings.createdBy : null;

        if (ownerId) {
            await Message.create({
                direction: 'inbound',
                from: cleanFrom,
                to: cleanTo,
                body: Body,
                isWhatsApp,
                sid: MessageSid,
                read: false,
                created_by: ownerId,
                timestamp: new Date()
            });
        } else {
            const customers = await Customer.find({
                $or: [
                    { phone: cleanFrom },
                    { "additional_contacts.phone": cleanFrom }
                ]
            });

            if (customers.length > 0) {
                const ownerIds = [...new Set(customers.map(c => c.created_by?.toString()).filter(Boolean))];
                for (const id of ownerIds) {
                    await Message.create({
                        direction: 'inbound',
                        from: cleanFrom,
                        to: cleanTo,
                        body: Body,
                        isWhatsApp,
                        sid: MessageSid,
                        read: false,
                        created_by: new mongoose.Types.ObjectId(id),
                        timestamp: new Date()
                    });
                }
            } else {
                await Message.create({
                    direction: 'inbound',
                    from: cleanFrom,
                    to: cleanTo,
                    body: Body,
                    isWhatsApp,
                    sid: MessageSid,
                    read: false,
                    timestamp: new Date()
                });
            }
        }
        res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } catch (err) {
        console.error('Webhook Error:', err);
        res.status(500).end();
    }
};

exports.sendMessage = async (req, res) => {
    const { to, body, isWhatsApp } = req.body;
    const ownerId = getOwnerId(req);

    try {
        const config = await twilioUtil.getTwilioConfig(ownerId);

        const result = await twilioUtil.sendMessage(
            to,
            body,
            isWhatsApp,
            ownerId
        );

        const phone = twilioUtil.normalizePhone(to);

        const message = await Message.create({
            direction: "outbound",
            from: config.twilioNumber,
            to: phone,
            body,
            isWhatsApp,
            sid: result.sid,
            status: "sent",
            created_by: ownerId,
            timestamp: new Date(),
        });

        res.json(message);
    } catch (err) {
        console.error("SMS Send Error:", err);

        res.status(500).json({
            error: err.message,
        });
    }
};
