import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Markdown (oder HTML) aus dem Gedächtnis als sicheres HTML (26.10.2026): Ergebnisse aus Cowork/Claude kommen als
 * Markdown mit Tabellen und Links. Gesäubert wird immer — der Text stammt von einer KI und darf kein Skript mitbringen.
 * Links öffnen in einem neuen Tab.
 */
export function markdownAlsHtml(text: string): string {
  const roh = marked.parse(text, { async: false, gfm: true, breaks: true });
  const html = DOMPurify.sanitize(roh, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'] });
  const huelle = document.createElement('div');
  huelle.innerHTML = html;
  for (const a of huelle.querySelectorAll('a[href]')) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  return huelle.innerHTML;
}
