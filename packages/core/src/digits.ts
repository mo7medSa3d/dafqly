/** Eastern Arabic (U+0660–0669) and Extended Arabic-Indic (U+06F0–06F9) digits → Latin. */
const EASTERN = "٠١٢٣٤٥٦٧٨٩";
const EXTENDED = "۰۱۲۳۴۵۶۷۸۹";
export function normalizeDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const e = EASTERN.indexOf(ch);
    if (e >= 0) { out += String(e); continue; }
    const x = EXTENDED.indexOf(ch);
    if (x >= 0) { out += String(x); continue; }
    if (ch === "٫") { out += "."; continue; } // Arabic decimal separator U+066B
    if (ch === "٬") { out += ","; continue; } // Arabic thousands separator U+066C
    out += ch;
  }
  return out;
}
const LATIN_TO_EASTERN = (s: string): string =>
  s.replace(/[0-9]/g, (d) => EASTERN[Number(d)] ?? d).replace(/\./g, "٫").replace(/,/g, "٬");
export function toEasternDigits(input: string): string { return LATIN_TO_EASTERN(input); }
