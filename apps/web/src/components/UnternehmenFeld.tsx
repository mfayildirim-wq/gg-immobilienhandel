import { Autocomplete } from '@mantine/core';
import { useUnternehmen } from '../lib/api.ts';

/**
 * Feld „Firma“ (Normalform 17.10.2026): freier Text wie bisher, dazu die vorhandenen Unternehmen als Vorschläge.
 * Gespeichert wird der Text — die API verknüpft das vorhandene Unternehmen oder legt es an.
 */
export function UnternehmenFeld({ value, onChange, label = 'Firma', placeholder = 'Immobilien GmbH', description }: {
  value: string; onChange: (v: string) => void; label?: string; placeholder?: string; description?: string;
}) {
  const { data = [] } = useUnternehmen();
  const eingabe = value.trim().toLowerCase();
  const vorschlaege = data
    .filter((u) => !eingabe || u.name.toLowerCase().includes(eingabe) || (u.domain ?? '').includes(eingabe))
    .slice(0, 12)
    .map((u) => u.name);
  return (
    <Autocomplete label={label} placeholder={placeholder} description={description} value={value} data={vorschlaege} limit={12}
      onChange={onChange} aria-label={label} />
  );
}
