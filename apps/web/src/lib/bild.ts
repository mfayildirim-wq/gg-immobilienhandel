/**
 * Foto vor dem Hochladen verkleinern (Port von compressFileToDataUrl, gg-immohandel src/lib/photoStorage.ts):
 * höchstens 1280 px breit, JPEG 0,78. HEIC (iPhone), das der Browser nicht umrechnen kann, geht unverändert hoch.
 * 30 s Zeitlimit je Bild, damit ein hängendes Bild den Stapel nicht aufhält.
 */
export function istHeic(datei: File): boolean {
  const name = datei.name.toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif') || datei.type === 'image/heic' || datei.type === 'image/heif';
}

export function bildVerkleinern(datei: File, maxBreite = 1280, qualitaet = 0.78): Promise<Blob> {
  const heic = istHeic(datei);
  return new Promise((fertig, fehler) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    const aufraeumen = () => { clearTimeout(zeit); URL.revokeObjectURL(url); img.onload = img.onerror = null; };
    const zeit = setTimeout(() => { aufraeumen(); fehler(new Error(`Timeout (30s) bei ${datei.name}`)); }, 30_000);
    img.onload = () => {
      const faktor = Math.min(1, maxBreite / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * faktor);
      canvas.height = Math.round(img.height * faktor);
      const ctx = canvas.getContext('2d');
      if (!ctx) { aufraeumen(); fehler(new Error('Canvas-Kontext nicht verfügbar')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        aufraeumen();
        if (blob) fertig(blob);
        else if (heic) fertig(datei);
        else fehler(new Error(`Bild „${datei.name}“ konnte nicht umgerechnet werden`));
      }, 'image/jpeg', qualitaet);
    };
    img.onerror = () => {
      aufraeumen();
      if (heic) fertig(datei);
      else fehler(new Error(`Bild „${datei.name}“ konnte nicht geladen werden`));
    };
    img.src = url;
  });
}
