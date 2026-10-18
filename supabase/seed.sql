-- Demodaten für die lokale Entwicklung (keine echten Personen oder Objekte).
insert into fach.makler (id, name, firma, tel, prio, kontakt_frequenz, last_contact, next_contact) values
  ('demo-makler-1', 'Anna Beispiel', 'Beispiel Immobilien GmbH', '+49 30 1234567', 'A', 'Monatlich', current_date - 35, current_date - 2),
  ('demo-makler-2', 'Bernd Muster', 'Muster & Partner', '+49 40 7654321', 'B', 'Wöchentlich', current_date - 7, current_date),
  ('demo-makler-3', 'Clara Demo', null, '+49 89 555000', 'C', 'Alle 3 Monate', current_date - 10, current_date + 80);

insert into fach.objekte (id, strasse, hausnr, plz, stadt, einheiten_anzahl, wohnflaeche, angebotspreis, status, erfasst_am) values
  ('demo-objekt-1', 'Lindenstraße', '12', '10969', 'Berlin', 8, 620.50, 1850000, 'In Prüfung', current_date - 20),
  ('demo-objekt-2', 'Hafenweg', '3', '20457', 'Hamburg', 12, 910.00, 2950000, 'Closing Path', current_date - 60),
  ('demo-objekt-3', 'Am Markt', '7a', '04109', 'Leipzig', 6, 430.00, 980000, 'Angekauft', current_date - 120),
  ('demo-objekt-4', 'Gartenstraße', '41', '80331', 'München', 4, 310.00, 2100000, 'In Prüfung', current_date - 3);

insert into fach.deals (id, objekt_id, makler_id, status, prio, nachfass_frequenz, next_contact, notizen) values
  ('demo-deal-1', 'demo-objekt-1', 'demo-makler-1', 'In Prüfung', 'B', 'Wöchentlich', current_date - 1, 'Unterlagen angefragt'),
  ('demo-deal-2', 'demo-objekt-2', 'demo-makler-2', 'Closing Path', 'A', 'Wöchentlich', current_date + 3, 'Notartermin in Abstimmung'),
  ('demo-deal-3', 'demo-objekt-3', 'demo-makler-3', 'Angekauft', null, 'Nie', null, null),
  ('demo-deal-4', 'demo-objekt-4', null, 'In Prüfung', null, 'Wöchentlich', current_date + 10, 'Import ohne Maklerdaten');

insert into fach.deal_status_historie (id, deal_id, von_status, nach_status, am, quelle) values
  ('demo-h-1', 'demo-deal-1', null, 'In Prüfung', now() - interval '20 days', 'umzug'),
  ('demo-h-2', 'demo-deal-2', null, 'In Prüfung', now() - interval '60 days', 'umzug'),
  ('demo-h-3', 'demo-deal-2', 'In Prüfung', 'Closing Path', now() - interval '5 days', 'umzug'),
  ('demo-h-4', 'demo-deal-3', null, 'Angekauft', now() - interval '120 days', 'umzug'),
  ('demo-h-5', 'demo-deal-4', null, 'In Prüfung', now() - interval '3 days', 'wizard');
