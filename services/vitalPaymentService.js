const axios = require("axios");
const crypto = require("crypto");

function hasVitalCredentials(settings) {
  return !!(
    settings &&
    settings.secretKey &&
    String(settings.secretKey).trim() &&
    settings.vitalMerchantId &&
    String(settings.vitalMerchantId).trim()
  );
}

async function processVitalCharge({
  vitalSettings,
  cardDetails,
  customerInfo = {},
  totalAmount,
  orderId,
}) {
  const cleanCard = (cardDetails?.cardNumber || "").replace(/\s+/g, "");
  const cardExp = (cardDetails?.cardExpiry || "").replace("/", "");
  const cardCvv = (cardDetails?.cardCvv || "").trim();
  const cardHolder = (
    cardDetails?.cardHolder ||
    customerInfo.contactName ||
    customerInfo.companyName ||
    "Valued Customer"
  ).trim();

  // Check for required Vital credentials
  if (!hasVitalCredentials(vitalSettings)) {
    return {
      success: false,
      error: "Vital Merchant API credentials (Merchant ID / Secret Key) are missing or not configured in Payment Settings.",
    };
  }

  try {
    const params = new URLSearchParams();
    params.append("security_key", vitalSettings.secretKey);
    params.append("amount", Number(totalAmount).toFixed(2));
    params.append("type", "sale");
    params.append("payment", "creditcard");
    params.append("ccnumber", cleanCard);
    params.append("ccexp", cardExp);
    params.append("cvv", cardCvv);

    const names = cardHolder.split(/\s+/);
    params.append("first_name", names[0] || "Valued");
    params.append("last_name", names.slice(1).join(" ") || "Customer");

    if (customerInfo.address) params.append("address1", customerInfo.address);
    if (customerInfo.phone) params.append("phone", customerInfo.phone);
    params.append("orderid", orderId || "PAY_" + Date.now());

    const gatewayResponse = await axios.post(
      "https://vms.transactiongateway.com/api/transact.php",
      params.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        validateStatus: () => true, 
        timeout: 15000,
      }
    );

    const parsedRes = new URLSearchParams(gatewayResponse.data);
    const gatewayCode = parsedRes.get("response");
    const gatewayText = parsedRes.get("responsetext");
    const gatewayTxId = parsedRes.get("transactionid");


    if (gatewayCode === "1") {
      return {
        success: true,
        transactionId: gatewayTxId || "ch_vital_" + crypto.randomBytes(8).toString("hex"),
        status: "succeeded",
        isSimulated: false,
      };
    }

    let errorMsg = gatewayText || "Payment declined by gateway.";
    if (errorMsg.toLowerCase().includes("duplicate transaction")) {
      const refMatch = errorMsg.match(/REFID:(\d+)/i);
      const refId = refMatch ? ` (Transaction #${refMatch[1]})` : "";
      errorMsg = `Duplicate Transaction: This card was already charged for this exact amount a moment ago${refId}. To protect you from accidental double-charges, please wait a few minutes before trying again.`;
    }

    return {
      success: false,
      error: errorMsg,
      code: gatewayCode,
    };
  } catch (gwErr) {
    console.error("[Vital Gateway] Communication error:", gwErr.message);

    return {
      success: false,
      error: `Failed to communicate with payment gateway (${gwErr.message || "timeout"}). Please try again.`,
    };
  }
}

module.exports = {
  hasVitalCredentials,
  processVitalCharge,
};
