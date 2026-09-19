import { BS_EBENE_FARBE, BS_EBENE_TEXTFARBE, BS_STATUS, BS_STATUS_FARBE, BS_STATUS_TEXTFARBE, type BsStatus } from '@gg/domain';

/** Status-Auswahl in den Excel-Farben (J1/J2). */
export function StatusWahl({ wert, aendern, label }: { wert: BsStatus; aendern: (s: BsStatus) => void; label: string }) {
  return (
    <select aria-label={label} value={wert} onChange={(e) => aendern(e.currentTarget.value as BsStatus)}
      style={{ background: BS_STATUS_FARBE[wert], color: BS_STATUS_TEXTFARBE[wert], border: 'none', borderRadius: 4, padding: '4px 6px', fontSize: 12, fontWeight: 600, width: '100%', cursor: 'pointer' }}>
      {BS_STATUS.map((s) => <option key={s} value={s} style={{ background: '#fff', color: '#000' }}>{s}</option>)}
    </select>
  );
}

export const ebeneStil = (lvl: 1 | 2 | 3) => ({ background: BS_EBENE_FARBE[lvl], color: BS_EBENE_TEXTFARBE[lvl] });
