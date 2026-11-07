import { useState } from 'react';
import './help.css';

const PASOS_KEY = 'nexus.firstSteps';

type Done = Record<string, boolean>;

/** Lee las casillas marcadas. Si el navegador no deja guardar, la lista parte desmarcada. */
function loadDone(): Done {
  try {
    const raw = JSON.parse(localStorage.getItem(PASOS_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function saveDone(d: Done) {
  try {
    localStorage.setItem(PASOS_KEY, JSON.stringify(d));
  } catch {
    /* sin almacenamiento: la casilla vale solo mientras la pantalla esté abierta */
  }
}

interface Paso { id: string; titulo: string; texto: React.ReactNode; tab: string; boton: string }

const PASOS: Paso[] = [
  {
    id: 'negocio', titulo: '1. Completar «Mi negocio»', tab: 'admin', boton: 'Ir a Administración',
    texto: <>Pon el nombre, RUT y dirección de tu negocio. Salen en tus comprobantes internos. Está en <b>Administración → Mi negocio</b>.</>,
  },
  {
    id: 'productos', titulo: '2. Cargar productos', tab: 'admin', boton: 'Ir a Administración',
    texto: <>Ve a <b>Administración → Ingresar mercadería</b> y escanea tus productos. Si uno no trae código, usa «Este producto no tiene código de barras».</>,
  },
  {
    id: 'precios', titulo: '3. Revisar o ajustar precios', tab: 'admin', boton: 'Ir a Administración',
    texto: <>En <b>Administración → Inventario</b> revisa el precio de venta de cada producto. Si está mal, toca <b>✏️ Precio</b>.</>,
  },
  {
    id: 'cajeros', titulo: '4. Crear tus cajeros con PIN', tab: 'admin', boton: 'Ir a Administración',
    texto: <>En <b>Administración → Cajeros</b> agrega a cada persona que va a vender, con un PIN de 4 a 8 números.</>,
  },
  {
    id: 'venta', titulo: '5. Abrir la jornada y hacer una venta de prueba', tab: 'pos', boton: 'Ir a la Caja',
    texto: <>En la <b>Caja</b> elige al cajero, escribe su PIN y el efectivo inicial. Vende algo y cóbralo. Si no quieres que la prueba quede, anúlala en <b>Historial</b>.</>,
  },
  {
    id: 'web', titulo: '6. Si tienes tienda web: copiar el enlace y probarla', tab: 'admin', boton: 'Ir a Administración',
    texto: <>En <b>Administración → Mi negocio</b> toca <b>Copiar enlace</b>. Ábrelo en tu celular y arma un pedido de prueba. Si era de prueba, cancélalo en <b>Pedidos</b>. Si no ves el enlace, quien te contrató el plan debe activar la tienda web.</>,
  },
  {
    id: 'respaldo', titulo: '7. Descargar tu primera copia de seguridad', tab: 'admin', boton: 'Ir a Administración',
    texto: <>En <b>Administración → Mi negocio</b> toca <b>⬇️ Descargar copia de mis datos</b>. Guárdala en tu correo o en un pendrive.</>,
  },
];

function PrimerosPasos({ go }: { go?: (tab: string) => void }) {
  const [done, setDone] = useState<Done>(loadDone);
  const listos = PASOS.filter((p) => done[p.id]).length;
  const marcar = (id: string, value: boolean) => {
    const next = { ...done, [id]: value };
    setDone(next);
    saveDone(next);
  };

  return (
    <>
      <p>Haz estos pasos en orden la primera vez. Marca cada casilla cuando termines; tu avance queda guardado en este equipo.</p>
      <p className="help-progress">{listos} de {PASOS.length} pasos listos</p>
      <ul className="help-steps">
        {PASOS.map((p) => (
          <li key={p.id} className={'help-step' + (done[p.id] ? ' done' : '')}>
            <input type="checkbox" aria-label={`Marcar: ${p.titulo}`} checked={!!done[p.id]} onChange={(e) => marcar(p.id, e.target.checked)} />
            <div>
              <strong>{p.titulo}</strong>
              <p>{p.texto}</p>
            </div>
            {go && <button type="button" className="btn ghost sm" onClick={() => go(p.tab)}>{p.boton}</button>}
          </li>
        ))}
      </ul>
    </>
  );
}

function Sec({ id, titulo, abierta = false, children }: { id: string; titulo: string; abierta?: boolean; children: React.ReactNode }) {
  return (
    <details id={`ayuda-${id}`} className="help-sec" open={abierta}>
      <summary>{titulo}</summary>
      {children}
    </details>
  );
}

const INDICE: [string, string][] = [
  ['primeros', '🚀 Primeros pasos'],
  ['que-es', 'ℹ️ Qué es Nexus y qué no es'],
  ['caja', '🛒 Vender en la Caja'],
  ['inventario', '📦 Inventario'],
  ['ingreso', '📥 Ingresar mercadería'],
  ['clientes', '👥 Clientes y convenio (fiado)'],
  ['web', '🌐 Tienda web'],
  ['reportes', '📊 Reportes: Panel e Historial'],
  ['cajeros', '🕐 Cajeros y jornadas'],
  ['negocio', '🏪 Mi negocio y copia de seguridad'],
  ['tuerca', '⚙️ La tuerca'],
  ['faq', '❓ Preguntas frecuentes'],
  ['glosario', '📚 Glosario'],
];

/** Manual de uso de Nexus. `go` (opcional) lleva a una pestaña de la app. */
export function HelpView({ go }: { go?: (tab: string) => void }) {
  return (
    <div className="help">
      <nav className="side" aria-label="Contenido de la ayuda">
        {INDICE.map(([id, titulo]) => <a key={id} href={`#ayuda-${id}`}>{titulo}</a>)}
      </nav>
      <div className="help-body">
        <h1>📖 Manual de Nexus</h1>
        <p className="hint">Toca un título para abrir o cerrar su sección.</p>

        <Sec id="primeros" titulo="🚀 Primeros pasos" abierta>
          <PrimerosPasos go={go} />
        </Sec>

        <Sec id="que-es" titulo="ℹ️ Qué es Nexus y qué no es">
          <ul>
            <li><b>Nexus es un sistema de control interno.</b> Te ayuda a llevar tu inventario, tus ventas, tu caja, tus clientes con convenio y tus compras.</li>
            <li>Los comprobantes de Nexus <b>no son boletas ni facturas del SII</b> y <b>no reemplazan tu boleta electrónica</b>.</li>
            <li>Para entregarle un documento legal al cliente, <b>sigue usando tu máquina o tu sistema de boletas</b>.</li>
            <li>Tus datos se guardan en el servidor, asociados a tu RUT. Ingresa con tu clave desde cualquier equipo.</li>
          </ul>
          <div className="help-warn">
            <p>Igual descarga copias de seguridad de vez en cuando (ver <a href="#ayuda-negocio">Mi negocio y copia de seguridad</a>).</p>
          </div>
        </Sec>

        <Sec id="caja" titulo="🛒 Vender en la Caja">
          <h3>Buscar y agregar productos</h3>
          <ul>
            <li><b>Buscar:</b> escribe parte del nombre en «Buscar producto». Toca el producto para agregarlo.</li>
            <li><b>Cantidad:</b> usa + y − en el pedido. La ✕ quita el producto.</li>
            <li><b>Escanear:</b> escribe o escanea el código en «Código de barras» y presiona Enter.</li>
            <li><b>Cámara del celular (📷):</b> toca 📷 junto al código de barras y apunta al código. La app hace un <b>pitido</b> al leerlo, avisa en pantalla y <b>sigue leyendo el siguiente</b>. Si no lee, usa «Tomar foto del código». El botón 🔇 silencia el pitido.</li>
          </ul>
          <h3>Cliente</h3>
          <ul>
            <li>Escribe el nombre o el RUT en la barra del cliente y elige de la lista. Los clientes <b>VIP</b> aparecen marcados.</li>
            <li>Si el cliente no está registrado, puedes dejar solo su nombre como referencia.</li>
          </ul>
          <h3>Descuentos y promociones</h3>
          <ul>
            <li>Toca <b>🏷️ Promociones</b>. Ahí puedes ver las promociones activas (botón <b>Aplicar</b>) o escribir un código en «Aplicar código promo».</li>
            <li>Para quitar un descuento del pedido, toca la ✕ que aparece junto al descuento.</li>
          </ul>
          <h3>Cobrar</h3>
          <ol>
            <li>Toca <b>💵 Cobrar</b> (o deja las formas de pago a la vista con la tuerca).</li>
            <li>Elige la forma de pago:
              <ul>
                <li><b>Efectivo:</b> escribe con cuánto paga el cliente y la app calcula el vuelto.</li>
                <li><b>Débito / Crédito:</b> el cobro con tarjeta es <b>simulado</b> en esta versión: no se conecta a tu terminal. Cobra en tu terminal y registra la venta aquí.</li>
                <li><b>Cheque y transferencia:</b> se registran al instante.</li>
                <li><b>Convenio:</b> ver abajo.</li>
              </ul>
            </li>
          </ol>
          <h3>Convenio (fiado)</h3>
          <p>La venta queda a nombre del cliente y se cobra después. Solo funciona con un cliente registrado con RUT y marcado como «autorizado para convenio» (Administración → Clientes). Si el cliente llegó a su tope, la caja no deja vender a convenio hasta que abone.</p>
          <h3>Pedidos abiertos</h3>
          <ul>
            <li><b>📋 Dejar pedido abierto</b> guarda el pedido con el nombre del cliente. Se imprime la comanda y el stock queda reservado.</li>
            <li>Puede ser <b>Pendiente de pago</b> (se cobra al retirar) o <b>Ya pagó</b>.</li>
            <li>Para retomarlo, toca <b>📋 Pedidos</b> abajo y luego <b>Cobrar</b>.</li>
            <li>Si el pedido tiene teléfono, el botón <b>💬 WhatsApp</b> abre un chat con un mensaje listo (pedido listo, en preparación, etc.). Tú confirmas el envío en WhatsApp.</li>
          </ul>
          <h3>Otras opciones</h3>
          <ul>
            <li><b>🍽️ Consumo:</b> saca productos del inventario al costo, para consumo propio. No es venta: no cobra, no genera comprobante y no deja ganancia. Queda en Historial → Consumos propios, donde se puede anular.</li>
            <li><b>Deuda del cliente:</b> al elegir un cliente con convenio se ve cuánto debe. Ver «Clientes y convenio».</li>
            <li><b>Varias cajas:</b> pueden estar abiertas varias cajas a la vez, una por cajero. Ver «Cajeros y jornadas».</li>
          </ul>
        </Sec>

        <Sec id="inventario" titulo="📦 Inventario">
          <p>Está en <b>Administración → Inventario</b>. Cada fila es un producto.</p>
          <ul>
            <li><b>Producto:</b> toca el nombre para ver su <b>tarjeta de existencia</b>.</li>
            <li><b>En la caja:</b> las unidades que tienes para vender en el local. Entre paréntesis, las que están reservadas por pedidos.</li>
            <li><b>En la web:</b> marca o desmarca <b>Visible en la web</b>. Si está desmarcado, el producto no aparece en la tienda web.</li>
            <li><b>Dejar en el local:</b> la tienda web muestra <b>todo el stock de la caja menos las unidades que escribas aquí</b>. Escribe la cantidad y toca <b>Guardar</b>.</li>
            <li><b>Precio de venta:</b> es el precio <b>con IVA</b>. <b>✏️ Precio</b> lo cambia. El nuevo precio rige desde ese momento; las ventas anteriores no cambian, y el cambio queda anotado con su motivo.</li>
            <li><b>Ajustar caja:</b> para correcciones (conteo, productos dañados). Escribe cuántas unidades sumar (número positivo) o restar (número negativo) y toca <b>OK</b>.</li>
            <li><b>Editar datos:</b> cambia nombre, categoría, código de barras, precio, costo, si es visible en la web y si está activo. Ahí mismo puedes escribir una <b>descripción</b> corta y poner una <b>foto</b> con <b>Sacar foto</b> (abre la cámara) o <b>Elegir de la galería</b>. También puedes agregarla o cambiarla desde la <b>Caja</b>, con el botón 📷 de cada producto. La foto se ve en la Caja y en tu tienda web, y se reduce sola. Un producto <b>inactivo</b> no se puede vender. «Sin código: asignar uno» le pone un número interno.</li>
          </ul>
          <h3>Tarjeta de existencia</h3>
          <p>Es el libro de movimientos de un producto, con fecha, detalle, entradas, salidas y saldo, en unidades y en valores. Puedes verla en <b>Total</b>, <b>Caja</b> u <b>Online</b>, filtrar por fechas e imprimirla. Si el movimiento es una venta, toca su detalle para ver el comprobante y reimprimirlo. Para cambiar el precio desde aquí, usa <b>✏️ Editar precio</b>.</p>
        </Sec>

        <Sec id="ingreso" titulo="📥 Ingresar mercadería">
          <p>Está en <b>Administración → Ingresar mercadería</b>. Arriba hay dos formas:</p>
          <h3>📥 Escanear (lo más rápido)</h3>
          <ol>
            <li>Escanea el código de barras, o escríbelo, y presiona <b>Enter</b>.</li>
            <li>Si el producto <b>no existe</b>, se abre un formulario para crearlo: nombre, categoría, cantidad, costo y precio de venta. Luego toca <b>Crear y agregar</b>.</li>
            <li>Si el producto <b>ya existe</b>, suma 1 unidad. Para indicar otra cantidad o cambiar costo o precio, desmarca «Sumar 1 unidad al escanear un producto que ya existe».</li>
          </ol>
          <ul>
            <li><b>Sin código de barras:</b> toca «Este producto no tiene código de barras». El sistema le asigna un número (1, 2, 3…) que puedes escribir en la Caja para venderlo.</li>
            <li><b>Cámara:</b> toca «📷 Escanear con la cámara». Con la cámara, un producto que ya existe siempre pide la cantidad.</li>
            <li>Abajo aparece «Ingresos de esta sesión» con lo que has ingresado.</li>
          </ul>
          <div className="help-warn"><p><b>Costos y precios se digitan CON IVA.</b> La app muestra el neto como ayuda. Si el precio queda bajo el costo, te avisa.</p></div>

          <h3>🧾 Con factura del proveedor</h3>
          <p>Registra una compra con los datos del documento del proveedor. Las unidades entran a la caja como <b>compra</b> (no como ajuste) y quedan en la tarjeta de existencia con su fecha.</p>
          <ol>
            <li>Completa los datos del documento: <b>proveedor</b> y <b>RUT</b> (opcionales), <b>documento</b> (factura, boleta o guía de despacho), <b>N° del documento</b> y <b>fecha</b> (obligatorios).</li>
            <li>Agrega cada producto: elige uno existente o «➕ Producto nuevo». Indica cantidad y costo unitario con IVA.</li>
            <li>Para un producto nuevo, el <b>precio de venta</b> es obligatorio. En uno existente, puedes digitar un precio nuevo; si lo dejas vacío, no cambia.</li>
            <li>Deja marcado «Actualizar el costo» para que el costo sea el promedio ponderado con lo que ya tienes.</li>
            <li>Toca <b>Registrar compra</b>.</li>
          </ol>
          <p>Debajo aparece la lista de compras, con filtro por fechas y el informe <b>«A quién le compras más»</b>. Con <b>Detalle</b> ves cada compra y puedes <b>anularla</b>, siempre que las unidades sigan en la caja.</p>
        </Sec>

        <Sec id="clientes" titulo="👥 Clientes y convenio (fiado)">
          <p>Está en <b>Administración → Clientes</b>. Los clientes registrados aparecen en la búsqueda de la Caja, por nombre o RUT.</p>
          <h3>Crear un cliente</h3>
          <ol>
            <li>Toca <b>➕ Nuevo cliente</b> y escribe nombre, RUT, correo y teléfono.</li>
            <li>Marca <b>Cliente VIP</b> si corresponde.</li>
            <li>Para dar convenio, marca <b>Autorizado para convenio</b>. Requiere RUT.</li>
            <li>Opcional: escribe un <b>tope de convenio</b>, lo máximo que puede deber. Déjalo vacío para no poner tope.</li>
            <li>Toca <b>Guardar</b>.</li>
          </ol>
          <h3>Cupo y deuda</h3>
          <ul>
            <li><b>Cupo:</b> lo que le queda disponible al cliente. «Sin tope» si no tiene límite.</li>
            <li><b>«Sin cupo»:</b> el cliente llegó a su tope. La Caja no deja vender a convenio hasta que abone.</li>
            <li><b>Debe:</b> lo que el cliente tiene pendiente.</li>
          </ul>
          <h3>Cobrar deuda</h3>
          <p>Toca <b>Cobrar deuda</b> en el cliente (o <b>Pagar deuda</b> cuando lo eliges en la Caja). Puedes cobrar todo con <b>Pagar todo</b>, la mitad, o un abono con cualquier monto. Elige la forma de pago y toca <b>Registrar pago</b>. Cobrar deuda necesita una jornada abierta. Con <b>🖨 Imprimir detalle</b> sale un estado de cuenta con las compras a convenio, los abonos y el saldo.</p>
        </Sec>

        <Sec id="web" titulo="🌐 Tienda web">
          <ul>
            <li><b>Qué es:</b> una página con tu catálogo para que tus clientes armen su pedido desde el celular.</li>
            <li><b>Quién la activa:</b> quien te contrató el plan. Si no la ves, consúltale.</li>
            <li><b>El enlace:</b> está en <b>Administración → Mi negocio</b>, en «Tu tienda web». Toca <b>Copiar enlace</b> y compártelo con tus clientes.</li>
            <li><b>Qué muestra:</b> todo el stock que tienes en la caja, menos lo que dejas en el local («Dejar en el local» en Inventario). Los productos no visibles en la web no aparecen.</li>
            <li><b>Pagos:</b> en la tienda web no se paga por internet. El cliente paga al retirar en el local.</li>
            <li><b>Pedidos:</b> cada pedido llega a <b>📋 Pedidos</b> como pendiente de pago. Nexus avisa con una alerta 🔔 y un pitido. Puedes tocar <b>Ver en Caja</b> para ir a ellos.</li>
            <li><b>Cuando el cliente llega:</b> toca <b>Cobrar</b> en el pedido, cobra y queda registrada la venta.</li>
            <li><b>Vencimiento:</b> un pedido web sin pagar vence a las <b>24 horas</b>. Al vencer se cancela solo y el stock vuelve a estar disponible.</li>
            <li><b>Aviso de privacidad:</b> antes de enviar su pedido, el cliente debe marcar que leyó el aviso de privacidad y condiciones de tu tienda.</li>
          </ul>
        </Sec>

        <Sec id="reportes" titulo="📊 Reportes: Panel e Historial">
          <h3>📊 Panel</h3>
          <p>Muestra cómo va tu negocio en el período que elijas: ventas, ingresos, ticket promedio, utilidad bruta, ítems vendidos, descuentos, anuladas, costo estimado y consumo propio. Tiene gráficos de tendencia diaria, medios de pago, ingresos por categoría, ventas por día de la semana y por hora. También muestra los productos más vendidos y las promociones aplicadas.</p>
          <p>Elige fechas en <b>Desde</b> y <b>Hasta</b>, o usa los botones <b>Hoy</b>, <b>Semana</b>, <b>Mes</b> o <b>Año</b>.</p>
          <p><b>Para exportar las ventas de un rango de fechas:</b> elige el rango en el Panel y toca <b>📗 Excel (CSV)</b>, arriba a la derecha. Se descarga un archivo con todas las ventas del período.</p>
          <h3>🧾 Historial</h3>
          <p>Muestra las últimas 100 ventas. Puedes filtrar por <b>Todas</b> o <b>Jornada actual</b>, y por fechas.</p>
          <ul>
            <li><b>Ver comprobante:</b> muestra el comprobante interno de la venta. Desde ahí puedes <b>Imprimir</b> o <b>Anular venta</b>.</li>
            <li><b>Anular:</b> la venta queda como anulada, no suma en los reportes, y sus unidades vuelven al inventario.</li>
            <li><b>Excel (CSV) y JSON</b> descargan las ventas que se ven en la tabla.</li>
            <li><b>Consumos propios:</b> lista los consumos y permite anular uno.</li>
          </ul>
        </Sec>

        <Sec id="cajeros" titulo="🕐 Cajeros y jornadas">
          <h3>Cajeros</h3>
          <p>En <b>Administración → Cajeros</b> agrega a cada persona con su nombre y un PIN de 4 a 8 números. Usa <b>Desactivar</b> para quitar a quien ya no trabaja contigo, y <b>Activar</b> para devolverlo.</p>
          <p><b>Dos tipos de ingreso.</b> El <b>administrador</b> (el dueño) entra con el RUT del negocio y su clave y ve todo. El <b>cajero</b> entra desde la pantalla de ingreso, en la opción «Cajero», con el RUT del negocio, su nombre y su PIN, y solo ve <b>Caja</b>, <b>Ingresar mercadería</b>, <b>Historial</b> y <b>Ayuda</b>: no puede cambiar precios, anular ventas, ver reportes ni tocar los datos del negocio.</p>
          <p><b>¿Un cajero olvidó su PIN?</b> El PIN no se puede ver, por seguridad. En <b>Administración → Cajeros</b> toca <b>Cambiar PIN</b>, escribe uno nuevo y avísale. El PIN anterior deja de servir al instante.</p>
          <h3>Abrir la jornada</h3>
          <p>Sin una jornada abierta no se puede vender ni cobrar. En la <b>Caja</b>, elige al cajero, escribe su PIN y el <b>efectivo inicial</b> (el fondo de caja con el que empiezas).</p>
          <h3>Varias cajas</h3>
          <ul>
            <li>Pueden estar abiertas varias cajas a la vez, una por cajero.</li>
            <li>Al entrar a la Caja, elige tu caja, escribe el PIN de tu cajero y entra. O toca <b>➕ Abrir otra caja</b>.</li>
            <li>Para pasar a otra caja: <b>🟢 Jornada → Cambiar de caja</b>.</li>
          </ul>
          <h3>Cerrar la jornada</h3>
          <p>Toca <b>🟢 Jornada → Cerrar Jornada</b>. Cuenta el dinero por forma de pago: Nexus compara con lo esperado y muestra faltantes o sobrantes. Solo cierra la caja en la que estás.</p>
          <div className="help-warn"><p>Efectivo esperado = fondo inicial + efectivo cobrado − vueltos entregados.</p></div>
          <h3>Ver jornadas</h3>
          <p>En <b>Administración → Jornadas</b> ves las jornadas abiertas y cerradas, con su fondo, sus ventas y el cierre por medio de pago. En el menú <b>🟢 Jornada</b> de la Caja está <b>ℹ️ Info Jornada</b> y <b>JSON de ventas</b>.</p>
        </Sec>

        <Sec id="negocio" titulo="🏪 Mi negocio y copia de seguridad">
          <h3>Datos del negocio</h3>
          <p>En <b>Administración → Mi negocio</b> escribe el nombre (obligatorio), RUT, razón social, giro, dirección, comuna y teléfono. Estos datos salen en tus comprobantes internos. Toca <b>Guardar</b>.</p>
          <h3>Copia de seguridad</h3>
          <ol>
            <li>En <b>Administración → Mi negocio</b>, toca <b>⬇️ Descargar copia de mis datos</b>.</li>
            <li>Se descarga un archivo con tus productos, ventas y clientes.</li>
            <li>Guárdalo en un lugar seguro: tu correo o un pendrive. Es tu respaldo propio.</li>
          </ol>
        </Sec>

        <Sec id="tuerca" titulo="⚙️ La tuerca">
          <p>El botón ⚙️ está arriba a la derecha.</p>
          <h3>Apariencia</h3>
          <ul>
            <li><b>Tema oscuro:</b> cambia entre claro y oscuro.</li>
            <li><b>Tamaño:</b> Normal, Grande o Extra grande, para la letra y los botones.</li>
            <li><b>Pantalla completa.</b></li>
          </ul>
          <h3>Caja</h3>
          <ul>
            <li><b>Buscador de productos:</b> muestra u oculta el buscador.</li>
            <li><b>Código de barras y cámara:</b> muestra u oculta el campo de código y el botón 📷.</li>
            <li><b>Botón «Todos» en las categorías.</b></li>
            <li><b>Datos de la jornada arriba:</b> muestra el local, la caja y el cajero arriba.</li>
            <li><b>Formas de pago a la vista:</b> muestra los botones de cobro sin tener que tocar Cobrar.</li>
            <li><b>Detalle de venta compacto.</b></li>
          </ul>
          <h3>Ir a</h3>
          <p>Administración, Panel, Historial y Ayuda. Y también <b>Cerrar sesión</b>.</p>
        </Sec>

        <Sec id="faq" titulo="❓ Preguntas frecuentes">
          <div className="help-faq">
            <h3>¿Por qué no puedo cobrar?</h3>
            <p>Falta abrir la jornada. Ve a la Caja, elige al cajero, escribe su PIN y el efectivo inicial.</p>
            <h3>¿Nexus sirve para emitir documentos tributarios?</h3>
            <p>No. Nexus es un control interno. Sigue usando tu máquina o sistema de boletas para el cliente.</p>
            <h3>¿Por qué no aparece el convenio?</h3>
            <p>El cliente debe estar registrado con RUT y marcado como autorizado para convenio, y no debe haber llegado a su tope.</p>
            <h3>Si cambio un precio, ¿cambian las ventas anteriores?</h3>
            <p>No. El nuevo precio rige desde ese momento. Las ventas ya hechas conservan su precio.</p>
            <h3>Si anulo una venta, ¿vuelve el stock?</h3>
            <p>Sí. Las unidades vuelven al inventario y la venta no suma en los reportes.</p>
            <h3>Un cliente web no pagó, ¿qué pasa?</h3>
            <p>A las 24 horas el pedido se cancela solo y su stock vuelve a estar disponible. También puedes cancelarlo antes en <b>Pedidos</b>.</p>
            <h3>¿Qué pasa si cambio de equipo?</h3>
            <p>Nada: tus datos están en el servidor. Ingresa con tu clave. Aun así, descarga copias de seguridad de vez en cuando.</p>
          </div>
        </Sec>

        <Sec id="glosario" titulo="📚 Glosario">
          <dl className="help-gloss">
            <div><dt>Convenio</dt><dd>Es el fiado: la venta queda a nombre del cliente y se paga después.</dd></div>
            <div><dt>Jornada</dt><dd>El turno de una caja: desde que se abre hasta que se cierra.</dd></div>
            <div><dt>Con IVA / Neto</dt><dd>«Con IVA» es el precio que paga el cliente. «Neto» es el mismo valor sin IVA; la app lo muestra como ayuda.</dd></div>
            <div><dt>Tarjeta de existencia</dt><dd>El libro con todos los movimientos de un producto: entradas, salidas y saldo.</dd></div>
          </dl>
        </Sec>
      </div>
    </div>
  );
}
