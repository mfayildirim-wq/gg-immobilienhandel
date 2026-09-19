/**
 * Fester Prüf-Datenbestand im Format der ALTEN App (KV-Sammlungen). Wird in die alte App geschrieben und per
 * Umzugsskript in den Neubau übernommen; beide Oberflächen müssen danach fachlich dasselbe zeigen.
 * Alle IDs beginnen mit `par-`. Keine echten Personen- oder Kundendaten.
 */
import { bsSeedVorlage, FILTER_TEMPLATES } from '@gg/domain';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const heute = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
const tag = (d: number) => new Date(Date.parse(`${heute}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

const objekte = [
  {
    id: 'par-o1', strasse: 'Paritätsweg', hausnr: '1', plz: '70173', stadt: 'Stuttgart', baujahr: '1965', einheitenAnz: '6', wohnflaeche: '480', grundstueck: '900',
    angebotspreis: 1450000, zielpreis: 1300000, istmiete: 4200, sollmiete: 5100, energie: 'C', heizung: 'Gas-Zentralheizung', status: 'In Prüfung', notizen: 'Dach 2021 neu\nHeizung 2018',
    einheiten: [
      { id: 'oe1', typ: 'Wohnung', lage: 'EG links', zimmer: 3, flaeche: 78.5, kaltmiete: 690, vermiet: 'Vermietet' },
      { id: 'oe2', typ: 'Gewerbe', lage: 'Laden', zimmer: 2, flaeche: 120, kaltmiete: 1400, vermiet: 'Leerstand' },
      { id: 'oe3', typ: 'Stellplatz', lage: 'Hof', stueck: 4, kaltmiete: 240, vermiet: 'Vermietet' },
      { id: 'oe4', typ: 'Wohnung', lage: 'DG', zimmer: 2, flaeche: 61, vermiet: 'Leerstand' },
    ],
  },
  { id: 'par-o2', strasse: 'Vergleichsstraße', hausnr: '22', plz: '89073', stadt: 'Ulm', baujahr: '1992', einheitenAnz: '3', wohnflaeche: '240', angebotspreis: 690000, einheiten: [] },
  { id: 'par-o3', strasse: 'Globalallee', hausnr: '5a', plz: '71032', stadt: 'Böblingen', baujahr: '1958', einheitenAnz: '12', wohnflaeche: '910', einheiten: [] },
  { id: 'par-o5', strasse: 'Paritätsweg', hausnr: '1', plz: '70173', stadt: 'Stuttgart', status: 'In Prüfung', einheiten: [] },
  { id: 'par-o4', strasse: 'Papierkorbweg', hausnr: '9', plz: '70173', stadt: 'Stuttgart', status: 'Archiv', einheiten: [], _deleted: true, _deletedAt: Date.parse(`${heute}T12:00:00Z`) - 2 * 86_400_000 },
];

const makler = [
  {
    id: 'par-m1', name: 'Paula Prüf', firma: 'Prüf Immobilien', tel: '+49 711 1000', email: 'paula@example.test', prio: 'A', kontaktFreq: 'Monatlich', lastContact: tag(-40), erstellt: tag(-200),
    aiSummary: 'Paula ist A-Maklerin in Stuttgart, schickt verlässlich Exposés.', aiSummaryTs: '14.9.2026 09:05',
    relationshipNote: 'Wir siezen uns, sie mag kurze E-Mails.',
    personal: { geburtsdatum: '03-15', anredeForm: 'sie', letzteErwaehnung: [{ ts: '12.9.2026', thema: 'Urlaub', detail: 'War auf Mallorca' }, { ts: '1.9.2026', thema: 'Fußball', detail: 'VfB-Fan' }] },
    komm: [
      { id: 'par-k3', ts: '16.9.2026 10:15', kanal: 'email', richtung: 'ausgehend', betreff: 'Exposé Paritätsweg', text: 'Können Sie mir Ihre Unterlagen senden?\nDanke' },
      { id: 'par-k2', ts: '2.9.2026 08:05', kanal: 'anruf', richtung: '', text: 'Rückruf vereinbart' },
      { id: 'par-k1', ts: 'Altbestand', kanal: 'notiz', text: 'kennt den Eigentümer' },
    ],
  },
  { id: 'par-m3', name: 'Nora Nie', prio: 'C', kontaktFreq: 'Nicht kontaktieren', lastContact: tag(-400) },
  { id: 'par-m4', name: 'Tim Termin', firma: 'Termin GmbH', prio: 'A', kontaktFreq: 'Alle 3 Monate', lastContact: tag(-95), nextContact: tag(-2) },
  { id: 'par-m2', name: 'Otto Offen', firma: 'Offen & Co', tel: '+49 731 2000', prio: 'B', kontaktFreq: 'Wöchentlich', lastContact: tag(-3), nextContact: tag(2), erstellt: tag(-100), notizen: 'Anruf: meldet sich nächste Woche' },
  { id: 'par-m6', name: 'Paula Prüf', firma: 'Prüf Immobilien GmbH', email: 'paula@example.test', prio: 'B', kontaktFreq: 'Monatlich' },
  { id: 'par-m5', name: 'Gelöschte Gerda', firma: 'Weg GmbH', prio: 'C', _deleted: true, _deletedAt: Date.parse(`${heute}T12:00:00Z`) - 28 * 86_400_000 },
];

const adresse = (o: (typeof objekte)[number]) => ({ adresse: o.strasse, hausnr: o.hausnr, plz: o.plz, stadt: o.stadt });

const deals = [
  {
    id: 'par-d1', objId: 'par-o1', maklerId: 'par-m1', status: 'In Prüfung',
    kommentare: [{ ts: '16.09.2026 10:15', text: 'Rückruf vereinbart\nzweite Zeile' }, { ts: '02.09.2026 08:05', text: 'Exposé erhalten' }, { ts: 'Altbestand', text: 'kennt den Eigentümer' }], nachfassFreq: 'Wöchentlich', lastContact: tag(-9), angebotsDatum: tag(-30), ...adresse(objekte[0]!),
    kalk: { kaufpreis: 1350000, notar: 2, gest: 5, makler: 3.57, fk_p: 80, ek_p: 20, euribor: 2.1, margeB: 2.5, bank_abgeb: 1, ek_r: 15, halt: 18, vprov: 4.76, aufk: 12000, glo_m: 15, rp_pct: 10 },
    einheiten: [
      { id: 'e1', typ: 'Wohnung', lage: 'EG links', zimmer: 3, fl: 78.5, mi_ist: 690, rend_k: 4.2 },
      { id: 'e2', typ: 'Wohnung', lage: 'EG rechts', zimmer: 2, fl: 61, mi_ist: 540, mi_neu_manual: true, mi_neu: 640, rend_k: 4.2 },
      { id: 'e3', typ: 'Wohnung', lage: '1. OG', zimmer: 4, fl: '95,5', mi_ist: '820', rend_k: 4, vkp: 389000 },
      { id: 'e4', typ: 'Gewerbe', lage: 'Laden', fl: 120, mi_ist: 1400, rend_k: 6 },
      { id: 'e5', typ: 'Stellplatz', lage: 'Hof', stk: 4, mi_ist: 240, rend_k: 5 },
    ],
    sanierung: [{ id: 's1', desc: 'Dach', amt: 85000, scope: 'both' }, { id: 's2', desc: 'Fenster', amt: '42.000', scope: 'auf' }, { id: 's3', desc: 'Heizung', amt: 36000, scope: 'glo' }],
    kalkVarianten: [
      {
        id: 'v2', name: 'Nachverhandlung', ts: '2026-09-10T08:30:00.000Z', kalk: { kaufpreis: 1190000, notar: 2, gest: 5, makler: 0, halt: 24, glo_m: 12, rp_fix: 50000 },
        einheiten: [{ id: 'e1', typ: 'Wohnung', lage: 'EG links', zimmer: 3, fl: 78.5, mi_ist: 690, mi_neu: 760, mi_neu_manual: true, rend_k: 4.6 }, { id: 'e9', typ: 'Stellplatz', lage: 'TG', stk: 6, mi_ist: 360, rend_k: 5 }],
        sanierung: [{ id: 's1', desc: 'Dach', amt: '95.000', scope: 'both' }],
      },
      { id: 'v1', name: 'Erstangebot', ts: '2026-08-02T22:30:00.000Z', kalk: { kaufpreis: 1250000, notar: 2, gest: 5, makler: 3.57, halt: 18 }, einheiten: [{ id: 'e1', typ: 'Wohnung', lage: 'EG links', fl: 78.5, mi_ist: 690, rend_k: 4.2, vkp: 200000 }], sanierung: [] },
    ],
  },
  {
    id: 'par-d2', objId: 'par-o2', maklerId: 'par-m2', status: 'Angebot abgegeben', notizen: 'nur als Notiz erfasst', nachfassFreq: 'Monatlich', lastContact: tag(-31), ...adresse(objekte[1]!),
    kalk: { kaufpreis: 640000, notar: 1.5, gest: 5, fk_p: 100, ek_p: 0, euribor: 3, margeB: 2, halt: 12, rp_fix: 20000 },
    einheiten: [
      { id: 'e1', typ: 'Wohnung', lage: 'EG', fl: 80, mi_ist: 760, rend_k: 4.5 },
      { id: 'e2', typ: 'Wohnung', lage: 'OG', fl: 80, mi_ist: 780, rend_k: 4.5 },
      { id: 'e3', typ: 'Wohnung', lage: 'DG', fl: 80, mi_ist: '', rend_k: '' },
    ],
    sanierung: [{ id: 's1', desc: 'Bäder', amt: 60000 }],
  },
  {
    id: 'par-d3', objId: 'par-o3', status: 'Verhandlung', nachfassFreq: 'Nie', ...adresse(objekte[2]!),
    kalk: { kaufpreis: 2100000, glo_m: 20 },
    einheiten: Array.from({ length: 12 }, (_, i) => ({ id: `e${i + 1}`, typ: 'Wohnung', lage: `W${i + 1}`, fl: 75.8, mi_ist: 610 + i * 5, rend_k: 3.8 })),
    sanierung: [],
  },
  {
    id: 'par-d5', objId: 'par-o3', status: 'Angebot abgegeben', nachfassFreq: 'Alle 3 Monate', lastContact: tag(-60), nextContact: heute, ...adresse(objekte[2]!),
    kalk: { kaufpreis: 1990000 }, einheiten: [], sanierung: [],
  },
  {
    id: 'par-d6', objId: 'par-o1', status: 'In Prüfung', nachfassFreq: 'Täglich', lastContact: tag(-1), ...adresse(objekte[0]!),
    kalk: {}, einheiten: [], sanierung: [],
  },
  {
    id: 'par-d7', objId: 'par-o2', status: 'Angekauft', ...adresse(objekte[1]!),
    kalk: { kaufpreis: 500000, notar: 2, gest: 5, makler: 0, fk_p: 80, ek_p: 20, euribor: 2, margeB: 2, halt: 12 },
    einheiten: [
      { id: 'w1', typ: 'Wohnung', lage: 'EG links', fl: 60, zimmer: 2, mi_ist: 600, mi_neu: 750, vkp: 400000 },
      { id: 'w2', typ: 'Wohnung', lage: 'OG rechts', fl: 40.5, zimmer: 2, mi_ist: 400, mi_neu: 500, vkp: 260000 },
      { id: 'w3', typ: 'Wohnung', lage: 'DG', fl: 55, zimmer: 3, mi_ist: 0, vkp: '' },
      { id: 'p1', typ: 'Stellplatz', lage: 'TG-01', mi_ist: 45, vkp: 18000 },
    ],
    sanierung: [{ id: 's1', desc: 'Treppenhaus', amt: 15000 }],
  },
  { id: 'par-d8', objId: 'par-o3', status: 'Angekauft', ...adresse(objekte[2]!), kalk: {}, einheiten: [], sanierung: [] },
  { id: 'par-d4', objId: 'par-o2', status: 'Absage', ...adresse(objekte[1]!), kalk: {}, einheiten: [], sanierung: [] },
];

const kkInputs = (kaufpreis: number, miete: number) => ({
  kaufpreis, notarPct: 0.015, grundbuchPct: 0.005, grundsteuerPct: 0.05, maklerPct: 0.0357, sonstigePct: 0,
  sanierungsposten: [{ label: 'Bad', amount: 18000, modus: 'aktivieren' }, { label: 'Malerarbeiten', amount: 6000, modus: 'sofort' }, { label: 'Dach (WEG)', amount: 4000, modus: 'weg_ruecklage' }],
  nettokaltmieteMonat: miete, stellplatzMiete: 60, sonstigeMiete: 0, umlagefaehig: 180, mieterhoehungJaehrlich: 0.02,
  nichtUmlagefaehig: 45, kostensteigerungJaehrlich: 0.02, wertsteigerungJaehrlich: 0.02, anteilGebaeudeKaufpreis: 0.75, afaSatz: 0.02,
  grenzsteuersatz: 0.42, darlehen: [{ label: 'Darlehen I', summe: Math.round(kaufpreis * 0.9), zinssatz: 0.0395, tilgung: 0.02 }, { label: 'KfW', summe: 30000, zinssatz: 0.021, tilgung: 0.03 }],
  kaufjahr: 2026, betrachtungsdauerJahre: 15, wohnflaecheGesamt: 78.5,
});

const kundenkalkulationen = [
  {
    id: 'par-kk1', dealId: 'par-d1', name: 'Kalkulation EG links', scope: 'aufteiler', einheitId: 'e1', createdAt: '2026-05-03T22:30:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z',
    objSnapshot: { adresse: 'Paritätsweg 1, 70173 Stuttgart', kaufdatum: '2026-05-01', wohnflaecheGesamt: 78.5, stellplaetzeAnzahl: 1, einheitenAnzahl: 1 },
    inputs: kkInputs(310000, 690), projektTitel: 'IVT AG Projekt: Paritätsweg', wertsteigerungBullets: ['Mieten bei Wechsel anpassen', 'Kosten optimieren'], wertsteigerungSichtbar: true,
    internNotiz: 'nicht im PDF', kaufpreisWohnung: 290000, kaufpreisStellplatz: 20000, stellplaetzeAnzahl: 1, stellplaetzeIds: ['e5'], impressionen: [PNG], anhaengeNamen: [],
  },
  {
    id: 'par-kk2', dealId: 'par-d3', name: 'Global Globalallee', scope: 'global', createdAt: '2026-02-01T08:00:00.000Z', updatedAt: '2026-02-02T08:00:00.000Z',
    objSnapshot: { adresse: 'Globalallee 5a, 71032 Böblingen', kaufdatum: '2026-02-01', wohnflaecheGesamt: 910, stellplaetzeAnzahl: 0, einheitenAnzahl: 12 },
    inputs: { ...kkInputs(2300000, 7700), betrachtungsdauerJahre: 10, wohnflaecheGesamt: 910 }, projektTitel: '', wertsteigerungBullets: [], wertsteigerungSichtbar: false,
    internNotiz: '', kaufpreisWohnung: 2300000, kaufpreisStellplatz: 0, stellplaetzeAnzahl: 0, stellplaetzeIds: [], impressionen: [], anhaengeNamen: [],
  },
];

const tabelle = Array.from({ length: 27 }, (_, i) => (i % 10 === 0 ? [i === 0 ? 'PROJEKTKOSTEN' : 'EXIT AUFTEILER', ''] : [`Position ${i}`, `${(i * 12345).toLocaleString('de-DE')} €`]));

const finanzpraes = [{
  id: 'par-fp1', dealId: 'par-d1', bankName: 'Paritätsbank Stuttgart', internNotiz: '', createdAt: '2026-05-01', updatedAt: '2026-05-02',
  slides: [
    { id: 'par-s1', typ: 'deckblatt', visible: true, data: { titel: 'ANKAUF Mehrfamilienhaus', untertitel: 'in Stuttgart, Paritätsweg 1', bildPath: PNG } },
    { id: 'par-s2', typ: 'objektbeschreibung', visible: true, data: { adresse: 'Paritätsweg 1, Stuttgart', baujahr: '1965', einheiten: '6', wohnflaeche: '480', gik: '1.350.000 €', beschreibung: 'Solides MFH\nin ruhiger Lage & <gut> erreichbar' } },
    { id: 'par-s3', typ: 'lagebeschreibung', visible: true, data: { standortBullets: 'Zentrale Lage\nSchulen in der Nähe', anbindungBullets: 'S-Bahn 5 Min' } },
    { id: 'par-s4', typ: 'geschaeftsmodell', visible: true, data: { zielgruppe: '' } },
    { id: 'par-s5', typ: 'projektkalkulation', visible: true, data: { tableHeaders: ['Position', 'Betrag'], tableRows: tabelle, tableTitle: 'Aufteiler-Kalkulation', beschreibung: 'lang' } },
    { id: 'par-s6', typ: 'finanzierungsstruktur', visible: true, data: { gik: '1.587.000 €', em: '238.050 €', ekAnteil: '15%', fm: '1.348.950 €', fkAnteil: '85%', zinsbindung: 'Euribor 3 Monate + 2,5% Marge', kreditnehmer: 'IVT Wohnen GmbH', zusatzBullets: 'Punkt A\nPunkt B' } },
    { id: 'par-s7', typ: 'grundrisse', visible: true, data: { bilder: [PNG, PNG], captions: ['EG', ''] } },
    { id: 'par-s8', typ: 'impressionen', visible: false, data: { bilder: [PNG], captions: ['Fassade'] } },
    { id: 'par-s9', typ: 'referenz', visible: true, data: { projektName: 'Calwer Straße 5', zeilen: 'Notartermin | 12.05.2025 | 750.000 €\nÜbergabe|01.07.2025|' } },
    { id: 'par-s10', typ: 'kundenliste', visible: true, data: { einzelverkauf: 'Kunde A\nKunde B', globalansprachen: '' } },
    { id: 'par-s11', typ: 'organigramm', visible: true, data: { beschreibung: '' } },
    { id: 'par-s12', typ: 'abschluss', visible: true, data: { untertitel: 'Geschäftsführung' } },
  ],
}];

const vorlage = bsSeedVorlage('ankauf');
const begleitscheine = [{
  id: 'par-bs1', typ: 'ankauf', objektId: 'par-o1', dealId: 'par-d1', adresse: 'Paritätsweg 1, 70173 Stuttgart', name: 'Paritätsweg_1_Stuttgart_Ankauf_Prüfung', kopf: 'Ankaufsprozess: Paritätsprüfung',
  createdAt: tag(-10),
  rows: vorlage.rows.map((r, i) => ({ ...r, status: i % 7 === 0 ? 'erledigt' : i % 5 === 0 ? 'In Progress' : 'offen', verantwortung: i % 9 === 0 ? 'GW' : r.verantwortung, sub: r.sub.map((s, j) => ({ ...s, status: j % 2 ? 'erledigt' : 'offen' })) }))
    .concat([]).slice(0, 60).concat(vorlage.rows.slice(-1)),
}];

const SPALTEN = [
  { id: 'te_nr_whg', label: 'TE-Nr. Whg.', type: 'text' }, { id: 'te_nr_garage', label: 'TE-Nr. Garage', type: 'text' },
  { id: 'vermietet_status', label: 'Vermietet / Leerstand', type: 'dropdown', dropdownOptions: ['Vermietet', 'Leerstand'] },
  { id: 'wohnflaeche', label: 'Wohnfläche', type: 'number' }, { id: 'lage', label: 'Lage', type: 'text' }, { id: 'zi', label: 'Zi', type: 'number' },
  { id: 'miteigentumsanteil', label: 'Miteigentumsanteil Whg.', type: 'percent' },
  { id: 'kaltmiete_ist', label: 'Kaltmiete IST Wohnung', type: 'euro' }, { id: 'miete_qm', label: 'Miete / qm', type: 'euro', computed: true },
  { id: 'kaltmiete_soll', label: 'Kaltmiete SOLL', type: 'euro' }, { id: 'kaltmiete_stp', label: 'Kaltmiete Stp.', type: 'euro' },
  { id: 'grundpreis_whg', label: 'Grundpreis Whg.', type: 'euro' }, { id: 'grundpreis_stp', label: 'Grundpreis Stp.', type: 'euro' },
  { id: 'provision', label: 'Provision (% siehe Settings)', type: 'euro', computed: true }, { id: 'sanierung', label: 'Sanierungskosten IVT vor Verkauf', type: 'euro' },
  { id: 'einkaufspreis', label: 'Einkaufspreis', type: 'euro', computed: true }, { id: 'ergebnis_ivt', label: 'Ergebnis IVT (nach Kosten)', type: 'euro', computed: true },
  { id: 'verkaufspreis', label: 'Verkaufspreis Wohnung', type: 'euro' }, { id: 'kp_qm', label: 'KP/m² Wohnung', type: 'euro', computed: true },
  { id: 'rendite_ist', label: 'Rendite Kunde IST', type: 'percent', computed: true }, { id: 'rendite_soll', label: 'Rendite nach Mieterhöhung voraussichtlich', type: 'percent', computed: true },
  { id: 'vertriebsstand', label: 'Vertriebsstand', type: 'multitext' }, { id: 'ampel', label: 'Ampel', type: 'ampel' },
  { id: 'kunde', label: 'Kunde', type: 'text' }, { id: 'notartermin', label: 'Notartermin', type: 'date' }, { id: 'reserviert', label: 'Reserviert', type: 'checkbox' },
];
const vertriebslisten = [{
  id: 'par-vl1', dealId: 'par-d7', createdAt: tag(-20), updatedAt: tag(-2), columns: SPALTEN, hiddenColumns: ['te_nr_whg'],
  rows: [
    { id: 'par-z1', einheitId: 'w1', isStellplatz: false, data: { lage: 'EG links', wohnflaeche: 60, zi: 2, kaltmiete_ist: 600, kaltmiete_soll: 750, grundpreis_whg: 400000, verkaufspreis: 400000, vermietet_status: 'Vermietet', sanierung: 12500, miteigentumsanteil: 12.5, ampel: 'gruen', vertriebsstand: 'Besichtigung\nam Freitag', kunde: 'Familie A', notartermin: '2026-10-15', reserviert: true } },
    { id: 'par-z2', einheitId: 'w2', isStellplatz: false, data: { lage: 'OG rechts', wohnflaeche: 40.5, zi: 2, kaltmiete_ist: 400, kaltmiete_soll: 500, grundpreis_whg: 260000, verkaufspreis: 255000, vermietet_status: 'Vermietet', ampel: 'rot' } },
    { id: 'par-z3', einheitId: 'w3', isStellplatz: false, data: { lage: 'DG', wohnflaeche: 55, zi: 3, kaltmiete_ist: '', kaltmiete_soll: '', vermietet_status: 'Leerstand' } },
    { id: 'par-z4', einheitId: 'p1', isStellplatz: true, data: { te_nr_garage: 'TG-01', kaltmiete_stp: 45, grundpreis_stp: 18000 } },
    { id: 'par-z5', isStellplatz: false, data: {} },
  ],
}];

const projekte = [
  {
    id: 'par-pj1', dealId: 'par-d8', adresse: 'Globalallee 5a', stadt: 'Böblingen', datum: tag(-60), zielVKP: 1200000,
    globalVstatus: 'notar', globalIstKP: 400000, globalKommentar: 'Fonds prüft', globalKaeufer: 'Fonds GmbH', globalNotarDatum: tag(20), globalReservDatum: '',
    gebPIP: [{ text: 'Dach dämmen', status: 'in Arbeit', verantw: '' }, { text: 'Fassade', status: 'offen', verantw: '' }],
    einheiten: [
      { id: 'pe1', typ: 'Wohnung', lage: 'EG links', zimmer: 3, fl: 78.5, kaltmiete: 780, kmMoeglich: 900, zielKP: 240000, grundpreis: 200000, provision: 9520, sanIVT: 12000, ergebnisIVT: 18480,
        istKP: 250000, vstatus: 'sold', vertriebsstand: '25.03 Jonas', vermietet: 'leer', mieterName: 'Meier', pip: 'grn', pipStrategie: 'Bad neu', pipTodos: [], pipTodosText: 'Angebot Bad',
        mieterTodosText: 'Kaution klären', reservDatum: tag(-10), notarDatum: tag(-3), kaeufer: 'Herr K.', vtKommentar: '',
        mieterHistorie: [{ id: 'par-h2', datum: tag(-5), inhalt: 'Mieterhöhung besprochen', ergebnis: 'zugestimmt' }, { id: 'par-h1', datum: tag(-30), inhalt: 'Erstkontakt', ergebnis: '' }] },
      { id: 'pe2', typ: 'Wohnung', lage: 'OG rechts', zimmer: 2, fl: 55, kaltmiete: 560, kmMoeglich: 560, zielKP: 180000, istKP: '175.000', vstatus: 'reserved', pip: 'yel',
        pipTodos: [], mieterHistorie: [], reservDatum: tag(-1), notarDatum: '', kaeufer: '', vtKommentar: '' },
      { id: 'pe3', typ: 'Wohnung', lage: 'DG', zimmer: 0, fl: 0, kaltmiete: 0, kmMoeglich: 0, zielKP: 0, istKP: 0, vstatus: 'notar', pip: 'red', vermietet: 'leer / gekündigt',
        pipTodos: [], mieterHistorie: [], reservDatum: '', notarDatum: '', kaeufer: '', vtKommentar: '' },
      { id: 'pe4', typ: 'Stellplatz', lage: 'TG-07', stk: 2, teNr: 'S7', kaltmiete: 45, istKP: 18000, vstatus: 'noglobal', pip: '', pipTodos: [], mieterHistorie: [] },
    ],
    todos: [
      { id: 'par-t1', cat: '📋 Kaufmännisch / Projekt', text: 'Projekt mit allen durchsprechen', status: 'erledigt', kommentar: 'erledigt am Montag', verantwortlich: 'GW', faellig: tag(-5) },
      { id: 'par-t2', cat: '📋 Kaufmännisch / Projekt', text: 'Kosten für folgende Maßnahmen einholen:\n-\n-', status: 'in progress', kommentar: '', verantwortlich: '', faellig: heute },
      { id: 'par-t3', cat: '📋 Kaufmännisch / Projekt', text: 'GW Kalkulation finalisieren', status: 'offen', kommentar: '', verantwortlich: 'Jonas', faellig: heute },
      { id: 'par-t4', cat: '⚖️ Rechtliche Due Diligence', text: 'Grundbuchauszug prüfen', status: 'erledigt', kommentar: '', verantwortlich: '', faellig: '' },
      { id: 'par-t5', cat: '⚖️ Rechtliche Due Diligence', text: 'Kaufvertrag final freigegeben', status: 'erledigt', kommentar: '', verantwortlich: '', faellig: '' },
      { id: 'par-t6', cat: '🔧 Technische Due Diligence', text: 'Baulasten prüfen', status: 'offen', kommentar: 'Amt angefragt', verantwortlich: 'Martin', faellig: tag(3) },
      { id: 'par-t7', cat: '🧪 Eigene Kategorie', text: 'Sonderpunkt', status: 'in progress', kommentar: '', verantwortlich: '', faellig: '' },
    ],
  },
  { id: 'par-pj2', dealId: '', adresse: 'Papierkorbweg 9', stadt: 'Ulm', datum: tag(-90), zielVKP: 0, einheiten: [], todos: [], gebPIP: [], _deleted: true, _deletedAt: Date.now() - 86_400_000 },
];

// Alle Vorlagen (sonst legt die alte App sie beim Öffnen an) + eigene Filter aus Chip/Suche, wie „Aktuelle als Filter speichern…“
const gespeicherteFilter = [
  ...Object.values(FILTER_TEMPLATES).flat().map((f, i) => ({ id: `par-sf-v${i}`, ...f, createdAt: 1_789_600_000, updatedAt: 1_789_600_000 })),
  { id: 'par-sf-d1', module: 'deals', name: 'Par Angekauft', criteria: [{ field: 'status', op: 'equals', value: 'Angekauft' }], createdAt: 1_789_600_100, updatedAt: 1_789_600_100 },
  { id: 'par-sf-d2', module: 'deals', name: 'par weg', criteria: [{ field: 'adresse', op: 'contains', value: 'weg' }, { field: 'kalk.kaufpreis', op: 'lte', value: 1_400_000 }], createdAt: 1_789_600_100, updatedAt: 1_789_600_100 },
  { id: 'par-sf-o1', module: 'objects', name: 'Par Straße', criteria: [{ field: 'strasse', op: 'contains', value: 'straße' }], createdAt: 1_789_600_100, updatedAt: 1_789_600_100 },
  { id: 'par-sf-m1', module: 'makler', name: 'Par mit Firma', criteria: [{ field: 'firma', op: 'is_set' }, { field: 'prio', op: 'in', value: ['A', 'b'] }], createdAt: 1_789_600_100, updatedAt: 1_789_600_100 },
];

// Kopien der Makler-Stammdaten im Deal, wie syncDealToMakler sie in der alten App pflegt
for (const d of deals as { maklerId?: string; maklerName?: string; maklerFirma?: string; maklerTel?: string; maklerEmail?: string }[]) {
  const m = makler.find((x) => x.id === d.maklerId) as { name?: string; firma?: string; tel?: string; email?: string } | undefined;
  if (m) Object.assign(d, { maklerName: m.name ?? '', maklerFirma: m.firma ?? '', maklerTel: m.tel ?? '', maklerEmail: m.email ?? '' });
}

/** KV-Schlüssel → Wert, genau so, wie die alte App sie speichert. */
export const PARITAET_BESTAND: Record<string, unknown> = {
  'immo-objects': objekte,
  'immo-makler': makler,
  'immo-deals': deals,
  'immo-kundenkalkulationen': kundenkalkulationen,
  'immo-finanzpraes': finanzpraes,
  'immo-begleitscheine': begleitscheine,
  'immo-vertriebslisten': vertriebslisten,
  'immo-projekte': projekte,
  'immo-saved-filters': gespeicherteFilter,
};

export const PARITAET_IDS = {
  deals: deals.map((d) => d.id),
  dealStatus: Object.fromEntries(deals.map((d) => [d.id, d.status])) as Record<string, string>,
  dealRoh: Object.fromEntries(deals.map((d) => [d.id, d])) as Record<string, { angebotsDatum?: string; nachfassFreq?: string }>,
  kundenkalkulationen: kundenkalkulationen.map((k) => k.id),
  praesentation: { id: 'par-fp1', dealId: 'par-d1', folien: finanzpraes[0]!.slides.map((s) => s.id) },
  begleitschein: 'par-bs1',
  vertriebsliste: 'par-vl1',
  projekt: { id: 'par-pj1', anlegenAusDeal: 'par-d7' },
  filter: gespeicherteFilter,
};
