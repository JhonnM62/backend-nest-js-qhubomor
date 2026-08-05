-- =====================================================
-- MIGRACIÓN DE DATOS: 3 de agosto de 2026
-- Origen: basededatosrestaurante (dbventas1.2)
-- Destino: qhubomor_restaurante2 (postgres-restaurante2)
-- IDCaja migrada: fa9ac809
-- Cajera: Luisa Castaño
-- =====================================================

BEGIN;

-- 1. APERTURA Y CIERRE DE CAJA
INSERT INTO "APERTURA Y CIERRE DE CAJA" ("IDCaja","Nombre","Apertura","Fecha de Apertura","Hora de Apertura","Efectivo de Apertura","Fecha de Cierre","Hora de Cierre","Efectivo de Cierre","Resumen","pdf","Pdfcount","observaciones","Cierre","Total 12 Onz","Total 24 Onz","Productos","Tipo de vaso","Cant A agregar","Plata Guardada","Cuadro Caja?","Valor Faltante","Valor Excedente","Hora en la que se actualizo","Contador","Contador 2","Hora Congelada","Transferencias Contadas","createdAt","updatedAt")
VALUES (
  'fa9ac809',
  'Luisa Castaño',
  'abierta',                -- Apertura: siempre 'abierta' al crear
  '2026-08-03',
  '14:36:00',
  '45000.00'::money,
  '2026-08-03',
  '14:36:00',
  NULL::money,
  '-45000.00'::money,
  '',
  NULL,
  E'0 guardados en el cajón de la casa.\n\nPréstamos 0\nSacamos 0\n\n0 vasos dañado con licor\n0 vasos dañados sin licor\n\n\nDINERO FALTANTE:\nDINERO EXEDENTE:',
  'cerrada',                -- Cierre: 'cerrada' porque ya tiene fechaDeCierre
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL::money,
  'NO SE HA REVISADO',
  '0.00'::money,
  '0.00'::money,
  NULL::timestamp,
  NULL,
  NULL,
  NULL,
  NULL::money,
  NULL::timestamp,
  NULL::timestamp
) ON CONFLICT ("IDCaja") DO UPDATE SET "Apertura" = 'abierta', "Cierre" = 'cerrada';

-- 2. APERTURA Y CIERRE INSUMOS (19 registros asociados a fa9ac809)
-- NOTA: El campo "Nombre Insumo" guarda el IDalimentos del insumo (FK a INSUMOS.IDalimentos)
-- El campo "Insumos" guarda el IDalimentos también
-- Los campos texto son: "Nombre del Producto", "Categoria", "Unidad de medida", etc.
INSERT INTO "APERTURA Y CIERRE INSUMOS" ("Idcierreyapertura","IDCaja","Nombre del Producto","Categoria","Insumos","Nombre Insumo","Unidad de medida","Cant apertura","Fecha y hora","Fecha","Cant de cierre","se utilizaron","Observacion","Agregar Cant","createdAt","updatedAt","Para que producto","Disponible")
VALUES
  ('peqk4bxs','fa9ac809','ALITAS X5 peq|ALITAS X10 med|ALITAS X15 Fami','4cce33b6','733547cc','733547cc','unidad',7,'2026-08-03 14:37:07'::timestamp,'2026-08-03'::date,NULL,7,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('wsbasnwh','fa9ac809','Sal La Rechimba Especial|CARNE MIXTA Trifasico|S. El Patron Cerdo|S. Callejero Mixto|CARNE CERDO','4cce33b6','7fc9d172','7fc9d172','unidad',24,'2026-08-03 14:37:04'::timestamp,'2026-08-03'::date,NULL,24,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('q9foaxu5','fa9ac809','H. La Parcera Clasica|H. La Berraca Doble|H. La Mera Vuelta Mexicana|Q Hubo Mor de la casa','4cce33b6','f4f23a39','f4f23a39','unidad',20,'2026-08-03 14:36:50'::timestamp,'2026-08-03'::date,NULL,20,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('l8mkjdpd','fa9ac809','CARNE MIXTA Trifasico|CARNE DE RES','4cce33b6','c57c3d1c','c57c3d1c','unidad',5,'2026-08-03 14:37:11'::timestamp,'2026-08-03'::date,NULL,5,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('43vhs3lr','fa9ac809','P. El Arriero Choriperro|Sal El Poblado Mixta|Q Hubo Mor de la casa|Sal La Rechimba Especial','4cce33b6','7eb7f4ad','7eb7f4ad','unidad',7,'2026-08-03 14:37:30'::timestamp,'2026-08-03'::date,NULL,7,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('i75lzwsj','fa9ac809','H. La Grosera Costilla|COSTILLA','4cce33b6','3ca3916e','3ca3916e','unidad',21,'2026-08-03 14:37:27'::timestamp,'2026-08-03'::date,NULL,21,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('i1rbawr1','fa9ac809','S. Callejero Mixto|Sal La Rechimba Especial|CARNE POLLO|CARNE MIXTA Trifasico|S. El Gomelo Pollo|H. La Mona Pollo|P. El Pinta Urbano','4cce33b6','eb89d7a9','eb89d7a9','unidad',16,'2026-08-03 14:37:14'::timestamp,'2026-08-03'::date,NULL,16,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('62k1b5jo','fa9ac809','Q Hubo Mor de la casa','4cce33b6','37df3652','37df3652','unidad',8,'2026-08-03 14:37:40'::timestamp,'2026-08-03'::date,NULL,8,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('pkj0w9ep','fa9ac809','Des J1','243c6b7b','98bb55dd','98bb55dd','unidad',9,'2026-08-03 14:37:43'::timestamp,'2026-08-03'::date,NULL,9,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('90lo24tu','fa9ac809','P. El Pinta Urbano|S. Callejero Mixto|S. El Patron Cerdo|S. El Gomelo Pollo','4cce33b6','98ffd543','98ffd543','unidad',19,'2026-08-03 14:37:50'::timestamp,'2026-08-03'::date,NULL,19,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('pvv7bblp','fa9ac809','Sal. La Comuna Tradicional|Sal El Poblado Mixta|Sal La Rechimba Especial','4cce33b6','50a3c23d','50a3c23d','unidad',29,'2026-08-03 14:36:56'::timestamp,'2026-08-03'::date,NULL,29,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('q1mmsnli','fa9ac809','Des P1','243c6b7b','a784d1f7','a784d1f7','unidad',13,'2026-08-03 14:37:47'::timestamp,'2026-08-03'::date,NULL,13,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('0gi3qn44','fa9ac809','H. La Parcera Clasica|H. La Mona Pollo|H. La Mera Vuelta Mexicana|H. La Grosera Costilla|Q Hubo Mor de la casa|H. La Berraca Doble','bd4a8fb5','ecc0f975','ecc0f975','unidad',18,'2026-08-03 14:37:00'::timestamp,'2026-08-03'::date,NULL,18,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('g3baoc92','fa9ac809','P. El Arriero Choriperro|P. El Pinta Urbano|P. El Ñerito Sencillo','bd4a8fb5','ead1ddaf','ead1ddaf','unidad',15,'2026-08-03 14:37:20'::timestamp,'2026-08-03'::date,NULL,15,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('ri8034gy','fa9ac809','S. El Patron Cerdo|S. Callejero Mixto|S. El Gomelo Pollo','bd4a8fb5','e6422020','e6422020','unidad',9,'2026-08-03 14:37:17'::timestamp,'2026-08-03'::date,NULL,9,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('yioymmjo','fa9ac809','P. El Ñerito Sencillo|P. El Pinta Urbano|P. El Arriero Choriperro|Sal. La Comuna Tradicional|Sal El Poblado Mixta|Sal La Rechimba Especial','4cce33b6','6f8501fd','6f8501fd','unidad',68,'2026-08-03 14:37:23'::timestamp,'2026-08-03'::date,NULL,68,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('ckepm84e','fa9ac809','H. La Parcera Clasica|H. La Berraca Doble|H. La Mona Pollo|H. La Mera Vuelta Mexicana|H. La Grosera Costilla|Q Hubo Mor de la casa|S. El Gomelo Pollo|S. El Patron Cerdo|S. Callejero Mixto|Queso tajado','4cce33b6','4abbe7ea','4abbe7ea','unidad',3,'2026-08-03 14:37:36'::timestamp,'2026-08-03'::date,NULL,3,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('y6nhab7w','fa9ac809','Sal. La Comuna Tradicional|P. El Ñerito Sencillo|P. El Pinta Urbano|Sal El Poblado Mixta|Sal La Rechimba Especial','4cce33b6','29c8a066','29c8a066','unidad',26,'2026-08-03 14:36:53'::timestamp,'2026-08-03'::date,NULL,26,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL),
  ('g83ex3i8','fa9ac809','H. La Parcera Clasica|H. La Berraca Doble|H. La Mera Vuelta Mexicana|H. La Grosera Costilla|Q Hubo Mor de la casa|Sal El Poblado Mixta|Sal La Rechimba Especial|P. El Ñerito Sencillo|S. Callejero Mixto','4cce33b6','2a82de73','2a82de73','unidad',4,'2026-08-03 14:37:33'::timestamp,'2026-08-03'::date,NULL,4,NULL,NULL,NULL::timestamp,NULL::timestamp,NULL::jsonb,NULL)
ON CONFLICT ("Idcierreyapertura") DO NOTHING;

COMMIT;

-- Verificación
SELECT 'AperturaCierreCaja insertada:' as msg, COUNT(*) FROM "APERTURA Y CIERRE DE CAJA" WHERE "IDCaja" = 'fa9ac809';
SELECT 'AperturaCierreInsumos insertados:' as msg, COUNT(*) FROM "APERTURA Y CIERRE INSUMOS" WHERE "IDCaja" = 'fa9ac809';
