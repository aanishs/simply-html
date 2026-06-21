// Result lines go to stdout (the skill reads these); progress goes to stderr so `--json`
// stdout stays pure machine-readable data.
export function line(label: string, value: string): void {
  process.stdout.write(`${label}: ${value}\n`);
}
export function note(msg: string): void {
  process.stderr.write(`${msg}\n`);
}
export function fail(msg: string): never {
  process.stderr.write(`simply-html: ${msg}\n`);
  process.exit(1);
}
