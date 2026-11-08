"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney, PAID_PLANS, PAYMENT_METHOD_LABELS, type Checkout, type CheckoutOption, type PaidPlan, type PaymentSummary } from "@satsharks/types";
import { Button, Card, Notice, PageHeader, Spinner } from "@/components/ui";
import { WHATSAPP_LINK } from "@/components/whatsapp-button";
import { api } from "@/lib/api";
import { BILLING_QUERY_KEY, formatDate } from "@/lib/billing";
import { usePricing } from "@/lib/pricing";

const inputClass = "mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500";

function CheckoutView() {
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const plan = (PAID_PLANS as readonly string[]).includes(search.get("plan") ?? "") ? (search.get("plan") as PaidPlan) : "three_months";
  const offer = search.get("offer") === "1";
  const checkout = useQuery({ queryKey: ["billing", "checkout", plan, offer], queryFn: () => api<Checkout>(`/api/billing/checkout?plan=${plan}${offer ? "&offer=1" : ""}`) });
  const pricing = usePricing();
  const [method, setMethod] = useState<CheckoutOption["method"] | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<PaymentSummary | null>(null);

  const data = checkout.data;
  useEffect(() => {
    if (data && method === null && data.methods[0]) setMethod(data.methods[0].method);
  }, [data, method]);

  if (checkout.isLoading) return <Spinner label="Preparing checkout" />;
  if (checkout.error || !data) {
    return (
      <Notice tone="error">
        {checkout.error?.message ?? "Checkout could not be opened."}{" "}
        <Link href="/pricing" className="font-bold underline">
          Back to plans
        </Link>
      </Notice>
    );
  }
  const chosen = data.methods.find((entry) => entry.method === method) ?? null;

  async function payByCard() {
    setBusy(true);
    setError(null);
    try {
      const { redirectUrl } = await api<{ redirectUrl: string }>("/api/billing/card", { method: "POST", body: { plan, currency: data!.currency, offer } });
      window.location.href = redirectUrl;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the card payment");
      setBusy(false);
    }
  }

  async function sendTransfer() {
    if (!chosen || chosen.method === "card") return;
    setBusy(true);
    setError(null);
    try {
      const { payment } = await api<{ payment: PaymentSummary }>("/api/billing/payments", {
        method: "POST",
        body: { plan, currency: data!.currency, method: chosen.method, reference: reference.trim(), note: note.trim(), offer },
      });
      setSent(payment);
      await queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEY });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the payment details");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Card className="mx-auto max-w-xl text-center">
        <h2 className="text-xl font-bold">Thank you! We have your payment details</h2>
        <p className="mt-2 text-sm text-slate-600">
          We check every transfer by hand, usually within a few hours. As soon as your {formatMoney(sent.amount, sent.currency)} is confirmed, your account is upgraded and you get a
          receipt by email.
        </p>
        <Link href="/billing" className="mt-5 inline-block rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-600">
          Go to Plan &amp; billing
        </Link>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div className="grid gap-4">
        {data.waiting && (
          <Notice tone="info">
            A {PAYMENT_METHOD_LABELS[data.waiting.method]} payment of {formatMoney(data.waiting.amount, data.waiting.currency)} is already waiting for approval. We will email you once it
            is checked; there is no need to pay again.
          </Notice>
        )}
        {data.methods.length === 0 ? (
          <Card>
            <h2 className="font-bold">Online payment is not open yet</h2>
            <p className="mt-1 text-sm text-slate-600">Message us on WhatsApp and we will help you pay and upgrade your account straight away.</p>
            <a href={WHATSAPP_LINK} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block rounded-lg bg-[#25D366] px-5 py-2.5 text-sm font-bold text-white">
              Message LUE SAT
            </a>
          </Card>
        ) : (
          <Card>
            <h2 className="font-bold">How would you like to pay?</h2>
            <div role="radiogroup" aria-label="Payment method" className="mt-3 grid gap-2 sm:grid-cols-2">
              {data.methods.map((entry) => (
                <button
                  key={entry.method}
                  type="button"
                  role="radio"
                  aria-checked={method === entry.method}
                  onClick={() => setMethod(entry.method)}
                  className={`min-h-12 cursor-pointer rounded-xl border px-4 text-left text-sm font-bold ${method === entry.method ? "border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500" : "border-slate-300 hover:bg-slate-50"}`}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {chosen?.method === "card" && (
              <div className="mt-5">
                <p className="text-sm text-slate-600">You will pay on a secure card page and come straight back. Your account is upgraded the moment the payment goes through.</p>
                <Button className="mt-4 w-full sm:w-auto" disabled={busy} onClick={payByCard}>
                  {busy ? "Opening…" : `Pay ${formatMoney(data.amount, data.currency)} by card`}
                </Button>
              </div>
            )}

            {chosen && chosen.method !== "card" && (
              <div className="mt-5 grid gap-4">
                <div>
                  <p className="text-sm font-bold">1. Send {formatMoney(data.amount, data.currency)} to:</p>
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-300 bg-slate-50 p-4 font-sans text-sm">{chosen.instructions}</pre>
                </div>
                <div>
                  <p className="text-sm font-bold">2. Tell us the transaction ID from your receipt</p>
                  <label className="mt-2 block text-xs font-bold">
                    Transaction ID / reference
                    <input className={inputClass} value={reference} maxLength={80} onChange={(event) => setReference(event.target.value)} placeholder="e.g. 0123456789" />
                  </label>
                  <label className="mt-3 block text-xs font-bold">
                    Note (optional)
                    <input className={inputClass} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Sender name or account, if different from yours" />
                  </label>
                </div>
                <Button disabled={busy || reference.trim().length < 4 || !!data.waiting} onClick={sendTransfer}>
                  {busy ? "Sending…" : "I have paid: send for approval"}
                </Button>
              </div>
            )}
            {error && (
              <div className="mt-4">
                <Notice tone="error">{error}</Notice>
              </div>
            )}
          </Card>
        )}
      </div>

      <Card className="lg:sticky lg:top-4">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Order</p>
        <h2 className="mt-1 text-xl font-bold">{data.planName}</h2>
        <p className="mt-3 flex flex-wrap items-baseline gap-2">
          <span className="text-3xl font-bold">{formatMoney(data.amount, data.currency)}</span>
          {data.discountPercent > 0 && <span className="text-sm text-slate-500 line-through">{formatMoney(data.listAmount, data.currency)}</span>}
        </p>
        {data.discountPercent > 0 && <p className="mt-1 text-sm font-bold text-green-700">Your one-time offer: {data.discountPercent}% off</p>}
        <p className="mt-3 text-sm text-slate-600">
          Everything unlocked from {formatDate(data.periodStart)} to {formatDate(data.periodEnd)}.
          {new Date(data.periodStart).getTime() > Date.now() + 60_000 && " It starts when your current plan ends, so you lose no days."}
        </p>
        <ul className="mt-4 space-y-1.5 text-sm">
          <li>Every past paper, plus each new one</li>
          <li>Unlimited drills</li>
          <li>Full analytics: score range, every skill, errors and timing</li>
          <li>3 streak freezes a month</li>
        </ul>
        {pricing.data?.tagline && <p className="mt-4 text-xs font-medium text-slate-600">{pricing.data.tagline}</p>}
        <p className="mt-2 text-xs text-slate-500">
          Prices in {data.currency}, based on your current IP location and verified again when you pay. Nothing is charged automatically; renewing is your choice. {pricing.data?.refundPolicy}
        </p>
        <Link href="/pricing" className="mt-4 inline-block text-sm font-bold text-brand-500 hover:underline">
          ← Change plan
        </Link>
      </Card>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <>
      <PageHeader title="Checkout" subtitle="Pay once for the plan you chose. Your account is upgraded as soon as the payment is confirmed." />
      <Suspense fallback={<Spinner label="Preparing checkout" />}>
        <CheckoutView />
      </Suspense>
    </>
  );
}
