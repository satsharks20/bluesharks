import type { Metadata } from "next";
import { PRICING_ALTERNATES, PricingPage } from "@/components/pricing-page";
import { requestPricingCurrency } from "@/lib/request-pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: "LUE SAT plans in PKR for Pakistan and USD for international students. Start free with two full past papers; upgrade for every paper and full analytics.",
  alternates: { canonical: "/pricing", languages: PRICING_ALTERNATES },
  openGraph: { title: "LUE SAT pricing", description: "Plans in PKR for Pakistan and USD worldwide. Start free.", url: "/pricing" },
};

// The current public IP decides for visitors and signed-in students alike.
export default async function Pricing() {
  const currency = await requestPricingCurrency();
  return (
    <PricingPage
      currency={currency}
      path="/pricing"
      title="Simple plans for every SAT timeline"
      subtitle="Start free with two full papers. Upgrade when you want every paper and unlimited practice."
    />
  );
}
