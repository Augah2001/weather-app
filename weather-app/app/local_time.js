function getLocalIsoWithOffset(date = new Date()) {
  // 1) Get the UTC ISO string, e.g. "2025-05-11T17:18:26.258Z"
  const utcIso = date.toISOString();

  // 2) Compute the local offset in minutes (+120 for Harare)
  const tzMin = -date.getTimezoneOffset();  
  const sign = tzMin >= 0 ? '+' : '-';
  const absMin = Math.abs(tzMin);
  const hrs = String(Math.floor(absMin / 60)).padStart(2, '0');
  const mins = String(absMin % 60).padStart(2, '0');

  // 3) Chop off the "Z" and append "+HH:MM"
  return utcIso.replace('Z', `${sign}${hrs}:${mins}`);
}

module.exports = { getLocalIsoWithOffset };
