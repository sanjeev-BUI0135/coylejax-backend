const Project = require("../models/Project");
const Customer = require("../models/Customer");
const MaterialOrder = require("../models/MaterialOrder");
const User = require("../models/User");
const Client = require("../models/Client");
const mongoose = require("mongoose");
const PaymentSettings = require("../models/PaymentSettings");
const Lead = require("../models/Lead");

const getOwnerId = (req) => {
    if (req.user.role_type === "admin") {
        return new mongoose.Types.ObjectId(req.user._id);
    }

    return new mongoose.Types.ObjectId(req.user.created_by);
};

async function getContactName(projectId) {
    try {
        if (!projectId) return "Customer";
        let actualProjectId;
        if (typeof projectId === "object") {
            actualProjectId = projectId._id || projectId;
        } else {
            actualProjectId = projectId;
        }
        if (!mongoose.Types.ObjectId.isValid(actualProjectId)) {
            return "Customer";
        }
        const project = await Project.findById(actualProjectId);
        if (!project || !project.customer_ids) {
            return "Customer";
        }
        const customer = await Customer.findById(project.customer_ids);
        if (customer && customer.contact_name) {
            return customer.contact_name;
        }
        return "Customer";
    } catch (err) {
        return "Customer";
    }
}

async function createMaterialOrderFromEstimate(estimate) {
    try {
        const existingOrder = await MaterialOrder.findOne({
            estimate_id: estimate._id
        });
        if (existingOrder) {

            const materialItems = (estimate.line_items || []).filter(item => {
                const category = (item.category || '').toLowerCase().trim();

                const isLabor = category.includes('labor') || category.includes('labour');
                const isServiceFee =
                    (category.includes('service') && category.includes('fee')) ||
                    category === 'service_fee' ||
                    category === 'service fee';

                return !(isLabor || isServiceFee || item.is_section);
            });

            existingOrder.line_items = materialItems.map((item, index) => {
                const existingLine = existingOrder.line_items[index] || {};

                return {
                    ...existingLine.toObject?.() || existingLine,

                    description: item.description,
                    quantity_ordered: item.quantity,
                    unit: item.unit,
                    unit_price: item.unit_price || 0,
                    category: item.category || 'Materials',
                    inventory_item_id:
                        item.inventory_item_id || existingLine.inventory_item_id || null,

                    quantity_received:
                        existingLine.quantity_received || 0,

                    status:
                        existingLine.status || 'Not Ordered'
                };
            });

            existingOrder.updatedAt = new Date();
            existingOrder.total_amount = estimate.total_amount || 0;

            await existingOrder.save();

            return existingOrder;
        }

        const materialItems = (estimate.line_items || []).filter(item => {
            const category = (item.category || '').toLowerCase().trim();
            const isLabor = category.includes('labor') || category.includes('labour');
            const isServiceFee = (category.includes('service') && category.includes('fee')) ||
                category === 'service_fee' ||
                category === 'service fee';

            if (isLabor || isServiceFee || item.is_section) {
                return false;
            }
            return true;
        });

        if (materialItems.length === 0) {
            return null;
        }

        const materialOrder = new MaterialOrder({
            estimate_id: estimate._id,
            project_id: estimate.project_id,
            order_status: 'Pending',
            requirement_status: 'Pending',
            total_amount: estimate.total_amount || 0,
            line_items: materialItems.map(item => ({
                description: item.description,
                quantity_ordered: item.quantity,
                quantity_received: 0,
                unit: item.unit,
                unit_price: item.unit_price || 0,
                status: 'Not Ordered',
                category: item.category || 'Materials',
                inventory_item_id: item.inventory_item_id || null
            })),
            notes: `Material order from estimate ${estimate.estimate_number}. Labor/Service excluded.`,
            created_by: estimate.created_by,
            created_by_user: estimate.created_by_user,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await materialOrder.save();
        return materialOrder;

    } catch (error) {
        console.error('Error creating material order:', error);
        return null;
    }
}

async function createCustomerFromQuickEstimate(estimate, adminId) {
    try {
        if (!estimate.is_quick_estimate || !estimate.quick_customer) {
            return null;
        }
        const quickCustomer = estimate.quick_customer;
        const email = quickCustomer.email_address?.toLowerCase().trim();
        
        let adminObjectId;
        try { adminObjectId = new mongoose.Types.ObjectId(adminId); } catch(e) {}

        let customer = await Customer.findOne({
            email,
            created_by: {
                $in: [
                    adminId,
                    adminId.toString(),
                    adminObjectId
                ].filter(Boolean)
            }
        });

        if (customer) {

            customer.company_name = quickCustomer.company_name || customer.company_name;
            customer.contact_name = quickCustomer.customer_name || customer.contact_name;
            customer.phone = quickCustomer.phone_number || customer.phone;
            customer.address = quickCustomer.billing_address || quickCustomer.site_address || customer.address;
            customer.billing_information = estimate.notes || customer.billing_information;
            customer.division = quickCustomer.division_type || customer.division;
            customer.updatedAt = new Date();

            await customer.save();

            try {
                const leads = await Lead.find({ 
                    email, 
                    created_by: {
                        $in: [
                            adminId,
                            adminId.toString(),
                            adminObjectId
                        ].filter(Boolean)
                    } 
                });
                
                if (leads && leads.length > 0) {
                    const settings = await PaymentSettings.findOne({ 
                        provider: "stripe", 
                        createdBy: {
                            $in: [
                                adminId,
                                adminId.toString(),
                                adminObjectId
                            ].filter(Boolean)
                        } 
                    });
                    
                    if (settings && settings.taxExemptLeads) {
                        const leadIds = leads.map(l => l._id);
                        const hasExemptLead = leadIds.some(id => 
                            settings.taxExemptLeads.some(exemptId => exemptId.toString() === id.toString())
                        );

                        if (hasExemptLead) {
                            await PaymentSettings.updateMany(
                                { _id: settings._id },
                                {
                                    $pullAll: { taxExemptLeads: leadIds },
                                    $addToSet: { taxExemptCustomers: customer._id }
                                }
                            );
                        }
                    }
                }
            } catch (err) {
                console.error("Error transferring tax exempt status:", err);
            }

            return customer;
        }

        customer = new Customer({
            company_name: quickCustomer.company_name || "",
            contact_name: quickCustomer.customer_name,
            email,
            phone: quickCustomer.phone_number || "",
            address: quickCustomer.billing_address || quickCustomer.site_address || "",
            billing_information: estimate.notes || "",
            division: quickCustomer.division_type || "",
            created_by: adminId
        });

        await customer.save();
        
        try {
            const PaymentSettings = require("../models/PaymentSettings");
            const Lead = require("../models/Lead");
            const leads = await Lead.find({ 
                email, 
                created_by: {
                    $in: [
                        adminId,
                        adminId.toString(),
                        adminObjectId
                    ].filter(Boolean)
                }
            });
            
            if (leads && leads.length > 0) {
                const settings = await PaymentSettings.findOne({ 
                    provider: "stripe", 
                    createdBy: {
                        $in: [
                            adminId,
                            adminId.toString(),
                            adminObjectId
                        ].filter(Boolean)
                    }
                });
                
                if (settings && settings.taxExemptLeads) {
                    const leadIds = leads.map(l => l._id);
                    const hasExemptLead = leadIds.some(id => 
                        settings.taxExemptLeads.some(exemptId => exemptId.toString() === id.toString())
                    );

                    if (hasExemptLead) {
                        await PaymentSettings.updateMany(
                            { _id: settings._id },
                            {
                                $pullAll: { taxExemptLeads: leadIds },
                                $addToSet: { taxExemptCustomers: customer._id }
                            }
                        );
                    }
                }
            }
        } catch (err) {
            console.error("Error transferring tax exempt status:", err);
        }

        return customer;

    } catch (error) {
        console.error("Customer create/update error:", error);
        return null;
    }
}

const getUserEmailById = async (userId) => {
    if (!userId) return null;

    let user = await User.findById(userId).select("email full_name");
    if (!user) {
        user = await Client.findById(userId).select("email full_name");
    }

    return user;
};

async function applyTaxRateToEstimate(estimateData, adminId, passedSettings = null) {
  if (!estimateData || !estimateData.line_items) {
    return;
  }
  try {
    // -------------------------------------------------------
    // If user manually overrode the tax rate via the toggle,
    // respect their choice — don't recalculate from settings.
    // Just recalculate tax_amount and total_amount from the
    // user-provided tax_rate.
    // -------------------------------------------------------
    if (estimateData.tax_exempt_override === true) {
      const userTaxRate = estimateData.tax_rate != null ? Number(estimateData.tax_rate) : 0;

      const lineItems = estimateData.line_items || [];
      const itemsWithTotals = lineItems.map(i => {
        const itemObj = i.toObject ? i.toObject() : i;
        const base = (itemObj.quantity || 0) * (itemObj.unit_price || 0);
        const markup = base * ((itemObj.markup_percentage || 0) / 100);
        return { ...itemObj, total: Number((base + markup).toFixed(2)) };
      });

      const lineItemsTotal = itemsWithTotals.reduce((s, i) => s + (i.total || 0), 0);
      const additionalMarkup = Number(estimateData.material_markup_amount || estimateData.material_markup || 0);
      const subtotal = Number((lineItemsTotal + additionalMarkup).toFixed(2));

      const taxableLineItemsTotal = itemsWithTotals
        .filter(i => i.category?.toLowerCase() === "materials")
        .reduce((s, i) => s + (i.total || 0), 0);

      estimateData.tax_rate = userTaxRate;
      estimateData.subtotal = subtotal;
      estimateData.tax_amount = Number((taxableLineItemsTotal * userTaxRate).toFixed(2));
      estimateData.total_amount = Number((subtotal + estimateData.tax_amount).toFixed(2));
      return;
    }

    const settings = passedSettings || await PaymentSettings.findOne({
      provider: "stripe",
      createdBy: adminId
    });

    const defaultTaxRate = settings && settings.taxRate != null ? settings.taxRate : 0.075;
    const taxExemptCustomers = settings?.taxExemptCustomers || [];
    const taxExemptLeads = settings?.taxExemptLeads || [];

    let isExempt = false;

    if (estimateData.is_quick_estimate) {
      // Check lead_id at top level OR inside quick_customer._lead_id
      const leadId = estimateData.lead_id || estimateData.quick_customer?._lead_id;
      if (leadId && taxExemptLeads.some(id => id.toString() === leadId.toString())) {
        isExempt = true;
      } else if (estimateData.quick_customer?.email_address) {
        const email = estimateData.quick_customer.email_address.toLowerCase().trim();
        
        let adminObjectId;
        try { adminObjectId = new mongoose.Types.ObjectId(adminId); } catch(e) {}
        
        // Build $or query to handle both String and ObjectId stored values in Mixed field
        const creatorQueryParts = [
          { created_by: adminId.toString() },
          ...(adminObjectId ? [{ created_by: adminObjectId }] : [])
        ];

        const customer = await Customer.findOne({
          email,
          $or: creatorQueryParts
        });
        if (customer && taxExemptCustomers.some(id => id.toString() === customer._id.toString())) {
          isExempt = true;
        }
        if (!isExempt) {
          const lead = await Lead.findOne({
            email,
            $or: creatorQueryParts
          });
          if (lead && taxExemptLeads.some(id => id.toString() === lead._id.toString())) {
            isExempt = true;
          }
        }
      }
    } else if (estimateData.project_id) {
      const project = await Project.findById(estimateData.project_id);
      if (project && project.customer_ids && project.customer_ids.length > 0) {
        const customerId = project.customer_ids[0];
        if (taxExemptCustomers.some(id => id.toString() === customerId.toString())) {
          isExempt = true;
        }
      }
    }

    const finalTaxRate = isExempt ? 0 : defaultTaxRate;
    estimateData.tax_rate = finalTaxRate;

    const lineItems = estimateData.line_items || [];
    const itemsWithTotals = lineItems.map(i => {
      const itemObj = i.toObject ? i.toObject() : i;
      const base = (itemObj.quantity || 0) * (itemObj.unit_price || 0);
      const markup = base * ((itemObj.markup_percentage || 0) / 100);
      return { ...itemObj, total: Number((base + markup).toFixed(2)) };
    });

    const lineItemsTotal = itemsWithTotals.reduce((s, i) => s + (i.total || 0), 0);
    const additionalMarkup = Number(estimateData.material_markup_amount || estimateData.material_markup || 0);
    const subtotal = Number((lineItemsTotal + additionalMarkup).toFixed(2));

    const taxableLineItemsTotal = itemsWithTotals
      .filter(i => i.category?.toLowerCase() === "materials")
      .reduce((s, i) => s + (i.total || 0), 0);

    estimateData.subtotal = subtotal;
    estimateData.tax_amount = Number((taxableLineItemsTotal * finalTaxRate).toFixed(2));
    estimateData.total_amount = Number((subtotal + estimateData.tax_amount).toFixed(2));
  } catch (err) {
    console.error("Error applying tax settings to estimate:", err);
  }
}


async function applyTaxRateToInvoice(invoiceData, adminId, passedSettings = null) {
  if (!invoiceData || !invoiceData.line_items) {
    return;
  }
  try {
    // If user manually overrode the tax rate via the toggle,
    // respect their choice — don't recalculate from settings.
    if (invoiceData.tax_exempt_override === true) {
      const userTaxRate = invoiceData.tax_rate != null ? Number(invoiceData.tax_rate) : 0;

      const lineItems = invoiceData.line_items || [];
      const itemsWithTotals = lineItems.map(i => {
        const itemObj = i.toObject ? i.toObject() : i;
        const base = (itemObj.quantity || 0) * (itemObj.unit_price || 0);
        const markup = base * ((itemObj.markup_percentage || 0) / 100);
        return { ...itemObj, total: Number((base + markup).toFixed(2)) };
      });

      const lineItemsTotal = itemsWithTotals.reduce((s, i) => s + (i.total || 0), 0);
      const additionalMarkup = Number(invoiceData.material_markup_amount || invoiceData.material_markup || 0);
      const subtotal = Number((lineItemsTotal + additionalMarkup).toFixed(2));

      const taxableLineItemsTotal = itemsWithTotals
        .filter(i => i.category?.toLowerCase() === "materials")
        .reduce((s, i) => s + (i.total || 0), 0);

      invoiceData.tax_rate = userTaxRate;
      invoiceData.subtotal = subtotal;
      invoiceData.tax_amount = Number((taxableLineItemsTotal * userTaxRate).toFixed(2));
      invoiceData.total_amount = Number((subtotal + invoiceData.tax_amount).toFixed(2));
      return;
    }

    const settings = passedSettings || await PaymentSettings.findOne({
      provider: "stripe",
      createdBy: adminId
    });

    const defaultTaxRate = settings && settings.taxRate != null ? settings.taxRate : 0.075;
    const taxExemptCustomers = settings?.taxExemptCustomers || [];
    const taxExemptLeads = settings?.taxExemptLeads || [];

    let isExempt = false;

    if (invoiceData.project_id) {
      const project = await Project.findById(invoiceData.project_id);
      if (project && project.customer_ids && project.customer_ids.length > 0) {
        const customerId = project.customer_ids[0];
        if (taxExemptCustomers.some(id => id.toString() === customerId.toString())) {
          isExempt = true;
        }
      }
    }

    // If no project or not yet exempt, check via linked estimate for quick-estimate invoices
    if (!isExempt && invoiceData.estimate_id) {
      const Estimate = require("../models/Estimate");
      const linkedEstimate = await Estimate.findById(invoiceData.estimate_id);
      if (linkedEstimate && linkedEstimate.is_quick_estimate) {
        const leadId = linkedEstimate.lead_id || linkedEstimate.quick_customer?._lead_id;
        if (leadId && taxExemptLeads.some(id => id.toString() === leadId.toString())) {
          isExempt = true;
        } else if (linkedEstimate.quick_customer?.email_address && !isExempt) {
          const email = linkedEstimate.quick_customer.email_address.toLowerCase().trim();
          let adminObjectId;
          try { adminObjectId = new mongoose.Types.ObjectId(adminId); } catch(e) {}
          const creatorQueryParts = [
            { created_by: adminId.toString() },
            ...(adminObjectId ? [{ created_by: adminObjectId }] : [])
          ];
          const customer = await Customer.findOne({ email, $or: creatorQueryParts });
          if (customer && taxExemptCustomers.some(id => id.toString() === customer._id.toString())) {
            isExempt = true;
          }
          if (!isExempt) {
            const lead = await Lead.findOne({ email, $or: creatorQueryParts });
            if (lead && taxExemptLeads.some(id => id.toString() === lead._id.toString())) {
              isExempt = true;
            }
          }
        }
      }
    }

    const finalTaxRate = isExempt ? 0 : defaultTaxRate;
    invoiceData.tax_rate = finalTaxRate;

    const lineItems = invoiceData.line_items || [];
    const itemsWithTotals = lineItems.map(i => {
      const itemObj = i.toObject ? i.toObject() : i;
      const base = (itemObj.quantity || 0) * (itemObj.unit_price || 0);
      const markup = base * ((itemObj.markup_percentage || 0) / 100);
      return { ...itemObj, total: Number((base + markup).toFixed(2)) };
    });

    const lineItemsTotal = itemsWithTotals.reduce((s, i) => s + (i.total || 0), 0);
    const additionalMarkup = Number(invoiceData.material_markup_amount || invoiceData.material_markup || 0);
    const subtotal = Number((lineItemsTotal + additionalMarkup).toFixed(2));

    const taxableLineItemsTotal = itemsWithTotals
      .filter(i => i.category?.toLowerCase() === "materials")
      .reduce((s, i) => s + (i.total || 0), 0);

    invoiceData.subtotal = subtotal;
    invoiceData.tax_amount = Number((taxableLineItemsTotal * finalTaxRate).toFixed(2));
    invoiceData.total_amount = Number((subtotal + invoiceData.tax_amount).toFixed(2));
  } catch (err) {
    console.error("Error applying tax settings to invoice:", err);
  }
}

module.exports = {
    getContactName,
    createMaterialOrderFromEstimate,
    createCustomerFromQuickEstimate,
    getUserEmailById,
    getOwnerId,
    applyTaxRateToEstimate,
    applyTaxRateToInvoice
};