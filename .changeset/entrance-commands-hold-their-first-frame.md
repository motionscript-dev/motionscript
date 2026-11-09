---
"@motionscript/core": patch
"@motionscript/charts": patch
---

A component command can be an entrance (`entrance: true`): the timeline holds its first frame from the moment its node appears, so the node no longer shows at rest, vanishes and then animates in when the command is placed after the node's start. The hold stops at the end of an earlier command writing the same props, so an exit followed by an entrance keeps the node gone in between. The registry reports it on `NodeCommandEntry.entrance` and `placedCommands()` gives each command's `holdFrom`. The line, bar and pie charts' `enter` are entrances.
