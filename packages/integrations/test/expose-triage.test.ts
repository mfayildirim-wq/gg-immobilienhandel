// Übernommen aus gg-immohandel server/expose-triage.test.ts (Stand 9d693b8), inhaltlich unverändert.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  classifyAttachmentName,
  extractObjektnummern,
  isNeverDownload,
  MIN_CANDIDATE_SCORE,
  scoreBodySubstance,
  stripSignature,
  triageMail,
  type TriageCode,
  type TriageInput,
} from '../src/expose/triage.ts';

// ── Beispielkatalog aus docs/EXPOSE-MAIL-IMPORT-ANFORDERUNGEN.md, Abschnitt 3 ──

interface Fixture {
  id: string;
  label: string;
  expectedVerdict: TriageCode;
  note: string;
  mail: TriageInput & { date: string; fromName: string };
}

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures', 'mails');

const fixtures: Fixture[] = readdirSync(FIXTURE_DIR)
  .filter(f => f.endsWith('.json'))
  .sort()
  .map(f => JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf-8')) as Fixture);

function byId(id: string): Fixture {
  const f = fixtures.find(x => x.id === id);
  if (!f) throw new Error(`Fixture ${id} fehlt`);
  return f;
}

describe('Triage — Beispielkatalog (Abnahmekriterium A1)', () => {
  it('findet alle 8 besprochenen Beispielmails', () => {
    expect(fixtures.map(f => f.id)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08']);
  });

  it.each(fixtures.map(f => [f.id, f.label, f.expectedVerdict] as const))(
    'Mail %s (%s) ⇒ %s',
    id => {
      const f = byId(id);
      const result = triageMail(f.mail);
      expect(result.verdict, `${f.label}\n${f.note}\n${result.reasons.join('\n')}`).toBe(
        f.expectedVerdict,
      );
    },
  );

  it('ist deterministisch — zwei Läufe liefern dasselbe Urteil (A0)', () => {
    for (const f of fixtures) {
      const a = triageMail(f.mail);
      const b = triageMail(f.mail);
      expect(b.verdict).toBe(a.verdict);
      expect(b.candidates).toEqual(a.candidates);
    }
  });
});

describe('A2 — ANNOUNCEMENT und NONE lösen keinen Browser-Lauf aus', () => {
  it('Ankündigung ohne Daten ergibt ANNOUNCEMENT, nicht NONE', () => {
    const result = triageMail({
      subject: 'Neues Objekt',
      bodyText:
        'Hallo Gerry, wir bekommen bald ein neues Objekt in Unterweissach in die Vermarktung. ' +
        'Das würde ich dir mal zuschicken, wenn das etwas für dich wäre.',
    });
    expect(result.verdict).toBe('ANNOUNCEMENT');
    expect(result.announcementSignals.length).toBeGreaterThan(0);
  });

  it('Mail ohne jeden Objektbezug ergibt NONE mit Begründung (R10)', () => {
    const result = triageMail({
      subject: 'Rechnung Juli',
      bodyText: 'Anbei die Rechnung. Mit freundlichen Grüßen',
      links: ['https://example.com/datenschutz'],
    });
    expect(result.verdict).toBe('NONE');
    expect(result.reasons[0]).toMatch(/Keine verwertbare Quelle/);
  });

  it('keine Kandidatenliste enthält Rechtsdokumente oder Rauschlinks', () => {
    for (const f of fixtures) {
      const result = triageMail(f.mail);
      for (const legal of result.legalAttachments) {
        expect(result.candidates.some(c => c.ref === legal)).toBe(false);
      }
    }
  });
});

describe('R1 — Anhangsnamen als Vorfilter (A4)', () => {
  const legal = [
    'Maklervertrag Interessent.pdf',
    'Verbraucherinformationen.pdf',
    '154938-widerruf.pdf',
    'Willenserklärung.pdf',
    'Datenschutzhinweise.pdf',
    'Informationspflicht Art 13 DSGVO.pdf',
  ];
  it.each(legal)('%s ist ein Rechtsdokument', name => {
    expect(classifyAttachmentName(name).cls).toBe('legal');
  });

  const supplements = [
    'Grundriss EG.pdf',
    '7.ENT_10WHG_Ansicht Süd_89.pdf',
    '5.ENT_10WHG_Schnitt A_87.pdf',
    'Wohnflächenberechnung.pdf',
    'Übersichtspläne Neustetten-Remmingsheim.pdf',
    'BS7 20260720 Mieterliste.pdf',
    'Flächenaufstellung BS7 und SB50+52.xlsx',
    'Energieausweis.pdf',
  ];
  it.each(supplements)('%s ist eine Zusatzunterlage', name => {
    expect(classifyAttachmentName(name).cls).toBe('supplement');
  });

  const exposes = [
    'Exposé Musterstraße.pdf',
    'Objektpräsentation Möhringen.pdf',
    'Teaser Hauptstätter Str. 54.pdf',
    'Objektangebot 2026.pdf',
  ];
  it.each(exposes)('%s ist ein Exposé-Kandidat', name => {
    expect(classifyAttachmentName(name).cls).toBe('expose');
  });

  it('Rechtsdokumente werden nie zu Kandidaten (Mail 02)', () => {
    const result = triageMail(byId('02').mail);
    expect(result.legalAttachments).toEqual([
      'Maklervertrag Interessent.pdf',
      'Verbraucherinformationen.pdf',
    ]);
    expect(result.candidates.filter(c => c.source === 'attachment')).toHaveLength(0);
  });

  it('viele Zusatzunterlagen schlagen den Mailtext nicht (Mail 05)', () => {
    const result = triageMail(byId('05').mail);
    expect(result.verdict).toBe('BODY');
    const bestAttachment = result.candidates.find(c => c.source === 'attachment');
    expect(bestAttachment?.score ?? 0).toBeLessThan(MIN_CANDIDATE_SCORE);
    expect(result.supplementAttachments.length).toBeGreaterThan(5);
  });
});

describe('R3 — Freischaltweg erkennen', () => {
  it('Mail 03 erkennt „Details ansehen" und „vollständiges Exposé"', () => {
    const result = triageMail(byId('03').mail);
    expect(result.unlockSignals).toContain('„Details ansehen"');
    expect(result.verdict).toBe('LINK_LANDING_LOCKED');
  });

  it('Mail 02 erkennt die Freischaltstrecke über die Plattform (fio)', () => {
    const result = triageMail(byId('02').mail);
    expect(result.unlockSignals).toHaveLength(0);
    expect(result.verdict).toBe('LINK_LANDING_LOCKED');
    expect(result.candidates[0]!.why.join(' ')).toMatch(/fio/i);
  });

  it('Mail 08 hat keinen Freischaltweg — offene Landingpage (R2)', () => {
    const result = triageMail(byId('08').mail);
    expect(result.unlockSignals).toHaveLength(0);
    expect(result.verdict).toBe('LINK_LANDING_OPEN');
  });
});

describe('R7 — Objektnummer', () => {
  it('liest die Objektnummer aus dem Mailtext', () => {
    expect(extractObjektnummern(byId('02').mail.bodyText || '')).toContain('S-109291');
    expect(extractObjektnummern(byId('03').mail.bodyText || '')).toContain('154.938');
  });

  it('wertet einen Anhang auf, dessen Name die Objektnummer trägt', () => {
    const ohne = triageMail({
      bodyText: 'Objektnummer: S-109291. Kaufpreis 1.290.000 EUR.',
      attachments: [{ filename: 'Unterlagen.pdf', sizeMB: 1.2, kind: 'pdf' }],
    });
    const mit = triageMail({
      bodyText: 'Objektnummer: S-109291. Kaufpreis 1.290.000 EUR.',
      attachments: [{ filename: 'Exposé S-109291.pdf', sizeMB: 1.2, kind: 'pdf' }],
    });
    const a = ohne.candidates.find(c => c.source === 'attachment')!;
    const b = mit.candidates.find(c => c.source === 'attachment')!;
    expect(b.score).toBeGreaterThan(a.score);
    expect(b.why.join(' ')).toMatch(/S-109291/);
  });
});

describe('Body-Substanz', () => {
  it('schneidet die Signatur ab, damit die Absenderanschrift nicht als Objekt zählt', () => {
    const body =
      'Aktuell haben wir ein Mehrfamilienhaus in 73663 Berglen im Verkauf. Kaufpreis 1.290.000 €. ' +
      'Das Objekt ist voll vermietet und in gutem Zustand. Wäre das interessant für Sie? ' +
      'Mit freundlichen Grüßen Simon Karrer, Fritz-Elsas-Str. 50 70174 Stuttgart';
    const cut = stripSignature(body);
    expect(cut).not.toMatch(/Fritz-Elsas-Str\. 50/);
    expect(scoreBodySubstance(body).facts.some(f => f.key === 'strasse')).toBe(false);
  });

  it('erkennt in Mail 01 Preis, Fläche, Grundstück, Miete, Einheiten und Ort', () => {
    const { score, facts } = scoreBodySubstance(byId('01').mail.bodyText || '');
    expect(facts.map(f => f.key).sort()).toEqual(
      ['einheiten', 'grundstueck', 'kaufpreis', 'miete', 'plzOrt', 'wohnflaeche'].sort(),
    );
    expect(score).toBeGreaterThanOrEqual(MIN_CANDIDATE_SCORE);
  });

  it('erkennt in Mail 05 auch Straße, Flurstück und den Preis unter einer Million', () => {
    const { facts } = scoreBodySubstance(byId('05').mail.bodyText || '');
    const keys = facts.map(f => f.key);
    expect(keys).toContain('strasse');
    expect(keys).toContain('flurstueck');
    expect(facts.find(f => f.key === 'kaufpreis')?.evidence).toMatch(/550\.000/);
  });

  it('hält Provisionssätze und Mietbeträge vom Kaufpreis fern', () => {
    const { facts } = scoreBodySubstance(
      'Käuferprovision 4,76 % inkl. MwSt. Jahresnettoeinnahmen ca. 64.000 €. Kaufpreis 1.290.000 €.',
    );
    expect(facts.find(f => f.key === 'kaufpreis')?.evidence).toMatch(/1\.290\.000/);
  });

  it('wertet den Mailtext auch bei starkem Link (Mail 06 bleibt bewertbar)', () => {
    for (const f of fixtures) {
      expect(triageMail(f.mail).candidates.some(c => c.source === 'body')).toBe(true);
    }
  });
});

describe('R8 — Rangliste statt fester Quellenrangfolge', () => {
  it('liefert eine absteigend sortierte Kandidatenliste', () => {
    for (const f of fixtures) {
      const scores = triageMail(f.mail).candidates.map(c => c.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it('je Mail gewinnt eine andere Quelle', () => {
    const winner = (id: string) => triageMail(byId(id).mail).candidates[0]!.source;
    expect(winner('04')).toBe('attachment');
    expect(winner('05')).toBe('body');
    expect(winner('02')).toBe('link');
  });
});

describe('R4 — Sperrliste für Downloads im Browser (A5)', () => {
  const gesperrt = [
    'Willenserklaerung.pdf',
    'Willenserklärung des Käufers',
    'Maklervertrag_2026.pdf',
    'Maklerauftrag',
    'Widerrufsbelehrung.pdf',
    'Verbraucherinformationen nach § 16a',
    'Datenschutzhinweise',
    'AGB',
    'Allgemeine Geschäftsbedingungen',
    'Nachweisvereinbarung.pdf',
    'Impressum',
  ];
  for (const text of gesperrt) {
    it(`sperrt "${text}"`, () => expect(isNeverDownload(text)).toBe(true));
  }

  const erlaubt = [
    'Expose_Musterstrasse_12.pdf',
    'Objektpräsentation',
    'Vollständiges Exposé herunterladen',
    'Grundriss EG.pdf',
    'Mieterliste.xlsx',
    'Download',
  ];
  for (const text of erlaubt) {
    it(`lässt "${text}" durch`, () => expect(isNeverDownload(text)).toBe(false));
  }

  it('greift auch auf die Anhangsnamen der Beispielmails', () => {
    for (const f of fixtures) {
      for (const name of triageMail(f.mail).legalAttachments) {
        expect(isNeverDownload(name)).toBe(true);
      }
    }
  });
});
