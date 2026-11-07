# Documentos legales de Nexus: guía para la revisión del abogado

Estado: **borradores**. No están aprobados por un abogado. Este archivo resume qué hay, qué falta y qué decisiones se necesitan.

## Dónde están los textos
- `frontend/src/legal/terminos.md` — términos y condiciones del servicio (Nexus ↔ negocio), con cláusula de encargo de datos.
- `frontend/src/legal/privacidad.md` — política de privacidad de Nexus.
- `frontend/src/legal/tienda.md` — aviso de privacidad y condiciones que ve el cliente final en la tienda web de cada negocio (se completa con los datos del negocio).
La aplicación los muestra en `/#/legal/terminos`, `/#/legal/privacidad` y en la tienda web.

## Datos que hay que completar (aparecen entre [corchetes])
Razón social, RUT, dirección y correo del proveedor · plan, precio y forma de cobro · período de prueba · reembolsos y mora · nivel de soporte · proveedores de alojamiento y país · plazos de conservación (30 días propuesto) · tope de responsabilidad (12 meses propuesto) · ciudad de tribunales.

## Preguntas para el abogado
1. **Rol de Nexus:** ¿encargado del tratamiento (como se redactó) respecto de los datos de los clientes de cada negocio? ¿Se necesita un contrato de encargo separado?
2. **Transferencia internacional:** el alojamiento está en Estados Unidos (hoy Railway). ¿Qué resguardos exige la Ley N° 21.719 y qué cláusulas conviene incluir?
3. **Vigencia de la Ley N° 21.719:** fijada para el 1 de diciembre de 2026, con un proyecto para postergarla a 2027. ¿Conviene cumplirla desde ya?
4. **Tienda web y consumidor (Ley N° 19.496):** pedidos con pago al retiro; información previa, retracto y reclamos. ¿Qué debe decir la tienda de cada negocio?
5. **Limitación de responsabilidad:** validez del tope y de las exclusiones frente a derechos irrenunciables.
6. **Aviso de «no tributario»:** que Nexus no emite boleta ni factura y no se conecta al SII; dónde y cómo debe quedar visible.
7. **Aceptación electrónica:** la app guarda versión y fecha de aceptación por negocio. ¿Basta o se necesita más evidencia (por ejemplo IP)?
8. **Conservación y eliminación** de datos al término del contrato.

## Lo que el sistema ya hace (para el Cliente final y el negocio)
- Tienda web: pide solo nombre y teléfono (correo y nota son opcionales), muestra el aviso de privacidad y exige marcar una casilla; guarda fecha y hora de la aceptación en cada pedido.
- Los pedidos web sin pagar vencen a las 24 horas.
- Cada negocio tiene sus datos aislados; claves cifradas; respaldos automáticos y descarga de una copia propia desde «Mi negocio».
- Aceptación de términos del negocio al ingresar (se activa con la variable `NEXUS_REQUIRE_TERMS=1` cuando los textos estén aprobados).

## Pendiente técnico relacionado
- Exportar o eliminar los datos de una persona a solicitud (hoy se puede eliminar un cliente; falta exportar sus datos).
- Registro de brechas y aviso (procedimiento).
