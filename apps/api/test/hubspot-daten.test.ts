import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { unternehmenSchluessel, unternehmenUebernahmePlan } from '@gg/domain';
import { inArray, like, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — Hilfsskript ohne Typen
import { CSV, MIGRATION, datenblock, migrationMitDaten } from '../../../supabase/daten/csv-zu-sql.mjs';

// Migrationen `unternehmen_uebernahme` und `hubspot_daten` (19.10.2026). Jeder Lauf in einer Transaktion, die zurückgerollt
// wird — die Migrationen betrachten den ganzen Bestand, andere Zeilen der lokalen DB bleiben so unberührt.
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;
const UEBERNAHME = readFileSync(join(import.meta.dirname, '../../../supabase/migrations/20261019150529_unternehmen_uebernahme.sql'), 'utf8');
const HUBSPOT = readFileSync(MIGRATION, 'utf8');

describe('HubSpot-Daten: Migration enthält genau die CSV', () => {
  it('Datenblock = CSV', () => {
    expect(HUBSPOT).toContain(datenblock(readFileSync(CSV, 'utf8')));
    expect(HUBSPOT.match(/^ {2}\(\d+, /gm)).toHaveLength(771);
  });
});

describe.skipIf(!url)('Migrationen Unternehmen-Übernahme und HubSpot', () => {
  const { db } = createDb(url!);
  const k = `Hub${Date.now()}`;

  /** Führt `arbeit` in einer Transaktion aus und rollt zurück; liefert das Ergebnis. */
  async function probe<T>(arbeit: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>): Promise<T> {
    let ergebnis: T | undefined;
    await db.transaction(async (tx) => { ergebnis = await arbeit(tx); tx.rollback(); }).catch((e) => { if (ergebnis === undefined) throw e; });
    return ergebnis!;
  }

  it('Firmenschlüssel in SQL = unternehmenSchluessel in TypeScript', async () => {
    const namen = ['elephas Immobilien GmbH', 'ELEPHAS IMMOBILIEN GMBH', 'E & G Private Immobilien GmbH', 'E&G  Private Immobilien GmbH ',
      'Volksbank Leonberg-Strohgäu eG', 'Baden-Württembergische Bank / Immobilienvermittlung BW GmbH', '„Müller“ Immobilien (Stuttgart)',
      'ÄÖÜ Straße GmbH', 'Fa. A+B Haus', 'Ｗｉｄｅ Ｉｍｍｏ', '  ', 'se-immo.de', 'Engel & Völkers – Esslingen'];
    const sqlWerte = await probe(async (tx) => {
      await tx.execute(sql.raw(UEBERNAHME));
      return Promise.all(namen.map(async (n) => ((await tx.execute(sql`select pg_temp.unternehmen_schluessel(${n}) as s`)) as any)[0].s as string | null));
    });
    expect(sqlWerte).toEqual(namen.map(unternehmenSchluessel));
  });

  it('Übernahme in SQL = unternehmenUebernahmePlan (Namen, Webseite, Domain, Anschrift, weitere Kontakte)', async () => {
    const makler = [
      { id: `${k}m1`, name: 'Anna', firma: `${k} elephas Immobilien GmbH`, webseite: 'www.elephas.de', email: 'anna@elephas.de', weitereKontakte: { namen: ['Mario Lukić', 'Bernd'], telefonnummern: [], emails: [] } },
      { id: `${k}m2`, name: 'Bernd', firma: `${k.toUpperCase()} ELEPHAS IMMOBILIEN GMBH`, webseite: 'https://elephas.de', strasse: 'Hauptstr. 1', plz: '70173', ort: 'Stuttgart' },
      { id: `${k}m3`, name: 'Clara', firma: `${k} elephas Immobilien GmbH` },
      { id: `${k}m4`, name: 'Dora', firma: `${k} Volksbank Immobilien GmbH`, webseite: 'www.volksbank-stuttgart.de' },
      { id: `${k}m5`, name: 'Emil', firma: `${k} Volksbank Immobilien GmbH`, webseite: 'www.vbs-immo.de', email: 'e@vbs-immo.de' },
      { id: `${k}m6`, name: 'Fritz', firma: '' },
    ];
    const plan = unternehmenUebernahmePlan(makler);
    const ist = await probe(async (tx) => {
      // zeitlich gestaffelt: die Reihenfolge entscheidet bei Gleichstand
      for (const [i, m] of makler.entries()) await tx.insert(schema.makler).values({ ...m, createdAt: new Date(Date.UTC(2020, 0, 1, 0, i)).toISOString() });
      await tx.execute(sql.raw(UEBERNAHME));
      const m = await tx.select().from(schema.makler).where(inArray(schema.makler.id, makler.map((x) => x.id)));
      const u = await tx.select().from(schema.unternehmen).where(like(schema.unternehmen.nameSchluessel, `${k.toLowerCase()}%`));
      return { m, u };
    });
    expect(ist.u).toHaveLength(plan.unternehmen.length);
    for (const p of plan.unternehmen) {
      const u = ist.u.find((x) => x.nameSchluessel === p.schluessel)!;
      expect({ name: u.name, webseite: u.webseite, domain: u.domain, strasse: u.strasse, plz: u.plz, ort: u.ort, weitereKontakte: u.weitereKontakte })
        .toEqual({ name: p.name, webseite: p.webseite, domain: p.domain, strasse: p.strasse, plz: p.plz, ort: p.ort, weitereKontakte: p.weitereKontakte });
      for (const id of p.maklerIds) expect(ist.m.find((x) => x.id === id)!.unternehmenId).toBe(u.id);
    }
    expect(ist.m.find((x) => x.id === `${k}m6`)!.unternehmenId).toBeNull();
  });

  it('HubSpot: vorhandene Makler und Unternehmen nur ergänzen, Priorität aus HubSpot, Rest neu anlegen — zweiter Lauf ändert nichts', async () => {
    const tel = `+49 7000 ${String(Date.now()).slice(-7)}`;
    const kopf = 'vorname,nachname,anrede,email,weitere_emails,telefon,mobil,du_sie,letzte_kontaktaufnahme,klassifizierung,jobbezeichnung,beruf,stellung,zustaendig,hinweis,mailing_status,mails_abgemeldet,rechtsgrundlage,quelle,unternehmensname,unternehmen,webseite,website_url,strasse,plz,ort,fax';
    const zeile = (w: Record<string, string>) => kopf.split(',').map((s) => (w[s] ?? '').includes(',') ? `"${w[s]}"` : (w[s] ?? '')).join(',');
    const csv = [kopf,
      // vorhanden über E-Mail: nur Lücken füllen, VIP → A, Firma neu
      zeile({ vorname: 'Erna', nachname: `${k}Eins`, anrede: 'Frau', email: `ERNA@${k}.de`, du_sie: 'per Du', klassifizierung: 'VIP', jobbezeichnung: 'Neu-Position', unternehmensname: `${k} Firma GmbH`, weitere_emails: `erna.privat@${k}.de` }),
      // vorhanden über Telefon, hat schon ein Unternehmen (gleicher Schlüssel): bleibt, dort nur Fax ergänzt; „Test“ ändert die Priorität nicht
      zeile({ vorname: 'Zora', nachname: `${k}Zwei`, mobil: tel, klassifizierung: 'Test', unternehmensname: `${k.toUpperCase()} ALT AG`, webseite: 'www.neu.example', fax: '0711 99' }),
      // neu mit Firma
      zeile({ vorname: 'Nina', nachname: `${k}Neu`, anrede: 'Frau', email: `nina@${k}.de`, klassifizierung: 'C', letzte_kontaktaufnahme: '2026-04-22', unternehmensname: `${k} Neu GmbH`, strasse: 'Weg 1', plz: '70173', ort: 'Stuttgart', mails_abgemeldet: 'true', mailing_status: 'Keine Mails mehr schicken' }),
      // doppelt (gleiche E-Mail) → zählt einmal
      zeile({ vorname: 'Nina', nachname: `${k}Neu`, email: `nina@${k}.de`, unternehmensname: `${k} Anders GmbH` }),
      // neu ohne Firma, Exit → Priorität leer
      zeile({ vorname: 'Otto', nachname: `${k}Ohne`, email: `otto@${k}.de`, klassifizierung: 'Exit' }),
    ].join('\n') + '\n';
    const migration = migrationMitDaten(HUBSPOT, csv);

    const ist = await probe(async (tx) => {
      const [uAlt] = await tx.insert(schema.unternehmen).values({ id: `${k}u`, name: `${k} Alt AG`, nameSchluessel: unternehmenSchluessel(`${k} Alt AG`), webseite: 'www.alt.example' }).returning();
      await tx.insert(schema.makler).values([
        { id: `${k}e1`, vorname: 'Erna', name: `${k}Eins`, email: `erna@${k}.de`, prio: 'B', position: 'Alt-Position' },
        { id: `${k}e2`, vorname: 'Zora', name: `${k}Zwei`, tel, prio: 'B', unternehmenId: uAlt!.id },
      ]);
      await tx.execute(sql.raw(migration));
      const lesen = async () => ({
        m: await tx.select().from(schema.makler).where(like(schema.makler.name, `${k}%`)),
        u: await tx.select().from(schema.unternehmen).where(like(schema.unternehmen.nameSchluessel, `${k.toLowerCase()}%`)),
      });
      const erst = await lesen();
      await tx.execute(sql.raw(migration));
      return { erst, dann: await lesen() };
    });

    const { m, u } = ist.erst;
    const makler = (name: string) => m.find((x) => x.name === `${k}${name}`)!;
    const firma = (name: string) => u.find((x) => x.name === name);
    expect(m).toHaveLength(4);
    expect(makler('Eins')).toMatchObject({ anrede: 'Frau', position: 'Alt-Position', prio: 'A', persoenlich: { anredeForm: 'du' }, unternehmenId: firma(`${k} Firma GmbH`)!.id });
    expect(firma(`${k} Firma GmbH`)!.weitereKontakte).toEqual({ namen: [], telefonnummern: [], emails: [`erna.privat@${k}.de`] });
    expect(makler('Zwei')).toMatchObject({ prio: 'B', unternehmenId: `${k}u` });
    expect(firma(`${k} Alt AG`)).toMatchObject({ webseite: 'www.alt.example', fax: '0711 99' });
    expect(makler('Neu')).toMatchObject({ vorname: 'Nina', email: `nina@${k}.de`, prio: 'C', kontaktFrequenz: 'Monatlich', lastContact: '2026-04-22', mailsAbgemeldet: true, mailingStatus: 'Keine Mails mehr schicken', unternehmenId: firma(`${k} Neu GmbH`)!.id });
    expect(firma(`${k} Neu GmbH`)).toMatchObject({ strasse: 'Weg 1', plz: '70173', ort: 'Stuttgart' });
    expect(firma(`${k} Anders GmbH`)).toBeUndefined();
    expect(makler('Ohne')).toMatchObject({ prio: null, unternehmenId: null });

    const stand = (x: typeof ist.erst) => [...x.m.map((y) => `${y.id}:${y.version}`), ...x.u.map((y) => `${y.id}:${y.version}`)].sort();
    expect(stand(ist.dann)).toEqual(stand(ist.erst));
  });
});
