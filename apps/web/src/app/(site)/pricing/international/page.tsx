import type { Metadata } from "next";
import { PRICING_ALTERNATES, PricingPage } from "@/components/pricing-page";
import { pricingCopy, requestPricingCurrency } from "@/lib/request-pricing";

export const metadata: Metadata = {
  title: "SAT prep prices for international students (USD)",
  description: "LUE SAT plans for students outside Pakistan, in US dollars: start free, then Monthly or 3 Months with every past Digital SAT paper and full analytics.",
  alternates: { canonical: "/pricing/international", languages: PRICING_ALTERNATES },
  openGraph: { title: "LUE SAT prices for international students (USD)", url: "/pricing/international" },
};

export default async function PricingInternational() {
  const currency = await requestPricingCurrency();
  const copy = pricingCopy(currency);
  return (
    <PricingPage
      currency={currency}
      path="/pricing/international"
      title={copy.title}
      subtitle={copy.subtitle}
    />
  );
}
