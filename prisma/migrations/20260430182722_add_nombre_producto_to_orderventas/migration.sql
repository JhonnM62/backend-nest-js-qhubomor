-- CreateTable
CREATE TABLE "USUARIOS" (
    "IDUsuarios" TEXT NOT NULL,
    "Nombre" TEXT,
    "email" TEXT,
    "Cedula" INTEGER,
    "Telefono" TEXT,
    "Direccion" TEXT,
    "Propinas" MONEY,
    "Rol" TEXT,
    "Foto" TEXT,
    "Salario" MONEY,
    "password" TEXT,
    "isActive" BOOLEAN,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "USUARIOS_pkey" PRIMARY KEY ("IDUsuarios")
);

-- CreateTable
CREATE TABLE "CATEGORIAS" (
    "IDcategoria" TEXT NOT NULL,
    "Nombre" TEXT NOT NULL,
    "Image" TEXT,

    CONSTRAINT "CATEGORIAS_pkey" PRIMARY KEY ("IDcategoria")
);

-- CreateTable
CREATE TABLE "CATEGORIAS INSUMOS" (
    "IDcategoriainsumos" TEXT NOT NULL,
    "Nombre" TEXT NOT NULL,
    "Imagen" TEXT,

    CONSTRAINT "CATEGORIAS INSUMOS_pkey" PRIMARY KEY ("IDcategoriainsumos")
);

-- CreateTable
CREATE TABLE "CLIENTES" (
    "IDcliente" SERIAL NOT NULL,
    "Nombre" TEXT,
    "Cedula" BIGINT,
    "Compras" TEXT,
    "Fecha y hora creacion" TIMESTAMP(3),
    "Fecha y hora actualizacion" TIMESTAMP(3),
    "Evento" TEXT,
    "Particpa?" TEXT,
    "Contador" INTEGER,
    "Whatsapp" TEXT,
    "Observaciones" TEXT,

    CONSTRAINT "CLIENTES_pkey" PRIMARY KEY ("IDcliente")
);

-- CreateTable
CREATE TABLE "PROVEDORES" (
    "IDprovedor" TEXT NOT NULL,
    "Nombre" TEXT,
    "Telefono" TEXT,
    "Direccion y Ciudad" TEXT,

    CONSTRAINT "PROVEDORES_pkey" PRIMARY KEY ("IDprovedor")
);

-- CreateTable
CREATE TABLE "MESAS" (
    "IdMesas" TEXT NOT NULL,
    "Nombre" TEXT,

    CONSTRAINT "MESAS_pkey" PRIMARY KEY ("IdMesas")
);

-- CreateTable
CREATE TABLE "PRODUCTOS" (
    "IDproductos" TEXT NOT NULL,
    "Categoria" TEXT,
    "Categoria_Nombre" TEXT,
    "Nombre" TEXT NOT NULL,
    "Mostrar" TEXT,
    "Cantidad" INTEGER,
    "Precio Unitario" MONEY,
    "Image" TEXT,
    "ImagenUrl" TEXT,
    "IDventas" TEXT,
    "Fecha de Cantidad agregada" TIMESTAMP(3),
    "Cantidad Agregada" INTEGER,
    "Precio de compra" MONEY,
    "Unidades" TEXT,
    "Descontar" TEXT,
    "Stock_Filtro" MONEY,
    "Combo" TEXT,
    "Llevar control en caja" TEXT,
    "Orden" INTEGER,

    CONSTRAINT "PRODUCTOS_pkey" PRIMARY KEY ("IDproductos")
);

-- CreateTable
CREATE TABLE "INSUMOS" (
    "IDalimentos" TEXT NOT NULL,
    "Categoria" TEXT,
    "Nombre" TEXT NOT NULL,
    "Unidades" TEXT,
    "Cantidad" INTEGER,
    "imagen" TEXT,
    "fecha de vencimiento" DATE,
    "NombreCategoria" TEXT,
    "Precio" MONEY,
    "Total" MONEY,
    "Agregar Cantidad" INTEGER,
    "Fecha" DATE,
    "Descontar cant de ventas?" TEXT,
    "Notificar a whatsapp" TEXT,
    "apartir de cantidad" INTEGER,
    "Enviar si o no" TEXT,
    "Disponible" TEXT,
    "Contador" INTEGER,
    "Image Url" TEXT,
    "Llevar control en caja" TEXT,
    "Contador 2" INTEGER,
    "imagencard" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "INSUMOS_pkey" PRIMARY KEY ("IDalimentos")
);

-- CreateTable
CREATE TABLE "RECETAINSUMOS" (
    "idinsumos" TEXT NOT NULL,
    "IDproductos" TEXT,
    "Categoria" TEXT,
    "Insumo" TEXT NOT NULL,
    "Tipo de medida" TEXT,
    "Cantidad" INTEGER,

    CONSTRAINT "RECETAINSUMOS_pkey" PRIMARY KEY ("idinsumos")
);

-- CreateTable
CREATE TABLE "INVENTARIO" (
    "IDinventario" TEXT NOT NULL,
    "Nombre" TEXT NOT NULL,
    "Fecha y hora" TIMESTAMP(3),
    "Tipo" TEXT,
    "Total" MONEY,
    "Descuento" MONEY,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "INVENTARIO_pkey" PRIMARY KEY ("IDinventario")
);

-- CreateTable
CREATE TABLE "ORDERINVENTARIO" (
    "IDorderinventario" TEXT NOT NULL,
    "IDinventario" TEXT,
    "Categoria" TEXT,
    "Nombre del Alimento" TEXT,
    "Cantidad" INTEGER,
    "Observacion" TEXT,
    "NombreCategoria" TEXT,
    "Fecha" DATE,
    "Precio" MONEY,
    "Precio Actual" MONEY,
    "Subtotal" MONEY,
    "Precio Anterior" MONEY,
    "Cant insumos" INTEGER,
    "Agregar a Insumos?" TEXT,
    "Provedor" TEXT,
    "Telefono Provedor" TEXT,
    "Direccion Provedor" TEXT,
    "Disponible" TEXT,
    "Fecha y hora" TIMESTAMP(3),
    "Se compro?" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "ORDERINVENTARIO_pkey" PRIMARY KEY ("IDorderinventario")
);

-- CreateTable
CREATE TABLE "VENTAS" (
    "IDventas" TEXT NOT NULL,
    "Fecha y hora" TIMESTAMP(3),
    "Escanear" TEXT,
    "Producto" TEXT,
    "Estado" TEXT,
    "MESA" TEXT,
    "FECHA" DATE,
    "HORA" TEXT,
    "Efectivo Recibido" MONEY,
    "Devueltas" MONEY,
    "Icon" TEXT,
    "Direccion" TEXT,
    "Costo del Domicilio" MONEY,
    "% de descuento" TEXT,
    "Descuento" MONEY,
    "Medio de pago" TEXT,
    "BANCO" TEXT,
    "Valor de transferencia" MONEY,
    "Pedido" TEXT,
    "AGREGAR PRODUCTOS" TEXT,
    "Usuario" TEXT,
    "Numero telefono" INTEGER,
    "Mensaje" TEXT,
    "TOTAL INPUT" MONEY,
    "Clente" TEXT,
    "Compras" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "VENTAS_pkey" PRIMARY KEY ("IDventas")
);

-- CreateTable
CREATE TABLE "ORDERVENTAS" (
    "IDorderventas" TEXT NOT NULL,
    "IDventas" TEXT,
    "Categoria" TEXT,
    "Nombre" TEXT,
    "Cantidad" INTEGER,
    "Precio" MONEY,
    "Precio total" MONEY,
    "Estado" TEXT,
    "Comentarios" TEXT,
    "Imagen" TEXT,
    "fecha" DATE,
    "SALSA" TEXT,
    "HELADO" TEXT,
    "TOPINGS" TEXT,
    "NombreProducto" TEXT,
    "CategoriaProducto" TEXT,
    "ImagenUrl" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "usuarioId" TEXT,
    "productoId" TEXT,

    CONSTRAINT "ORDERVENTAS_pkey" PRIMARY KEY ("IDorderventas")
);

-- CreateTable
CREATE TABLE "Dinero retirado" (
    "IDretiro" TEXT NOT NULL,
    "FilterID" TEXT,
    "valor" MONEY,
    "retiro" MONEY,
    "sobrante" MONEY,
    "Total" MONEY,
    "fecha y hora" TIMESTAMP(3),
    "observacion" TEXT,
    "comentario" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "usuarioId" TEXT,

    CONSTRAINT "Dinero retirado_pkey" PRIMARY KEY ("IDretiro")
);

-- CreateTable
CREATE TABLE "APERTURA Y CIERRE DE CAJA" (
    "IDCaja" TEXT NOT NULL,
    "Nombre" TEXT,
    "Apertura" TEXT,
    "Fecha de Apertura" DATE,
    "Hora de Apertura" TEXT,
    "Efectivo de Apertura" MONEY,
    "Fecha de Cierre" DATE,
    "Hora de Cierre" TEXT,
    "Efectivo de Cierre" MONEY,
    "Resumen" MONEY,
    "pdf" TEXT,
    "Pdfcount" INTEGER,
    "observaciones" TEXT,
    "Cierre" TEXT,
    "Total 12 Onz" INTEGER,
    "Total 24 Onz" INTEGER,
    "Productos" TEXT,
    "Tipo de vaso" TEXT,
    "Cant A agregar" INTEGER,
    "Plata Guardada" MONEY,
    "Cuadro Caja?" TEXT,
    "Valor Faltante" MONEY,
    "Valor Excedente" MONEY,
    "Hora en la que se actualizo" TIMESTAMP(3),
    "Contador" INTEGER,
    "Contador 2" INTEGER,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "APERTURA Y CIERRE DE CAJA_pkey" PRIMARY KEY ("IDCaja")
);

-- CreateTable
CREATE TABLE "APERTURA Y CIERRE INSUMOS" (
    "Idcierreyapertura" TEXT NOT NULL,
    "IDCaja" TEXT,
    "Para que producto" TEXT,
    "Nombre del Producto" TEXT,
    "Categoria" TEXT,
    "Insumos" TEXT,
    "Nombre Insumo" TEXT,
    "Unidad de medida" TEXT,
    "Cant apertura" INTEGER,
    "Fecha y hora" TIMESTAMP(3),
    "Fecha" DATE,
    "Cant de cierre" INTEGER,
    "se utilizaron" INTEGER,
    "Observacion" TEXT,
    "Agregar Cant" INTEGER,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "APERTURA Y CIERRE INSUMOS_pkey" PRIMARY KEY ("Idcierreyapertura")
);

-- CreateTable
CREATE TABLE "GASTOS" (
    "IDgastos" TEXT NOT NULL,
    "Concepto" TEXT,
    "Fecha y hora" TIMESTAMP(3),
    "Fecha" DATE,
    "Valor" MONEY,
    "Fotos" TEXT,
    "Medio de pago" TEXT,
    "Relacion con insumos" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "GASTOS_pkey" PRIMARY KEY ("IDgastos")
);

-- CreateTable
CREATE TABLE "GASTOS PERSONALES" (
    "IDgastos" TEXT NOT NULL,
    "Concepto" TEXT,
    "Fecha y hora" TIMESTAMP(3),
    "Fecha" DATE,
    "Valor" MONEY,
    "Fotos" TEXT,
    "Medio de pago" TEXT,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "GASTOS PERSONALES_pkey" PRIMARY KEY ("IDgastos")
);

-- CreateTable
CREATE TABLE "COMENTARIOS" (
    "ID" TEXT NOT NULL,
    "Comentarios" TEXT,
    "Tipo" TEXT,
    "Precio" MONEY,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "COMENTARIOS_pkey" PRIMARY KEY ("ID")
);

-- CreateTable
CREATE TABLE "Filter" (
    "FilterID" TEXT NOT NULL,
    "Desde" DATE,
    "Hasta" DATE,
    "Categoria" TEXT,
    "Producto" TEXT,
    "Ingreso Total" MONEY,
    "pdf" TEXT,
    "Categoria Alimentos" TEXT,
    "Alimentos" TEXT,
    "pdf2" TEXT,
    "Desde2" DATE,
    "Hasta2" BOOLEAN,
    "TIPO DE FILTRO" TEXT,
    "Desde3" DATE,
    "Hasta3" DATE,
    "Categoria2" TEXT,
    "Producto2" TEXT,
    "Numero de Unidades Vendidas" INTEGER,
    "Precio Total del Producto Vendido" INTEGER,
    "Desde4" DATE,
    "Hasta4" DATE,
    "pdf3" TEXT,
    "Total Gastos" MONEY,
    "Desde5" DATE,
    "Hasta5" DATE,
    "pdf4" TEXT,
    "Total Gastos personales" MONEY,
    "Desde6" DATE,
    "Hasta6" DATE,
    "pdf5" TEXT,
    "Total de plata guardada" MONEY,
    "Fecha Inicio Ventas" DATE,
    "Fecha Final Ventas" DATE,
    "Ventas TOTAL" MONEY,
    "Gastos TOTAL" MONEY,
    "Inventario TOTAL" MONEY,
    "Gastos Personales TOTAL" MONEY,
    "Utilidad Negocio" MONEY,
    "Utilidad Neta" MONEY,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Filter_pkey" PRIMARY KEY ("FilterID")
);

-- CreateTable
CREATE TABLE "HOME" (
    "IDhome" TEXT NOT NULL,
    "Menu" TEXT,
    "MostrarRol" TEXT,
    "Icono" TEXT,
    "Vista" TEXT,
    "Accion" TEXT,
    "Orden" INTEGER,

    CONSTRAINT "HOME_pkey" PRIMARY KEY ("IDhome")
);

-- CreateTable
CREATE TABLE "SUBMENU" (
    "Idsubmenu" TEXT NOT NULL,
    "IDhome" TEXT,
    "Submenu" TEXT,
    "Rol" TEXT,
    "Imagen" TEXT,
    "Vista" TEXT,
    "Orden" INTEGER,

    CONSTRAINT "SUBMENU_pkey" PRIMARY KEY ("Idsubmenu")
);

-- CreateTable
CREATE TABLE "_AperturaCierreCajaToVentas" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_AperturaCierreCajaToVentas_AB_unique" ON "_AperturaCierreCajaToVentas"("A", "B");

-- CreateIndex
CREATE INDEX "_AperturaCierreCajaToVentas_B_index" ON "_AperturaCierreCajaToVentas"("B");

-- AddForeignKey
ALTER TABLE "PRODUCTOS" ADD CONSTRAINT "PRODUCTOS_Categoria_fkey" FOREIGN KEY ("Categoria") REFERENCES "CATEGORIAS"("IDcategoria") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "INSUMOS" ADD CONSTRAINT "INSUMOS_Categoria_fkey" FOREIGN KEY ("Categoria") REFERENCES "CATEGORIAS INSUMOS"("IDcategoriainsumos") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RECETAINSUMOS" ADD CONSTRAINT "RECETAINSUMOS_IDproductos_fkey" FOREIGN KEY ("IDproductos") REFERENCES "PRODUCTOS"("IDproductos") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RECETAINSUMOS" ADD CONSTRAINT "RECETAINSUMOS_Insumo_fkey" FOREIGN KEY ("Insumo") REFERENCES "INSUMOS"("IDalimentos") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERINVENTARIO" ADD CONSTRAINT "ORDERINVENTARIO_IDinventario_fkey" FOREIGN KEY ("IDinventario") REFERENCES "INVENTARIO"("IDinventario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERINVENTARIO" ADD CONSTRAINT "ORDERINVENTARIO_Provedor_fkey" FOREIGN KEY ("Provedor") REFERENCES "PROVEDORES"("IDprovedor") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VENTAS" ADD CONSTRAINT "VENTAS_Usuario_fkey" FOREIGN KEY ("Usuario") REFERENCES "USUARIOS"("IDUsuarios") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VENTAS" ADD CONSTRAINT "VENTAS_MESA_fkey" FOREIGN KEY ("MESA") REFERENCES "MESAS"("IdMesas") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERVENTAS" ADD CONSTRAINT "ORDERVENTAS_IDventas_fkey" FOREIGN KEY ("IDventas") REFERENCES "VENTAS"("IDventas") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERVENTAS" ADD CONSTRAINT "ORDERVENTAS_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "USUARIOS"("IDUsuarios") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ORDERVENTAS" ADD CONSTRAINT "ORDERVENTAS_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "PRODUCTOS"("IDproductos") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dinero retirado" ADD CONSTRAINT "Dinero retirado_FilterID_fkey" FOREIGN KEY ("FilterID") REFERENCES "VENTAS"("IDventas") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dinero retirado" ADD CONSTRAINT "Dinero retirado_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "USUARIOS"("IDUsuarios") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "APERTURA Y CIERRE INSUMOS" ADD CONSTRAINT "APERTURA Y CIERRE INSUMOS_Nombre Insumo_fkey" FOREIGN KEY ("Nombre Insumo") REFERENCES "INSUMOS"("IDalimentos") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SUBMENU" ADD CONSTRAINT "SUBMENU_IDhome_fkey" FOREIGN KEY ("IDhome") REFERENCES "HOME"("IDhome") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AperturaCierreCajaToVentas" ADD CONSTRAINT "_AperturaCierreCajaToVentas_A_fkey" FOREIGN KEY ("A") REFERENCES "APERTURA Y CIERRE DE CAJA"("IDCaja") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AperturaCierreCajaToVentas" ADD CONSTRAINT "_AperturaCierreCajaToVentas_B_fkey" FOREIGN KEY ("B") REFERENCES "VENTAS"("IDventas") ON DELETE CASCADE ON UPDATE CASCADE;
