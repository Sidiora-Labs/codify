use axum::{routing::get, Router};
async fn lifetimeHandler() -> &'static str { "ok" }
fn router() -> Router {
  Router::new().route("/rust/lifetime", get(lifetimeHandler))
}
