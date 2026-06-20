// ════════════════════════════════════════════════════════════════════════════
// stripe-checkout — create a Stripe Checkout Session for a Campaign Funds purchase
//
// Deploy:  supabase functions deploy stripe-checkout
// Secrets: supabase secrets set STRIPE_SECRET_KEY=sk_...   (use test keys first!)
//
// The client (web only) calls this with a SKU; we create a Checkout Session and
// return its URL to redirect to. Fulfillment happens out-of-band in the
// stripe-webhook function (the browser redirect is NOT trusted to grant funds).
// The user is identified from their JWT and stamped into session metadata so the
// webhook knows whom to credit.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^17';

const ALLOWED_ORIGINS = new Set<string>([
  'https://playelector.com',
  'https://www.playelector.com',
  'http://localhost:5174',
]);
const FALLBACK_ORIGIN = 'https://playelector.com';

// USD price (in cents) per SKU on the WEB rail. The funds/characters granted are
// owned by the DB (fulfill_purchase); this is only what Stripe charges.
const WEB_PRICE_CENTS: Record<string, { cents: number; label: string }> = {
  funds_1500: { cents: 99, label: '1,500 Campaign Funds' },
  funds_4000: { cents: 199, label: '4,000 Campaign Funds' },
  funds_8000: { cents: 399, label: '8,000 Campaign Funds' },
  funds_12000: { cents: 599, label: '12,000 Campaign Funds' },
  unlock_washington: { cents: 299, label: 'George Washington (character)' },
  unlock_joe_biden: { cents: 299, label: 'Joe Biden (character)' },
  unlock_ronald_reagan: { cents: 299, label: 'Ronald Reagan (character)' },
  unlock_starmer: { cents: 299, label: 'Keir Starmer (character)' },
  unlock_farage: { cents: 299, label: 'Nigel Farage (character)' },
  unlock_jfk: { cents: 299, label: 'John F. Kennedy (character)' },
};

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : FALLBACK_ORIGIN;
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body: unknown, status = 200, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'missing auth' }, 401, cors);

    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ error: 'billing not configured' }, 503, cors);

    // Identify the buyer from their JWT.
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: 'invalid auth' }, 401, cors);
    const uid = userData.user.id;

    const { sku, successUrl, cancelUrl } = (await req.json().catch(() => ({}))) as {
      sku?: string;
      successUrl?: string;
      cancelUrl?: string;
    };
    const product = sku ? WEB_PRICE_CENTS[sku] : undefined;
    if (!sku || !product) return json({ error: 'unknown sku' }, 400, cors);

    const origin = req.headers.get('Origin') ?? FALLBACK_ORIGIN;
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20' });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: product.cents,
            product_data: { name: `Elector — ${product.label}` },
          },
        },
      ],
      // The webhook reads these to know whom to credit and with what.
      metadata: { user_id: uid, sku },
      success_url: successUrl ?? `${origin}/?purchase=success`,
      cancel_url: cancelUrl ?? `${origin}/?purchase=cancel`,
    });

    return json({ url: session.url }, 200, cors);
  } catch (err) {
    return json({ error: (err as Error).message ?? 'checkout failed' }, 500, cors);
  }
});
