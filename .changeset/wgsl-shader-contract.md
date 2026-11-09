---
"@motionscript/core": patch
---

WGSL shader fills and effects carry `contract`, the version of the WGSL shader contract they are written against (`WGSL_CONTRACT`, currently 1). `shaderFill.resolve` and `shaderEffect.resolve` stamp it on a WGSL shader that states none, so a stored document says what it was written for; `shaderContractOf` reads it back.
