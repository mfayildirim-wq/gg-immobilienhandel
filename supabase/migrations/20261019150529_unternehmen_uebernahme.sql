-- Unternehmen der Makler aus dem Altfeld `makler.firma` anlegen und zuordnen (19.10.2026).
-- Ersetzt `pnpm unternehmen:uebernahme`: läuft beim Deploy mit `supabase db push` und lässt sich gefahrlos erneut
-- ausführen, weil es nur Makler ohne Unternehmen betrachtet (auch die im Papierkorb).
-- Regeln wie bisher (`unternehmenUebernahmePlan` in @gg/domain):
--   * Gruppen nach Firmenschlüssel (nur Schreibweisen zusammengefasst; Rechtsform und Standort bleiben unterscheidend)
--   * Name: häufigste Schreibweise, bei Gleichstand nicht die in Großbuchstaben, sonst die zuerst angelegte
--   * Webseite: die häufigste; Domain aus der Webseite, sonst die häufigste Mail-Domain (ohne Freemailer)
--   * Anschrift als Ganzes vom ersten Makler, der eine hat
--   * weitere Kontakte aller Makler zusammen, ohne die Makler der Gruppe selbst
--   * Gibt es das Unternehmen schon (gleicher Schlüssel), werden dort nur Lücken gefüllt.
-- Die Altfelder am Makler bleiben stehen; gelesen wird zuerst das Unternehmen.

-- Hilfsfunktionen nur für diese Sitzung (pg_temp): nichts bleibt in der Datenbank zurück.
create or replace function pg_temp.unternehmen_schluessel(t text) returns text language sql immutable as $$
  select nullif(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(normalize(coalesce(t, ''), NFKC)), '[.,;:()"''„“”‚‘’`´]', ' ', 'g'),
          '[-–—]', ' ', 'g'),
        '\s*([&+/])\s*', '\1', 'g'),
      '\s+', ' ', 'g')), '')
$$;

create or replace function pg_temp.unternehmen_domain(webseite text, email text) returns text language plpgsql immutable as $$
declare
  host text := substring(regexp_replace(regexp_replace(lower(btrim(coalesce(webseite, ''))), '^[a-z]+://', ''), '^www\.', '') from '^[^/?#:\s]*');
  d text := split_part(lower(btrim(coalesce(email, ''))), '@', 2);
begin
  if host like '%.%' then return host; end if;
  if d like '%.%' and d not in ('gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'gmx.at', 'web.de', 't-online.de', 'yahoo.com',
    'yahoo.de', 'outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de', 'icloud.com', 'me.com', 'freenet.de',
    'aol.com', 'posteo.de', 'mail.de', 'online.de', 'arcor.de', 'email.de', 'vodafone.de', '1und1.de') then return d; end if;
  return null;
end $$;

create or replace function pg_temp.telefon_schluessel(v text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(v, ''), '\D', '', 'g'), '^(0049|49)0?', '0')
$$;

-- Kontaktlisten zusammenführen (`unternehmenKontakte`): Reihenfolge bleibt, Doppeltes und die Hauptkontakte fallen weg.
-- listen: jsonb-Array von { namen, telefonnummern, emails }; haupt: jsonb-Array von { name, tel, mobil, festnetz, email }
create or replace function pg_temp.kontakte_vereinen(listen jsonb, haupt jsonb) returns jsonb language plpgsql immutable as $$
declare
  art text; liste jsonb; e jsonb; t text; s text; gesehen text[]; aus jsonb := '{}'; werte jsonb;
begin
  foreach art in array array['namen', 'telefonnummern', 'emails'] loop
    gesehen := case art
      when 'telefonnummern' then array(select pg_temp.telefon_schluessel(x) from jsonb_array_elements(coalesce(haupt, '[]')) h,
        lateral unnest(array[h->>'tel', h->>'mobil', h->>'festnetz']) x where coalesce(x, '') <> '')
      when 'namen' then array(select lower(h->>'name') from jsonb_array_elements(coalesce(haupt, '[]')) h where coalesce(h->>'name', '') <> '')
      else array(select lower(h->>'email') from jsonb_array_elements(coalesce(haupt, '[]')) h where coalesce(h->>'email', '') <> '')
    end;
    werte := '[]';
    for liste in select l from jsonb_array_elements(coalesce(listen, '[]')) l loop
      if jsonb_typeof(liste->art) is distinct from 'array' then continue; end if;
      for e in select x from jsonb_array_elements(liste->art) x loop
        t := case when jsonb_typeof(e) = 'string' then btrim(e #>> '{}') else '' end;
        s := case when t = '' then '' when art = 'telefonnummern' then pg_temp.telefon_schluessel(t) else lower(t) end;
        if s = '' or s = any(gesehen) then continue; end if;
        gesehen := gesehen || s;
        werte := werte || to_jsonb(t);
      end loop;
    end loop;
    aus := aus || jsonb_build_object(art, werte);
  end loop;
  if jsonb_array_length(aus->'namen') + jsonb_array_length(aus->'telefonnummern') + jsonb_array_length(aus->'emails') = 0 then return null; end if;
  return aus;
end $$;

drop table if exists pg_temp.ue_makler, pg_temp.ue_gruppe;

create temp table ue_makler as
select m.id, m.firma, m.webseite, m.email, m.strasse, m.plz, m.ort, m.weitere_kontakte,
  pg_temp.unternehmen_schluessel(m.firma) as schluessel,
  row_number() over (order by m.created_at, m.id) as ord,
  jsonb_build_object('name', nullif(concat_ws(' ', m.vorname, m.name), ''), 'tel', m.tel, 'mobil', m.mobil, 'festnetz', m.festnetz, 'email', m.email) as haupt,
  case when coalesce(btrim(m.webseite), '') <> '' then coalesce(pg_temp.unternehmen_domain(m.webseite, null), btrim(m.webseite)) end as host
from fach.makler m
where m.unternehmen_id is null;

create temp table ue_gruppe as
select g.schluessel,
  (select f from (select btrim(regexp_replace(x.firma, '\s+', ' ', 'g')) as f, count(*) as n, min(x.ord) as o
                  from ue_makler x where x.schluessel = g.schluessel group by 1) s
   order by n desc, (f = upper(f)), o limit 1) as name,
  (select btrim(x.webseite) from ue_makler x where x.schluessel = g.schluessel and x.host = (
     select host from ue_makler y where y.schluessel = g.schluessel and y.host is not null group by host order by count(*) desc, min(y.ord) limit 1)
   order by x.ord limit 1) as webseite,
  (select d from (select pg_temp.unternehmen_domain(null, x.email) as d, x.ord from ue_makler x where x.schluessel = g.schluessel) s
   where d is not null group by d order by count(*) desc, min(ord) limit 1) as mail_domain,
  (select jsonb_build_object('strasse', nullif(btrim(x.strasse), ''), 'plz', nullif(btrim(x.plz), ''), 'ort', nullif(btrim(x.ort), ''))
   from ue_makler x where x.schluessel = g.schluessel and (coalesce(btrim(x.strasse), '') <> '' or coalesce(btrim(x.ort), '') <> '')
   order by x.ord limit 1) as anschrift,
  pg_temp.kontakte_vereinen(
    (select jsonb_agg(coalesce(x.weitere_kontakte, 'null') order by x.ord) from ue_makler x where x.schluessel = g.schluessel),
    (select jsonb_agg(x.haupt order by x.ord) from ue_makler x where x.schluessel = g.schluessel)) as weitere_kontakte,
  (select u.id from fach.unternehmen u where u.name_schluessel = g.schluessel and u.deleted_at is null order by u.created_at, u.id limit 1) as vorhanden_id
from (select distinct schluessel from ue_makler where schluessel is not null) g;

-- Vorhandene Unternehmen: nur Lücken füllen (`unternehmenErgaenzen`)
with ergaenzt as (
  select u.id,
    case when coalesce(btrim(u.webseite), '') = '' and g.webseite is not null then g.webseite else u.webseite end as webseite,
    case when coalesce(btrim(u.domain), '') = ''
      then coalesce(pg_temp.unternehmen_domain(g.webseite, null), g.mail_domain, u.domain) else u.domain end as domain,
    case when x.adresse_leer and g.anschrift is not null then g.anschrift->>'strasse' else u.strasse end as strasse,
    case when x.adresse_leer and g.anschrift is not null then g.anschrift->>'plz' else u.plz end as plz,
    case when x.adresse_leer and g.anschrift is not null then g.anschrift->>'ort' else u.ort end as ort,
    case when g.weitere_kontakte is not null then pg_temp.kontakte_vereinen(
      jsonb_build_array(coalesce(u.weitere_kontakte, 'null'), g.weitere_kontakte),
      (select coalesce(jsonb_agg(h), '[]') from (
        select jsonb_build_object('name', nullif(concat_ws(' ', k.vorname, k.name), ''), 'tel', k.tel, 'mobil', k.mobil, 'festnetz', k.festnetz, 'email', k.email) h
        from fach.makler k where k.unternehmen_id = u.id and k.deleted_at is null
        union all select y.haupt from ue_makler y where y.schluessel = g.schluessel) hs))
    else u.weitere_kontakte end as weitere_kontakte
  from fach.unternehmen u
  join ue_gruppe g on g.vorhanden_id = u.id
  cross join lateral (select coalesce(btrim(u.strasse), '') = '' and coalesce(btrim(u.plz), '') = '' and coalesce(btrim(u.ort), '') = '' as adresse_leer) x
)
update fach.unternehmen u set
  webseite = e.webseite, domain = e.domain, strasse = e.strasse, plz = e.plz, ort = e.ort, weitere_kontakte = e.weitere_kontakte,
  version = u.version + 1, updated_at = now()
from ergaenzt e
where u.id = e.id
  and (u.webseite, u.domain, u.strasse, u.plz, u.ort, u.weitere_kontakte) is distinct from (e.webseite, e.domain, e.strasse, e.plz, e.ort, e.weitere_kontakte);

-- Neue Unternehmen
insert into fach.unternehmen (id, name, name_schluessel, webseite, domain, strasse, plz, ort, weitere_kontakte)
select gen_random_uuid()::text, g.name, g.schluessel, g.webseite,
  coalesce(pg_temp.unternehmen_domain(g.webseite, null), g.mail_domain),
  g.anschrift->>'strasse', g.anschrift->>'plz', g.anschrift->>'ort', g.weitere_kontakte
from ue_gruppe g
where g.vorhanden_id is null;

-- Makler zuordnen
update fach.makler m set unternehmen_id = u.id
from ue_makler x
join lateral (select u.id from fach.unternehmen u where u.name_schluessel = x.schluessel and u.deleted_at is null
              order by u.created_at, u.id limit 1) u on true
where m.id = x.id and m.unternehmen_id is null;

drop table ue_makler, ue_gruppe;
