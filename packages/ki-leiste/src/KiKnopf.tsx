/** Der rote Sprechkreis oben in der Mitte: öffnet und schließt die Leiste, von jedem Dialog aus. */
import { useKiLeiste } from './kontext.tsx';
import { Sprechkreis } from './Sprechkreis.tsx';

export const KI_ROT = '#e03131';

export function KiKnopf({ groesse = 34 }: { groesse?: number }) {
  const { offen, setOffen } = useKiLeiste();
  const label = offen ? 'KI-Leiste schließen' : 'KI-Leiste öffnen';
  return (
    <button type="button" className="kl-knopf" aria-label={label} title={label} aria-pressed={offen} onClick={() => setOffen(!offen)}>
      <Sprechkreis groesse={groesse} farbe={KI_ROT} zustand={offen ? 'denkt' : 'ruhig'} titel="KI-Assistent" saat={7} />
    </button>
  );
}
