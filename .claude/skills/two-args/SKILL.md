---
name: two-args
description: Dummy skill for testing. Checks that exactly two arguments were passed. Use when the user runs "/two-args".
argument-hint: <first> <second>
---

# Two Args

This is a dummy skill.

- All arguments: "$ARGUMENTS"
- First argument: "$0"
- Second argument: "$1"

Count the words in the all-arguments line above:

- If there are exactly 2, reply: "✅ Got 2 arguments: $0 and $1"
- Otherwise, reply: "❌ Expected 2 arguments but got <count>"

If the all-arguments line is empty, the count is 0.
