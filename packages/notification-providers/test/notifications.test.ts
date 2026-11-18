import { describe, expect, it } from 'vitest';
import { renderTemplate, textToHtml } from '../src';

describe('templates', () => {
  it('renders placeholders and escapes HTML', () => {
    const vars = { customer: { firstName: '<b>Ana</b>' }, booking: { reference: 'BOOK-2026-000001' } };
    expect(renderTemplate('Hi {{customer.firstName}} ({{ booking.reference }}) {{missing}}', vars)).toBe('Hi <b>Ana</b> (BOOK-2026-000001) ');
    expect(renderTemplate('Hi {{customer.firstName}}', vars, { html: true })).toBe('Hi &lt;b&gt;Ana&lt;/b&gt;');
  });
  it('does not expose prototype properties', () => {
    expect(renderTemplate('{{constructor.name}}', {})).toBe('');
  });
  it('converts text to safe HTML', () => {
    const html = textToHtml('Hello <script>\n\nVisit https://example.com');
    expect(html).not.toContain('<script>');
    expect(html).toContain('href="https://example.com"');
  });
});
