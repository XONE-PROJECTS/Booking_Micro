export type PortalProfile = {
  slug: string;
  name: string;
  currency: string;
  timezone: string;
  locale: string;
  guestBookingEnabled: boolean;
  profile?: { displayName?: string; description?: string };
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
    accentColor?: string;
    backgroundColor?: string;
    textColor?: string;
    fontFamily?: string;
    borderRadius?: string;
    embedAllowedOrigins?: string[];
    portal?: { headerHtml?: string; footerHtml?: string; termsHtml?: string };
  };
};

export type PublicService = {
  id: string;
  name: string;
  slug: string;
  shortDescription?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  basePrice?: string;
  currency?: string;
  categoryId?: string | null;
  definition?: {
    timeSelection?: string;
    dateSelection?: string;
    guests?: { enabled?: boolean; types?: { key: string; label: string; min?: number; max?: number }[] };
  };
  options?: { id: string; name: string; price: string; required?: boolean; maxQuantity?: number }[];
};

export type FormSchema = {
  fields: {
    key: string;
    type: string;
    label: string;
    required?: boolean;
    placeholder?: string;
    options?: { value: string; label: string }[];
    consentText?: string;
  }[];
};

const CUSTOMER_TOKEN_KEY = 'ub_customer_token';

export function getCustomerToken(slug: string): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(`${CUSTOMER_TOKEN_KEY}:${slug}`);
}

export function setCustomerToken(slug: string, token: string) {
  sessionStorage.setItem(`${CUSTOMER_TOKEN_KEY}:${slug}`, token);
}

export function clearCustomerToken(slug: string) {
  sessionStorage.removeItem(`${CUSTOMER_TOKEN_KEY}:${slug}`);
}