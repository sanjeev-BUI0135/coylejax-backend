const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const uploadClientLogo = require("../middleware/upload");

const {
    createClient,
    getClients,
    getClient,
    updateClient,
    deleteClient,
    checkPrefix
} = require("../controllers/ClientController");

router.post("/", auth, uploadClientLogo.single("logo"), createClient);
router.get("/check-prefix", auth, checkPrefix);

router.get("/",auth, getClients);
router.get("/:id",auth, getClient);

router.patch("/:id",auth, uploadClientLogo.single("logo"), updateClient);

router.delete("/:id",auth, deleteClient);

module.exports = router;
