// backend/services/invoice.service.js
//
// The order invoice, rendered as a PDF (#1487, #1608).
//
// WHY THE CURRENCY IS NOT SIMPLY CONCATENATED
//
// The store prices in INR and `config/currency.js` declares the symbol as "₹"
// (U+20B9). This document is drawn with pdfkit's default font, and pdfkit's
// built-in `Helvetica` is one of the fourteen standard PDF Type1 faces: it
// carries **WinAnsiEncoding**, a 256-glyph Latin-1 derivative that predates the
// rupee sign by two decades. U+20B9 is not in it.
//
// A character the font cannot encode is emitted as `.notdef` — zero width,
// paints nothing. So `Total: ₹1499.00` reached the customer as `Total: 1499.00`
// with the currency silently swallowed, and an invoice that does not say what
// currency it is in is not an invoice. `doc.widthOfString("₹") === 0` is the
// whole of the evidence, and it is what `resolveMoneyStyle` below checks.
//
// The check is deliberately a *probe* rather than a list of known-bad symbols.
// ₩, ₪, ₫, ₴ and ₦ are all outside WinAnsi too, and a future deployment that
// embeds a Unicode TTF should get its symbol back automatically rather than
// being stuck with the fallback forever.
//
// The fallback is the ISO 4217 code — `INR 1,499.00`. It is unambiguous, it is
// what every accounting system already reads, and it is pure ASCII, so no font
// can lose it.
//
// Numbers are formatted through `Intl.NumberFormat` against the configured
// locale and minor-unit exponent rather than a hard-coded `toFixed(2)`: the
// rupee groups in lakhs, the yen has no decimal places at all, and neither of
// those is this module's business to know.

const PDFDocument = require('pdfkit');
const CURRENCY = require('../config/currency');

// Page geometry. Everything below is expressed against these so the table, the
// rules and the summary block cannot drift apart when one of them is moved.
const MARGIN = 50;
const CONTENT_RIGHT = 530;
const PAGE_BOTTOM = 700;

// Column x-offsets and widths for the line-item table.
const COL = Object.freeze({
    NAME_X: MARGIN,
    NAME_WIDTH: 230,
    QTY_X: 300,
    QTY_WIDTH: 50,
    PRICE_X: 380,
    PRICE_WIDTH: 50,
    TOTAL_X: 480,
    TOTAL_WIDTH: 50
});

// The shortest a line-item row may be, even when the name fits on one line.
// Keeps the table from looking cramped and matches the old fixed step.
const MIN_ROW_HEIGHT = 20;

// Vertical step for the single-line rows of the summary block.
const SUMMARY_LINE_HEIGHT = 15;

/**
 * Can the active font actually draw this string?
 *
 * pdfkit reports a width of zero for a glyph it has no mapping for, which is
 * the only signal available before the page is flattened. Anything that throws
 * (a font that has not been embedded yet, a stubbed document in a test) counts
 * as "no", because the safe answer is the one that still prints a currency.
 *
 * @param {object} doc pdfkit document
 * @param {string} text
 * @returns {boolean}
 */
const canRenderText = (doc, text) => {
    if (!text) return false;
    if (typeof doc.widthOfString !== 'function') return false;

    try {
        return doc.widthOfString(text) > 0;
    } catch (error) {
        return false;
    }
};

/**
 * Decide, once per document, how money will be written on it.
 *
 * Two possible answers, and which one applies is a property of the font this
 * document happens to be using, not of the currency:
 *
 *   symbol   "₹1,499.00"    -- the font has a glyph for CURRENCY.symbol
 *   code     "INR 1,499.00" -- it does not, so the ISO 4217 code stands in
 *
 * Resolved once and passed down rather than recomputed at each call site, so a
 * single invoice cannot print some amounts with the symbol and others with the
 * code -- a document that does that is harder to read than one that
 * consistently uses either.
 *
 * `usesSymbol` is returned alongside the prefix because a caller may want to
 * know *which* answer it got -- the footer line ("Amounts in INR") is worth
 * more when the symbol was dropped -- without having to re-derive it by
 * inspecting the string.
 *
 * @param {object} doc pdfkit document, already using its final font
 * @returns {{ prefix: string, usesSymbol: boolean }}
 */
const resolveMoneyStyle = (doc) => {
    if (canRenderText(doc, CURRENCY.symbol)) {
        return { prefix: CURRENCY.symbol, usesSymbol: true };
    }

    // Trailing space: "INR 1,499.00" reads as an amount, "INR1,499.00" reads as
    // a part number.
    return { prefix: `${CURRENCY.code} `, usesSymbol: false };
};

/**
 * Group and fix the decimals of an amount according to the configured locale.
 *
 * `Intl` is wrapped because a Node build without full ICU falls back to a
 * root locale, and a thrown formatter must not take an invoice download down
 * with it. The manual path produces the same shape for the two-decimal case,
 * which is every currency this store has ever priced in.
 *
 * @param {unknown} amount
 * @returns {string} digits, grouping and decimal separator only — no symbol
 */
const formatAmount = (amount) => {
    const parsed = Number(amount);

    // isFinite, not `Number(x) || 0`. That idiom catches NaN, null, undefined
    // and "" but lets Infinity through, and Intl renders Infinity as "∞"
    // (U+221E) -- which is itself outside WinAnsi, so the very glyph problem
    // this module exists to avoid would come back on the one line nobody
    // thought to check. A non-finite amount is not a price; it prints as zero.
    const finite = Number.isFinite(parsed) ? parsed : 0;

    // Clamped, because both Intl.NumberFormat and toFixed throw RangeError
    // outside their accepted ranges -- and the fallback below would then throw
    // *inside* the catch that exists to stop the first throw, taking the
    // invoice download with it.
    const configured = Number(CURRENCY.minorUnitExponent);
    const digits = Number.isInteger(configured)
        ? Math.min(Math.max(configured, 0), 20)
        : 2;

    // Anything that rounds to zero prints as zero, without a sign. Both -0 and
    // -0.001 would otherwise come out as "-0.00", and on an invoice that reads
    // as a mistake -- "Discount: --0.00" reads as two. A genuinely negative
    // amount keeps its sign; only a *displayed* zero loses one.
    const roundsToZero = Math.abs(finite) < 0.5 / 10 ** digits;
    const value = roundsToZero ? 0 : finite;

    try {
        return new Intl.NumberFormat(CURRENCY.locale || 'en-US', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
            // `decimal` rather than `currency`: the style is chosen by
            // resolveMoneyStyle against what the font can draw, and asking Intl
            // for the currency style would put the unencodable symbol straight
            // back into the string.
            style: 'decimal'
        }).format(value);
    } catch (error) {
        return value.toFixed(digits);
    }
};

/**
 * A complete money string in the style this document has settled on.
 *
 * @param {{ prefix: string }} style
 * @param {unknown} amount
 * @returns {string}
 */
const money = (style, amount) => `${style.prefix}${formatAmount(amount)}`;

/**
 * Draw the line-item column headings and the rule under them.
 *
 * Extracted so it can be drawn again after every page break. A second page of
 * an invoice that is a bare column of numbers is not readable, and the previous
 * version produced exactly that.
 *
 * @param {object} doc
 * @param {number} top y of the heading row
 * @returns {number} y at which the first row of the table may start
 */
const drawTableHeader = (doc, top) => {
    doc.font('Helvetica-Bold');
    doc.text('Item', COL.NAME_X, top, { width: COL.NAME_WIDTH });
    doc.text('Qty', COL.QTY_X, top, { width: COL.QTY_WIDTH, align: 'right' });
    doc.text('Price', COL.PRICE_X, top, { width: COL.PRICE_WIDTH, align: 'right' });
    doc.text('Total', COL.TOTAL_X, top, { width: COL.TOTAL_WIDTH, align: 'right' });

    doc.moveTo(MARGIN, top + 15).lineTo(CONTENT_RIGHT, top + 15).stroke();
    doc.font('Helvetica');

    return top + 25;
};

/**
 * How tall a line-item row needs to be.
 *
 * The name is the only wrapping cell, so it decides. Measured rather than
 * assumed: the previous version advanced by a fixed 20pt regardless, so any
 * product name longer than the 230pt column was overprinted by the row beneath
 * it.
 *
 * @param {object} doc
 * @param {string} name
 * @returns {number}
 */
const rowHeightFor = (doc, name) => {
    if (typeof doc.heightOfString !== 'function') {
        return MIN_ROW_HEIGHT;
    }

    try {
        const measured = doc.heightOfString(name, { width: COL.NAME_WIDTH });
        return Math.max(MIN_ROW_HEIGHT, Math.ceil(measured) + 5);
    } catch (error) {
        return MIN_ROW_HEIGHT;
    }
};

/**
 * Resolve the shipping address into one printable line.
 *
 * `full_address` is what the order tables carry when the address book was used;
 * `shipping_address` is the JSON blob guest checkout writes. Either may be
 * absent, and a malformed blob must not stop an invoice being produced.
 *
 * @param {object} order
 * @returns {string}
 */
const resolveAddress = (order) => {
    let fullAddress = order.full_address || '';

    if (!fullAddress && order.shipping_address) {
        try {
            const address = typeof order.shipping_address === 'string'
                ? JSON.parse(order.shipping_address)
                : order.shipping_address;

            fullAddress = [
                address.street,
                address.city,
                [address.state, address.zip].filter(Boolean).join(' ')
            ]
                .map((part) => String(part || '').trim())
                .filter(Boolean)
                .join(', ');
        } catch (error) {
            fullAddress = '';
        }
    }

    return String(fullAddress).replace(/^[,\s]+/, '').trim();
};

/**
 * The money figures for the summary block.
 *
 * Column names differ across the order paths this repository has accumulated
 * (`discount` vs `discount_amount`, `total` vs `final_amount`), so the aliases
 * are resolved in one place instead of inline in the drawing code. `??` rather
 * than truthiness: a recorded total of zero is a real figure, and `||` would
 * quietly swap it for the other column.
 *
 * @param {object} order
 * @returns {{subtotal:number, discount:number, tax:number, shipping:number, total:number}}
 */
const resolveTotals = (order) => {
    const num = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };

    const discountSource = order.discount ?? order.discount_amount;
    const totalSource = order.final_amount ?? order.total;

    return {
        subtotal: num(order.subtotal),
        discount: num(discountSource),
        tax: num(order.tax),
        shipping: num(order.shipping_cost),
        total: num(totalSource)
    };
};

/**
 * Render an invoice for one order.
 *
 * @param {object} order row from `orders`
 * @param {Array<object>} items rows from `order_items`
 * @returns {Promise<Buffer>}
 */
function generateInvoicePdf(order, items) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: MARGIN });
            const buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));
            doc.on('error', reject);

            // Settled once, before anything is drawn, so the whole document
            // agrees with itself about how money looks.
            const style = resolveMoneyStyle(doc);
            const amount = (value) => money(style, value);

            // ---- Header -------------------------------------------------
            doc.fillColor('#444444')
                .fontSize(20)
                .text('INVOICE', MARGIN, 50, { align: 'right' });

            const orderIdText = order.order_number || order.id;
            doc.fontSize(10)
                .text(`Order ID: ${orderIdText}`, MARGIN, 80, { align: 'right' })
                .text(
                    `Order Date: ${new Date(order.created_at).toLocaleDateString(CURRENCY.locale || 'en-US')}`,
                    MARGIN,
                    95,
                    { align: 'right' }
                );

            // ---- Customer ----------------------------------------------
            doc.fontSize(14).text('Billed To:', MARGIN, 130);
            doc.fontSize(10)
                .text(order.customer_name || 'N/A', MARGIN, 150)
                .text(order.customer_email || 'N/A', MARGIN, 165)
                .text(order.customer_phone || '', MARGIN, 180)
                .text(resolveAddress(order), MARGIN, 195, { width: COL.NAME_WIDTH * 1.5 });

            // ---- Line items ---------------------------------------------
            let y = drawTableHeader(doc, 250);

            (items || []).forEach((item) => {
                const name = String(item.name || 'Unknown Product');
                const qty = Number(item.qty) || 1;
                const price = Number(item.price) || 0;
                const height = rowHeightFor(doc, name);

                // Break *before* drawing, and take the headings with us — a
                // row must never be split across the page boundary and a
                // continuation page must still say what its columns mean.
                if (y + height > PAGE_BOTTOM) {
                    doc.addPage();
                    y = drawTableHeader(doc, MARGIN);
                }

                doc.text(name, COL.NAME_X, y, { width: COL.NAME_WIDTH });
                doc.text(String(qty), COL.QTY_X, y, { width: COL.QTY_WIDTH, align: 'right' });
                doc.text(amount(price), COL.PRICE_X, y, { width: COL.PRICE_WIDTH, align: 'right' });
                doc.text(amount(price * qty), COL.TOTAL_X, y, { width: COL.TOTAL_WIDTH, align: 'right' });

                y += height;
            });

            doc.moveTo(MARGIN, y).lineTo(CONTENT_RIGHT, y).stroke();
            y += SUMMARY_LINE_HEIGHT;

            // ---- Summary -------------------------------------------------
            const totals = resolveTotals(order);

            // The summary is eight lines at most; if the table ended near the
            // foot of the page it goes on a fresh one rather than off the
            // bottom edge.
            if (y + SUMMARY_LINE_HEIGHT * 8 > PAGE_BOTTOM) {
                doc.addPage();
                y = MARGIN;
            }

            const summaryLine = (text, bold = false) => {
                doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
                doc.text(text, COL.PRICE_X, y, { align: 'right' });
                y += SUMMARY_LINE_HEIGHT;
            };

            summaryLine(`Subtotal: ${amount(totals.subtotal)}`);

            if (totals.discount > 0) {
                summaryLine(`Discount: -${amount(totals.discount)}`);
            }

            if (totals.tax > 0) {
                summaryLine(`Tax: ${amount(totals.tax)}`);
            }

            if (totals.shipping > 0) {
                summaryLine(`Shipping: ${amount(totals.shipping)}`);
            }

            summaryLine(`Total: ${amount(totals.total)}`, true);
            summaryLine(`Payment Method: ${order.payment_method || 'N/A'}`);

            // Always stated, symbol or not. When the symbol did render this is
            // a confirmation; when it did not it is the only place the reader
            // would otherwise have to guess.
            summaryLine(`Amounts in ${CURRENCY.code}`);

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = {
    generateInvoicePdf,
    // Exported for the tests, which need to assert the encoding decision
    // itself rather than only the pixels that come out the far end.
    canRenderText,
    resolveMoneyStyle,
    formatAmount,
    resolveTotals,
    resolveAddress
};
