// Vercel-Function für die ganze API. Der Inhalt entsteht im Bauschritt (`pnpm --filter @gg/api bau:vercel`):
// die Pakete des Arbeitsbereichs sind TypeScript-Quellen, die der Node-Builder von Vercel nicht selbst übersetzt.
export * from '../apps/api/dist/vercel.mjs';
