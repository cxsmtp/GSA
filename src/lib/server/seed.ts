import { get, run } from './db';

/** A fresh portal starts with two courts and evening/weekend peak prices, all editable in Admin → Courts. */
export function seedDefaults() {
  if (get<{ n: number }>('SELECT COUNT(*) AS n FROM courts')!.n > 0) return;
  run("INSERT INTO courts (name, note, sort) VALUES ('Court 1', 'Wooden · Synthetic mat', 1), ('Court 2', 'Wooden · Synthetic mat', 2)");
  run("INSERT INTO price_rules (name, days, start_min, end_min, price_paise, priority) VALUES ('Evening peak', '12345', 1020, 1380, 50000, 10), ('Weekend', '06', 300, 1380, 55000, 20)");
}
