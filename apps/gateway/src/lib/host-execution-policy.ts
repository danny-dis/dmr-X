export function canRunHostProcess(localMode: boolean, production: boolean): boolean {
  return localMode && !production;
}
