const dict = {
  'en-PH': {
    catalog: 'Services',
    book: 'Book now',
    lookup: 'Find booking',
    confirm: 'Confirm booking',
    date: 'Date',
    loading: 'Loading…',
  },
} as const;

export type Locale = keyof typeof dict;

export function t(key: keyof (typeof dict)['en-PH'], locale: Locale = 'en-PH'): string {
  return dict[locale][key] ?? key;
}