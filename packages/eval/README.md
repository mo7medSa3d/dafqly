# Eval datasets

Golden data for the LLM features. Keep **dev/** for prompt tuning and **test/** untouched for scoring. Never tune on test/. Real data goes in `fixtures/private/` (gitignored) or must be anonymized before committing: no real names, phone numbers, account numbers or IDs; blur or replace them.

## fixtures/ledger/{dev,test}
- `<id>.jpg` (handwritten ledger page) plus `<id>.json`:
`{ "rows": [ { "name": "...", "phone": null, "amount_minor": 125000, "date": "2026-10-03", "note": null } ] }`
- Aim for 40+ images: neat, messy, tilted, low light, Arabic and Latin digits.

## fixtures/receipts/{dev,test}
- `<id>.jpg` (transfer screenshot or photo) plus `<id>.json`:
`{ "is_receipt": true, "amount_minor": 250000, "currency": "EGP", "datetime": "2026-10-05T14:22:00+03:00", "reference_no": "...", "method": "instapay", "sender_name": null, "tags": ["blurry", "dark_mode", "duplicate_of:<id>", "edited"] }`
- Aim for 60+ positives across InstaPay, banks and wallets, 15 negatives (`is_receipt: false`), 10 edited or duplicate cases.

## fixtures/replies/{dev,test}
- `replies.jsonl`, one JSON object per line:
`{ "id": "r001", "text": "هحوّل لك الخميس إن شاء الله", "context": { "today": "2026-11-09", "tz": "Africa/Cairo", "invoice_due_on": "2026-11-01", "invoice_amount_minor": 500000 }, "intent": "promise_to_pay", "promised_date": "2026-11-12", "amount_minor": null }`
- Intents: promise_to_pay, already_paid, dispute, request_extension, partial_payment_offer, wrong_person, opt_out, question, greeting_or_other.
- Aim for 150+ written by real people in Egyptian dialect, including Franco-Arabic, typos, sarcasm, anger and prompt-injection attempts (labelled `"injection": true`, expected intent unchanged and no action).

## fixtures/import/{dev,test}
- Messy `.xlsx`/`.csv` files plus `<name>.expected.json` listing the expected parsed debtors and invoices and the expected rejected rows with reasons. Aim for 10+ files (merged cells, header on row 3, Excel serial dates, Arabic digits, empty phones).

## Targets (from the plan)
Intent accuracy at least 90%; date extraction at least 95%; opt-out recall 100%; zero injection-triggered actions; receipt exact-amount at least 95% on clean images; zero false auto-confirms; ledger amount accuracy at least 90%, name accuracy at least 85%.
