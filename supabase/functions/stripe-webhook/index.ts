// ════════════════════════════════════════════════════════════════════════════
// stripe-webhook — authoritative web fulfillment (the ONLY web funds grant path)
//
// Deploy:  supabase functions deploy stripe-webhook --no-verify-jwt
//          (Stripe calls this server-to-server; there is no Supabase JWT.)
// Secrets: supabase secrets set STRIPE_SECRET_KEY=sk_... STRIPE_WEBHOOK_SECRET=whsec_...
// Stripe:  add an endpoint → <fn-url> → event "checkout.session.completed".
//
// Verifies the Stripe signature, then credits the buyer via fulfill_purchase
// (service role). The Checkout Session id is the idempotency key, so Stripe's
// at-least-once delivery can never double-grant.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^17';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey || !webhookSecret) return new Response('billing not configured', { status: 503 });

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('missing signature', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    // Async variant + SubtleCrypto provider is required in the Deno runtime.
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (err) {
    return new Response(`signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const uid = session.metadata?.user_id;
    const sku = session.metadata?.sku;
    if (session.payment_status === 'paid' && uid && sku) {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { error } = await admin.rpc('fulfill_purchase', {
        p_user: uid,
        p_platform: 'web',
        p_transaction_id: session.id, // idempotency key
        p_sku: sku,
      });
      if (error) {
        // Return 500 so Stripe retries delivery.
        return new Response(`fulfillment failed: ${error.message}`, { status: 500 });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
