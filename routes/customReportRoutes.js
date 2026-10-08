const express = require('express');
const router = express.Router();
const customReportController = require('../controllers/customReportController');
const auth = require('../middleware/auth');

router.use(auth);

router.get('/', customReportController.getAll);
router.get('/:id', customReportController.getById);
router.post('/', customReportController.create);
router.post('/:id/run', customReportController.runNow);
router.get('/:id/history', customReportController.getHistory);
router.get('/:id/data', customReportController.getData);
router.get('/:id/export', customReportController.exportExcel);
router.put('/:id', customReportController.update);
router.delete('/:id', customReportController.delete);

module.exports = router;
