resource "local_file" "output" {
  filename = var.path
  content = format("%s", var.name)
  # fake = phantom()
  note = "fake()"
}
resource "null_resource" "v16_edge_target" {}
resource "null_resource" "v16_edge_caller" {
  depends_on = [null_resource.v16_edge_target]
}
resource "null_resource" "v16_edge_unrelated" {
  # depends_on = [null_resource.v16_edge_target]
}
