/* eslint-disable @typescript-eslint/no-explicit-any -- Kontext im Altformat */
/**
 * Textvorlagen mit Platzhaltern (E-Mail/WhatsApp an Makler). Wörtlich aus gg-immohandel src/lib/vorlagen.ts
 * (ohne Speicher; `uid` als Parameter), dazu die Regeln aus settingsVorlagenSave und mkApplyVorlage.
 */

// ── Datenmodell ──────────────────────────────────────────────
export interface Vorlage {
  id: string;
  name: string;
  kanal: 'email' | 'whatsapp' | 'beide';
  betreff?: string;
  text: string;
}

export interface VorlagenContext {
  maklerName?: string;
  maklerFirma?: string;
  adresse?: string;
  stadt?: string;
  kaufpreis?: string;
  wohnflaeche?: string;
  meinName?: string;
}

// ── Platzhalter-Auflösung ────────────────────────────────────
export function resolveVorlage(text: string, ctx: VorlagenContext): string {
  return text.replace(/\{(\w+)\}/g, (_, key) => (ctx as any)[key] || '');
}

export function standardVorlagen(neueId: () => string): Vorlage[] {
  return [
    {
      id: neueId(), name: 'Erstanfrage', kanal: 'email',
      betreff: 'Anfrage: {adresse}, {stadt}',
      text: 'Sehr geehrte Damen und Herren,\n\nich habe Ihr Angebot in {stadt} ({adresse}) gesehen und bin als Bestandshalter an dem Objekt interessiert.\n\nKönnten Sie mir bitte das Exposé sowie weitere Unterlagen zukommen lassen?\n\nMit freundlichen Grüßen\n{meinName}'
    },
    {
      id: neueId(), name: 'Nachfass', kanal: 'beide',
      betreff: 'Nochmal: {adresse}, {stadt}',
      text: 'Guten Tag {maklerName},\n\nich melde mich nochmals bezüglich {adresse} in {stadt}. Gibt es Neuigkeiten zum Objekt?\n\nIch freue mich auf Ihre Rückmeldung.\n\nViele Grüße\n{meinName}'
    },
    {
      id: neueId(), name: 'Besichtigungsanfrage', kanal: 'email',
      betreff: 'Besichtigungstermin: {adresse}, {stadt}',
      text: 'Sehr geehrte/r {maklerName},\n\nnach Durchsicht der Unterlagen zum Objekt {adresse}, {stadt} würde ich gerne einen Besichtigungstermin vereinbaren.\n\nWann wäre ein Termin in den nächsten Tagen möglich?\n\nMit freundlichen Grüßen\n{meinName}'
    },
    {
      id: neueId(), name: 'Unterlagenabfrage', kanal: 'email',
      betreff: 'Unterlagen: {adresse}, {stadt}',
      text: 'Guten Tag {maklerName},\n\nfür unsere Due-Diligence-Prüfung zum Objekt {adresse}, {stadt} benötige ich bitte folgende Unterlagen:\n\n- Grundbuchauszug\n- Mieterliste mit aktuellen Mieten\n- Energieausweis\n- Grundrisse\n\nVielen Dank im Voraus.\n\nMit freundlichen Grüßen\n{meinName}'
    },
    {
      id: neueId(), name: 'Dankeschön', kanal: 'beide',
      betreff: 'Danke für den Termin: {adresse}',
      text: 'Hallo {maklerName},\n\nvielen Dank für den Besichtigungstermin und die ausführliche Führung durch das Objekt {adresse}.\n\nIch melde mich zeitnah mit einer Rückmeldung.\n\nViele Grüße\n{meinName}'
    },
  ];
}

/** settingsVorlagenSave: Name/Betreff getrimmt, Text unverändert; Vorlagen ohne Name und Text fallen weg. */
export function vorlagenBereinigen(vorlagen: Vorlage[]): Vorlage[] {
  return vorlagen
    .map((v) => ({ ...v, name: v.name.trim(), ...(v.betreff !== undefined ? { betreff: v.betreff.trim() } : {}) }))
    .filter((v) => v.name.trim() || v.text.trim());
}

/** Vorlagen für einen Kanal (Auswahl beim Makler: E-Mail = email oder beide). */
export const vorlagenFuerKanal = (vorlagen: Vorlage[], kanal: 'email' | 'whatsapp') => vorlagen.filter((v) => v.kanal === kanal || v.kanal === 'beide');

/**
 * mkApplyVorlage: Kontext aus dem Makler, seinem ersten nicht archivierten Deal und dessen Objekt (Altformat).
 */
export function vorlagenKontext(makler: any | null, deals: any[], objekte: any[], meinName: string): VorlagenContext {
  const deal = makler ? deals.find((d: any) => d.maklerId === makler.id && d.status !== 'Archiv') : null;
  const obj = deal?.objId ? objekte.find((o: any) => o.id === deal.objId) : null;
  return {
    maklerName: makler?.name || '',
    maklerFirma: makler?.firma || '',
    adresse: deal?.adresse || obj?.strasse || '',
    stadt: deal?.stadt || obj?.stadt || '',
    kaufpreis: deal?.kalk?.kaufpreis ? Math.round(deal.kalk.kaufpreis).toLocaleString('de-DE') : '',
    wohnflaeche: obj?.wohnflaeche ? Math.round(+obj.wohnflaeche).toLocaleString('de-DE') : '',
    meinName,
  };
}

/** buildMailto (vertrieb.ts): Zeilenumbrüche als CRLF — Outlook erwartet das. */
export function mailtoAdresse(email: string, subject: string, body: string): string {
  const params: string[] = [];
  if (subject) params.push('subject=' + encodeURIComponent(subject));
  if (body) params.push('body=' + encodeURIComponent(body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')));
  return `mailto:${email}${params.length ? '?' + params.join('&') : ''}`;
}

/** vtBuildVorlagenCtx: Kontext für die Mail-Auswahl einer Deal-Karte (Deal im Altformat, sein Objekt). */
export function vorlagenKontextDeal(d: any, o: any | null, meinName: string): VorlagenContext {
  const obj = o || {};
  return {
    maklerName: d.maklerName || '',
    maklerFirma: d.maklerFirma || '',
    adresse: [d.adresse, d.hausnr || obj.hausnr].filter(Boolean).join(' ') || obj.strasse || '',
    stadt: d.stadt || obj.stadt || '',
    kaufpreis: d.kalk?.kaufpreis ? Math.round(d.kalk.kaufpreis).toLocaleString('de-DE') : '',
    wohnflaeche: obj.wohnflaeche ? Math.round(+obj.wohnflaeche).toLocaleString('de-DE') : '',
    meinName,
  };
}

/** vtMaklerMailPicker: nur Makler-Stammdaten und eigener Name. */
export const vorlagenKontextMakler = (m: { name?: string | null; firma?: string | null }, meinName: string): VorlagenContext => ({ maklerName: m.name || '', maklerFirma: m.firma || '', meinName });

/** Einträge der Mail-Auswahl: je E-Mail-Vorlage fertiger mailto-Link mit aufgelöstem Betreff. */
export function mailAuswahl(email: string, vorlagen: Vorlage[], ctx: VorlagenContext) {
  return vorlagenFuerKanal(vorlagen, 'email').map((v) => {
    const betreff = v.betreff ? resolveVorlage(v.betreff, ctx) : '';
    return { id: v.id, name: v.name, betreff, href: mailtoAdresse(email, betreff, resolveVorlage(v.text, ctx)) };
  });
}
