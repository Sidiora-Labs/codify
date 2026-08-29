import { Router } from "express";
import { helper } from "./util";
import { missing } from "nonexistent-package";

export function startApp() {
    const router = Router();
    helper();
    missing();
    return router;
}
