const path = require('path');
const fs = require('fs');

// Date-indexed historical chart results store (Scraped from Sattakingdmatka.com)
const chartRecords = {};

// Helper to format Date object to YYYY-MM-DD
function formatDateKey(dateObj) {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Load official 1-year historical chart records from Sattakingdmatka.com data
(function loadSattakingdmatkaData() {
  try {
    const jsonPath = path.join(__dirname, 'sattakingdmatka_chart.json');
    if (fs.existsSync(jsonPath)) {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      Object.assign(chartRecords, data);
      console.log(`[Chart Store] Successfully loaded ${Object.keys(data).length} historical chart dates from Sattakingdmatka.com!`);
    }
  } catch (e) {
    console.error('[Chart Store Error]', e.message);
  }

  // Ensure default structure for today
  const today = new Date();
  const todayKey = formatDateKey(today);
  const istNow = new Date(today.getTime() + (5.5 * 60 * 60 * 1000));
  const istKey = formatDateKey(istNow);

  [todayKey, istKey].forEach(k => {
    if (!chartRecords[k]) {
      chartRecords[k] = {
        "Desawar": "--",
        "Disawer": "--",
        "Shiv Parwati": "--",
        "Delhi Bazar": "--",
        "Dubai Market": "--",
        "Shree Ganesh": "--",
        "Shri Ganesh": "--",
        "Faridabad": "--",
        "Ghaziabad": "--",
        "Gali": "--"
      };
    }
  });
})();

module.exports = {
  chartRecords,
  formatDateKey
};
