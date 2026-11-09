---
"@motionscript/core": patch
"@motionscript/sdk": patch
---

A command published under a key of its own, `@command({ key: "press" }) pulse()`, runs the method it decorates. The registry recorded the key as the method to call, so dispatching it from a document called whatever the class had under that name: a prop (`Command "press" needs a "press" method`), an inherited method, or nothing. `CommandMeta` now carries `method` beside `key`, and `Registry.addNode` stores it as `NodeCommandEntry.method`. A command whose key is a core command's but whose method is not is no longer taken for the core command when compile decides whether it reads or writes layout. A command declared without a `key` is unchanged.
