/**
 * Who may do what. Every staff API route names one permission (src/lib/server/staffApi.ts) and the
 * server checks it against this table on every call; the admin app hides what a role can't use.
 * Shared by server and browser so both read the same table.
 *
 *   admin        everything, including money, bill book, settings and team
 *   manager        manager: runs the spaces day to day; cash he and his assistants collect is on his name
 *   assistant       assistant: helps with reservations — sees the timetable, books, sends WhatsApp
 *                confirmations, takes cash (on the manager's name); changes nothing else
 */
export const ROLES = ['admin', 'manager', 'assistant'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  account: 'Own password & 2-step sign-in',
  'bookings.view': 'See timetable and bookings',
  'bookings.create': 'Make phone & walk-in bookings',
  'bookings.notify': 'Send WhatsApp confirmations',
  'cash.collect': 'Take cash / UPI at the desk',
  'bookings.edit': 'Edit booking notes',
  'bookings.cancel': 'Cancel unpaid bookings',
  'schedule.manage': 'Block spaces (batches, events)',
  'about.manage': 'Edit the About page',
  'cash.custody': 'Hold cash on own name & deposit it',
  money: 'Payments, bill book, expenses, reports',
  settings: 'Spaces, prices, hours, settings',
  team: 'Add & manage staff',
} as const;
export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ALL,
  manager: ['account', 'bookings.view', 'bookings.create', 'bookings.notify', 'cash.collect', 'bookings.edit', 'bookings.cancel', 'schedule.manage', 'about.manage', 'cash.custody'],
  assistant: ['account', 'bookings.view', 'bookings.create', 'bookings.notify', 'cash.collect'],
};

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', manager: 'Manager', assistant: 'Assistant' };

export function can(role: Role | undefined | null, perm: Permission): boolean {
  return Boolean(role && ROLE_PERMISSIONS[role]?.includes(perm));
}
