// Dirección del cliente para los límites por IP (de la IP solo se guarda una huella con sal, nunca en claro).
//
// La aplicación corre en Cloudflare Workers: allí `cf-connecting-ip` lo escribe el borde y el cliente no puede
// falsificarlo (no hay un servidor de origen al que llamar saltándose a Cloudflare). `x-forwarded-for` sí se puede
// falsificar (la primera dirección la pone quien llama), así que solo es respaldo cuando no hay encabezado de
// Cloudflare (desarrollo local u otro proxy), donde estos límites son solo una ayuda, no una garantía.
export type HeaderReader = (name: string) => string | undefined;

export function clientIp(header: HeaderReader): string {
  return (
    (header("cf-connecting-ip") ?? "").trim() ||
    (header("x-forwarded-for") ?? "").split(",")[0].trim() ||
    (header("x-real-ip") ?? "").trim() ||
    "unknown"
  );
}
