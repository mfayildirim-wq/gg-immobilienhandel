import { STANDARD_ORGANIGRAMM_BILD } from '@gg/documents';

/** Künstlicher Altbestand mit allen bekannten Sonderfällen der alten App (keine echten Daten). */
export const ALTBESTAND = {
  'immo-makler': [
    {
      id: 'mk-1', name: 'Anna Alt', firma: 'Alt Immobilien', tel: '+49 30 111', email: 'anna@example.test', prio: 'A',
      kontaktFreq: 'Monatlich', lastContact: '2026-08-01', nextContact: '2026-09-01', erstellt: '2026-01-10',
      notizen: 'Anruf: will Exposé schicken',
      komm: [
        { id: 'k-neu', ts: '16.09.2026 10:15', kanal: 'tel', richtung: 'aus', text: 'Rückruf vereinbart' },
        { id: 'k-alt', ts: 'Altbestand', kanal: 'notiz', text: 'kennt Eigentümer' },
      ],
      importedEmailUids: ['uid-1'],
      personal: { geburtsdatum: '1970-05-01' },
    },
    { id: 'mk-2', name: 'Bernd Nie', kontaktFreq: 'Nicht kontaktieren', prio: 'X', _deleted: true, _deletedAt: 1_758_110_700_000 },
    { id: 'mk-3', name: 'Clara Komisch', kontaktFreq: 'Zweiwöchentlich', lieblingsfarbe: 'blau' },
  ],
  'immo-objects': [
    {
      id: 'obj-1', strasse: 'Musterstraße', hausnr: '12', plz: '70178', stadt: 'Stuttgart', baujahr: '1978',
      einheitenAnz: '6', wohnflaeche: '480', angebotspreis: '1.200.000', istmiete: '5400', datum: '2026-03-23',
      status: 'In Prüfung', energie: 'D', besonderheit: 'Denkmal',
      einheiten: [
        { id: 'e1', typ: 'Wohnung', lage: 'EG links', zimmer: 3, flaeche: 78, kaltmiete: 780, vermiet: 'Vermietet' },
        { id: 'e2', typ: 'Stellplatz', lage: 'Hof', stueck: 3, kaltmiete: 300 },
      ],
    },
    { id: 'obj-2', strasse: 'Leerweg', angebotspreis: 'auf Anfrage', einheiten: [{ id: 'e1', typ: 'Wohnung', lage: 'EG' }] },
  ],
  'immo-deals': [
    {
      id: 'deal-1', objId: 'obj-1', maklerId: 'mk-1', status: 'Angekauft', angebotsDatum: '2026-03-23', nachfassFreq: 'Wöchentlich',
      adresse: 'Musterstraße', stadt: 'Stuttgart', maklerTel: '+49 30 999', maklerName: 'Anna Alt',
      kalk: { kaufpreis: 1200000, notar: 2 },
      einheiten: [
        { id: 'de1', typ: 'Wohnung', lage: 'EG links', fl_ist: 78, mi_ist: 780, _psUnitId: 4711 },
        { id: 'de2', typ: 'Wohnung', lage: 'EG rechts', fl: '82,5', mi_ist: '820', mi_neu_manual: true, mi_neu: 950, rend_k: '4.5', vkp: '' },
        { id: 'de3', typ: 'Stellplatz', lage: 'Hof', stk: '2', mi_ist: 120, rend_k: 5, vkp: 36000 },
      ],
      sanierung: [{ id: 's1', desc: 'Dach', amt: 45000, scope: 'auf' }, { id: 's2', desc: 'Fenster', amt: '38.000' }, { id: 's3', desc: 'Keller', amt: 9000, scope: 'glo' }],
      kommentare: [{ ts: '17.09.2026 09:00', text: 'Notartermin' }, { ts: 'Altbestand', text: 'erste Notiz' }],
      notizen: 'steht zusätzlich im Feld',
      kalkVarianten: [{ id: 'v1', name: 'Erstangebot', ts: '2026-03-20T10:00:00.000Z', kalk: { kaufpreis: 1100000 }, einheiten: [], sanierung: [] }],
      _prio: { order: 4 }, _due: 'x',
    },
    {
      id: 'deal-2', objId: 'obj-weg', maklerId: 'mk-weg', status: 'Verhandlung', adresse: 'Verwaistgasse', hausnr: '1', stadt: 'Ulm',
      maklerName: 'Max Waise', maklerTel: '+49 1', notizen: 'nur Notiz', nachfassFreq: 'Nie',
      kalk: { kaufpreis: '750.000' }, _deleted: 1_758_110_700_000,
    },
    { id: 'deal-3', objId: 'obj-2', status: 'Closing Path', maklerName: 'Nur Kopie' },
  ],
  'immo-kundenkalkulationen': [
    {
      id: 'kk-1', dealId: 'deal-1', name: 'Kalkulation EG rechts', scope: 'aufteiler', einheitId: 'de2',
      createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z',
      objSnapshot: { adresse: 'Musterstraße 12, Stuttgart', kaufdatum: '2026-05-01', wohnflaecheGesamt: 82.5, stellplaetzeAnzahl: 0, einheitenAnzahl: 1 },
      inputs: {
        kaufpreis: 400000, notarPct: 0.015, grundbuchPct: 0.005, grundsteuerPct: 0.05, maklerPct: 0, sonstigePct: 0,
        sanierungsposten: [{ label: 'Bad', amount: 20000, modus: 'aktivieren' }], nettokaltmieteMonat: 950, stellplatzMiete: 0, sonstigeMiete: 0,
        umlagefaehig: 0, mieterhoehungJaehrlich: 0.02, nichtUmlagefaehig: 40, kostensteigerungJaehrlich: 0, wertsteigerungJaehrlich: 0.02,
        anteilGebaeudeKaufpreis: 0.7, afaSatz: 0.02, grenzsteuersatz: 0.42, darlehen: [{ label: 'Darlehen I', summe: 320000, zinssatz: 0.04, tilgung: 0.02 }],
        kaufjahr: 2026, betrachtungsdauerJahre: 10, wohnflaecheGesamt: 82.5,
      },
      projektTitel: 'Einzelverkauf EG rechts', wertsteigerungBullets: ['KfW'], wertsteigerungSichtbar: true, disclaimerOverride: 'alter Text',
      stellplaetzeIds: ['de3'], stellplaetzeAnzahl: 1, impressionen: ['photo:obj-1/a.jpg', 'data:image/jpeg;base64,AAA'],
    },
    { id: 'kk-2', dealId: 'deal-weg-weg', name: 'Waise', scope: 'global', inputs: { kaufpreis: 1 } },
  ],
  'immo-finanzpraes': [
    {
      id: 'fp-1', dealId: 'deal-1', bankName: 'Kreissparkasse', internNotiz: 'intern', createdAt: '2026-05-01', updatedAt: '2026-05-02',
      slides: [
        { id: 'sl-1', typ: 'deckblatt', visible: true, data: { titel: 'ANKAUF Mehrfamilienhaus', bilder: ['photo:obj-1/f-1'] } },
        { id: 'sl-1', typ: 'projektkalkulation', visible: false, data: { tableRows: [['Kaufpreis', '1.200.000 €']], _scope: 'aufteiler', _snapshot: { gik: 1 } } },
        { id: 'sl-3', typ: 'altertyp', visible: true, data: {} },
      ],
    },
    { id: 'fp-2', dealId: 'deal-weg', bankName: 'Waise', slides: [] },
    { id: 'fp-3', dealId: 'deal-1', bankName: 'Alt', slides: [{ id: 'sl-9', typ: 'abschluss', visible: true }], _deleted: true, _deletedAt: 1_758_110_700_000 },
  ],
  'immo-finanzpraes-defaults': {
    geschaeftsmodell: { zielgruppe: 'Private Banking Kunden' },
    organigramm: { bild: STANDARD_ORGANIGRAMM_BILD, beschreibung: '' },
    abschluss: { untertitel: 'Gerry & Sven', bild: 'data:image/jpeg;base64,EIGENES' },
  },
  'immo-vertriebslisten': [
    {
      id: 'vl-1', dealId: 'deal-1', createdAt: '2026-06-01', updatedAt: '2026-06-02', hiddenColumns: ['garten'],
      columns: [{ id: 'lage', label: 'Lage', type: 'text' }, { id: 'miete_qm', label: 'Miete / qm', type: 'euro', computed: true }],
      rows: [
        { id: 'z1', einheitId: 'de1', isStellplatz: false, data: { lage: 'EG links', wohnflaeche: 78, kaltmiete_ist: 780, ampel: 'gruen' } },
        { id: 'z2', einheitId: 'weg', isStellplatz: true, data: { te_nr_garage: 'Hof' } },
      ],
    },
    { id: 'vl-2', dealId: 'deal-weg', rows: [] },
  ],
  'immo-vertriebslisten-defaults': [{ id: 'lage', label: 'Lage', type: 'text' }],
  'immo-vorlagen': [
    { id: 'vl-a', name: 'Erstanfrage', kanal: 'email', betreff: 'Anfrage: {adresse}', text: 'Guten Tag {maklerName},\n\n…' },
    { id: 'vl-b', name: 'WA kurz', kanal: 'whatsapp', text: 'Hallo {maklerName} 👋' },
  ],
  'immo-saved-filters': [
    { id: 'sf-1', module: 'deals', name: '🔥 Heiße Pipeline', criteria: [{ field: 'status', op: 'in', value: ['Closing Path', 'Angebot abgegeben'] }], createdAt: 1_789_630_611, updatedAt: 1_789_630_700 },
    { id: 'sf-2', module: 'deals', name: '🔥 Heiße Pipeline', criteria: [{ field: 'status', op: 'in', value: ['Closing Path', 'Angebot abgegeben'] }], createdAt: 1_789_630_900, updatedAt: 1_789_630_900 },
    { id: 'sf-3', module: 'makler', name: 'Eigene A', criteria: [{ field: 'prio', op: 'equals', value: 'A' }, { field: 'name', op: 'contains', value: 'an' }], createdAt: 1_789_630_611 },
    { id: 'sf-4', module: 'projekte', name: 'gibt es nicht', criteria: [] },
  ],
  'immo-projekte': [
    {
      id: 'pj-1', dealId: 'deal-1', adresse: 'Musterstraße 12', stadt: 'Stuttgart', datum: '2026-05-10', zielVKP: 1_507_778,
      globalVstatus: 'notar', globalIstKP: '1.400.000', globalKommentar: 'Käufer prüft', globalKaeufer: 'Fonds', globalNotarDatum: '2026-10-01', globalReservDatum: '',
      einheiten: [
        {
          id: 'de1', typ: 'Wohnung', lage: 'EG links', zimmer: 3, fl: 78, kaltmiete: 780, kmMoeglich: 900, zielKP: 240000, pip: 'grn', pipStrategie: 'Bad neu', pipTodos: [],
          pipTodosText: 'Angebot Bad', mieterHistorie: [{ id: 'h2', datum: '2026-06-02', inhalt: 'Mieterhöhung', ergebnis: 'zugestimmt' }, { datum: '2026-05-20', inhalt: 'Erstkontakt', ergebnis: '' }],
          vstatus: 'sold', reservDatum: '2026-07-01', notarDatum: '15.08.2026', kaeufer: 'Herr K.', istKP: '250.000', vtKommentar: '', grundpreis: 200000, vermietet: 'leer',
          vertriebsstand: '25.03 Jonas', mieterName: 'Meier', mieterTodosText: 'Kaution klären',
        },
        { id: 'de-weg', typ: 'Stellplatz', lage: 'Hof', stk: 2, pipTodos: ['alt'], vstatus: 'none', istKP: 0 },
      ],
      todos: [
        { id: 't1', cat: '📋 Kaufmännisch / Projekt', text: 'Kosten einholen:\n-\n-', status: 'in progress', kommentar: '', verantwortlich: 'GW', faellig: '2026-09-17' },
        { id: 't2', cat: '📋 Kaufmännisch / Projekt', text: 'Altpunkt', done: true },
        { id: 't3', cat: '🧪 Eigene', text: 'Offen ohne Status' },
      ],
      gebPIP: [{ text: 'Dach', status: 'in Arbeit', verantw: '' }],
    },
    { id: 'pj-2', dealId: 'deal-gibt-es-nicht', adresse: 'Ohne Deal 1', stadt: '', einheiten: [], todos: [], gebPIP: [], zielVKP: 0, _deleted: true, _deletedAt: 1_758_110_700_000 },
  ],
  'immo-begleitscheine': [
    {
      id: 'bs-1', typ: 'ankauf', objektId: 'obj-1', dealId: 'deal-1', adresse: 'Musterstraße 12, 70178 Stuttgart', name: 'Musterstraße_12_Stuttgart_Ankauf_IVT',
      kopf: 'Ankaufsprozess: MFH', createdAt: '2026-05-01', updatedAt: '2026-05-03', archiviert: true, archiviertAm: '2026-05-03',
      rows: [
        { id: 'r12', lvl: 2, text: 'Projekt durchsprechen', verantwortung: 'GW', status: 'erledigt', sub: [{ id: 'r12s1', text: 'Termin', status: 'In Progress' }] },
        { id: 'bs-final', lvl: 1, text: 'vollständig abgearbeitet', verantwortung: '', status: 'erledigt', sub: [], fix: true },
      ],
    },
    { id: 'bs-2', typ: 'verkauf', objektId: 'obj-nirgends', name: 'Waise', rows: [] },
    { id: 'bs-3', typ: 'verkauf', objektId: 'obj-2', dealId: 'deal-gibt-es-nicht', whgNr: '02', name: 'Leerweg_Verkauf_02_X', kopf: '', rows: [], createdAt: '2026-06-01', _deleted: true, _deletedAt: 1_758_110_700_000 },
  ],
  'immo-bs-vorlage-ankauf': { typ: 'ankauf', kopf: 'Eigener Kopf', rows: [{ id: 'r11', lvl: 1, text: 'Kaufmännisch', verantwortung: '', status: 'offen', sub: [] }], updatedAt: '2026-04-01' },
  'immo-bs-aktionen': [{ typ: 'verkauf', aktionen: [
    { id: 'va1', label: 'Brief', typ: 'vordruck-brief', aktiv: true, rowId: 'bs-final', vordruckId: 'vd-1' },
    { id: 'va2', label: 'Alt', typ: 'vordruck-brief', aktiv: false, rowId: 'bs-final', vordruckId: 'vd-geloescht' },
  ] }],
  'immo-bs-vordrucke': [{ id: 'vd-1', nummer: 'F065', titel: 'Anschreiben', art: 'brief', inhalt: 'Sehr geehrte … {adresse}', aktiv: true }],
  'tabelle:deal_documents': [
    { id: 'doc-1', deal_id: 'deal-1', original_name: 'Exposé Musterstraße.pdf', mime_type: 'application/pdf', size_bytes: 512000, label: '', uploaded_at: 1_758_110_700 },
    { id: 'doc-2', deal_id: 'deal-1', original_name: 'Teilungserklärung (neu).pdf', mime_type: 'application/pdf', size_bytes: 1024, label: 'TE', uploaded_at: 1_758_110_800 },
    { id: 'doc-waise', deal_id: 'deal-gibt-es-nicht', original_name: 'x.pdf', mime_type: 'application/pdf', size_bytes: 1, label: '', uploaded_at: 1_758_110_800 },
  ],
  'tabelle:obj_photos': [
    { id: 'f-1', obj_id: 'obj-1', original_name: 'Fassade.jpg', mime_type: 'image/jpeg', size_bytes: 123456, sort_order: 0, uploaded_at: 1_758_110_700 },
    { id: 'f-2', obj_id: 'obj-1', original_name: 'Plan.png', mime_type: 'image/png', size_bytes: 2048, sort_order: 1, uploaded_at: 1_758_110_800 },
    { id: 'f-waise', obj_id: 'obj-geloescht', original_name: 'weg.jpg', mime_type: 'image/jpeg', size_bytes: 1, sort_order: 0, uploaded_at: 1 },
  ],
  'immo-kkalk-hinweise': ['Mietsteigerung bei Neuvermietung'],
  'immo-kalk-defaults': { rp: 10 },
};
