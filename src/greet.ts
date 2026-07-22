/**
 * Build a friendly greeting for the given name.
 */
export function greet(name: string): string {
  const trimmed = name.trim();
  return `Hello, ${trimmed.length > 0 ? trimmed : "world"}!`;
}
