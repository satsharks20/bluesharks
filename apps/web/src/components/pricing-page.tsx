// The pricing page body, shared by /pricing and the two hreflang routes. All three receive the
// currency selected from the current request IP; route names no longer override geolocation.
import type { Metadata } from "next";
import { PRICING_PLAN_IDS, parsePrice, type Currency, type PricingContent } from "@satsharks/types";
import { PricingPlans } from "@/app/(site)/pricing/pricing-plans";
import { SITE_NAME, absoluteUrl } from "@/lib/site";
import { JsonLd, breadcrumbLd } from "./json-ld";

// hreflang: Pakistan's page for en-PK, the international page for everyone else, /pricing as default.
export const PRICING_ALTERNATES: NonNullable<Metadata["alternates"]>["languages"] = {
  "en-PK": "/pricing/pakistan",
  en: "/pricing/international",
  "x-default": "/pricing",
};

// The plans as the API serves them (Admin → Settings), for the structured data. Missing when the
// API cannot be reached (e.g. during a build); the page itself loads them in the browser anyway.
async function loadPricing(): Promise<PricingContent | null> {
  try {
    const response = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}/api/pricing`, { next: { revalidate: 600 }, signal: AbortSignal.timeout(4000) });
    const body = (await response.json()) as { ok: boolean; data?: PricingContent };
    return body.ok && body.data ? body.data : null;
  } catch {
    return null;
  }
}

function offersLd(pricing: PricingContent, currencies: Currency[], path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${SITE_NAME} Digital SAT practice`,
    description: "Real past Digital SAT papers in a Bluebook-style test screen, adaptive mocks, drills, a predicted score and analytics.",
    brand: { "@type": "Brand", name: SITE_NAME },
    url: absoluteUrl(path),
    offers: pricing.plans
      .filter((plan) => (PRICING_PLAN_IDS as readonly string[]).includes(plan.id))
      .flatMap((plan) =>
        currencies.map((currency) => ({
          "@type": "Offer",
          name: `${plan.name} (${currency})`,
          price: plan.id === "free" ? 0 : (parsePrice(plan.price[currency]) ?? undefined),
          priceCurrency: currency,
          availability: "https://schema.org/InStock",
          url: absoluteUrl(path),
          eligibleRegion: currency === "PKR" ? { "@type": "Country", name: "Pakistan" } : undefined,
        })),
      )
      .filter((offer) => offer.price !== undefined),
  };
}

export async function PricingPage({ currency, path, title, subtitle }: { currency: Currency; path: string; title: string; subtitle: string }) {
  const pricing = await loadPricing();
  const currencies: Currency[] = [currency];
  return (
    <div className="py-6 sm:py-10">
      {pricing && <JsonLd data={offersLd(pricing, currencies, path)} />}
      <JsonLd data={breadcrumbLd([{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }, ...(path !== "/pricing" ? [{ name: title, path }] : [])])} />
      <header className="mx-auto mb-8 max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-[40px] sm:leading-tight">{title}</h1>
        <p className="mt-3 text-slate-600">{subtitle}</p>
      </header>
      <PricingPlans initialCurrency={currency} />
    </div>
  );
}
