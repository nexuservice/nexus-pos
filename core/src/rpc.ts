/**
 * Métodos del motor que se pueden invocar desde el frontend o por HTTP (POST /api/rpc/:método).
 * Los de lectura no persisten el estado; los de escritura sí.
 */
export const READ_METHODS = [
  'branches', 'catalog', 'listProducts', 'inventory', 'nextInternalCode', 'movements', 'stockCard', 'listClients', 'searchClients', 'clientBalance', 'listConsumptions', 'listPurchases', 'listSuppliers', 'listCashiers',
  'listPromotions', 'activePromotions', 'getCart', 'nextOrderNumber', 'currentShift', 'shiftInfo', 'listShifts', 'openShifts', 'verifyShiftPin',
  'getPayment', 'getBusiness', 'findProduct', 'getSale', 'listSales', 'listTickets', 'salesReport', 'snapshot',
] as const;

export const WRITE_METHODS = [
  'upsertProduct', 'adjustStock', 'moveStock', 'setWebStock', 'setWebReserve', 'moveAllWebToShop', 'upsertClient', 'deleteClient', 'upsertCashier', 'upsertPromotion',
  'deletePromotion', 'applyPromo', 'removePromo', 'createCart', 'cartAdd', 'cartSetQuantity', 'cartRemove', 'cartClear',
  'setCustomer', 'openShift', 'closeShift', 'assignCartShift', 'cancelPayment', 'voidSale', 'holdCart', 'createPaidTicket', 'resumeTicket',
  'completeTicket', 'cancelTicket', 'payClientDebt', 'registerConsumption', 'voidConsumption', 'registerPurchase', 'voidPurchase', 'setProductPrice', 'setProductSalePrice', 'updateBusiness', 'receiveStock',
] as const;

export const RPC_METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;
export type RpcName = (typeof RPC_METHODS)[number];
export const isRpcName = (n: string): n is RpcName => (RPC_METHODS as readonly string[]).includes(n);
export const isReadMethod = (n: string): boolean => (READ_METHODS as readonly string[]).includes(n);

/**
 * Lo que puede hacer el perfil de cajero: vender, abrir y cerrar su caja, ingresar mercadería por escaneo y ver el historial.
 * Todo lo demás (precios, inventario, clientes, promociones, compras, anulaciones, reportes, datos del negocio) es del administrador.
 */
export const CASHIER_METHODS: readonly RpcName[] = [
  // consultar
  'branches', 'catalog', 'listProducts', 'nextInternalCode', 'searchClients', 'clientBalance', 'listCashiers', 'activePromotions', 'getCart',
  'nextOrderNumber', 'currentShift', 'shiftInfo', 'openShifts', 'verifyShiftPin', 'getPayment', 'getBusiness', 'findProduct', 'getSale',
  'listSales', 'listTickets', 'listConsumptions',
  // vender y operar la caja
  'applyPromo', 'removePromo', 'createCart', 'cartAdd', 'cartSetQuantity', 'cartRemove', 'cartClear', 'setCustomer', 'openShift', 'closeShift',
  'assignCartShift', 'cancelPayment', 'holdCart', 'createPaidTicket', 'resumeTicket', 'completeTicket', 'cancelTicket', 'payClientDebt',
  'registerConsumption',
  // ingresar mercadería
  'receiveStock',
];
export const isCashierMethod = (n: string): boolean => (CASHIER_METHODS as readonly string[]).includes(n);
