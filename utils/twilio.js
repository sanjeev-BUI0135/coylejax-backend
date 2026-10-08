const twilio = require("twilio");
const SmsSettings = require("../models/SmsSettings");


async function getTwilioConfig(ownerId) {
    if (ownerId) {
        try {
            const settings = await SmsSettings.findOne({
                createdBy: ownerId,
            });

            if (settings) {
                // SMS disabled by user
                if (settings.enabled === false) {
                    return { disabled: true };
                }

                // Custom Twilio credentials
                if (settings.accountSid && settings.authToken) {
                    return {
                        accountSid: settings.accountSid,
                        authToken: settings.authToken,
                        twilioNumber: settings.twilioPhoneNumber,
                    };
                }
            }
        } catch (err) {
            console.error(
                `Error fetching Twilio settings for owner ${ownerId}:`,
                err
            );
        }
    }

    // Fallback to environment variables
    return {
        accountSid: process.env.TWILIO_ACCOUNT_SID,
        authToken: process.env.TWILIO_AUTH_TOKEN,
        twilioNumber:
            process.env.TWILIO_NUMBER ||
            process.env.TWILIO_PHONE_NUMBER ||
            "+12185357885",
    };
}

function normalizePhone(phone) {
    if (!phone) return "";

    const phoneStr = phone.toString().trim();

    // Already in E.164 format
    if (phoneStr.startsWith("+")) {
        return phoneStr;
    }

    const digits = phoneStr.replace(/\D/g, "");

    // India mobile numbers
    if (digits.length === 10 && /^[6-9]/.test(digits)) {
        return `+91${digits}`;
    }

    // India number with country code
    if (digits.length === 12 && digits.startsWith("91")) {
        return `+${digits}`;
    }

    // US number
    if (digits.length === 10) {
        return `+1${digits}`;
    }

    // US number with country code
    if (digits.length === 11 && digits.startsWith("1")) {
        return `+${digits}`;
    }

    // Fallback
    return `+${digits}`;
}


async function sendMessage(
    to,
    body,
    isWhatsApp = false,
    ownerId = null
) {
    if (!to) {
        throw new Error(
            "Recipient phone number (to) is missing"
        );
    }

    if (!body) {
        throw new Error("Message body is required");
    }

    const config = await getTwilioConfig(ownerId);

    if (config.disabled) {
        throw new Error(
            "SMS features are currently disabled for your account. Please enable them in SMS Settings."
        );
    }

    if (!config.accountSid || !config.authToken) {
        throw new Error(
            "Twilio credentials not configured. Please check your SMS Settings."
        );
    }

    const client = twilio(
        config.accountSid,
        config.authToken
    );

    const normalizedTo = normalizePhone(to);

    const from = isWhatsApp
        ? `whatsapp:${config.twilioNumber}`
        : config.twilioNumber;

    const recipient = isWhatsApp
        ? `whatsapp:${normalizedTo}`
        : normalizedTo;

    try {
        const message = await client.messages.create({
            body,
            from,
            to: recipient,
        });
        return message;
    } catch (error) {
        console.error("Twilio Send Error:", {
            code: error.code,
            message: error.message,
            moreInfo: error.moreInfo,
        });

        throw error;
    }
}

module.exports = {
    sendMessage,
    getTwilioConfig,
    normalizePhone,
};