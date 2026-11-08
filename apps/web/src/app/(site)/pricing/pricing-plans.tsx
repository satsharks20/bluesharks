"use client";

import Link from "next/link";
import { homePath, isStaffUser, useMe } from "@/lib/auth";
import { ExitOffer } from "@/components/exit-offer";
import { StudentProof } from "@/components/student-proof";
import { Notice, Spinner } from "@/components/ui";
import { usePricing, type Currency } from "@/lib/pricing";

// The server page supplies the currency derived from the current public IP. There is deliberately
// no account override or browser switch: checkout independently enforces the same IP rule.

function Check() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="mt-0.5 h-5 w-5 flex-none text-brand-500"
      fill="currentColor"
    >
      <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0z" />
    </svg>
  );
}

export function PricingPlans({
  initialCurrency = "USD",
}: {
  initialCurrency?: Currency;
}) {
  const { data: user } = useMe();
  const pricing = usePricing();
  const currency = initialCurrency;
  const checkoutHref = (planId: string) => `/checkout?plan=${planId}`;

  if (pricing.isLoading) return <Spinner label="Loading plans" />;
  if (pricing.error || !pricing.data)
    return (
      <Notice tone="error">
        The plans could not be loaded. Please try again.
      </Notice>
    );
  const { plans, comparison, tagline, schoolsNote, refundPolicy } =
    pricing.data;

  return (
    <>
      <p className="text-center text-sm font-medium text-slate-600">
        {currency === "PKR" ? "Prices in PKR for your current location in Pakistan." : "Prices in USD for your current location outside Pakistan."} Currency is verified again at
        checkout.
      </p>

      <div className="mx-auto mt-8 grid max-w-6xl gap-4 lg:grid-cols-3">
        {plans.map((plan) => {
          const paid = plan.id !== "free";
          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border bg-white p-6 ${plan.popular ? "border-brand-500 ring-2 ring-brand-500" : "border-slate-900"}`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-6 rounded-full bg-brand-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
                  Most popular
                </span>
              )}
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{plan.name}</h2>
                {plan.saving && (
                  <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-bold text-green-700">
                    {plan.saving[currency]}
                  </span>
                )}
              </div>
              <p className="mt-4 flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-[34px] font-bold leading-none tracking-tight">
                  {plan.price[currency]}
                </span>
                <span className="text-sm text-slate-500">{plan.period}</span>
              </p>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {plan.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-2">
                    <Check />
                    {highlight}
                  </li>
                ))}
              </ul>
              <div className="mt-7">
                {!paid ? (
                  <Link
                    href={user ? homePath(user) : "/register"}
                    className="flex h-11 w-full items-center justify-center rounded-lg border border-slate-900 bg-white text-sm font-bold transition hover:bg-slate-50"
                  >
                    {user ? "Go to your dashboard" : "Create a free account"}
                  </Link>
                ) : user && isStaffUser(user) ? (
                  <button
                    type="button"
                    disabled
                    className="h-11 w-full cursor-not-allowed rounded-lg bg-brand-500 text-sm font-bold text-white opacity-60"
                  >
                    Student accounts only
                  </button>
                ) : user ? (
                  <Link
                    href={checkoutHref(plan.id)}
                    className="flex h-11 w-full items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white transition hover:bg-brand-600"
                  >
                    {user.plan === "paid"
                      ? `Renew with ${plan.name}`
                      : `Choose ${plan.name}`}
                  </Link>
                ) : (
                  <Link
                    href={`/register?next=${encodeURIComponent(checkoutHref(plan.id))}`}
                    className="flex h-11 w-full items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white transition hover:bg-brand-600"
                  >
                    Get started
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {tagline && (
        <p className="mt-6 text-center text-sm font-medium text-slate-600">
          {tagline}
        </p>
      )}
      {refundPolicy && (
        <p className="mt-2 text-center text-xs font-bold text-slate-700">
          {refundPolicy}
        </p>
      )}

      <section className="mt-14">
        <h2 className="text-center text-2xl font-bold tracking-tight">
          Free vs paid
        </h2>
        <div className="mx-auto mt-6 max-w-4xl overflow-hidden rounded-2xl border border-slate-900 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-900 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="px-4 py-3 sm:px-6">
                  Feature
                </th>
                <th scope="col" className="w-[26%] px-3 py-3">
                  Free
                </th>
                <th
                  scope="col"
                  className="w-[30%] px-3 py-3 text-brand-600 sm:px-6"
                >
                  Paid
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {comparison.map((row) => (
                <tr key={row.feature}>
                  <th scope="row" className="px-4 py-3 font-medium sm:px-6">
                    {row.feature}
                  </th>
                  <td className="px-3 py-3 text-slate-600">{row.free}</td>
                  <td className="px-3 py-3 font-bold sm:px-6">{row.paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {schoolsNote && (
          <p className="mx-auto mt-5 max-w-2xl text-center text-sm text-slate-600">
            {schoolsNote}
          </p>
        )}
      </section>

      <StudentProof />
      <ExitOffer />
    </>
  );
}
