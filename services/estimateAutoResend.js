const { DateTime } = require('luxon');
const Estimate = require('../models/Estimate');
const Project = require('../models/Project');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Client = require('../models/Client');
const sendMail = require('../utils/sendMail');
const estimateMail = require('../utils/estimateMail');
const { logActivity } = require('../utils/activityLogger');

const startEstimateResendScheduler = () => {

    let isRunning = false;

    // every minute using native setInterval to avoid node-cron warnings
    setInterval(async () => {

        // Skip this tick if the previous run is still in progress
        if (isRunning) return;
        isRunning = true;

        try {

            const APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/New_York';

            const interval = parseInt( process.env.ESTIMATE_RESEND_INTERVAL || '7', 10 );

            const unit = process.env.ESTIMATE_RESEND_UNIT || 'days';

            const now = DateTime.now().setZone(APP_TIMEZONE);

            const currentDateTime = now.toJSDate();

            // 7 days before
            const sevenDaysAgo = now
                .minus({ [unit]: interval })
                .toJSDate();


            // sent + rejected estimates only
            const estimates = await Estimate.find({
                status: { $in: ['sent', 'rejected'] },
                sent_date: { $lte: sevenDaysAgo },
            });

            for (const estimate of estimates) {

                try {
                    let creator = await User.findById(estimate.created_by).lean();
                    if (!creator) {
                        creator = await Client.findById(estimate.created_by).lean();
                    }

                    if (!creator) continue;

                    let customerEmail = null;
                    let customerName = 'Customer';

                    // QUICK ESTIMATE
                    if (estimate.is_quick_estimate) {
                        customerEmail = estimate.quick_customer?.email_address;
                        customerName = estimate.quick_customer?.customer_name || 'Customer';
                    }

                    // NORMAL ESTIMATE
                    else if (estimate.project_id) {

                        const project = await Project.findById(estimate.project_id).select('customer_ids');
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

                    // no customer email
                    if (!customerEmail) {
                        continue;
                    }
                    const crypto = require('crypto');
                    const sigHmac = crypto.createHmac('sha256', process.env.JWT_SECRET || 'secret')
                                          .update(`${estimate.public_share_token}:s`)
                                          .digest('hex')
                                          .substring(0, 10);
                    const magicLink = `${process.env.BASE_URL}/estimate-print?token=${estimate.public_share_token}&type=s&sig=${sigHmac}`;
                    const emailHtml = estimateMail(
                        magicLink,
                        estimate.estimate_number,
                        customerName,
                        creator.email,
                        creator.companyPhone,
                        creator.companyName,
                        creator.address,
                        creator.full_name,
                        creator.logo,
                        'summary'
                    );

                    await sendMail({
                        from: creator.companyName || 'Company',
                        replyTo: creator.email,
                        to: customerEmail,
                        subject: `Reminder: Estimate ${estimate.estimate_number}`,
                        text: `Reminder for estimate ${estimate.estimate_number}`,
                        html: emailHtml
                    });

                    estimate.auto_resend_count = (estimate.auto_resend_count || 0) + 1;
                    estimate.last_auto_resend_at = currentDateTime;

                    // next resend after 7 days
                    estimate.sent_date = currentDateTime;

                    await estimate.save();

                    await logActivity(
                        estimate.project_id || estimate._id,
                        creator,
                        'Estimate',
                        'Sent',
                        `Estimate "${estimate.estimate_number}" resent via email automatically.`,
                        {
                            estimate_number: estimate.estimate_number,
                            auto_resend_count: estimate.auto_resend_count
                        },
                        estimate._id,
                        'Estimate'
                    );

                } catch (mailErr) {
                    console.error(`Failed resend for ${estimate.estimate_number}`, mailErr);
                }
            }

        } catch (error) {
            console.error('Estimate Resend Scheduler Error:', error);
        } finally {
            isRunning = false;
        }
    }, 60000); // 60,000 ms = 1 minute

    console.log('Estimate Resend Scheduler Initialized');
};

module.exports = { startEstimateResendScheduler };

