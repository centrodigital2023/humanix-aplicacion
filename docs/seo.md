# SEO · Guía de verificación y monitoreo

Última actualización: abril de 2026

## 1. Google Search Console

### 1.1 Verificación (ya activa)

El token de verificación ya está embebido en `src/routes/__root.tsx` como meta tag:

```html
<meta name="google-site-verification" content="ohLJMuczZHl79QIbEcvqP4UgjxZd8LAhhMhWU9IN_mQ" />
```

Pasos para activar:

1. Ingresa a <https://search.google.com/search-console>.
2. Agrega la propiedad tipo **Prefijo de URL**: `https://humanix.lat`.
3. Selecciona el método **Etiqueta HTML**, confirma el token ya incluido y presiona **Verificar**.

### 1.2 Envío del sitemap dinámico

El sitemap ahora se genera en servidor con ofertas de empleo indexables y perfiles verificados (ver `src/routes/sitemap[.]xml.ts`).

1. En GSC → **Sitemaps**.
2. Ingresa `sitemap.xml` (la URL completa queda `https://humanix.lat/sitemap.xml`).
3. Presiona **Enviar**. Google revisa cada 24-48 h.

Cobertura esperada:

- Rutas estáticas: `/`, `/buscar`, `/familias`, `/profesionales`, `/planes`, `/tecnologia`, `/sobre`, `/carreras`, `/contacto`, `/prensa`, `/terminos`, `/privacidad`, `/habeas-data`, `/cumplimiento`.
- Dinámicas: `/profesional/{id}` (perfiles verificados y activos), `/oferta/{id}` (ofertas abiertas no bloqueadas).

### 1.3 Validación Rich Results

Prueba manualmente cada schema en <https://search.google.com/test/rich-results>:

| URL | Schema esperado |
|-----|-----------------|
| `/` | Organization, WebSite (SearchAction), FAQPage |
| `/familias` | Organization, WebSite, Service, BreadcrumbList |
| `/profesionales` | Organization, WebSite, Service, BreadcrumbList |
| `/oferta/{id}` | JobPosting, BreadcrumbList |
| `/profesional/{id}` | Person / ProfilePage (si se agrega) |
| `/terminos` · `/privacidad` · `/habeas-data` · `/cumplimiento` | BreadcrumbList |

### 1.4 Monitoreo continuo

- **Cobertura**: revisa errores tipo *404*, *excluidas por `noindex`* (deben ser solo `/auth`, `/dashboard/*`, `/superadmin/*`, `/mensajes`, `/servicio/*`, `/evaluador`, `/talento-humano`).
- **Core Web Vitals**: LCP < 2.5s, INP < 200ms, CLS < 0.1.
- **Empleos** (Job Posting Report): aparece automáticamente cuando Google indexa ≥ 10 `JobPosting` válidos.

## 2. Bing Webmaster Tools (recomendado)

1. <https://www.bing.com/webmasters>.
2. Importa la propiedad desde Google Search Console (verificación automática).
3. Envía el mismo sitemap `https://humanix.lat/sitemap.xml`.

## 3. OG images por sección

Se agregaron 3 imágenes sociales específicas en `public/og/` (servidas como `/og/*.svg`):

- `/og/familias.svg` — usado por `/familias`.
- `/og/profesionales.svg` — usado por `/profesionales`.
- `/og/tecnologia.svg` — usado por `/tecnologia`.

Para mayor compatibilidad (LinkedIn/WhatsApp prefieren PNG), convierte a PNG 1200×630:

```bash
# requiere `rsvg-convert` o ImageMagick
for f in public/og/*.svg; do
  rsvg-convert -w 1200 -h 630 "$f" -o "${f%.svg}.png"
done
# luego actualiza las rutas para referenciar .png en lugar de .svg
```

## 4. Robots.txt

`public/robots.txt` ya bloquea áreas privadas y apunta al sitemap. No requiere acciones adicionales.

## 5. Checklist post-deploy

- [ ] Verificar que `/sitemap.xml` responde 200 con `Content-Type: application/xml`.
- [ ] Probar `/oferta/{id}` con una oferta real → ver JSON-LD `JobPosting` en el HTML.
- [ ] Enviar sitemap a GSC y Bing.
- [ ] Ejecutar <https://pagespeed.web.dev/> sobre la home y `/buscar`.
- [ ] Configurar alertas de cobertura y CWV en GSC.
