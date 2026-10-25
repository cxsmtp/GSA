import next from 'eslint-config-next';

const config = [
  ...next,
  { ignores: ['.next/**', 'node_modules/**', 'public/sw.js'] },
  {
    // Client components read browser-only facts (platform, saved bookings, the URL) after hydration and
    // load data in effects on purpose; the rule's alternative (external stores) adds code for no gain here.
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
];

export default config;
