-- Telefonnummern der Makler bereinigen (21.10.2026).
-- Der HubSpot-Export (Migration `hubspot_daten`) brachte Excel-Reste mit: ein Textmarker ' vorn („'+49…“, auch nur „'+“),
-- Nummern ohne + („4971…“) und Nummern in Exponentialschreibweise („4.97E+12“, Ziffern verloren). Die 27 Makler mit „'+“
-- erschienen untereinander als Dubletten (gleiche Telefonnummer). Gilt für alle Makler; ein zweiter Lauf ändert nichts.
--   * ' vorn weg
--   * ohne Ziffer oder in Exponentialschreibweise → leer
--   * 49 + mindestens 8 Ziffern ohne + → +49…
-- Leere und alle übrigen Werte bleiben unverändert.
create or replace function pg_temp.telefon_bereinigt(v text) returns text language sql immutable as $$
  select case
    when coalesce(btrim(v), '') = '' then v
    when t !~ '\d' or t ~* '^\d+([.,]\d+)?e\+?\d+$' then null
    when t ~ '^49\d{8,}$' then '+' || t
    when v ~ '^\s*''' then t
    else v
  end
  from (select btrim(regexp_replace(v, '^\s*''+', '')) as t) x
$$;

update fach.makler m set
  tel = pg_temp.telefon_bereinigt(m.tel),
  mobil = pg_temp.telefon_bereinigt(m.mobil),
  festnetz = pg_temp.telefon_bereinigt(m.festnetz),
  version = m.version + 1, updated_at = now()
where (m.tel, m.mobil, m.festnetz) is distinct from
  (pg_temp.telefon_bereinigt(m.tel), pg_temp.telefon_bereinigt(m.mobil), pg_temp.telefon_bereinigt(m.festnetz));
