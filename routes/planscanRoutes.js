const express = require("express");
const router = express.Router();

const {
    getProjects,
    getProjectItems,
    getProjectById,
} = require("../controllers/planscanController.js");

router.get("/projects", getProjects);

router.get("/projects/:projectId", getProjectById);

router.get(
    "/projects/:projectId/items",
    getProjectItems
);

module.exports = router;