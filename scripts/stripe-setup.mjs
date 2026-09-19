#!/usr/bin/env node
// Billing (SPEC.md §24): configure a Stripe account for Unitos, the way the
// Dashboard steps of Stripe's Billing quickstart would, by API and
// idempotently. Run it again any time: it changes only what differs.
//
//   1. One product per tier (Unitos Premium, Unitos Ultra), found by the
//      metadata unitos_tier; created when missing.
//   2. A monthly and a yearly price on each, found by their lookup keys
//      (unitos_premium_monthly, …). A price whose amount or currency changed
//      is archived and a new price takes its lookup key: subscriptions on the
//      old price keep it.
//   3. The webhook endpoint <origin>/api/stripe/webhook with the events
//      lib/billing/events.ts handles. Its signing secret prints once, at
//      creation: after that it is in the Dashboard (Workbench → Webhooks).
//   4. The customer portal (Manage subscription): switch tier, cancel at the
//      period's end, update the card, see invoices.
//   5. The env lines to set: the four STRIPE_PRICE_* ids and, when the
//      endpoint was created now, STRIPE_WEBHOOK_SECRET.
//
// Usage (amounts in major units of the currency, dollars not cents):
//
//   STRIPE_SECRET_KEY=rk_live_… node scripts/stripe-setup.mjs \
//     --origin https://unitosnotebook.com --currency usd \
//     --premium-monthly 9.99 --premium-yearly 95.88 \
//     --ultra-monthly 19.99 --ultra-yearly 191.88 [--tax-code txcd_10103001]
//
// The key needs write access to products, prices, webhook endpoints, and the
// customer portal configuration: a restricted key with those, or the
// account's secret key once. A test key configures the sandbox, a live key
// the live account: the two are separate, run it for each.

import Stripe from "stripe";

const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "charge.refunded",
];

const TIERS = {
  PREMIUM: { name: "Unitos Premium", env: "PREMIUM" },
  ULTRA: { name: "Unitos Ultra", env: "ULTRA" },
};
const INTERVALS = ["month", "year"];
const ENV_INTERVAL = { month: "MONTHLY", year: "YEARLY" };

// Currencies Stripe bills in whole units (lib/billing/format.ts).
const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd", "clp", "isk", "huf", "twd", "ugx"]);

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`--${key} needs a value`);
    out[key] = value;
    i++;
  }
  return out;
}

function fail(message) {
  console.error(`stripe-setup: ${message}`);
  process.exit(1);
}

function minorUnits(text, currency, flag) {
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) fail(`--${flag} must be a positive amount, got "${text}"`);
  const amount = ZERO_DECIMAL.has(currency) ? Math.round(value) : Math.round(value * 100);
  if (amount <= 0) fail(`--${flag} rounds to nothing`);
  return amount;
}

function lookupKey(tier, interval) {
  return `unitos_${tier.toLowerCase()}_${interval === "year" ? "yearly" : "monthly"}`;
}

const opts = args(process.argv.slice(2));
const key = process.env.STRIPE_SECRET_KEY;
if (!key) fail("STRIPE_SECRET_KEY is not set");
const origin = (opts.origin ?? "").replace(/\/$/, "");
if (!/^https?:\/\//.test(origin)) fail("--origin must be the site's origin, e.g. https://unitosnotebook.com");
const currency = (opts.currency ?? "usd").toLowerCase();
const amounts = {};
for (const tier of Object.keys(TIERS)) {
  for (const interval of INTERVALS) {
    const flag = `${tier.toLowerCase()}-${interval === "year" ? "yearly" : "monthly"}`;
    if (!opts[flag]) fail(`--${flag} is required`);
    amounts[`${tier}:${interval}`] = minorUnits(opts[flag], currency, flag);
  }
}
const taxCode = opts["tax-code"] ?? "";
const live = key.includes("_live_");

const stripe = new Stripe(key, { appInfo: { name: "Unitos setup" } });
const log = (line) => console.log(line);
log(`Configuring the ${live ? "LIVE" : "test"} account for ${origin} in ${currency.toUpperCase()}.`);

// 1. Products. Found by listing, not Search: Search lags a minute behind a
// write, and a rerun inside that minute would create the product twice.
// With more than one active product for a tier, the one that holds the
// tier's monthly price wins, else the oldest; the others are named so the
// operator can archive them in the Dashboard.
async function ensureProduct(tier) {
  const all = (await stripe.products.list({ active: true, limit: 100 })).data.filter(
    (p) => p.metadata?.unitos_tier === tier,
  );
  const monthly = (await stripe.prices.list({ lookup_keys: [lookupKey(tier, "month")], active: true, limit: 1 })).data[0];
  let product = all.find((p) => p.id === monthly?.product) ?? all[all.length - 1];
  if (all.length > 1) {
    const extras = all.filter((p) => p.id !== product.id).map((p) => p.id);
    log(`Warning: ${all.length} active products carry unitos_tier=${tier}; using ${product.id}, archive ${extras.join(", ")} in the Dashboard`);
  }
  if (!product) {
    product = await stripe.products.create({
      name: TIERS[tier].name,
      metadata: { unitos_tier: tier },
      ...(taxCode ? { tax_code: taxCode } : {}),
    });
    log(`Created product ${product.id} (${product.name})`);
  } else {
    const patch = {};
    if (product.name !== TIERS[tier].name) patch.name = TIERS[tier].name;
    if (taxCode && product.tax_code !== taxCode) patch.tax_code = taxCode;
    if (Object.keys(patch).length > 0) {
      product = await stripe.products.update(product.id, patch);
      log(`Updated product ${product.id} (${Object.keys(patch).join(", ")})`);
    } else {
      log(`Product ${product.id} (${product.name}) is in place`);
    }
  }
  return product;
}

// 2. Prices.
async function ensurePrice(product, tier, interval) {
  const lookup = lookupKey(tier, interval);
  const amount = amounts[`${tier}:${interval}`];
  const found = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 2 });
  const current = found.data[0];
  const same =
    current &&
    current.product === product.id &&
    current.currency === currency &&
    current.unit_amount === amount &&
    current.recurring?.interval === interval &&
    current.recurring?.interval_count === 1;
  if (same) {
    log(`Price ${current.id} (${lookup}: ${amount} ${currency} / ${interval}) is in place`);
    return current;
  }
  const price = await stripe.prices.create({
    product: product.id,
    currency,
    unit_amount: amount,
    recurring: { interval },
    lookup_key: lookup,
    transfer_lookup_key: true,
    metadata: { unitos_tier: tier, unitos_interval: interval },
  });
  log(`Created price ${price.id} (${lookup}: ${amount} ${currency} / ${interval})`);
  if (current) {
    await stripe.prices.update(current.id, { active: false });
    log(`Archived price ${current.id} (was ${current.unit_amount} ${current.currency} / ${current.recurring?.interval})`);
  }
  return price;
}

// 3. The webhook endpoint.
async function ensureWebhook() {
  const url = `${origin}/api/stripe/webhook`;
  const all = await stripe.webhookEndpoints.list({ limit: 100 });
  const found = all.data.find((e) => e.url === url);
  if (!found) {
    const endpoint = await stripe.webhookEndpoints.create({
      url,
      enabled_events: EVENTS,
      description: "Unitos billing (lib/billing/events.ts)",
    });
    log(`Created webhook endpoint ${endpoint.id} for ${url}`);
    return endpoint.secret ?? "";
  }
  const missing = EVENTS.filter((e) => !found.enabled_events.includes(e) && !found.enabled_events.includes("*"));
  if (missing.length > 0 || found.status !== "enabled") {
    await stripe.webhookEndpoints.update(found.id, { enabled_events: EVENTS, disabled: false });
    log(`Updated webhook endpoint ${found.id}: added ${missing.join(", ") || "nothing"}${found.status !== "enabled" ? ", enabled" : ""}`);
  } else {
    log(`Webhook endpoint ${found.id} for ${url} is in place`);
  }
  return "";
}

// 4. The customer portal.
async function ensurePortal(products, prices) {
  const config = {
    business_profile: {
      privacy_policy_url: `${origin}/privacy`,
      terms_of_service_url: `${origin}/terms`,
    },
    default_return_url: `${origin}/billing`,
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "create_prorations",
        products: Object.keys(TIERS).map((tier) => ({
          product: products[tier].id,
          prices: INTERVALS.map((interval) => prices[`${tier}:${interval}`].id),
        })),
      },
    },
  };
  const existing = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  const current = existing.data[0];
  if (current) {
    await stripe.billingPortal.configurations.update(current.id, config);
    log(`Updated the customer portal configuration ${current.id}`);
  } else {
    const created = await stripe.billingPortal.configurations.create(config);
    log(`Created the customer portal configuration ${created.id}`);
  }
}

const products = {};
const prices = {};
for (const tier of Object.keys(TIERS)) {
  products[tier] = await ensureProduct(tier);
  for (const interval of INTERVALS) {
    prices[`${tier}:${interval}`] = await ensurePrice(products[tier], tier, interval);
  }
}
const webhookSecret = await ensureWebhook();
await ensurePortal(products, prices);

// 5. The env lines.
log("");
log("Set these in the environment (Vercel → Settings → Environment Variables), then redeploy and turn billing on at /admin/billing:");
for (const tier of Object.keys(TIERS)) {
  for (const interval of INTERVALS) {
    log(`STRIPE_PRICE_${TIERS[tier].env}_${ENV_INTERVAL[interval]}=${prices[`${tier}:${interval}`].id}`);
  }
}
if (webhookSecret) {
  log(`STRIPE_WEBHOOK_SECRET=${webhookSecret}`);
} else {
  log("STRIPE_WEBHOOK_SECRET=<the endpoint's signing secret: Dashboard → Workbench → Webhooks → the endpoint → Reveal>");
}
log("STRIPE_SECRET_KEY=<a restricted key for the app: Checkout Sessions write, Customers write, Customer portal write, Subscriptions read, Invoices read, Prices read>");
