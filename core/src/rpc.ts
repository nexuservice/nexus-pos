/**
 * Métodos del motor que se pueden invocar desde el frontend o por HTTP (POST /api/rpc/:método).
 * Los de lectura no persisten el estado; los de escritura sí.
 */
export const READ_METHODS = [
  'branches', 'catalog', 'listProducts', 'inventory', 'movements', 'stockCard', 'listClients', 'searchClients', 'clientBalance', 'listConsumptions', 'listCashiers',
  'listPromotions', 'activePromotions', 'getCart', 'nextOrderNumber', 'currentShift', 'shiftInfo', 'listShifts',
  'getPayment', 'foliosRemaining', 'currentFolio', 'getSale', 'listSales', 'listTickets', 'salesReport', 'snapshot',
] as const;

export const WRITE_METHODS = [
  'upsertProduct', 'adjustStock', 'moveStock', 'upsertClient', 'deleteClient', 'upsertCashier', 'upsertPromotion',
  'deletePromotion', 'applyPromo', 'removePromo', 'createCart', 'cartAdd', 'cartSetQuantity', 'cartRemove', 'cartClear',
  'setCustomer', 'openShift', 'closeShift', 'cancelPayment', 'voidSale', 'holdCart', 'createPaidTicket', 'resumeTicket',
  'completeTicket', 'cancelTicket', 'payClientDebt', 'registerConsumption', 'voidConsumption',
] as const;

export const RPC_METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;
export type RpcName = (typeof RPC_METHODS)[number];
export const isRpcName = (n: string): n is RpcName => (RPC_METHODS as readonly string[]).includes(n);
export const isReadMethod = (n: string): boolean => (READ_METHODS as readonly string[]).includes(n);
