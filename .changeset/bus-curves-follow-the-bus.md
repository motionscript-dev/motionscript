---
"@motionscript/browser": patch
"@motionscript/core": patch
---

A curve on an `AudioBus` animates, over the bus's own span.

- A curve in a bus's `filters` was resolved against a length of 0, so it held its first value: `AudioFilters.gain(fadeOut(1))` never faded, and a fade or `ramp` up from 0 silenced everything on the bus. It now runs over the bus's presence span, from its row's `startAt` to its `endAt`, or to its clip's end when nothing removes it, the way a sound's curve runs over the sound's. Every clip on the bus hears the same fade, wherever its own span falls.
- A curve-valued bus `volume` was read as 1. It is now scheduled like a curve in `filters`.
- A bus chain was built once per bus id and kept, so a later change to the bus's level, mute or filters was not heard for the life of the device, and the offline mix played every clip through whichever version of a bus it met first. A chain is now reused only for a bus that sounds the same, and the live device builds its bus chains again after each pause, so a curve lines up with wherever playback resumes.
- The live device restarted a curve segment from its first value when it began playing partway through that segment. It now picks the segment up where it has got to, as the offline mix does.
- `AudioBusStop` carries the bus's span as `startAt` and `endAt`, in the same seconds as the request that carries it, and `busStopKey` keys a stop by everything that changes its sound. `busPathOf` and `busPathTo` take the declaring `AudioScope` as a second argument, and `AudioBusGraph.inputFor` takes the time its start time falls at, in the stops' seconds, as a third.
