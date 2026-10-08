const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getAllSuppliers, getSupplierById, createSupplier, updateSupplier, bulkDeleteSuppliers , deleteSupplier, bulkUploadSuppliers } = require('../controllers/supplierController');
const auth = require("../middleware/auth");

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'text/csv') {
      return cb(new Error('Only CSV files are allowed'));
    }
    cb(null, true);
  }
});

router.get('/', auth, getAllSuppliers);
router.post('/bulk-upload', auth, upload.single('file'), bulkUploadSuppliers);
router.delete('/bulk', auth, bulkDeleteSuppliers);
router.post('/', auth, createSupplier);
router.get('/:id', auth, getSupplierById);
router.put('/:id', auth, updateSupplier);
router.delete('/:id', auth, deleteSupplier);


module.exports = router;
