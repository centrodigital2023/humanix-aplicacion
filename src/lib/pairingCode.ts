// Código de emparejamiento de un reloj o pulsera (Samsung Health, Tasker…): 12 caracteres de un alfabeto de 32 sin letras que se confunden
// (60 bits, de números aleatorios del navegador). Antes salía de un resumen de 32 bits que incluía la hora: se podía adivinar. Quien tiene el
// código puede enviar lecturas a nombre de la persona, así que tiene que ser imposible de adivinar; además, la base de datos frena a quien
// falla muchas veces (migración 20261014110000).

export const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 12;

/** Llena el arreglo con bytes aleatorios (criptográficos en el navegador; inyectable en las pruebas). */
export type FillRandom = (bytes: Uint8Array) => Uint8Array;

const browserRandom: FillRandom = (bytes) => {
  globalThis.crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
  return bytes;
};

/**
 * `256 % 32 === 0`: tomar los 5 bits bajos de cada byte reparte los 32 símbolos por igual (sin sesgo). Los códigos se generan en el
 * navegador de quien conecta el reloj; nunca con `Math.random()` ni con la hora.
 */
export function generatePairingCode(
  length: number = PAIRING_CODE_LENGTH,
  random: FillRandom = browserRandom,
): string {
  if (!Number.isInteger(length) || length < PAIRING_CODE_LENGTH || length > 64)
    throw new Error(`El código lleva entre ${PAIRING_CODE_LENGTH} y 64 caracteres`);
  const bytes = random(new Uint8Array(length));
  if (bytes.length !== length) throw new Error("Fuente de números aleatorios no válida");
  let out = "";
  for (let i = 0; i < length; i++) out += PAIRING_ALPHABET[(bytes[i] ?? 0) & 31];
  return out;
}

/** ¿Tiene la forma de un código actual? (los de 8 caracteres de antes siguen funcionando, pero ya no se generan). */
export const isCurrentPairingCode = (code: string): boolean =>
  new RegExp(`^[${PAIRING_ALPHABET}]{${PAIRING_CODE_LENGTH},64}$`).test(code);
