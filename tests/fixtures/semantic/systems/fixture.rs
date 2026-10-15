use std::fmt;
trait Runner { fn run(&self, value: i32) -> i32; }
struct Worker { n: i32 }
impl Runner for Worker {
    fn run(&self, value: i32) -> i32 { helper(value) }
}
fn helper(value: i32) -> i32 { value + 1 }
fn invoke() -> i32 {
    let selected = helper;
    selected(2)
}
macro_rules! passthrough { ($x:expr) => { $x }; }
