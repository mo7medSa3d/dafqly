// Generates the F2 golden import fixtures (SYNTHETIC messy files, authored
// for this suite — no real customer data) together with their expected.json
// files. Expectations below are written by hand from the fixture contents,
// NOT produced by the parser under test. Re-run: node scripts/generate-import-fixtures.mjs
import * as XLSX from "xlsx";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/import/test");
mkdirSync(outDir, { recursive: true });

function writeXlsx(name, aoa, merges) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (merges) ws["!merges"] = merges;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, resolve(outDir, name));
}
function writeExpected(name, expected) {
  writeFileSync(resolve(outDir, `${name}.expected.json`), JSON.stringify(expected, null, 2) + "\n");
}
const stats = (total, valid, invalid = 0, empty = 0, duplicate = 0) => ({ total, valid, invalid, empty, duplicate });

// 1. Clean English sheet
writeXlsx("01-clean-en.xlsx", [
  ["Name", "Phone", "Amount", "Due Date", "Reference"],
  ["Ahmed Samir", "01001234567", "1250.50", "2026-11-20", "INV-1"],
  ["Mona Adel", "+201112345678", "300", "2026-11-25", "INV-2"],
  ["Khaled Nour", "00201021234567", "99.99", "2026-12-01", "INV-3"],
]);
writeExpected("01-clean-en.xlsx", {
  existingPhones: {},
  stats: stats(3, 3),
  rows: [
    { rowNumber: 2, status: "valid", phoneE164: "+201001234567", amountMinor: "125050", dueOn: "2026-11-20" },
    { rowNumber: 3, status: "valid", phoneE164: "+201112345678", amountMinor: "30000", dueOn: "2026-11-25" },
    { rowNumber: 4, status: "valid", phoneE164: "+201021234567", amountMinor: "9999", dueOn: "2026-12-01" },
  ],
});

// 2. Arabic headers, Eastern-Arabic digits everywhere
writeXlsx("02-arabic-headers.xlsx", [
  ["اسم العميل", "رقم الهاتف", "المبلغ المستحق", "تاريخ الاستحقاق"],
  ["محمد علي", "٠١٠٠٩٨٧٦٥٤٣", "٢٬٥٠٠٫٧٥", "٢٥/١١/٢٠٢٦"],
  ["سارة محمود", "01007776655", "٤٠٠", "2026-11-28"],
]);
writeExpected("02-arabic-headers.xlsx", {
  existingPhones: {},
  stats: stats(2, 2),
  rows: [
    { rowNumber: 2, status: "valid", phoneE164: "+201009876543", amountMinor: "250075", dueOn: "2026-11-25" },
    { rowNumber: 3, status: "valid", phoneE164: "+201007776655", amountMinor: "40000", dueOn: "2026-11-28" },
  ],
});

// 3. Header on row 3 under title rows
writeXlsx("03-header-row-3.xlsx", [
  ["كشف حسابات العملاء — نوفمبر", null, null],
  ["شركة النيل للتجارة", null, null],
  ["Name", "Phone", "Amount"],
  ["Omar Fathy", "01003334455", "750.25"],
]);
writeExpected("03-header-row-3.xlsx", {
  existingPhones: {},
  stats: stats(1, 1),
  headerRow: 2,
  rows: [{ rowNumber: 4, status: "valid", phoneE164: "+201003334455", amountMinor: "75025" }],
});

// 4. Messy amounts: thousands commas, currency suffix, numeric cells, Arabic comma
writeXlsx("04-messy-amounts.xlsx", [
  ["Name", "Phone", "Amount"],
  ["A One", "01001001001", "1,250.50"],
  ["B Two", "01001001002", "2,000 جنيه"],
  ["C Three", "01001001003", 375.5],
  ["D Four", "01001001004", "١٬٠٠٠٫٥٠"],
  ["E Five", "01001001005", "500 ج.م"],
]);
writeExpected("04-messy-amounts.xlsx", {
  existingPhones: {},
  stats: stats(5, 5),
  rows: [
    { rowNumber: 2, status: "valid", amountMinor: "125050" },
    { rowNumber: 3, status: "valid", amountMinor: "200000" },
    { rowNumber: 4, status: "valid", amountMinor: "37550" },
    { rowNumber: 5, status: "valid", amountMinor: "100050" },
    { rowNumber: 6, status: "valid", amountMinor: "50000" },
  ],
});

// 5. Excel serial dates (44927 = 2023-01-01, 46304 = 2026-10-09)
writeXlsx("05-serial-dates.xlsx", [
  ["Name", "Phone", "Amount", "Due Date"],
  ["Serial One", "01002002001", "100", 44927],
  ["Serial Two", "01002002002", "200", 46304],
]);
writeExpected("05-serial-dates.xlsx", {
  existingPhones: {},
  stats: stats(2, 2),
  rows: [
    { rowNumber: 2, status: "valid", dueOn: "2023-01-01" },
    { rowNumber: 3, status: "valid", dueOn: "2026-10-09" },
  ],
});

// 6. Text dates in a CSV (d/m/Y, d-m-Y, ISO, Arabic digits)
writeFileSync(resolve(outDir, "06-text-dates.csv"),
  "Name,Phone,Amount,Due Date\n" +
  "Text One,01003003001,100,20/11/2026\n" +
  "Text Two,01003003002,200,05-03-2026\n" +
  "Text Three,01003003003,300,2026-12-15\n" +
  "Text Four,01003003004,400,٠١/٠١/٢٠٢٧\n");
writeExpected("06-text-dates.csv", {
  existingPhones: {},
  stats: stats(4, 4),
  rows: [
    { rowNumber: 2, status: "valid", dueOn: "2026-11-20" },
    { rowNumber: 3, status: "valid", dueOn: "2026-03-05" },
    { rowNumber: 4, status: "valid", dueOn: "2026-12-15" },
    { rowNumber: 5, status: "valid", dueOn: "2027-01-01" },
  ],
});

// 7. Bad rows of every kind — all reported, none dropped
writeXlsx("07-bad-rows.xlsx", [
  ["Name", "Phone", "Amount", "Due Date"],
  ["No Phone", "", "100", "2026-11-20"],
  ["Bad Amount", "01004004002", "abc", "2026-11-20"],
  ["", "01004004003", "100", "2026-11-20"],
  ["Bad Date", "01004004004", "100", "next friday"],
  [null, null, null, null],
  ["Good Row", "01004004006", "100", "2026-11-20"],
  ["Negative", "01004004007", "-50", "2026-11-20"],
]);
writeExpected("07-bad-rows.xlsx", {
  existingPhones: {},
  stats: stats(7, 1, 5, 1, 0),
  rows: [
    { rowNumber: 2, status: "invalid", errorField: "phone" },
    { rowNumber: 3, status: "invalid", errorField: "amount" },
    { rowNumber: 4, status: "invalid", errorField: "name" },
    { rowNumber: 5, status: "invalid", errorField: "dueDate" },
    { rowNumber: 6, status: "empty" },
    { rowNumber: 7, status: "valid" },
    { rowNumber: 8, status: "invalid", errorField: "amount" },
  ],
});

// 8. Duplicates: against the tenant's existing debtors and within the file
writeXlsx("08-duplicates.xlsx", [
  ["Name", "Phone", "Amount"],
  ["Existing Debtor", "01005005001", "100"],
  ["Fresh Debtor", "01005005002", "200"],
  ["Fresh Again", "+201005005002", "300"],
]);
writeExpected("08-duplicates.xlsx", {
  existingPhones: { "+201005005001": "existing-debtor-id" },
  stats: stats(3, 1, 0, 0, 2),
  rows: [
    { rowNumber: 2, status: "duplicate", duplicateDebtorId: "existing-debtor-id" },
    { rowNumber: 3, status: "valid" },
    { rowNumber: 4, status: "duplicate", duplicateOfRow: 3 },
  ],
});

// 9. Merged cells: the debtor name spans two invoice rows
writeXlsx("09-merged-cells.xlsx", [
  ["Name", "Phone", "Amount"],
  ["Merged Name", "01006006001", "100"],
  [null, "01006006002", "200"],
], [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }]);
writeExpected("09-merged-cells.xlsx", {
  existingPhones: {},
  stats: stats(2, 2),
  rows: [
    { rowNumber: 2, status: "valid", name: "Merged Name" },
    { rowNumber: 3, status: "valid", name: "Merged Name" },
  ],
});

// 10. Landline (valid debtor, not WhatsApp-capable) and a nonsense phone
writeXlsx("10-phones.xlsx", [
  ["Name", "Phone", "Amount"],
  ["Landline Shop", "0223456789", "100"],
  ["Nonsense", "12345", "100"],
  ["Mobile Ok", "01007007001", "100"],
]);
writeExpected("10-phones.xlsx", {
  existingPhones: {},
  stats: stats(3, 2, 1, 0, 0),
  rows: [
    { rowNumber: 2, status: "valid", phoneE164: "+20223456789", whatsappCapable: false },
    { rowNumber: 3, status: "invalid", errorField: "phone" },
    { rowNumber: 4, status: "valid", whatsappCapable: true },
  ],
});

// 11. A 5,000-row file
{
  const aoa = [["Name", "Phone", "Amount", "Due Date"]];
  for (let i = 0; i < 5000; i++) aoa.push([`Bulk ${i}`, `0100${String(1000000 + i)}`, "10.00", "2026-11-20"]);
  writeXlsx("11-big-5000.xlsx", aoa);
  writeExpected("11-big-5000.xlsx", {
    existingPhones: {},
    stats: stats(5000, 5000),
    rows: [
      { rowNumber: 2, status: "valid", amountMinor: "1000" },
      { rowNumber: 5001, status: "valid", amountMinor: "1000" },
    ],
  });
}

// 12. CSV with quoted commas and an Arabic-comma amount
writeFileSync(resolve(outDir, "12-quoted-csv.csv"),
  "Name,Phone,Amount,Notes\n" +
  "\"Ali, Ahmed\",01008008001,\"1,250.50\",\"paid half, rest later\"\n" +
  "\"بائع, الجملة\",01008008002,\"٣٬٠٠٠\",\"ملاحظة, مهمة\"\n");
writeExpected("12-quoted-csv.csv", {
  existingPhones: {},
  stats: stats(2, 2),
  rows: [
    { rowNumber: 2, status: "valid", amountMinor: "125050", name: "Ali, Ahmed" },
    { rowNumber: 3, status: "valid", amountMinor: "300000" },
  ],
});

console.log("fixtures written to", outDir);
