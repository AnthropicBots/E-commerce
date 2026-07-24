const INTERACTION_TYPES = {
  VIEW: "view",
  CART_ADD: "cart_add",
  WISHLIST_ADD: "wishlist_add",
  PURCHASE: "purchase",
};

const INTERACTION_WEIGHTS = {
  [INTERACTION_TYPES.VIEW]: 1,
  [INTERACTION_TYPES.CART_ADD]: 3,
  [INTERACTION_TYPES.WISHLIST_ADD]: 2,
  [INTERACTION_TYPES.PURCHASE]: 5,
};

const INTERACTION_LABELS = {
  [INTERACTION_TYPES.VIEW]: "Viewed",
  [INTERACTION_TYPES.CART_ADD]: "Added to Cart",
  [INTERACTION_TYPES.WISHLIST_ADD]: "Added to Wishlist",
  [INTERACTION_TYPES.PURCHASE]: "Purchased",
};

const INTERACTION_ICONS = {
  [INTERACTION_TYPES.VIEW]: "👁️",
  [INTERACTION_TYPES.CART_ADD]: "🛒",
  [INTERACTION_TYPES.WISHLIST_ADD]: "❤️",
  [INTERACTION_TYPES.PURCHASE]: "✅",
};

const INTERACTION_CATEGORIES = {
  [INTERACTION_TYPES.VIEW]: "browsing",
  [INTERACTION_TYPES.CART_ADD]: "engagement",
  [INTERACTION_TYPES.WISHLIST_ADD]: "engagement",
  [INTERACTION_TYPES.PURCHASE]: "conversion",
};

const VALID_INTERACTION_TYPES = Object.values(INTERACTION_TYPES);

function isValidInteractionType(type) {
  return VALID_INTERACTION_TYPES.includes(type);
}

function getInteractionWeight(type) {
  return INTERACTION_WEIGHTS[type] || 0;
}

function getInteractionLabel(type) {
  return INTERACTION_LABELS[type] || type;
}

function getInteractionIcon(type) {
  return INTERACTION_ICONS[type] || "📌";
}

function getInteractionCategory(type) {
  return INTERACTION_CATEGORIES[type] || "unknown";
}

function validateInteractionType(type, throwError = false) {
  const isValid = isValidInteractionType(type);
  if (!isValid && throwError) {
    throw new Error(`Invalid interaction type: ${type}. Valid types: ${VALID_INTERACTION_TYPES.join(', ')}`);
  }
  return isValid;
}

function getAllInteractionTypes() {
  return [...VALID_INTERACTION_TYPES];
}

function getInteractionTypesByCategory(category) {
  return Object.entries(INTERACTION_CATEGORIES)
    .filter(([_, cat]) => cat === category)
    .map(([type]) => type);
}

function getKeyByValue(value) {
  const entry = Object.entries(INTERACTION_TYPES).find(([_, val]) => val === value);
  return entry ? entry[0] : null;
}

module.exports = {
  INTERACTION_TYPES,
  INTERACTION_WEIGHTS,
  INTERACTION_LABELS,
  INTERACTION_ICONS,
  INTERACTION_CATEGORIES,
  VALID_INTERACTION_TYPES,
  isValidInteractionType,
  getInteractionWeight,
  getInteractionLabel,
  getInteractionIcon,
  getInteractionCategory,
  validateInteractionType,
  getAllInteractionTypes,
  getInteractionTypesByCategory,
  getKeyByValue,
};