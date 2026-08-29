import { helper } from "./util";

export function doWork() {
    // near-miss: helpr instead of helper
    helpr();
    return helper();
}
