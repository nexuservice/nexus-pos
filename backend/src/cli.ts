/**
 * Administración de clientes desde la terminal (sin abrir el servidor):
 *   npm run cliente -- crear 76123456-0 "Almacén Don Pepe" clave-segura
 *   npm run cliente -- listar
 *   npm run cliente -- clave 76123456-0 nueva-clave
 *   npm run cliente -- desactivar 76123456-0
 *   npm run cliente -- activar 76123456-0
 */
import { DATA_DIR } from './config';
import { FileTenantStorage, TenantError, TenantManager } from './tenants';

const [cmd, ...args] = process.argv.slice(2);
const manager = new TenantManager(new FileTenantStorage(DATA_DIR));
const show = (t: { rut: string; name: string; active: boolean }) => `${t.rut}  ${t.name}  ${t.active ? 'activo' : 'DESACTIVADO'}`;

try {
  switch (cmd) {
    case 'crear': {
      const [rut, name, password] = args;
      if (!rut || !name || !password) throw new TenantError('INVALID_DATA', 'Uso: crear <rut> "<nombre del negocio>" <clave>');
      console.log('Cliente creado:', show(manager.create({ rut, name, password })));
      console.log('Entra con su RUT y esa clave. Su negocio parte vacío.');
      break;
    }
    case 'listar': {
      const all = manager.list();
      console.log(all.length ? all.map(show).join('\n') : 'No hay clientes todavía.');
      break;
    }
    case 'clave': {
      const [rut, password] = args;
      if (!rut || !password) throw new TenantError('INVALID_DATA', 'Uso: clave <rut> <nueva clave>');
      console.log('Clave actualizada:', show(manager.setPassword(rut, password)));
      break;
    }
    case 'desactivar':
    case 'activar': {
      if (!args[0]) throw new TenantError('INVALID_DATA', `Uso: ${cmd} <rut>`);
      console.log('Listo:', show(manager.setActive(args[0], cmd === 'activar')));
      break;
    }
    default:
      console.log('Comandos: crear <rut> "<nombre>" <clave> | listar | clave <rut> <nueva> | desactivar <rut> | activar <rut>');
  }
} catch (e) {
  console.error(e instanceof TenantError ? `Error: ${e.message}` : e);
  process.exitCode = 1;
}
