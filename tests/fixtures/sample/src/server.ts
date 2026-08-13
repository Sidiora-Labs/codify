import express from "express";
import { formatName } from "./util";

const app = express();

export function getUsers(req: any, res: any) {
  res.json([{ name: formatName("ada", "lovelace") }]);
}

export function createUser(req: any, res: any) {
  const name = formatName(req.body.first, req.body.last);
  res.status(201).json({ name });
}

export class UserService {
  find(id: string) {
    return { id, name: formatName("grace", "hopper") };
  }
}

app.get("/users", getUsers);
app.post("/users", createUser);

app.listen(3000);
