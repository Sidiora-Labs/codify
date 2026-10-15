package sample
import (
    "fmt"
    j "encoding/json"
)
type Runner interface { Run(int) int }
type Worker struct { n int }
func (w Worker) Run(value int) int { return helper(value) }
func helper(value int) int { fmt.Println(value); return value + 1 }
func invoke(cb func(int) int) int {
    selected := helper
    return cb(selected(2))
}
