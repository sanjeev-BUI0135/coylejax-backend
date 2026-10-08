const { DateTime } = require('luxon');

const Invoice = require('../models/Invoice');
const Project = require('../models/Project');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Client = require('../models/Client');

const sendMail = require('../utils/sendMail');
const generateInvoiceEmailHTML = require('../utils/invoiceEmailTemplate');
const { logActivity } = require('../utils/activityLogger');

const startInvoiceResendScheduler = () => {

    let isRunning = false;

    setInterval(async () => {

        if (isRunning) return;
        isRunning = true;

        try {

            const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';
            const interval = parseInt( process.env.ESTIMATE_RESEND_INTERVAL || '7', 10 );
            const unit = process.env.ESTIMATE_RESEND_UNIT || 'days';

            const now = DateTime.now().setZone(APP_TIMEZONE);

            const currentDateTime = now.toJSDate();

            const sevenDaysAgo = now
                .minus({ [unit]: interval })
                .toJSDate();


            const invoices = await Invoice.find({
                status: { $in: ['sent'] },
                invoice_sent_date: { $lte: sevenDaysAgo },
            });

            for (const invoice of invoices) {
                try {
                    let creator = await User.findById(invoice.created_by).lean();
                    if (!creator) {
                        creator = await Client.findById(invoice.created_by).lean();
                    }

                    if (!creator) continue;

                    let customerEmail = null;
                    let customerName = 'Customer';

                    if (invoice.project_id) {

                        const project = await Project.findById(invoice.project_id).select('customer_ids');

                        if (project?.customer_ids?.length) {
                            const customer = await Customer.findById(project.customer_ids[0]).select(
                                'email contact_name company_name'
                            );

                            if (customer) {
                                customerEmail = customer.email;
                                customerName = customer.contact_name || customer.company_name || 'Customer';
                            }
                        }
                    }

                    if (!customerEmail) continue;
                    const crypto = require('crypto');
                    const sigHmac = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
                                          .update(`${invoice.public_share_token}:s`)
                                          .digest('hex')
                                          .substring(0, 10);
                    const invoiceLink = `${process.env.BASE_URL}/PublicInvoice?token=${invoice.public_share_token}&type=s&sig=${sigHmac}`;
                    const emailHtml = generateInvoiceEmailHTML(
                        invoiceLink,
                        invoice.invoice_number,
                        customerName,
                        'summary',
                        invoice.total_amount,
                        invoice.due_date,
                        creator.email,
                        creator.companyPhone,
                        creator.companyName,
                        creator.address,
                        creator.logo
                    );

                    await sendMail({
                        from: creator.companyName || 'Company',
                        replyTo: creator.email,
                        to: customerEmail,
                        subject: `Reminder: Invoice ${invoice.invoice_number}`,
                        text: `Reminder for invoice ${invoice.invoice_number}`,
                        html: emailHtml
                    });

                    invoice.auto_resend_count = (invoice.auto_resend_count || 0) + 1;
                    invoice.last_auto_resend_at = currentDateTime;
                    // reset resend cycle
                    invoice.invoice_sent_date = currentDateTime;
                    await invoice.save();
                    await logActivity(
                        invoice.project_id || invoice._id,
                        creator,
                        'Invoice',
                        'Sent',
                        `Invoice "${invoice.invoice_number}" resent via email automatically.`,
                        {
                            invoice_number: invoice.invoice_number,
                            auto_resend_count: invoice.auto_resend_count
                        },
                        invoice._id,
                        'Invoice'
                    );

                } catch (mailErr) {
                    console.error(`Failed resend for ${invoice.invoice_number}`, mailErr);
                }
            }

        } catch (error) {
            console.error('Invoice Resend Scheduler Error:', error);
        } finally {
            isRunning = false;
        }

    }, 60000);
};

module.exports = { startInvoiceResendScheduler };