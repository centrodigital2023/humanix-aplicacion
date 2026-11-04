# Contrato de servicio de cuidado («Nuestro acuerdo de cuidado»)

> **Aviso:** el texto fue redactado con cuidado según la ley colombiana, pero **no reemplaza la revisión de un abogado**.
> Antes de usarlo a gran escala conviene que un abogado revise sobre todo la cláusula de independencia del profesional
> (riesgo de «contrato realidad»), la de datos de salud y la de retracto.

## Qué falló
La tarjeta de contrato de `/servicio/$bookingId` leía la tabla `service_contracts`, que nunca se creó en producción.
La consulta fallaba, el error se ignoraba y la tarjeta desaparecía sin decir nada. `SmartContractCard` también ignoraba
los errores de `smart_contract_shifts`.

## Cómo funciona ahora
- **Texto**: `src/lib/serviceContract.ts` (`renderServiceContract`) lo genera de forma determinista a partir de la reserva
  (fecha, duración, valor, forma de pago, comisión) y de la versión de plantilla `hx-cuidado-v1`. Si cambias el texto,
  crea una versión nueva y súbela también en `hx_accept_service_contract`.
- **Aceptación**: `hx_accept_service_contract` (migración `20261104200000_service_contract_acceptances.sql`) guarda quién,
  cuándo (hora del servidor), versión, huella SHA-256 del texto, consentimientos (contrato + datos de salud), IP,
  dispositivo y una copia de las condiciones clave. Las filas no se pueden editar.
- **Consulta**: `hx_service_contract_status` devuelve las aceptaciones de la reserva a las partes y al equipo (la IP y
  el dispositivo solo a quien aceptó).
- **Cambios**: si cambian la fecha, la duración, el valor o la forma de pago, la tarjeta pide aceptar de nuevo.
- **Sin migración**: la tarjeta se puede leer y descargar, y dice «Muy pronto podrás aceptarlo aquí mismo».

## Marco legal citado
Código Civil (arts. 1495, 1602, 2063, 2144), Código de Comercio (art. 864), Ley 1480 de 2011 (arts. 6, 7, 47, 51),
Ley 1581 de 2012 y Decreto 1074 de 2015, Ley 527 de 1999 (arts. 5, 7, 14) y Decreto 2364 de 2012, Código Sustantivo
del Trabajo (art. 23), Ley 1164 de 2007, Ley 23 de 1981, Ley 1251 de 2008, Ley 1618 de 2013, Ley 2220 de 2022.

## Pendiente de revisar
- La Política de Privacidad dice que Humanix no trata datos de salud, pero la bitácora del turno y este contrato sí
  mueven información de salud entre las partes. Conviene alinear la política con un abogado.
