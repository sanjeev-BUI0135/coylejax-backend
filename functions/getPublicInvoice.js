
import { createClient } from 'npm:@base44/sdk@0.1.0';

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

        // Use system authentication to access data
        // Find invoice by public share token
        const invoices = await base44.entities.Invoice.filter({ public_share_token: token });
        
        if (invoices.length === 0) {
            return new Response(JSON.stringify({ error: 'Invoice not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const invoice = invoices[0];
        
        // Get related project and customer data
        const project = await base44.entities.Project.get(invoice.project_id);
        const customer = await base44.entities.Customer.get(project.customer_id);

        return new Response(JSON.stringify({
            invoice,
            project,
            customer
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Error fetching public invoice:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
});
    