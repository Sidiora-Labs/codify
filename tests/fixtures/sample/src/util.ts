export function formatName(first: string, last: string): string {
  return capitalize(first) + " " + capitalize(last);
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
