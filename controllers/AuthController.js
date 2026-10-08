const crypto = require("crypto");
const User = require("../models/User");
const Client = require("../models/Client");
const sendMail = require("../utils/sendMail");
const resetPasswordMail = require("../utils/resetPasswordMail");

const BASE_URL = process.env.BASE_URL;
const RESET_TOKEN_EXPIRY = 15 * 60 * 1000;

const generateResetToken = () => {
    const token = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");

    return { token, hashedToken };
};

const findAccountByEmail = async (email) => {
    return (
        (await User.findOne({ email })) ||
        (await Client.findOne({ email }))
    );
};

const findAccountByValidToken = async (hashedToken) => {
    const query = {
        reset_password_token: hashedToken,
        reset_password_expires: { $gt: Date.now() },
    };

    return (
        (await User.findOne(query)) ||
        (await Client.findOne(query))
    );
};

const findCreator = async (creatorId) => {
    return (
        (await User.findById(creatorId).lean()) ||
        (await Client.findById(creatorId).lean())
    );
};

exports.forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const account = await findAccountByEmail(email);
        if (!account) {
            return res.status(404).json({
                message: "Email not found in our records",
            });
        }

        const { token, hashedToken } = generateResetToken();

        account.reset_password_token = hashedToken;
        account.reset_password_expires = Date.now() + RESET_TOKEN_EXPIRY;
        await account.save();

        const resetLink = `${BASE_URL}/resetPassword?token=${token}`;
        let creatorId;

        if (account.role_type === "admin") {
            creatorId = account._id; 
        } else {
            creatorId = account.created_by; 
        }

        const creator = await findCreator(creatorId);

        const html = resetPasswordMail(
            account.full_name ||  `${account.firstName || ""} ${account.lastName || ""}`.trim() || "User",
            resetLink,
            creator
        );

        await sendMail({
            from: creator?.companyName || "Coylejax",
            to: account.email,
            subject: "Reset your password",
            text: `Reset your password: ${resetLink}`,
            html,
        });

        res.json({ message: "Password reset link sent successfully" });

    } catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({ message: "Server error" });
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({
                message: "Token and password are required",
            });
        }

        const hashedToken = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");

        const account = await findAccountByValidToken(hashedToken);

        if (!account) {
            return res.status(400).json({
                message: "Token is invalid or expired",
            });
        }

        account.password = password;
        account.reset_password_token = undefined;
        account.reset_password_expires = undefined;

        await account.save();

        res.json({ message: "Password reset successful" });

    } catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({ message: "Server error" });
    }
};
