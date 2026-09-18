import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const categorias = [
  'BEBIDAS',
  'ADICCIONALES',
  'HAMBURGUESAS',
  'Fundidos de Queso',
  'SALCHIPAPAS',
  'Perros',
];

const menuData = [
  // BEBIDAS
  { categoria: 'BEBIDAS', nombre: 'Gaseosas', precio: 7000 },
  { categoria: 'BEBIDAS', nombre: 'Cervezas Nacionales', precio: 9000 },
  { categoria: 'BEBIDAS', nombre: 'Corona', precio: 12000 },
  { categoria: 'BEBIDAS', nombre: 'Sodas Italianas', precio: 16000 },
  { categoria: 'BEBIDAS', nombre: 'Michelado', precio: 3000 },
  { categoria: 'BEBIDAS', nombre: 'Agua Manantial', precio: 5000 },
  { categoria: 'BEBIDAS', nombre: 'Limonada Natural', precio: 9000 },
  { categoria: 'BEBIDAS', nombre: 'Limonadas Especiales (coco, cereza, mango, maracuya)', precio: 15000 },
  { categoria: 'BEBIDAS', nombre: 'Limonada de Vino', precio: 17000 },
  { categoria: 'BEBIDAS', nombre: 'Jugos en Agua', precio: 10000 },
  { categoria: 'BEBIDAS', nombre: 'Jugos en Leche', precio: 13000 },

  // ADICCIONALES
  { categoria: 'ADICCIONALES', nombre: 'Carne Hamburguesa', precio: 13000 },
  { categoria: 'ADICCIONALES', nombre: 'Aros de Cebolla', precio: 11000 },
  { categoria: 'ADICCIONALES', nombre: 'Tocineta', precio: 7000 },
  { categoria: 'ADICCIONALES', nombre: 'Salsa de Queso', precio: 11000 },
  { categoria: 'ADICCIONALES', nombre: 'Papas Francesas', precio: 9000 },
  { categoria: 'ADICCIONALES', nombre: 'Maduro', precio: 9000 },
  { categoria: 'ADICCIONALES', nombre: 'Chorizo', precio: 9000 },
  { categoria: 'ADICCIONALES', nombre: 'Chicharrones', precio: 13000 },
  { categoria: 'ADICCIONALES', nombre: 'Piña Asada', precio: 7000 },
  { categoria: 'ADICCIONALES', nombre: 'Maicitos', precio: 5000 },
  { categoria: 'ADICCIONALES', nombre: 'Guacamole', precio: 11000 },

  // HAMBURGUESAS
  { categoria: 'HAMBURGUESAS', nombre: 'Hamburguesa CLASICA', precio: 31900 },
  { categoria: 'HAMBURGUESAS', nombre: 'Hamburguesa FOGATA', precio: 38200 },
  { categoria: 'HAMBURGUESAS', nombre: 'Hamburguesa CHIMICHURRI', precio: 36800 },
  { categoria: 'HAMBURGUESAS', nombre: 'Hamburguesa BUFFALO (PICANTE)', precio: 36700 },
  { categoria: 'HAMBURGUESAS', nombre: 'Hamburguesa PIMIENTAS', precio: 39700 },
  { categoria: 'HAMBURGUESAS', nombre: 'Hamburguesa PIAZZOLA', precio: 37900 },

  // Fundidos de Queso
  { categoria: 'Fundidos de Queso', nombre: 'Fundido Pollo con Champiñones', precio: 34800 },
  { categoria: 'Fundidos de Queso', nombre: 'Fundido Maduro con Tocineta', precio: 34800 },
  { categoria: 'Fundidos de Queso', nombre: 'Fundido Capress', precio: 32900 },
  { categoria: 'Fundidos de Queso', nombre: 'Fundido Fogata', precio: 37800 },

  // SALCHIPAPAS
  { categoria: 'SALCHIPAPAS', nombre: 'Salchipapa Fogata', precio: 34800 },
  { categoria: 'SALCHIPAPAS', nombre: 'Salchipapa Papas Candela', precio: 34800 },
  { categoria: 'SALCHIPAPAS', nombre: 'Salchipapa El Chispero', precio: 34800 },
  { categoria: 'SALCHIPAPAS', nombre: 'Salchipapa Doble Troque', precio: 38500 },
  { categoria: 'SALCHIPAPAS', nombre: 'Salchipapa Señorial', precio: 35500 },

  // Perros
  { categoria: 'Perros', nombre: 'Perro Sencillo', precio: 30200 },
  { categoria: 'Perros', nombre: 'Perro Fogata', precio: 33400 },
  { categoria: 'Perros', nombre: 'Perro Choripan', precio: 33900 },
];

async function main() {
  console.log('Iniciando carga de menú para Fogata...');

  // 1. Crear categorías
  const catMap = new Map<string, string>();
  for (const catName of categorias) {
    let categoria = await prisma.categorias.findFirst({
      where: { nombre: catName },
    });

    if (!categoria) {
      categoria = await prisma.categorias.create({
        data: {
          nombre: catName,
        },
      });
      console.log(`✅ Categoría creada: ${catName}`);
    } else {
      console.log(`ℹ️ Categoría ya existía: ${catName}`);
    }
    catMap.set(catName, categoria.IDcategoria);
  }

  // 2. Crear productos
  for (const item of menuData) {
    const categoriaId = catMap.get(item.categoria);
    if (!categoriaId) continue;

    let producto = await prisma.productos.findFirst({
      where: { nombre: item.nombre },
    });

    if (!producto) {
      await prisma.productos.create({
        data: {
          nombre: item.nombre,
          categoria: categoriaId,
          categoriaNombre: item.categoria,
          precioUnitario: item.precio,
          mostrar: 'si',
          cantidad: 999, // Para evitar problemas de stock si no llevan inventario
          llevarControlEnCaja: 'no',
        },
      });
      console.log(`✅ Producto creado: ${item.nombre} - $${item.precio}`);
    } else {
      // Actualizar el precio si ya existe
      await prisma.productos.update({
        where: { IDproductos: producto.IDproductos },
        data: {
          precioUnitario: item.precio,
          categoria: categoriaId,
          categoriaNombre: item.categoria,
          mostrar: 'si',
          llevarControlEnCaja: 'no',
        },
      });
      console.log(`🔄 Producto actualizado: ${item.nombre} - $${item.precio}`);
    }
  }

  console.log('¡Menú cargado exitosamente!');
}

main()
  .catch((e) => {
    console.error('Error cargando el menú:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
