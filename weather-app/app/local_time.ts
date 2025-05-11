function getLocalIsoWithOffset(date = new Date()) {
  // Add 2 hours to the current UTC time
  const shifted = new Date(date.getTime() + 2 * 60 * 60 * 1000);

  // Format to ISO and append the fixed offset +02:00
  const iso = shifted.toISOString().slice(0, -1); // remove "Z"
  return `${iso}+02:00`;
}

module.exports = { getLocalIsoWithOffset };
