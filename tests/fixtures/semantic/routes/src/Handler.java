class Handler {
  @GetMapping("/spring/home")
  public String home() { return "home"; }
  @PostMapping(
    "/spring/multiline"
  )
  public String create() { return "created"; }
  /*
  @GetMapping("/spring-block-ghost")
  */
  String text = "@GetMapping(\"/spring-string-ghost\")";
}
