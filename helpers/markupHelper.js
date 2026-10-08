const { getMarkupThreshold } = require('./getMarkupThreshold.js');

async function hasLowMarkupItems(lineItems, ownerId) {
  if (!lineItems || !Array.isArray(lineItems)) return false;

  const markupLimit = await getMarkupThreshold(ownerId);

  return lineItems.some(item => {
    const unitPrice = parseFloat(item.unit_price) || 0;
    const total = parseFloat(item.total) || 0;
    const quantity = parseFloat(item.quantity) || 1;

    if (unitPrice <= 0 || total <= 0) return false;

    const baseCost = unitPrice * quantity;
    if (baseCost <= 0) return false;

    const markupPercentage = ((total - baseCost) / baseCost) * 100;
    return markupPercentage > 0 && markupPercentage < markupLimit;
  });
}

async function getLowMarkupItems(lineItems, ownerId) {
  const markupLimit = await getMarkupThreshold(ownerId);

  return lineItems.filter(item => {
    const unitPrice = parseFloat(item.unit_price) || 0;
    const total = parseFloat(item.total) || 0;
    const quantity = parseFloat(item.quantity) || 1;

    if (unitPrice <= 0 || total <= 0) return false;

    const baseCost = unitPrice * quantity;
    if (baseCost <= 0) return false;

    const markupPercentage = ((total - baseCost) / baseCost) * 100;

    return markupPercentage > 0 && markupPercentage < markupLimit;
  }).map(item => {
    const unitPrice = parseFloat(item.unit_price) || 0;
    const total = parseFloat(item.total) || 0;
    const quantity = parseFloat(item.quantity) || 1;

    const baseCost = unitPrice * quantity;
    const markupPercentage = ((total - baseCost) / baseCost) * 100;

    return {
      ...item,
      markup_percentage: markupPercentage.toFixed(1),
      base_cost: baseCost
    };
  });
}

module.exports = {
  hasLowMarkupItems,
  getLowMarkupItems
};
