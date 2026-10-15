fn list() {}
fn router(app: Router) { app.route("/axum/list", get(list)); }
