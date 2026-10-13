import { NumberInput, type NumberInputProps } from '@mantine/core';
import { useState } from 'react';
import { alsZahl } from '../lib/format.ts';

type Props = Omit<NumberInputProps, 'value' | 'onChange'> & {
  value: number | '' | null | undefined;
  /** Jede vollständige Zahl beim Tippen; `null` = Feld geleert. Halbfertiges („4,“ oder „-“) wird nicht gemeldet. */
  onWert: (n: number | null) => void;
};

/**
 * Zahleneingabe, die beim Tippen nichts umschreibt.
 *
 * Mantines NumberInput meldet Halbfertiges wie „4,“ als Text. Wer daraus 0 oder null macht oder den Wert für die
 * Anzeige umrechnet (Zinssatz 0,047 ↔ 4,7 %), schreibt dem Nutzer mitten im Tippen ein neues Feld hin: aus „4,“
 * wurde „0 %“, Kommastellen ließen sich nur per Einfügen setzen. Deshalb gilt, solange das Feld den Fokus hat, der
 * getippte Text (ab dem ersten Tastendruck); der gespeicherte Wert wird erst beim Verlassen wieder angezeigt (dann formatiert).
 */
export function Zahlfeld({ value, onWert, onBlur, ...rest }: Props) {
  // null = seit dem Fokus noch nichts getippt. Bewusst nicht schon beim Fokus setzen: das neue Rendern hob eine
  // gerade gemachte Markierung (Klick, Strg+A) wieder auf, und die erste Ziffer landete hinter dem alten Wert.
  const [text, setText] = useState<number | string | null>(null);
  return (
    <NumberInput
      {...rest}
      value={text ?? value ?? ''}
      onBlur={(e) => { setText(null); onBlur?.(e); }}
      onChange={(v) => {
        setText(v);
        const n = alsZahl(v);
        if (n !== null || v === '') onWert(n);
      }}
    />
  );
}
