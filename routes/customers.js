const express = require('express');
const router = express.Router();
const multer = require('multer');
const auth = require('../middleware/auth');
const { bulkUploadCustomers, getCustomers, getCustomerById, createCustomer, updateCustomer, deleteCustomer, bulkDeleteCustomers } = require('../controllers/customerController');

const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});


router.post('/bulk-upload', auth, upload.single('file'), bulkUploadCustomers);
router.get('/', auth, getCustomers);
router.get('/:id', auth, getCustomerById);
router.post('/', auth, createCustomer);
router.put('/:id', auth, updateCustomer);
router.delete('/bulk', auth, bulkDeleteCustomers);
router.delete('/:id', auth, deleteCustomer);

module.exports = router;
