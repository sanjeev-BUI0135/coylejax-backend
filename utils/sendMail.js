const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: true, 
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendMail({ from, to, subject, text, html, replyTo, attachments = []  }) {
  if (!to) {
    throw new Error("Recipient email (to) is missing");
  }

  const mailOptions = {
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    text,
    html,
    attachments, 
  };

  if (replyTo) {
    mailOptions.replyTo = replyTo;
  }

  
  if (from) {
    mailOptions.from = `"${from}" <${process.env.EMAIL_FROM}>`;
  }

  return transporter.sendMail(mailOptions);
}

module.exports = sendMail;
