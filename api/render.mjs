// Function 2 von 2: alles, was einen Browser startet oder ähnlich lange rechnet (PDF- und PPTX-Exporte).
// Dieselbe App wie api/index.mjs — nur mit der Laufzeit und Instanzgröße, die ein Chromium braucht
// (vercel.json → functions; die Speichergröße steht im Vercel-Dashboard). Welche Routen hierher zeigen: vercel.json → rewrites.
export * from '../apps/api/dist/vercel.mjs';
