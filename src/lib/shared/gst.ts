/**
 * Indian GST (shared by the server and the admin screens).
 *
 *  - Not registered (turnover under the registration threshold): a plain Receipt, no tax.
 *  - Regular registration: a Tax Invoice. Bookings are supplied where the business is, so the place
 *    of supply is the business's own state: CGST + SGST, half the rate each; IGST only when a manual
 *    invoice names another state as the place of supply.
 *  - Composition scheme: a Bill of Supply, no tax collected from the customer.
 * The rate and SAC code are settings for the business's CA to set; nothing here is legal advice.
 */

export type GstMode = 'none' | 'regular' | 'composition';

export interface GstSettings {
  mode: GstMode;
  gstin: string;
  legalName: string;
  ratePct: number;
  sac: string;
  pricesIncludeGst: boolean;
  invoicePrefix: string;
  thresholdPaise: number;
  terms: string;
}

export interface TaxSplit {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/** Split an amount (paise) into taxable value and tax. `amount` is inclusive or exclusive per the setting. */
export function splitTax(amount: number, g: Pick<GstSettings, 'mode' | 'ratePct' | 'pricesIncludeGst'>, interState = false): TaxSplit {
  if (g.mode !== 'regular' || g.ratePct <= 0) return { taxable: amount, cgst: 0, sgst: 0, igst: 0, total: amount };
  const r = g.ratePct;
  const taxable = g.pricesIncludeGst ? Math.round((amount * 100) / (100 + r)) : amount;
  const total = g.pricesIncludeGst ? amount : amount + Math.round((amount * r) / 100);
  const tax = total - taxable;
  if (interState) return { taxable, cgst: 0, sgst: 0, igst: tax, total };
  const cgst = Math.round(tax / 2);
  return { taxable, cgst, sgst: tax - cgst, igst: 0, total };
}

/** The customer pays this for a booking whose slot prices add up to `base`. */
export function payable(base: number, g: Pick<GstSettings, 'mode' | 'ratePct' | 'pricesIncludeGst'>): number {
  return splitTax(base, g).total;
}

export function documentTitle(mode: GstMode): string {
  return mode === 'regular' ? 'Tax Invoice' : mode === 'composition' ? 'Bill of Supply' : 'Receipt';
}

export function documentKind(mode: GstMode): 'tax_invoice' | 'bill_of_supply' | 'receipt' {
  return mode === 'regular' ? 'tax_invoice' : mode === 'composition' ? 'bill_of_supply' : 'receipt';
}

/** GSTIN: 2-digit state, PAN (5 letters, 4 digits, 1 letter), entity number, Z, checksum. */
export const GSTIN_RE = /^[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Validates the GSTIN checksum digit too (base-36 Luhn-style mod 36). */
export function isValidGstin(gstin: string): boolean {
  const g = gstin.toUpperCase();
  if (!GSTIN_RE.test(g)) return false;
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = chars.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return chars[(36 - (sum % 36)) % 36] === g[14];
}

export const STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};
