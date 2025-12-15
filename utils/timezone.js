export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Manila";

export function getTZParts(date = new Date(), timeZone = APP_TIMEZONE) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const m = (map.timeZoneName || "").match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  const offsetHours = m ? parseInt(m[1], 10) : 0;
  const offsetMinutes = m && m[2] ? parseInt(m[2], 10) : 0;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    offsetHours,
    offsetMinutes,
  };
}

export function getTZDateString(date = new Date(), timeZone = APP_TIMEZONE) {
  const { year, month, day } = getTZParts(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getTZCurrentTimeString(date = new Date(), timeZone = APP_TIMEZONE) {
  const { hour, minute } = getTZParts(date, timeZone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function getStartEndOfDay(dateInput, timeZone = APP_TIMEZONE) {
  let refDate;
  if (dateInput && typeof dateInput === "string") {
    const [y, m, d] = dateInput.split("-").map(Number);
    refDate = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12, 0, 0, 0));
  } else if (dateInput instanceof Date) {
    refDate = dateInput;
  } else {
    refDate = new Date();
  }
  const { year, month, day, offsetHours, offsetMinutes } = getTZParts(refDate, timeZone);
  const start = new Date(Date.UTC(year, month - 1, day, 0 - offsetHours, 0 - offsetMinutes, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day, 23 - offsetHours, 59 - offsetMinutes, 59, 999));
  const tzDateString = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const targetDate = start;
  return { startOfDay: start, endOfDay: end, targetDate, tzDateString };
}

export function isSameTZDay(dateA, dateB, timeZone = APP_TIMEZONE) {
  return getTZDateString(dateA, timeZone) === getTZDateString(dateB, timeZone);
}

export function getTZMinutesSinceMidnight(date = new Date(), timeZone = APP_TIMEZONE) {
  const { hour, minute } = getTZParts(date, timeZone);
  return hour * 60 + minute;
}
