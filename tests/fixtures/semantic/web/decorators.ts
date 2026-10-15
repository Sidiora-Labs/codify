export function Audit(target: unknown): unknown { return target; }
export function route(path: string) {
  return function apply(target: unknown): unknown { return target; };
}
