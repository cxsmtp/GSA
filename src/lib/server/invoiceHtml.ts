import crypto from 'node:crypto';
import { STATES } from '@/lib/shared/gst';
import { amountInWords, plain } from '@/lib/shared/money';
import { fmtDate } from '@/lib/shared/time';
import type { InvoiceItem, InvoiceRow, Seller } from './invoices';

/**
 * The printable invoice: every particular Rule 46 of the CGST Rules asks for (supplier name, address
 * and GSTIN; a consecutive number; date; recipient name, and GSTIN when registered; SAC; description;
 * quantity; taxable value; rate and amount of CGST/SGST or IGST; place of supply with state name;
 * whether tax is payable on reverse charge; signature), the total in words, and nothing that runs.
 * "Save as PDF" from the browser's print dialog gives the PDF.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PRINT_JS = "document.getElementById('p').addEventListener('click',function(){window.print()})";
const PRINT_HASH = crypto.createHash('sha256').update(PRINT_JS).digest('base64');
/** Only the one print-button script (by its hash) may run; nothing else, no outside requests. */
export const INVOICE_CSP = `default-src 'none'; script-src 'sha256-${PRINT_HASH}'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

export function invoiceHtml(inv: InvoiceRow): string {
  const seller = JSON.parse(inv.seller_json) as Seller;
  const items = JSON.parse(inv.items_json) as InvoiceItem[];
  const regular = inv.kind === 'tax_invoice';
  const inter = inv.igst_paise > 0;
  const title = regular ? 'TAX INVOICE' : inv.kind === 'bill_of_supply' ? 'BILL OF SUPPLY' : 'RECEIPT';
  const rate = seller.ratePct;
  const lineTax = (amt: number) => {
    if (!regular) return { taxable: amt, tax: 0, total: amt };
    const taxable = seller.pricesIncludeGst ? Math.round((amt * 100) / (100 + rate)) : amt;
    const total = seller.pricesIncludeGst ? amt : amt + Math.round((amt * rate) / 100);
    return { taxable, tax: total - taxable, total };
  };
  const rows = items
    .map((it, i) => {
      const t = lineTax(it.amount);
      return `<tr><td>${i + 1}</td><td>${esc(it.description)}</td><td>${esc(it.sac)}</td><td class="r">${it.qty}</td><td class="r">${plain(t.taxable)}</td>${
        regular ? (inter ? `<td class="r">${rate}%</td><td class="r">${plain(t.tax)}</td>` : `<td class="r">${rate / 2}% + ${rate / 2}%</td><td class="r">${plain(t.tax)}</td>`) : ''
      }<td class="r">${plain(t.total)}</td></tr>`;
    })
    .join('');
  const cancelled = inv.status === 'cancelled';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} ${esc(inv.number)}</title>
<style>
*{box-sizing:border-box}body{font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0;background:#eef2f7}
.page{max-width:820px;margin:16px auto;background:#fff;padding:28px;border-radius:14px;box-shadow:0 6px 30px #0f172a1a;position:relative;overflow:hidden}
.band{position:absolute;inset:0 0 auto 0;height:6px;background:linear-gradient(90deg,#c6ff00,#00e5ff,#7c4dff)}
h1{font-size:20px;letter-spacing:.12em;margin:0}.muted{color:#64748b}.top{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:6px}
.brand{font-weight:800;font-size:18px}.box{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:16px 0}
table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border-bottom:1px solid #e2e8f0;padding:7px 6px;text-align:left;vertical-align:top}th{background:#f8fafc;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569}
.r{text-align:right;white-space:nowrap}.tot{margin-left:auto;width:min(340px,100%);margin-top:10px}.tot td{border:0;padding:4px 6px}.tot .g td{font-weight:800;font-size:15px;border-top:2px solid #0f172a}
.words{margin-top:10px;font-weight:600}.foot{display:flex;justify-content:space-between;gap:16px;margin-top:28px;flex-wrap:wrap}.sign{text-align:right;min-width:200px}.sign .line{margin-top:44px;border-top:1px solid #94a3b8;padding-top:4px}
.stamp{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%) rotate(-18deg);font-size:64px;font-weight:900;color:#ef444433;border:6px solid #ef444433;padding:4px 18px;border-radius:12px;letter-spacing:.1em}
.btn{display:inline-block;margin:0 auto 12px;padding:10px 18px;border-radius:999px;background:#0f172a;color:#fff;text-decoration:none;font-weight:700}.bar{text-align:center}
@media (max-width:560px){.page{margin:0;border-radius:0;padding:18px}.grid{grid-template-columns:1fr}th:nth-child(3),td:nth-child(3){display:none}}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0}.bar{display:none}}
</style></head><body>
<div class="page"><div class="band"></div>${cancelled ? '<div class="stamp">CANCELLED</div>' : ''}
<div class="top"><div><div class="brand">${esc(seller.name)}</div>${seller.legalName && seller.legalName !== seller.name ? `<div>${esc(seller.legalName)}</div>` : ''}
<div class="muted">${esc([seller.address, seller.city, seller.pincode].filter(Boolean).join(', '))}</div>
<div class="muted">${seller.stateCode ? `${esc(seller.state)} (State code ${esc(seller.stateCode)})` : ''}${seller.phone ? ` · ${esc(seller.phone)}` : ''}${seller.email ? ` · ${esc(seller.email)}` : ''}</div>
${seller.gstin ? `<div><b>GSTIN:</b> ${esc(seller.gstin)}</div>` : ''}</div>
<div style="text-align:right"><h1>${title}</h1>${regular ? '<div class="muted">Original for recipient</div>' : ''}<div><b>No.</b> ${esc(inv.number)}</div><div><b>Date:</b> ${esc(fmtDate(inv.date))}</div></div></div>
<div class="grid"><div class="box"><div class="muted">Billed to</div><div><b>${esc(inv.customer_name)}</b></div>${inv.customer_address ? `<div>${esc(inv.customer_address)}</div>` : ''}${inv.customer_phone ? `<div>${esc(inv.customer_phone)}</div>` : ''}${inv.customer_gstin ? `<div><b>GSTIN:</b> ${esc(inv.customer_gstin)}</div>` : ''}</div>
<div class="box"><div><b>Place of supply:</b> ${esc(STATES[inv.place_of_supply] || '')} (${esc(inv.place_of_supply)})</div>${regular ? '<div><b>Reverse charge:</b> No</div>' : ''}</div></div>
<table><thead><tr><th>#</th><th>Description</th><th>SAC</th><th class="r">Qty</th><th class="r">${regular ? 'Taxable value' : 'Value'}</th>${regular ? `<th class="r">${inter ? 'IGST rate' : 'CGST + SGST'}</th><th class="r">Tax</th>` : ''}<th class="r">Amount ₹</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot"><tbody>
${regular ? `<tr><td>Taxable value</td><td class="r">${plain(inv.taxable_paise)}</td></tr>${inter ? `<tr><td>IGST @ ${rate}%</td><td class="r">${plain(inv.igst_paise)}</td></tr>` : `<tr><td>CGST @ ${rate / 2}%</td><td class="r">${plain(inv.cgst_paise)}</td></tr><tr><td>SGST @ ${rate / 2}%</td><td class="r">${plain(inv.sgst_paise)}</td></tr>`}` : ''}
<tr class="g"><td>Total ₹</td><td class="r">${plain(inv.total_paise)}</td></tr></tbody></table>
<div class="words">${esc(amountInWords(inv.total_paise))}</div>
${inv.kind === 'bill_of_supply' ? '<p class="muted">Composition taxable person, not eligible to collect tax on supplies.</p>' : ''}
${inv.kind === 'receipt' ? '<p class="muted">Supplier not registered under GST; no GST charged.</p>' : ''}
${cancelled ? `<p><b>Cancelled:</b> ${esc(inv.cancel_reason)}</p>` : ''}
<div class="foot"><div class="muted" style="max-width:420px">${esc(seller.terms || '')}<br>This is a computer-generated document.</div>
<div class="sign"><div>For ${esc(seller.legalName || seller.name)}</div><div class="line">Authorised signatory</div></div></div>
</div><div class="bar"><button class="btn" id="p" type="button" style="border:0;cursor:pointer;font:inherit;font-weight:700">Print / Save as PDF</button></div><script>${PRINT_JS}</script></body></html>`;
}
