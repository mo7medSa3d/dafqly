# DAFQLY email brand assets

Assets for transactional email (receipts, reminders, statements). Email is not the web:
most clients block external images by default, none of them run JavaScript, and layout
must be table-based — so the header ships as a pre-rendered PNG plus a table snippet,
not as SVG or web fonts.

## Files

| File | What it is |
| --- | --- |
| `email-header.png` | 1200×240 px header banner (2× for a 600×120 display size). White background, colour DAFQLY horizontal lockup (outlined paths, no font dependency) left-aligned, 4 px teal `#27C7A5` rule along the bottom edge. |
| `email-header.html` | Minimal table-based snippet (`role="presentation"`, inline styles only) that drops the header at the top of an email body. Alt text: "DAFQLY — Track. Follow. Get Paid." |

## Usage

1. Paste the table from `email-header.html` at the top of the email `<body>`, above the
   content table.
2. **Host or inline the image — a relative `src` does not work in a sent email.**
   Pick one before sending:
   - Host `email-header.png` at a public HTTPS URL (e.g. the app's static assets) and
     replace `src="email-header.png"` with that absolute URL, or
   - Attach it as a CID inline image in the message MIME and use `src="cid:dafqly-header"`.
3. Keep the `width="600" height="120"` attributes and the inline `display:block` style —
   Outlook desktop relies on the attributes, and the style prevents gaps under the image.
4. Because clients may block the image, the email must still make sense without it:
   keep the sender name as "DAFQLY" and repeat any critical information as real text in
   the body. Never put essential content only inside the header image.

## Brand values used

- Navy `#14243A` (wordmark + symbol), teal `#27C7A5` (symbol flow + bottom rule),
  white `#FFFFFF` background.
- The wordmark in the PNG is rendered from the outlined lockup
  (`packages/brand/logo/wordmark-horizontal-outlined.svg`, Plus Jakarta Sans ExtraBold
  converted to paths), so it looks identical in every client with no font installed.
