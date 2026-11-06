// Every unit conversion in the app lives here, written out, so a reviewer can
// audit each factor in one place.

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND; // 60,000
export const MS_PER_HOUR = 60 * MS_PER_MINUTE; // 3,600,000
export const MS_PER_DAY = 24 * MS_PER_HOUR; // 86,400,000

/** India Standard Time is UTC+05:30 all year; 5.5 hours = 19,800,000 ms. */
export const IST_OFFSET_MS = 5 * MS_PER_HOUR + 30 * MS_PER_MINUTE;

export const PAISE_PER_RUPEE = 100;
export const BYTES_PER_KIB = 1_024;
export const BYTES_PER_MIB = 1_024 * BYTES_PER_KIB; // 1,048,576

/** Bytes to mebibytes: divide by 1,048,576. */
export const bytesToMib = (bytes) => bytes / BYTES_PER_MIB;

/** Show a byte count in the largest unit that keeps the number readable. */
export function formatBytes(bytes) {
  if (bytes < BYTES_PER_KIB) return `${bytes} B`;
  if (bytes < BYTES_PER_MIB) return `${(bytes / BYTES_PER_KIB).toFixed(1)} KB`;
  return `${bytesToMib(bytes).toFixed(1)} MB`;
}
