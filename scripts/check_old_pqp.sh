#!/bin/bash
docker exec postgres-restaurante2 psql -U postgres -d qhubomor_restaurante2 -c "
SELECT \"IDCaja\", \"Nombre Insumo\", \"Para que producto\" 
FROM \"APERTURA Y CIERRE INSUMOS\" 
WHERE \"Para que producto\" IS NOT NULL 
AND \"IDCaja\" != 'fa9ac809' 
LIMIT 10;
"
