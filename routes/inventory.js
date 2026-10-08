const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const inventoryController = require('../controllers/inventoryController');

// GET /api/inventoryitems
router.get('/', auth, inventoryController.getAllInventoryItems);

// GET /api/inventoryitems/:id
router.get('/:id', auth, inventoryController.getInventoryItemById);

// POST /api/inventoryitems
router.post('/', auth, inventoryController.createInventoryItem);

// POST /api/inventoryitems/bulk
router.post("/bulk", auth, inventoryController.createBulkInventoryItems);

// PUT /api/inventoryitems/:id
router.put('/:id', auth, inventoryController.updateInventoryItem);

// DELETE /api/inventoryitems/bulk
router.delete("/bulk", auth, inventoryController.deleteBulkInventoryItems);

// DELETE /api/inventoryitems/:id
router.delete("/:id", auth, inventoryController.deleteInventoryItem);

module.exports = router;