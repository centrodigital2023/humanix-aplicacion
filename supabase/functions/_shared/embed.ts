// Embedding compartido — pseudo-embedding determinístico de 768 dimensiones.
// Usamos una proyección hash (FNV-1a) sobre tokens del texto para producir
// un vector estable sin depender de un proveedor externo.
// Es suficiente para matching semántico básico (coocurrencia de términos)
// y mantiene compatibilidad con la columna vector(768) existente.

const DIMS = 768;

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9áéíóúñ\s]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && t.length <= 32);
}

export function embedText(text: string): number[] {
  const vec = new Float32Array(DIMS);
  const tokens = tokenize(text);
  if (tokens.length === 0) return Array.from(vec);

  // Unigrams + bigrams para capturar contexto.
  const grams: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    grams.push(tokens[i] + "_" + tokens[i + 1]);
  }

  for (const g of grams) {
    const h1 = fnv1a(g);
    const h2 = fnv1a("salt::" + g);
    const idx = h1 % DIMS;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  // L2 normalize (clave para cosine distance del operador <=> de pgvector).
  let norm = 0;
  for (let i = 0; i < DIMS; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(DIMS);
  for (let i = 0; i < DIMS; i++) out[i] = vec[i] / norm;
  return out;
}
