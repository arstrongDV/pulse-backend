export function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export function trimAndLowercase(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export function trimAndUppercase(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}
