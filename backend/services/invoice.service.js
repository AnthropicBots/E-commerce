const PDFDocument = require('pdfkit');

function generateInvoicePdf(order, items) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            let buffers = [];
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });
            doc.on('error', reject);

            // Generate Header
            doc.fillColor('#444444')
                .fontSize(20)
                .text('INVOICE', 50, 50, { align: 'right' });
            
            const orderIdText = order.order_number || order.id;
            doc.fontSize(10)
                .text(`Order ID: ${orderIdText}`, 50, 80, { align: 'right' })
                .text(`Order Date: ${new Date(order.created_at).toLocaleDateString()}`, 50, 95, { align: 'right' });
            
            // Customer Info
            doc.fontSize(14).text('Billed To:', 50, 130);
            doc.fontSize(10)
                .text(order.customer_name || 'N/A', 50, 150)
                .text(order.customer_email || 'N/A', 50, 165)
                .text(order.customer_phone || '', 50, 180);
                
            let fullAddress = order.full_address || '';
            if (!fullAddress && order.shipping_address) {
                const address = typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address) : order.shipping_address;
                fullAddress = `${address.street || ''}, ${address.city || ''}, ${address.state || ''} ${address.zip || ''}`.trim();
            }
            if (fullAddress.startsWith(',')) fullAddress = fullAddress.substring(1).trim();
            doc.text(fullAddress, 50, 195);

            // Table Header
            const tableTop = 250;
            doc.font('Helvetica-Bold');
            doc.text('Item', 50, tableTop);
            doc.text('Qty', 300, tableTop, { width: 50, align: 'right' });
            doc.text('Price', 380, tableTop, { width: 50, align: 'right' });
            doc.text('Total', 480, tableTop, { width: 50, align: 'right' });
            
            doc.moveTo(50, tableTop + 15).lineTo(530, tableTop + 15).stroke();
            
            // Table Rows
            doc.font('Helvetica');
            let y = tableTop + 25;
            (items || []).forEach(item => {
                // Handle pagination if needed
                if (y > 700) {
                    doc.addPage();
                    y = 50;
                }
                const name = item.name || 'Unknown Product';
                const qty = Number(item.qty) || 1;
                const price = Number(item.price) || 0;
                const lineTotal = price * qty;

                doc.text(name, 50, y, { width: 230 });
                doc.text(qty.toString(), 300, y, { width: 50, align: 'right' });
                doc.text(`$${price.toFixed(2)}`, 380, y, { width: 50, align: 'right' });
                doc.text(`$${lineTotal.toFixed(2)}`, 480, y, { width: 50, align: 'right' });
                y += 20;
            });
            
            doc.moveTo(50, y).lineTo(530, y).stroke();
            y += 15;
            
            // Summary
            const subtotal = Number(order.subtotal) || 0;
            let discount = Number(order.discount) || 0;
            if (!discount && order.discount_amount) {
                discount = Number(order.discount_amount);
            }
            const tax = Number(order.tax) || 0;
            const shipping = Number(order.shipping_cost) || 0;
            let total = Number(order.total) || 0;
            if (order.final_amount) {
                total = Number(order.final_amount);
            }

            doc.text(`Subtotal: $${subtotal.toFixed(2)}`, 380, y, { align: 'right' });
            y += 15;
            if (discount > 0) {
                doc.text(`Discount: -$${discount.toFixed(2)}`, 380, y, { align: 'right' });
                y += 15;
            }
            if (tax > 0) {
                doc.text(`Tax: $${tax.toFixed(2)}`, 380, y, { align: 'right' });
                y += 15;
            }
            if (shipping > 0) {
                doc.text(`Shipping: $${shipping.toFixed(2)}`, 380, y, { align: 'right' });
                y += 15;
            }
            
            doc.font('Helvetica-Bold');
            doc.text(`Total: $${total.toFixed(2)}`, 380, y, { align: 'right' });
            y += 15;
            doc.font('Helvetica');
            doc.text(`Payment Method: ${order.payment_method || 'N/A'}`, 380, y, { align: 'right' });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = {
    generateInvoicePdf
};
