-- Unternehmen aus makler.firma (Normalform 17.10.2026, Protokoll 32): je normiertem Firmennamen ein Unternehmen,
-- Makler verweisen per unternehmen_id darauf. Webseite und Domain ziehen ans Unternehmen. Die Spalten
-- makler.firma und makler.webseite fallen in der nächsten Migration.
--
-- Normierung wie @gg/domain unternehmenNameNormieren: lower · Leerraum zu einem Leerzeichen · trim · Satzzeichen am Ende weg.
-- Die Funktion bleibt, damit die API Firmen beim Anlegen mit derselben Regel findet (Test packages/db/test/unternehmen-sql.test.ts).
CREATE OR REPLACE FUNCTION fach.unternehmen_name_normiert(name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(btrim(regexp_replace(lower(coalesce(name, '')), '\s+', ' ', 'g')), '[.,;:]+$', ''))
$$;
--> statement-breakpoint
INSERT INTO fach.unternehmen (id, name, name_normiert, webseite, quelle, reihenfolge, created_at)
SELECT gen_random_uuid()::text,
       (array_agg(btrim(regexp_replace(m.firma, '\s+', ' ', 'g')) ORDER BY m.created_at, m.id))[1],
       fach.unternehmen_name_normiert(m.firma),
       (array_agg(btrim(m.webseite) ORDER BY m.created_at, m.id) FILTER (WHERE coalesce(btrim(m.webseite), '') <> ''))[1],
       'umzug',
       min(m.reihenfolge),
       min(m.created_at)
FROM fach.makler m
WHERE coalesce(btrim(m.firma), '') <> ''
GROUP BY fach.unternehmen_name_normiert(m.firma);
--> statement-breakpoint
UPDATE fach.makler m SET unternehmen_id = u.id
FROM fach.unternehmen u
WHERE coalesce(btrim(m.firma), '') <> ''
  AND u.name_normiert = fach.unternehmen_name_normiert(m.firma)
  AND u.deleted_at IS NULL;
--> statement-breakpoint
-- Mehrere Webseiten bei Maklern derselben Firma (verschieden nach Abzug von Schema, „www.“ und Pfad): die erste gilt,
-- die übrigen stehen in den Notizen
UPDATE fach.unternehmen u SET notizen = 'Weitere Webseiten der Makler: ' || w.liste
FROM (
  SELECT x.unternehmen_id, string_agg(DISTINCT x.webseite, ', ') AS liste, count(DISTINCT x.domain) AS n
  FROM (
    SELECT m.unternehmen_id, btrim(m.webseite) AS webseite,
           regexp_replace(regexp_replace(regexp_replace(lower(btrim(m.webseite)), '^[a-z][a-z0-9+.-]*://', ''), '^www[0-9]*\.', ''), '[/?#].*$', '') AS domain
    FROM fach.makler m WHERE coalesce(btrim(m.webseite), '') <> ''
  ) x
  GROUP BY x.unternehmen_id
) w
WHERE w.unternehmen_id = u.id AND w.n > 1;
--> statement-breakpoint
-- Rechtsform aus dem Namen (Teilmenge von @gg/domain rechtsformAusName; AG/SE/UG/eG nur groß geschrieben)
UPDATE fach.unternehmen SET rechtsform = CASE
  WHEN name ~* '\mgmbh\s*&\s*co\.?\s*kgaa\M' THEN 'GmbH & Co. KGaA'
  WHEN name ~* '\mgmbh\s*&\s*co\.?\s*kg\M' THEN 'GmbH & Co. KG'
  WHEN name ~* '\mag\s*&\s*co\.?\s*kg\M' THEN 'AG & Co. KG'
  WHEN name ~* '\mug\s*\(haftungsbeschr' THEN 'UG (haftungsbeschränkt)'
  WHEN name ~* '\mggmbh\M' THEN 'gGmbH'
  WHEN name ~* '\mgmbh\M' THEN 'GmbH'
  WHEN name ~* '\mmbh\M' THEN 'mbH'
  WHEN name ~* '\mkgaa\M' THEN 'KGaA'
  WHEN name ~* '\me\.\s?k\.?(\s|$)' THEN 'e.K.'
  WHEN name ~* '\me\.\s?v\.?(\s|$)' THEN 'e.V.'
  WHEN name ~ '\meG\M' THEN 'eG'
  WHEN name ~* '\mohg\M' THEN 'OHG'
  WHEN name ~* '\mgbr\M' THEN 'GbR'
  WHEN name ~* '\mkg\M' THEN 'KG'
  WHEN name ~ '\mAG\M' THEN 'AG'
  WHEN name ~ '\mSE\M' THEN 'SE'
  WHEN name ~ '\mUG\M' THEN 'UG'
  WHEN name ~* '\mltd\.?(\s|$)' THEN 'Ltd.'
  WHEN name ~* '\minc\.?(\s|$)' THEN 'Inc.'
  WHEN name ~* '\mllc\M' THEN 'LLC'
  ELSE NULL END
WHERE rechtsform IS NULL;
--> statement-breakpoint
-- Domain: aus der Webseite, sonst die häufigste Nicht-Freemail-Domain der E-Mail-Adressen der Makler
UPDATE fach.unternehmen SET domain = NULLIF(regexp_replace(regexp_replace(regexp_replace(lower(btrim(webseite)), '^[a-z][a-z0-9+.-]*://', ''), '^www[0-9]*\.', ''), '[/?#].*$', ''), '')
WHERE domain IS NULL AND coalesce(btrim(webseite), '') <> '';
--> statement-breakpoint
UPDATE fach.unternehmen u SET domain = d.domain
FROM (
  SELECT DISTINCT ON (unternehmen_id) unternehmen_id, domain
  FROM (
    SELECT m.unternehmen_id, lower(split_part(btrim(m.email), '@', 2)) AS domain, count(*) AS n
    FROM fach.makler m
    WHERE m.unternehmen_id IS NOT NULL AND m.email LIKE '%@%.%'
      AND lower(split_part(btrim(m.email), '@', 2)) NOT IN (
        'gmail.com','googlemail.com','gmx.de','gmx.net','gmx.at','gmx.ch','web.de','t-online.de','yahoo.de','yahoo.com','hotmail.de','hotmail.com',
        'outlook.de','outlook.com','live.de','live.com','icloud.com','me.com','mac.com','aol.com','aol.de','freenet.de','arcor.de','online.de',
        'posteo.de','mail.de','email.de','protonmail.com','proton.me','kabelmail.de','vodafone.de','unitybox.de','bluewin.ch','mailbox.org','yandex.com','msn.com','magenta.de','telekom.de','o2online.de')
    GROUP BY m.unternehmen_id, lower(split_part(btrim(m.email), '@', 2))
  ) x
  ORDER BY unternehmen_id, n DESC, domain
) d
WHERE d.unternehmen_id = u.id AND u.domain IS NULL;
