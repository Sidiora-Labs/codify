func show(req: Request) -> String { return "ok" }
app.get("/vapor/show", use: show)
