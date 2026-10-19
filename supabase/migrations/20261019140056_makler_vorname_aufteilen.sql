-- Makler: Vorname aus dem bisherigen vollen Namen lösen (19.10.2026).
-- Das erste Wort wird Vorname, der Rest bleibt in `name` (Nachname). Angezeigt wird weiter „Vorname Name“.
-- Unverändert bleiben: einzelne Wörter, Anrede oder Titel vorn (Herr, Frau, Dr., Prof., „B. Eng.“),
-- mehrere Personen („&“, „/“, „und“) und „Nachname, Vorname“. Läuft nur über Zeilen ohne Vornamen,
-- ein zweiter Lauf ändert also nichts.
with zerlegt as (
  select id, regexp_replace(btrim(name), '\s+', ' ', 'g') as voll
  from fach.makler
  where vorname is null and name is not null
)
update fach.makler m
set vorname = split_part(z.voll, ' ', 1),
    name = substr(z.voll, length(split_part(z.voll, ' ', 1)) + 2)
from zerlegt z
where m.id = z.id
  and position(' ' in z.voll) > 0
  and split_part(z.voll, ' ', 1) !~* '^(herr|frau|dr\.?|prof\.?|dipl\.?.*)$'
  and not (split_part(z.voll, ' ', 1) ~ '\.$' and split_part(z.voll, ' ', 2) ~ '\.$')
  and z.voll !~ '[&/,]'
  and z.voll !~* '\sund\s';
