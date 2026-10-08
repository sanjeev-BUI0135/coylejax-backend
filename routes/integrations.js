const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const auth = require('../middleware/auth');
const nodemailer = require('nodemailer'); 
const fs = require("fs");
const csv = require("csv-parser");


const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },

  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const baseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9]/g, '-');
    const safeFileName = `${Date.now()}-${baseName}${ext}`;
    cb(null, safeFileName);
  },
});
const upload = multer({ storage });

// Upload file endpoint
router.post('/upload-file', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fileUrl = `${process.env.APP_URL}/uploads/${req.file.filename}`;
    res.json({ file_url: fileUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.post('/send-email', auth, async (req, res) => {
  const { to, subject, body, isHTML, from_name, reply_to_email  } = req.body;

  try {
    if (!process.env.EMAIL_PASS)
      return res.status(500).json({ success: false, message: 'EMAIL_PASS not set in .env' });

    // Create transporter
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT, 10),
      secure: process.env.EMAIL_PORT == 465, // true for 465
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Send email
    await transporter.sendMail({
     from: `"${from_name || process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM}>`,
      to,
      subject,
      html: isHTML ? body : undefined,  
      text: isHTML ? undefined : body,
      replyTo: reply_to_email || process.env.EMAIL_FROM,
    });

    res.json({ success: true, message: 'Email sent successfully!' });
  } catch (error) {
    console.error('Email sending failed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


router.post('/invoke-llm', auth, async (req, res) => {
  res.json({ success: true, message: 'LLM functionality not implemented yet' });
});

router.post('/generate-image', auth, async (req, res) => {
  res.json({ success: true, message: 'Image generation not implemented yet' });
});

// router.post('/extract-data', auth, async (req, res) => {
//   res.json({ success: true, message: 'Data extraction not implemented yet' });
// });

router.post('/extract-data', auth, async (req, res) => {
  try {
    const { file_url, json_schema } = req.body;
    if (!file_url) return res.status(400).json({ error: 'Missing file_url' });
    if (!json_schema) return res.status(400).json({ error: 'Missing json_schema' });

    const filePath = file_url.replace(`${process.env.APP_URL}/`, '');

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    const results = [];

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        const mapped = {};
        const props = json_schema?.items?.properties || {};

        for (const key of Object.keys(props)) {
          const schemaDef = props[key];
          let value = row[key];

          if (typeof value === 'string') value = value.trim();

          if (schemaDef.type === 'number') {
            value = parseFloat(value) || schemaDef.default || 0;
          } else if (schemaDef.type === 'string') {
            value = value || schemaDef.default || '';
          }

          mapped[key] = value;
        }

        results.push(mapped);
      })
      .on('end', () => {
        res.json({
          status: 'success',
          count: results.length,
          output: results,
        });
      })
      .on('error', (err) => {
        console.error('CSV parse error:', err);
        res.status(500).json({ error: 'Failed to parse CSV file' });
      });
  } catch (error) {
    console.error('Error in extract-data:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;