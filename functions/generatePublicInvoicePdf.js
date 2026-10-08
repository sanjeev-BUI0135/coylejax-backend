
import { createClient } from 'npm:@base44/sdk@0.1.0';
import { jsPDF } from 'npm:jspdf@2.5.1';
import autoTable from 'npm:jspdf-autotable@3.8.2';

const base44 = createClient({
    appId: Deno.env.get('BASE44_APP_ID'),
});

Deno.serve(async (req) => {
    try {
        const { token } = await req.json();
        
        if (!token) {
            return new Response(JSON.stringify({ error: 'Token is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const invoices = await base44.entities.Invoice.filter({ public_share_token: token });
        
        if (invoices.length === 0) {
            return new Response(JSON.stringify({ error: 'Invoice not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const invoice = invoices[0];
        
        // Get related data
        const project = await base44.entities.Project.get(invoice.project_id);
        const customer = await base44.entities.Customer.get(project.customer_id);

        const doc = new jsPDF();
        
        // Company Header
        doc.setFontSize(20);
        doc.setTextColor(0, 0, 0);
        doc.text('George P. Coyle and Sons', 105, 20, { align: 'center' });
        doc.setFontSize(12);
        doc.text('2361 Dennis St, Jacksonville, FL 32203', 105, 28, { align: 'center' });
        doc.text('P.O. Box 2267', 105, 34, { align: 'center' });
        
        // Title
        doc.setFontSize(18);
        doc.setTextColor(0, 0, 0);
        doc.text('INVOICE', 105, 50, { align: 'center' });
        
        // Invoice Details
        doc.setFontSize(11);
        doc.text(`Invoice Number: ${invoice.invoice_number}`, 20, 70);
        doc.text(`Issue Date: ${new Date(invoice.issue_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}`, 20, 78);
        doc.text(`Due Date: ${new Date(invoice.due_date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })}`, 20, 86);
        if (invoice.customer_po_number) {
            doc.text(`Customer PO: ${invoice.customer_po_number}`, 20, 94);
        }
        
        // Customer Info
        doc.text('Bill To:', 120, 70);
        doc.text(customer.company_name || '', 120, 78);
        doc.text(customer.contact_name || '', 120, 86);
        doc.text(customer.address || '', 120, 94);
        doc.text(`${customer.city || ''}, ${customer.state || ''} ${customer.zip_code || ''}`, 120, 102);
        
        // Project Info
        doc.text(`Project: ${project.project_name}`, 20, 110);
        doc.text(`Location: ${invoice.project_location || project.location || ''}`, 20, 118);
        if (invoice.project_manager) {
            doc.text(`Project Manager: ${invoice.project_manager}`, 20, 126);
        }
        
        // Line Items Table
        const tableColumn = ['Description', 'Qty', 'Unit', 'Unit Price', 'Total'];
        const tableRows = [];
        
        if (invoice.line_items && invoice.line_items.length > 0) {
            invoice.line_items.forEach(item => {
                if (item.is_section) {
                    tableRows.push([{
                        content: item.description || '',
                        colSpan: 5,
                        styles: { halign: 'left', fontStyle: 'normal', fillColor: [243, 244, 246] }
                    }]);
                } else {
                    tableRows.push([
                        item.description || '',
                        item.quantity?.toString() || '0',
                        item.unit || '',
                        `$${(item.unit_price || 0).toFixed(2)}`,
                        `$${(item.total || 0).toFixed(2)}`
                    ]);
                }
            });
        }
        
        autoTable(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: 140,
            theme: 'grid',
            headStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0] },
            alternateRowStyles: { fillColor: [255, 255, 255] },
            styles: { fontSize: 10 }
        });
        
        // Totals
        const finalY = doc.lastAutoTable.finalY + 20;
        doc.text('Subtotal:', 140, finalY);
        doc.text(`$${(invoice.subtotal || 0).toFixed(2)}`, 170, finalY);
        
        doc.text(`Tax (${((invoice.tax_rate || 0) * 100).toFixed(1)}%):`, 140, finalY + 8);
        doc.text(`$${(invoice.tax_amount || 0).toFixed(2)}`, 170, finalY + 8);
        
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text('Total:', 140, finalY + 20);
        doc.text(`$${(invoice.total_amount || 0).toFixed(2)}`, 170, finalY + 20);
        
        // Payment Info
        doc.setFontSize(11);
        doc.setFont(undefined, 'normal');
        doc.text('Amount Paid:', 140, finalY + 32);
        doc.text(`$${(invoice.amount_paid || 0).toFixed(2)}`, 170, finalY + 32);
        
        const balanceDue = (invoice.total_amount || 0) - (invoice.amount_paid || 0);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(200, 0, 0);
        doc.text('Balance Due:', 140, finalY + 44);
        doc.text(`$${balanceDue.toFixed(2)}`, 170, finalY + 44);
        
        // Notes
        if (invoice.notes) {
            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(0, 0, 0);
            doc.text('Notes:', 20, finalY + 60);
            const splitNotes = doc.splitTextToSize(invoice.notes, 170);
            doc.text(splitNotes, 20, finalY + 68);
        }
        
        const pdfBytes = doc.output('arraybuffer');
        
        return new Response(pdfBytes, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename=invoice_${invoice.invoice_number}.pdf`
            }
        });
        
    } catch (error) {
        console.error('Error generating public invoice PDF:', error);
        return new Response(JSON.stringify({ error: 'PDF generation failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});
    