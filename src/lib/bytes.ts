// A byte count as people read it: "12.4 MB", "1.2 GB". One decimal from MB
// up, none below; 1024-based, as the caps in the app are (lib/images.ts,
// lib/video/types.ts). No server imports: the settings bar reads it too.

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit >= 2 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value).toString();
  return `${text} ${UNITS[unit]}`;
}
