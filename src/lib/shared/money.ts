/** Money is always whole paise (₹1 = 100 paise) as integers: no floating point rounding in totals. */

export function rupees(paise: number, { decimals }: { decimals?: boolean } = {}): string {
  const showDecimals = decimals ?? paise % 100 !== 0;
  const value = paise / 100;
  return `₹${value.toLocaleString('en-IN', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  })}`;
}

/** "1234.50" for invoices and CSVs. */
export function plain(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parse "1,234.5" / 1234.5 rupees into paise; null when not a valid non-negative amount. */
export function toPaise(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.replace(/[,₹\s]/g, '') : '';
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [r, p = ''] = s.split('.');
  return Number(r) * 100 + Number((p + '00').slice(0, 2));
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? belowHundred(rest) : ''].filter(Boolean).join(' ');
}

/** Indian numbering in words, as printed on invoices: "Rupees One Lakh Twenty Thousand and Fifty Paise Only". */
export function amountInWords(paise: number): string {
  let n = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (crore) parts.push(`${crore >= 1000 ? belowThousand(Math.floor(crore / 1000)) + ' Thousand ' : ''}${belowThousand(crore % 1000)} Crore`.trim());
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  const words = parts.join(' ') || 'Zero';
  return `Rupees ${words}${p ? ` and ${belowHundred(p)} Paise` : ''} Only`;
}
