# Módulo de Apertura y Cierre de Caja

Este módulo gestiona la apertura, control de insumos, y análisis financiero (cierre) de la caja diaria.

## Reglas de Negocio Actualizadas (2026-05-06)

### 1. Análisis Financiero y Montos de Venta
- **Estados Válidos:** El cálculo financiero (Efectivo, Transferencias, Total Ventas) **solo** toma en cuenta los pedidos en estado `PAGADO` o `ENTREGADO`.
- **Estados Excluidos:** Se excluyen estrictamente los pedidos en estado `TOMADO`, `EN_EL_CARRITO`, `LISTO_PARA_ENTREGA`, o `DEUDOR` para evitar inflar los ingresos de caja con dinero que no ha entrado físicamente.
- **Lógica de "EFECTIVO Y OTROS":** Cuando un pago es mixto, el valor reportado como Efectivo corresponde a la propiedad `efectivoRecibido` de la venta. El valor de Transferencia se calcula matemáticamente como la diferencia `(totalInput - efectivoRecibido)`.

### 2. Órdenes Repartidas (Domicilios)
- Un pedido se considera "Repartido" o "Domicilio" si cumple alguna de las siguientes condiciones:
  - El `costoDelDomicilio` es mayor a 0.
  - La propiedad `direccion` no está vacía.
- Ya no depende estrictamente de que el estado sea "ENTREGADO", permitiendo contabilizar los domicilios apenas son cobrados (`PAGADO`).

### 3. Control de Insumos Físicos
- **Gasto Físico vs. Gasto en Sistema:**
  - El *Gasto Físico* es la diferencia entre la cantidad declarada al abrir la caja (`cantApertura`) y la cantidad contabilizada al cerrarla (`cantDeCierre`).
  - El *Gasto en Sistema* (Teórico) se calcula sumando las cantidades de insumos consumidos por los productos vendidos en los pedidos **cobrados** (`PAGADO`, `ENTREGADO`).
- Se garantiza la consistencia del conteo excluyendo los productos de órdenes no cobradas (ej. `TOMADO`), lo que alinea las cantidades mostradas en el módulo de Historial de Ventas con el Análisis Financiero de la Caja.

### 4. Inventario Dinámico y Conteo Obligatorio
- El sistema **no proyecta cantidades** basadas en el "Gasto del sistema" para rellenar automáticamente la cantidad de cierre.
- Es **obligatorio** que el usuario ingrese la cantidad física final (`cantDeCierre`) de cada insumo. Si un campo se deja vacío o no se contabiliza físicamente, el sistema bloqueará el guardado/cierre de la caja y advertirá al usuario indicando que "Faltan cantidades en algunos insumos".

---
*Firma Digital QA: Aprobado para despliegue - Valores pixel-perfect verificados con base de datos.*