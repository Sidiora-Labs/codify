package main

import "fmt"

func handleReq(name string) string {
	return fmt.Sprintf("hello %s", name)
}

func main() {
	fmt.Println(handleReq("world"))
}
