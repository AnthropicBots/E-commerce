// The one place the currency is declared. Display, invoicing and payment all
// read from here, which they did not before: the storefront showed ₹, invoices
// were printed with $, and payment intents were raised in USD for the same
// order.
//
// `minorUnitExponent` is what payment providers need to convert a decimal
// amount into the smallest unit. It is 2 for the rupee, but it is 0 for the yen
// and 3 for the dinar, so nothing may assume a factor of a hundred.

const CURRENCY = Object.freeze({
    code: "INR",
    symbol: "₹",
    minorUnitExponent: 2,
    locale: "en-IN",
});

module.exports = CURRENCY;
