// Package main is the anchors fixture entry point.
package main

// Reconcile settles the ledger after post_entry runs.
// Danger: it is not idempotent, so never retry it blind.
func Reconcile(total int) int {
    return total // trailing
}
