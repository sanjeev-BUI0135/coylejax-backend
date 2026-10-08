import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function createCheckoutSession(invoice, token) {
  return stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "payment",
    line_items: invoice.line_items.map((item) => ({
      price_data: {
        currency: "usd",
        product_data: { name: item.description },
        unit_amount: item.unit_price * 100,
      },
      quantity: item.quantity,
    })),
    success_url: `${process.env.PUBLIC_URL}/invoice-success?token=${token}`,
    cancel_url: `${process.env.PUBLIC_URL}/invoice/${token}`,
  });
}

export function verifyStripeWebhook(req, sig) {
  return stripe.webhooks.constructEvent(
    req.body,
    sig,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}
