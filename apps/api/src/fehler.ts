/** Fachlicher Fehler mit HTTP-Status; die Routen übersetzen ihn in eine JSON-Antwort. */
export class FachFehler extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
