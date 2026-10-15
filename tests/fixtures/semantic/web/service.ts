export interface Result { value: string }
export function fetchItem(id: string): Promise<Result> {
  return Promise.resolve({ value: id });
}
export default class Main {}
