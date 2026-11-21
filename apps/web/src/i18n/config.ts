export const locales = ['en-PH'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en-PH';