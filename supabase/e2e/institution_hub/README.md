# Suite de PostgreSQL del hub de instituciones y el contrato inteligente

Prueba de punta a punta la migración `supabase/migrations/20261009100000_institution_hub_smart_contracts.sql` contra un
**PostgreSQL 16 real**, con roles reales (`anon`, `authenticated`, `service_role`), RLS y los disparadores de la migración.

> ⚠️ **Solo para una base desechable** (por ejemplo `docker run -p 5432:5432 -e POSTGRES_PASSWORD=x postgres:16`).
> El script crea y **borra** la base `hx_inst_test` y define roles y esquemas de apoyo. **Nunca** lo apuntes a Supabase /
> Lovable Cloud ni a una base con datos reales. Por eso exige `HX_TEST_CONFIRM=desechable`.

```bash
HX_TEST_CONFIRM=desechable PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=x \
  supabase/e2e/institution_hub/run.sh
```

Resultado esperado: `pasaron|fallaron|total` con 0 fallos y una tabla vacía de verificaciones fallidas.

> Esta carpeta **no** está en `supabase/tests/` a propósito: `supabase test db` ejecuta todo lo que haya allí contra la
> base local y estos archivos no son pruebas pgTAP (crean tablas de apoyo y borran bases).

## Qué contiene

| Archivo | Para qué |
|---|---|
| `run.sh` | Crea la base, carga el esquema de apoyo, aplica las migraciones previas de las que depende y la nueva, y corre el escenario |
| `bootstrap_common.sql`, `bootstrap_text.sql`, `bootstrap_inst.sql`, `real_functions.sql` | **Aproximación** del esquema de producción justo antes de la migración (auth, tablas, políticas, funciones copiadas de migraciones anteriores). Si producción difiere, la suite puede dar falsos positivos o negativos |
| `scenario.sql` | El escenario: 15 grupos de comprobaciones (ver abajo) |
| `band_golden.csv` | Tabla de referencia de la banda de negociación; la verifican **este escenario (14.5–14.6) y la prueba de TypeScript** `institutionNegotiation.test.ts` |

## Grupos del escenario

1. Publicar con agenda y datos privados · 2. Profesional Free se postula y no puede negociar · 3. Pasa a Esencial y contraoferta ·
4. La institución acepta → reserva con dirección · 5. Desbloqueo del contacto y aviso · 6. Free con reserva: ve la dirección
pero no el contacto · 7. Rondas, vencimiento y reintento · 8. Contrato inteligente (firmas, huella, cadena de eventos,
alteración detectada) · 9. Flujo de contratos anterior cerrado · 10. Familia sin agenda y sus avisos · 10b. Extras (aceptar
contraoferta siendo Free, rechazos, contacto previo) · 11. Cancelación y reapertura de cupo · 12. Reputación · 13. Bandejas y
oferta de talento · 14. Auditoría de permisos (+ banda de negociación) · 15. Equipo de confianza.

Las firmas se registran con `service_role`, como hace la función de servidor `signSmartContract`; la parte de Supabase
Auth (envío del código y marca `amr` del token) no se puede probar aquí.
