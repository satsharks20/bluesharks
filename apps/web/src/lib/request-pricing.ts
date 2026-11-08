import { headers } from "next/headers";
import { currencyForIpCountry, type Currency } from "@satsharks/types";

// Vercel supplies a two-letter country derived from the requester's public IP. PKR is allowed only
// when Pakistan is positively identified; a missing/invalid location fails closed to USD instead of
// accidentally giving local pricing to an international visitor.
export async function requestPricingCurrency(): Promise<Currency> {
  const country = (await headers()).get("x-vercel-ip-country");
  return currencyForIpCountry(country);
}

export function pricingCopy(currency: Currency): { title: string; subtitle: string } {
  return currency === "PKR"
    ? {
        title: "SAT prep prices in Pakistan",
        subtitle: "Plans in Pakistani rupees for your current location. Start free with two full past papers; upgrade when you want every paper.",
      }
    : {
        title: "SAT prep prices for international students",
        subtitle: "Plans in US dollars for your current location outside Pakistan. Start free with two full past papers.",
      };
}
