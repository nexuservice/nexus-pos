const SECTIONS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: 'inicio', title: '📋 Resumen general',
    body: (
      <>
        <p>Nexus junta en una sola plataforma tu <b>Caja</b> (punto de venta) y tu <b>Tienda online</b>, con el mismo inventario, boleta electrónica y reportes.</p>
        <ul>
          <li><b>Caja</b>: vender en el local. Requiere una jornada abierta.</li>
          <li><b>Tienda online</b>: catálogo y carrito para tus clientes. No requiere jornada.</li>
          <li><b>Administración</b>: productos, clientes, cajeros, promociones, inventario y jornadas. En <i>Inventario</i>, toca el nombre de un producto para ver su <b>tarjeta de existencia</b>: cada entrada y salida (ventas, consumos, ajustes, traspasos y anulaciones) con el saldo después de cada movimiento. Se puede ver por Total, Caja u Online, filtrar por fechas e imprimir. Si el movimiento es una venta (o su anulación), toca «Venta #N» para ver la boleta y <b>reimprimirla</b>.</li>
          <li><b>Compras</b>: en <i>Administración → Productos</i> hay dos botones, <b>Nuevo producto</b> (crea el producto sin unidades) y <b>Nueva compra</b>. La compra registra proveedor, documento (factura, boleta o guía), número y fecha, y las cantidades con su costo neto; en la misma compra puedes crear productos nuevos. Las unidades entran a la caja como <i>compra</i>, no como ajuste, y quedan en la tarjeta de existencia con el documento y la fecha de la factura (el saldo inicial no cambia). Por defecto el costo del producto pasa a ser el promedio ponderado. Todas las compras están en <i>Administración → Compras</i>, donde se pueden anular mientras las unidades sigan en la caja.</li>
          <li><b>Panel</b> e <b>Historial</b>: analítica y revisión de ventas.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'jornada', title: '🕐 Abrir y cerrar jornada',
    body: (
      <>
        <p><b>Abrir:</b> en la Caja elige el cajero, escribe su PIN y el efectivo inicial (fondo). Sin jornada abierta no se puede cobrar.</p>
        <p><b>Cerrar:</b> menú <i>Jornada → Cerrar Jornada</i>. Cuenta el dinero por forma de pago; Nexus compara con lo esperado y muestra faltantes o sobrantes.</p>
        <p className="tip">💡 Efectivo esperado = fondo inicial + efectivo cobrado − vueltos entregados.</p>
      </>
    ),
  },
  {
    id: 'ventas', title: '🛒 Vender',
    body: (
      <ul>
        <li><b>Productos:</b> toca un producto para agregarlo; usa + / − para la cantidad y ✕ para quitarlo.</li>
        <li><b>Buscar:</b> escribe parte del nombre. <b>Código de barras:</b> escanea o escribe el código y Enter.</li>
        <li><b>Cliente:</b> escribe nombre o RUT (mínimo 2 caracteres). Elige de la lista con el mouse o con ↑ ↓ y Enter. Si no está registrado, queda el nombre como referencia. Los clientes <span className="vip">VIP</span> se marcan.</li>
        <li><b>Efectivo:</b> indica cuánto entrega el cliente y Nexus calcula el vuelto.</li>
        <li><b>Débito / Crédito:</b> el cobro pasa por el terminal (simulado en esta demo, con Transbank por defecto) y muestra su avance.</li>
        <li><b>Cheque y transferencia:</b> se registran al instante, sin terminal.</li>
        <li><b>Convenio (crédito):</b> solo para clientes registrados con RUT y marcados como «Autorizado para convenio» en Administración → Clientes. Sin un cliente autorizado el botón queda bloqueado. La venta se suma a lo que el cliente debe.</li>
        <li><b>Consumo:</b> el botón «🍽️ Consumo» junto a «Limpiar» saca los productos del pedido del inventario valorizados al costo. No es una venta: no cobra, no emite boleta ni usa folio, y no deja ganancia. Queda registrado en el Panel como «Consumo propio». Si te equivocas, en Historial → «Consumos propios» puedes anularlo y las unidades vuelven al inventario.</li>
        <li><b>Deuda del cliente:</b> al buscar un cliente se ve cuánto debe en total. Con «Pagar deuda» (también en Administración → Clientes → «Cobrar deuda») se registra el pago completo o un abono, con la forma de pago que elijas. Requiere jornada abierta y el abono entra al arqueo de esa jornada. El botón «🖨 Imprimir detalle» entrega un estado de cuenta con cada compra a convenio (productos, cantidades y precios), los abonos y el saldo, para que el cliente revise antes de pagar.</li>
      </ul>
    ),
  },
  {
    id: 'pedidos', title: '📋 Pedidos abiertos y WhatsApp',
    body: (
      <>
        <p><b>Dejar pedido abierto</b> guarda el pedido con el nombre del cliente, teléfono, canal y observaciones, e imprime la comanda. El stock queda reservado.</p>
        <ul>
          <li><b>Pendiente de pago:</b> se cobra cuando el cliente retire (botón <i>Cobrar</i> en Pedidos).</li>
          <li><b>Ya pagó:</b> se cobra y se emite la boleta al guardar; luego se marca <i>Entregado</i>.</li>
        </ul>
        <p>Desde <i>Pedidos → WhatsApp</i> elige una plantilla (pedido listo, en preparación, detalle, aviso), revisa el número y el mensaje y pulsa <i>Abrir WhatsApp</i>. A los números de 9 dígitos se les agrega +56. Usa un enlace de WhatsApp, sin API: confirmas el envío allí.</p>
      </>
    ),
  },
  {
    id: 'promos', title: '🏷️ Promociones',
    body: (
      <>
        <p>Menú <i>Promociones</i> de la Caja: <b>Ver promociones activas</b> (con botón Aplicar), <b>Aplicar código promo</b> y <b>Crear promoción</b>. También en <i>Administración → Descuentos y promociones</i>.</p>
        <p>Tipos: <b>porcentaje</b> (1 a 100 %) o <b>monto fijo</b> en CLP; con código, fecha de vencimiento y estado activo/inactivo. El descuento aparece en el carrito y en la boleta.</p>
      </>
    ),
  },
  {
    id: 'ajustes', title: '⚙️ Menú de ajustes',
    body: (
      <ul>
        <li><b>Pantalla:</b> tema claro/oscuro, pantalla completa, info superior, formas de pago siempre visibles, detalle compacto, tamaño de botones y de fuente.</li>
        <li><b>Catálogo:</b> mostrar buscador, código de barras y botón «Todos».</li>
        <li><b>Sistema:</b> respaldar la base de datos (descarga un archivo JSON) y recargar.</li>
        <li><b>Gestión:</b> accesos a Administración, Panel, Historial y Ayuda.</li>
      </ul>
    ),
  },
  {
    id: 'panel', title: '📊 Panel e historial',
    body: (
      <>
        <p>El <b>Panel</b> muestra ventas, ingresos, ticket promedio, utilidad bruta, ítems, descuentos, anuladas y costo, comparados con el período anterior, más gráficos por día, medio de pago, categoría, día de la semana y hora. Filtra con Hoy, Semana, Mes, Año o un rango.</p>
        <p>El <b>Historial</b> lista las últimas 100 ventas, permite ver la boleta (y su XML), imprimir, <b>anular</b> (devuelve el stock) y exportar a Excel (CSV) o JSON.</p>
        <p className="tip">💡 Una boleta emitida se anula en el SII con una nota de crédito electrónica; Nexus la deja marcada como anulada.</p>
      </>
    ),
  },
  {
    id: 'limites', title: 'ℹ️ Alcance de esta demo',
    body: (
      <ul>
        <li>Los pagos con tarjeta son simulados; no se cobra dinero real.</li>
        <li>La boleta tiene la estructura del SII (DTE 39) pero sin timbre ni firma, y no se envía al SII.</li>
        <li>Sin servidor, los datos viven solo en este navegador (botón <i>Reiniciar demo</i>).</li>
      </ul>
    ),
  },
];

export function HelpView() {
  return (
    <div className="help">
      <nav className="side" aria-label="Contenido de la ayuda">
        {SECTIONS.map((s) => <a key={s.id} href={`#ayuda-${s.id}`}>{s.title}</a>)}
      </nav>
      <div className="help-body">
        <h1>📖 Ayuda de Nexus</h1>
        {SECTIONS.map((s) => (
          <section key={s.id} id={`ayuda-${s.id}`} className="panel">
            <h2>{s.title}</h2>
            {s.body}
          </section>
        ))}
      </div>
    </div>
  );
}
