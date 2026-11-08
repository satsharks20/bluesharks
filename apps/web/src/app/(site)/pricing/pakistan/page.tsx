import type { Metadata } from "next";
import { PRICING_ALTERNATES, PricingPage } from "@/components/pricing-page";
import { pricingCopy, requestPricingCurrency } from "@/lib/request-pricing";

export const metadata: Metadata = {
  title: "SAT prep prices in Pakistan (PKR)",
  description: "LUE SAT plans for students in Pakistan, in Pakistani rupees: start free, then Monthly or 3 Months with every past Digital SAT paper and full analytics.",
  alternates: { canonical: "/pricing/pakistan", languages: PRICING_ALTERNATES },
  openGraph: { title: "LUE SAT prices in Pakistan (PKR)", url: "/pricing/pakistan", locale: "en_PK" },
};

export default async function PricingPakistan() {
  const currency = await requestPricingCurrency();
  const copy = pricingCopy(currency);
  return (
    <PricingPage
      currency={currency}
      path="/pricing/pakistan"
      title={copy.title}
      subtitle={copy.subtitle}
    />
  );
}
