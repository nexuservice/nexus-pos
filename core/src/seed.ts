import type { Client, EngineState, Product, Promotion } from './types';

const P = (n: number, name: string, category: string, priceClp: number, published = true): Product => ({
  id: `prod_${n}`,
  sku: `NX-${String(n).padStart(4, '0')}`,
  barcode: `78000000${String(n).padStart(5, '0')}`,
  name, category, priceClp, costClp: Math.round(priceClp * 0.65), published, active: true,
});

export const SEED_PRODUCTS: Product[] = [
  P(1, 'Bebida cola 1,5 L', 'Bebidas', 1990),
  P(2, 'Agua mineral 1,5 L', 'Bebidas', 990),
  P(3, 'Jugo de naranja 1 L', 'Bebidas', 1490),
  P(4, 'Cerveza lata 470 cc', 'Bebidas', 1290),
  P(5, 'Pan de molde', 'Panadería', 2190),
  P(6, 'Marraqueta (unidad)', 'Panadería', 300),
  P(7, 'Galletas de vainilla', 'Snacks', 890),
  P(8, 'Papas fritas 140 g', 'Snacks', 1590),
  P(9, 'Chocolate en barra', 'Snacks', 1350),
  P(10, 'Maní salado 100 g', 'Snacks', 1090),
  P(11, 'Leche entera 1 L', 'Lácteos', 1190),
  P(12, 'Yogur natural', 'Lácteos', 590),
  P(13, 'Queso laminado 250 g', 'Lácteos', 3290),
  P(14, 'Huevos docena', 'Despensa', 3490),
  P(15, 'Arroz 1 kg', 'Despensa', 1590),
  P(16, 'Fideos spaghetti 400 g', 'Despensa', 990),
  P(17, 'Aceite vegetal 1 L', 'Despensa', 2490),
  P(18, 'Azúcar 1 kg', 'Despensa', 1390),
  P(19, 'Café instantáneo 170 g', 'Despensa', 4990),
  P(20, 'Detergente 1 L', 'Limpieza', 3990),
  P(21, 'Papel higiénico 4 un.', 'Limpieza', 2790),
  P(22, 'Jabón de manos', 'Limpieza', 1890),
  P(23, 'Bolsa reutilizable', 'Otros', 500, false),
  P(24, 'Vaso desechable', 'Otros', 100, false),
];

export const SEED_CLIENTS: Client[] = [
  { id: 'cli_seed_1', name: 'María Pérez', rut: '12345678-5', email: 'maria@ejemplo.cl', phone: '+56911112222', isVip: true, creditAuthorized: true },
  { id: 'cli_seed_2', name: 'Juan Soto', rut: '11111111-1', email: 'juan@ejemplo.cl', phone: '+56933334444', isVip: false },
  { id: 'cli_seed_3', name: 'Comercial Los Andes SpA', rut: '22222222-2', email: 'compras@losandes.cl', isVip: false, creditAuthorized: true },
];

export const SEED_PROMOTIONS: Promotion[] = [
  { id: 'promo_seed_1', name: 'Bienvenida 5%', type: 'percent', value: 5, code: 'NEXUS5', validUntil: '2027-12-31', active: true },
  { id: 'promo_seed_2', name: 'Clientes VIP 10%', type: 'percent', value: 10, code: 'VIP10', validUntil: '2027-12-31', active: true },
  { id: 'promo_seed_3', name: 'Descuento fijo $500', type: 'fixed', value: 500, code: 'MENOS500', validUntil: '2027-12-31', active: true },
];

/** Estado inicial de demostración: 1 sucursal, stock en ambos canales, un cajero (PIN 1234) y folios. */
export function seedState(opts: { physical?: number; online?: number; folioFrom?: number; folioTo?: number } = {}): EngineState {
  const physical = opts.physical ?? 40;
  const online = opts.online ?? 15;
  const stock: EngineState['stock'] = {};
  for (const p of SEED_PRODUCTS) {
    stock[`branch_1:${p.id}:physical`] = { qty: physical, reserved: 0 };
    stock[`branch_1:${p.id}:online`] = { qty: p.published ? online : 0, reserved: 0 };
  }
  return {
    branches: [{ id: 'branch_1', code: 'MAT', name: 'Casa Matriz' }],
    products: structuredClone(SEED_PRODUCTS),
    clients: structuredClone(SEED_CLIENTS),
    cashiers: [{ id: 'cashier_1', name: 'Cajero 1', pin: '1234', active: true }],
    promotions: structuredClone(SEED_PROMOTIONS),
    shifts: [], tickets: [],
    stock,
    carts: {}, payments: {}, sales: [], documents: [], movements: [], creditPayments: [], consumptions: [], purchases: [], priceChanges: [],
    nextFolio: opts.folioFrom ?? 1,
    lastFolio: opts.folioTo ?? 500,
    saleSeq: 0, ticketSeq: 0, seq: 0,
  };
}
