const fs = require('fs');
let f = fs.readFileSync('c:/APIS_v2.3/puntodeventabackend/src/nomina/nomina.service.ts', 'utf8');

// Use a simple string split and join instead of regex for safety
const searchString = "Est\\u00e1s fuera del rango permitido para descansos \\n(${Math.round(distanciaMetros)}m > ${radioPermitido}m)";
// wait, the actual characters may be different. Let's just use string replacement with regex that matches anything between two parts.

f = f.replace(/Est.s fuera del rango permitido para descansos[^]+?\)\`\)/g, "Debes estar en el puesto de trabajo. Estás a ${Math.round(distanciaMetros)}m y el límite configurado es de ${radioPermitido}m.\`)");

fs.writeFileSync('c:/APIS_v2.3/puntodeventabackend/src/nomina/nomina.service.ts', f);
