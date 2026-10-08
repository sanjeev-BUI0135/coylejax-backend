const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const serviceAuth = require('../middleware/serviceAuth');

const roleController = require('../controllers/roleController');

/* SERVICE */
router.get('/getRoles', serviceAuth, roleController.getAllRolesService);

/* USER */
router.get('/', auth, roleController.getRoles);
router.post('/', auth, roleController.createRole);
router.get('/:id', auth, roleController.getRoleById);
router.put('/:id', auth, roleController.updateRole);
router.delete('/:id', auth, roleController.deleteRole);

module.exports = router;