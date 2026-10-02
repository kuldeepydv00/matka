// Universal Market Cycle Date Calculation for all Matka games in IST timezone

function getISTDateStr(d) {
  if (!d) d = new Date();
  const dateObj = (typeof d === "string" || typeof d === "number") ? new Date(d) : d;
  const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(validDate);
}

function getISTDate(d) {
  if (!d) d = new Date();
  let dateObj = (typeof d === "string" || typeof d === "number") ? new Date(d) : d;
  if (isNaN(dateObj.getTime())) dateObj = new Date();
  const utcMs = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
  return new Date(utcMs + (5.5 * 60 * 60 * 1000));
}

function parseMins(timeStr) {
  if (!timeStr) return 0;
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(timeStr);
  if (!match) return 0;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

function getISTHoursAndMins(d) {
  if (!d) d = new Date();
  const dateObj = (typeof d === "string" || typeof d === "number") ? new Date(d) : d;
  const validDate = isNaN(dateObj.getTime()) ? new Date() : dateObj;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  });
  const parts = formatter.formatToParts(validDate);
  let hour = parseInt(parts.find(p => p.type === 'hour').value);
  if (hour === 24) hour = 0;
  const minute = parseInt(parts.find(p => p.type === 'minute').value);
  return { hour, minute, curMins: hour * 60 + minute, validDate };
}

function getMarketCycleDate(gameName, sched, d) {
  if (!d) d = new Date();
  const { curMins, validDate } = getISTHoursAndMins(d);
  const istDateStr = getISTDateStr(validDate);

  if (!sched) {
    try {
      const { gameSchedulesStore } = require("../store");
      sched = gameSchedulesStore[gameName] || 
        (gameName === "Desawar" ? gameSchedulesStore["Disawer"] : 
        (gameName === "Disawer" ? gameSchedulesStore["Desawar"] : 
        (gameName === "Shree Ganesh" ? gameSchedulesStore["Shri Ganesh"] : 
        (gameName === "Shri Ganesh" ? gameSchedulesStore["Shree Ganesh"] : null))));
    } catch (e) {}
  }

  if (!sched || !sched.open || !sched.close) {
    return istDateStr;
  }

  const openMins = parseMins(sched.open);
  const closeMins = parseMins(sched.close);

  // Midnight-crossing window (e.g. Desawar: Open 12:00 PM, Close 04:00 AM)
  if (closeMins < openMins || gameName === "Desawar" || gameName === "Disawer") {
    // If hour >= 5 AM (300m), bets placed belong to next day morning cycle (Day + 1)
    if (curMins >= 300) {
      const nextDay = new Date(validDate.getTime() + (24 * 60 * 60 * 1000));
      return getISTDateStr(nextDay);
    } else {
      // Early morning before 05:00 AM belongs to today morning cycle
      return istDateStr;
    }
  }

  // Same-day window (e.g. Delhi Bazar, Faridabad, Ghaziabad, Gali)
  const resultMins = sched.result ? parseMins(sched.result) : closeMins;
  const effectiveCutoff = Math.max(closeMins, resultMins);

  if (curMins >= effectiveCutoff) {
    const nextDay = new Date(validDate.getTime() + (24 * 60 * 60 * 1000));
    return getISTDateStr(nextDay);
  }

  return istDateStr;
}

function isGameInOpenWindow(gameName, sched, d) {
  if (!d) d = new Date();
  const { curMins: curM } = getISTHoursAndMins(d);

  if (!sched) {
    try {
      const { gameSchedulesStore } = require('../store');
      sched = gameSchedulesStore[gameName] || 
        (gameName === 'Desawar' ? gameSchedulesStore['Disawer'] : 
        (gameName === 'Disawer' ? gameSchedulesStore['Desawar'] : 
        (gameName === 'Shree Ganesh' ? gameSchedulesStore['Shri Ganesh'] : 
        (gameName === 'Shri Ganesh' ? gameSchedulesStore['Shree Ganesh'] : null))));
    } catch (e) {}
  }

  if (!sched || !sched.open || !sched.close) return false;
  if (sched.enabled === false) return false;

  const openM = parseMins(sched.open);
  const closeM = parseMins(sched.close);

  if (closeM < openM || gameName === 'Desawar' || gameName === 'Disawer') {
    return curM >= openM || curM < closeM;
  }
  return curM >= openM && curM < closeM;
}

module.exports = {
  getISTDate,
  getISTDateStr,
  getISTHoursAndMins,
  parseMins,
  getMarketCycleDate,
  isGameInOpenWindow
};
