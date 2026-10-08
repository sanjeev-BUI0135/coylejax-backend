const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
require("dotenv").config();

const estimatesRouter = require("./routes/estimates");
const { initializeAwardedProjects } = require("./utils/cron");
const { sendReminderEmail, sendProcessingEmail } = require("./utils/projectEmails");
const { startReminderScheduler } = require("./services/reminderScheduler");
const { startReportScheduler } = require("./services/reportScheduler");
// Require database configuration to connect to MongoDB on start
const connectDB = require("./config/database");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(
  cors({
    origin: [
      "https://coylejax.app",
      "https://www.coylejax.app",
      "http://localhost:5173",
      "http://192.168.0.164:5173",
      "http://192.168.0.164:5174",
      "http://192.168.0.153:5173",
      "http://192.168.0.142:5173",
      "https://staging.coylejax.app",
      "http://192.168.0.153:3001",
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS', 'PUT'],
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" })); // Parses incoming JSON requests
app.use(express.urlencoded({ extended: true })); // Parses URL-encoded data

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

app.use(
  '/uploads/checklist',
  (req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.BASE_URL);
    res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(path.join(__dirname, 'uploads/checklist'))
);

const downloadInvoiceRouter = require('./routes/downloadInvoice');
app.use('/api', downloadInvoiceRouter);

// --- API Routes ---

app.use("/api/auth", require("./routes/users")); // Handles register, login, me

app.use("/api/users", require("./routes/users"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/customers", require("./routes/customers"));
app.use("/api/estimates", require("./routes/estimates"));
app.use("/api/invoices", require("./routes/invoices"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/materialorders", require("./routes/materialOrders"));
app.use("/api/inventoryitems", require("./routes/inventory"));
app.use("/api/laborentrys", require("./routes/laborEntries"));
app.use("/api/functions", require("./routes/functions"));
app.use("/api/paymentroutes", require("./routes/paymentRoutes"));
app.use("/api/checklists", require("./routes/checklist"));
app.use("/api/estimates-approved", require("./routes/estimates"));
app.use("/api/roles", require("./routes/roles"));
app.use("/api/clients", require("./routes/ClientRoutes"));
app.use("/api/master-data", require("./routes/masterDataRoutes"));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/payment-settings', require('./routes/payment_settings'));
app.use('/api/sms-settings', require('./routes/sms_settings'));
app.use('/api/settings/glaciers-ai', require('./routes/glacierAiSettings'));
app.use('/api/leads', require("./routes/leads"));
app.use('/api/activity-logs', require('./routes/activityLogs'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/custom-reports', require('./routes/customReportRoutes'));
app.use("/api/planscan", require("./routes/planscanRoutes")
);

const { router: reminderRouter } = require('./routes/remainders');
app.use("/api/reminders", reminderRouter);

const bidRoutes = require('./routes/bid');
app.use('/api/bids', bidRoutes);

app.use(
  '/uploads',
  (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(path.join(__dirname, 'uploads'))
);
app.use("/api", require("./routes/timeEntries"));

// --- Static Files ---
// If you have file uploads, this makes them accessible via a URL
// app.use("/uploads", express.static("uploads"));

app.use("/api/integrations", require("./routes/integrations"));
app.use("/api/sms", require("./routes/messages"));

// --- Root and Health Check ---
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the CoyleJax API!" });
});
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date() });
});

// --- Error Handling Middleware ---
// A catch-all for any errors that occur in the routes
app.use((err, req, res, next) => {
  console.error(err.stack);
  res
    .status(500)
    .json({ error: "Something went wrong!", details: err.message });
});

if (process.env.NODE_ENV !== "production") {
  const listEndpoints = require("express-list-endpoints");
  app.get("/__routes", (req, res) => res.json(listEndpoints(app)));
}

// --- Start Server ---
async function startServer() {
  try {
    // Connect to MongoDB
    await connectDB();

    // Initialize cron jobs for all awarded projects
    // await initializeAwardedProjects({
    //   sendReminderEmail,
    //   sendProcessingEmail
    // });

    // Start the reminder scheduler
    startReminderScheduler();

    // Start the custom report scheduler
    startReportScheduler();

    // Start the Express server
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
      console.log(`Reminder system is active`);
    });
  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
}

// Start the server
startServer();