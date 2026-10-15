resource "local_file" "output" {
  filename = var.path
  content = format("%s", var.name)
  # fake = phantom()
  note = "fake()"
}
