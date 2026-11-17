const HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };

/**
 * Online debtor checkout is disabled: Paymob is reserved strictly for
 * platform SaaS subscriptions in billing.ts. Debtors pay using the merchant's
 * offline paymentInstructions and upload a receipt on the statement portal.
 */
export async function POST(): Promise<Response> {
  return Response.json(
    {
      error: {
        code: "GATEWAY_DISABLED",
        message: "Online debtor checkout is disabled; please use the merchant's payment instructions and upload a receipt.",
      },
    },
    { status: 410, headers: HEADERS },
  );
}
