package main
func list(c *Context) { }
func register(r *Engine) { r.GET("/gin/list", list) }
func registerMore(r *Engine) {
  r.POST(
    "/gin/multiline",
    list,
  )
}
/*
r.GET("/gin-block-ghost", list)
*/
var prose = "r.GET(\"/gin-string-ghost\", list)"
