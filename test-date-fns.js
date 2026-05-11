const { format } = require('date-fns');
const { es } = require('date-fns/locale');

const dates = ['2025-12-03', '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31'];

dates.forEach(d => {
  const parsed1 = new Date(d);
  // Simulating UTC-5
  const localStr1 = format(parsed1, 'd MMM', { locale: es });
  
  const parsed2 = new Date(d + 'T12:00:00');
  const localStr2 = format(parsed2, 'd MMM', { locale: es });
  
  console.log(`Original: ${d} | new Date(d) -> ${localStr1} | new Date(d+'T12...') -> ${localStr2}`);
});
