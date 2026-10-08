const Customer = require("../models/Customer");
const Invoice = require("../models/Invoice");


async function findOrCreateCustomer({ customerInfo = {}, creatorId }) {
  if (!customerInfo || (!customerInfo.companyName && !customerInfo.contactName && !customerInfo.phone && !customerInfo.email)) {
    return null;
  }

  try {
    let customerDoc = null;

    // 1. Search by exact email first (most reliable identifier)
    if (customerInfo.email && customerInfo.email.trim()) {
      customerDoc = await Customer.findOne({ email: customerInfo.email.trim().toLowerCase() });
    }

    // 2. If no match by email, search by company_name AND contact_name together
    if (!customerDoc && customerInfo.companyName && customerInfo.contactName) {
      customerDoc = await Customer.findOne({
        company_name: customerInfo.companyName.trim(),
        contact_name: customerInfo.contactName.trim(),
      });
    }

    // 3. If still no match, search by company_name alone
    if (!customerDoc && customerInfo.companyName && customerInfo.companyName.trim()) {
      customerDoc = await Customer.findOne({ company_name: customerInfo.companyName.trim() });
    }

    if (customerDoc) {
      // Update customer with any newly provided details
      const updates = {};
      if (customerInfo.contactName && !customerDoc.contact_name) {
        updates.contact_name = customerInfo.contactName.trim();
      }
      if (customerInfo.companyName && !customerDoc.company_name) {
        updates.company_name = customerInfo.companyName.trim();
      }
      if (customerInfo.phone && (!customerDoc.phone || customerDoc.phone === "N/A")) {
        updates.phone = customerInfo.phone.trim();
      }
      if (customerInfo.address && !customerDoc.address) {
        updates.address = customerInfo.address.trim();
      }
      if (Object.keys(updates).length > 0) {
        customerDoc = await Customer.findByIdAndUpdate(customerDoc._id, updates, { new: true });
      }
      return customerDoc;
    }

    // Create new customer
    const compName = (customerInfo.companyName || customerInfo.contactName || "Customer").trim();
    const contName = (customerInfo.contactName || customerInfo.companyName || "Valued Customer").trim();
    const custEmail = (customerInfo.email && customerInfo.email.trim())
      ? customerInfo.email.trim().toLowerCase()
      : `customer_${Date.now()}@coylejax.temp`;
    const custPhone = (customerInfo.phone || "N/A").trim();

    customerDoc = await Customer.create({
      company_name: compName,
      contact_name: contName,
      email: custEmail,
      phone: custPhone,
      address: (customerInfo.address || "").trim(),
      created_by: creatorId,
    });

    return customerDoc;
  } catch (err) {
    console.error("[CustomerPaymentService] Customer lookup/creation error:", err.message);
    if (customerInfo.email) {
      try {
        return await Customer.findOne({ email: customerInfo.email.trim().toLowerCase() });
      } catch (_) {}
    }
    return null;
  }
}

/**
 * Apply payment to invoice and calculate new totals and status
 */
async function applyPaymentToInvoice({
  invoiceId,
  amount,
  processingFee = 0,
  transactionId,
  paymentMethod,
  status = "succeeded",
}) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return null;

  const previousPaid = invoice.amount_paid || 0;
  const previousFee = invoice.processing_fee || 0;
  const parsedAmount = Number(amount);
  const parsedFee = Number(processingFee);

  const newAmountPaid = Number((previousPaid + parsedAmount).toFixed(2));
  const newProcessingFee = Number((previousFee + parsedFee).toFixed(2));
  const remaining = Number((invoice.total_amount - newAmountPaid).toFixed(2));

  let newStatus = "unpaid";
  if (remaining <= 0) {
    newStatus = "paid";
  } else if (newAmountPaid > 0) {
    newStatus = "partial";
  }

  const updatedInvoice = await Invoice.findByIdAndUpdate(
    invoice._id,
    {
      status: newStatus,
      amount_paid: newAmountPaid,
      processing_fee: newProcessingFee,
      payment_details: {
        transaction_id: transactionId,
        amount_paid: parsedAmount,
        currency: "usd",
        status: status,
        payment_method: paymentMethod,
        paid_at: new Date(),
      },
    },
    { new: true }
  );

  return {
    invoice: updatedInvoice,
    previousPaid,
    newAmountPaid,
    newProcessingFee,
    remaining,
    newStatus,
  };
}

module.exports = {
  findOrCreateCustomer,
  applyPaymentToInvoice,
};
