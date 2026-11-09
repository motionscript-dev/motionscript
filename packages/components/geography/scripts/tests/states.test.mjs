import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, mock, test } from "node:test"

import { buildStates } from "../lib/states.mjs"

const square = (west, south, size = 1) => ({
  type: "Polygon",
  coordinates: [
    [
      [west, south],
      [west, south + size],
      [west + size, south + size],
      [west + size, south],
      [west, south],
    ],
  ],
})
const unit = (properties, geometry = square(0, 0)) => ({ type: "Feature", properties, geometry })
const collection = (...features) => ({ type: "FeatureCollection", features })
const summary = ({ code, parent, first, listed, units, name }) => ({ code, parent, first, listed, units, name })
const byCode = (features, code) => features.find((feature) => feature.code === code)

describe("buildStates", () => {
  beforeEach(() => {
    mock.method(console, "warn", () => undefined)
  })

  afterEach(() => {
    mock.restoreAll()
  })

  test("makes a first-level state of each ISO 3166-2 code, filed under its country by the code's prefix", () => {
    const { units, features } = buildStates(
      collection(
        unit({ iso_3166_2: "US-CA", name: "California", name_nl: "Californië", adm0_a3: "USA" }, square(0, 0)),
        // Puerto Rico is filed under the US by `adm0_a3`, and under its own code by the prefix.
        unit({ iso_3166_2: "PR-00", name: "Puerto Rico", adm0_a3: "USA" }, square(10, 0))
      )
    )
    assert.deepEqual(features.map(summary), [
      { code: "US-CA", parent: "US", first: true, listed: true, units: ["a1:0"], name: "California" },
      { code: "PR-00", parent: "PR", first: true, listed: true, units: ["a1:1"], name: "Puerto Rico" },
    ])
    assert.equal(features[0].nameNl, "Californië")
    assert.equal(features[1].nameNl, "Puerto Rico")
    assert.deepEqual(units.map(({ id }) => id), ["a1:0", "a1:1"])
    assert.equal("primary" in features[0], false)
  })

  test("trims whitespace around a code, and falls back to the code for a name", () => {
    const { features } = buildStates(collection(unit({ iso_3166_2: "  US-TX  " })))
    assert.equal(features[0].code, "US-TX")
    assert.equal(features[0].name, "US-TX")
  })

  test("merges the units of one code into one state, named after the largest", () => {
    const { features } = buildStates(
      collection(
        unit({ iso_3166_2: "US-HI", name: "Small island" }, square(0, 0, 1)),
        unit({ iso_3166_2: "US-HI", name: "Big island" }, square(10, 0, 3))
      )
    )
    assert.equal(features.length, 1)
    assert.deepEqual(features[0].units, ["a1:0", "a1:1"])
    assert.equal(features[0].name, "Big island")
  })

  test("keeps a placeholder code as an unlisted unit under the code without its tilde", () => {
    const { features } = buildStates(collection(unit({ iso_3166_2: "XK-X02~", name: "Gjilan" })))
    assert.deepEqual(features.map(summary), [
      { code: "XK-X02", parent: "XK", first: true, listed: false, units: ["a1:0"], name: "Gjilan" },
    ])
  })

  test("gives a codeless unit the code of the country it is assigned to, so a map has no hole", () => {
    const { features } = buildStates(collection(unit({ iso_3166_2: "-99-X01", adm0_a3: "ESB", name: "Dhekelia" })))
    assert.deepEqual(features.map(({ code, parent }) => [code, parent]), [["CY-X01", "CY"]])
  })

  test("keeps a codeless unit that carries the placeholder tilde as unlisted", () => {
    const { features } = buildStates(collection(unit({ iso_3166_2: "-99-X02~", adm0_a3: "KAS", name: "Siachen" })))
    assert.deepEqual(features.map(({ code, parent, listed }) => [code, parent, listed]), [["IN-X02", "IN", false]])
  })

  test("skips a codeless unit with no owner in the table, a unit with no geometry, and an unusable code, warning about the last", () => {
    const warn = mock.method(console, "warn", () => undefined)
    const { features } = buildStates(
      collection(
        unit({ iso_3166_2: "-99-X01", adm0_a3: "NOP", name: "Orphan" }),
        unit({ iso_3166_2: "US-NY", name: "No outline" }, null),
        unit({ iso_3166_2: "not a code", name: "Garbage" }),
        unit({ iso_3166_2: "US-OR", name: "Oregon" })
      )
    )
    assert.deepEqual(features.map(({ code }) => code), ["US-OR"])
    assert.equal(warn.mock.callCount(), 1)
    assert.match(String(warn.mock.calls[0].arguments[0]), /unusable code "not a code" \(Garbage\); dropped/)
  })

  describe("where the source's units are second level", () => {
    test("makes the ISO region a state of its own, over the units, and puts each unit under it", () => {
      const { features } = buildStates(
        collection(
          unit({ iso_3166_2: "ES-M", region_cod: "ES.MD", region: "Comunidad de Madrid", name: "Madrid" }, square(0, 0)),
          unit({ iso_3166_2: "ES-TO", region_cod: "ES.CM", region: "Castilla-La Mancha", name: "Toledo" }, square(10, 0)),
          unit({ iso_3166_2: "ES-CU", region_cod: "ES.CM", region: "Castilla-La Mancha", name: "Cuenca" }, square(20, 0))
        )
      )
      assert.deepEqual(summary(byCode(features, "ES-M")), {
        code: "ES-M",
        parent: "ES-MD",
        first: false,
        listed: true,
        units: ["a1:0"],
        name: "Madrid",
      })
      assert.deepEqual(summary(byCode(features, "ES-CM")), {
        code: "ES-CM",
        parent: "ES",
        first: true,
        listed: true,
        units: ["a1:1", "a1:2"],
        name: "Castilla-La Mancha",
      })
      assert.deepEqual(summary(byCode(features, "ES-MD")), {
        code: "ES-MD",
        parent: "ES",
        first: true,
        listed: true,
        units: ["a1:0"],
        name: "Comunidad de Madrid",
      })
    })

    test("renames the Spanish communities whose HASC differs from their ISO code", () => {
      const { features } = buildStates(
        collection(
          unit({ iso_3166_2: "ES-PM", region_cod: "ES.PM", region: "Illes Balears", name: "Balears" }),
          unit({ iso_3166_2: "ES-LO", region_cod: "ES.LO", region: "La Rioja", name: "Rioja" })
        )
      )
      assert.deepEqual(features.filter(({ first }) => first).map(({ code }) => code).sort(), ["ES-IB", "ES-RI"])
    })

    test("takes the British nation from geonunit", () => {
      const { features } = buildStates(collection(unit({ iso_3166_2: "GB-KEN", geonunit: "England", name: "Kent" })))
      assert.deepEqual(summary(byCode(features, "GB-KEN")), {
        code: "GB-KEN",
        parent: "GB-ENG",
        first: false,
        listed: true,
        units: ["a1:0"],
        name: "Kent",
      })
      const nation = byCode(features, "GB-ENG")
      assert.equal(nation.parent, "GB")
      assert.equal(nation.nameNl, "Engeland")
    })

    test("leaves a British unit that belongs to no nation as a first-level state", () => {
      const { features } = buildStates(collection(unit({ iso_3166_2: "GB-ZZZ", geonunit: "Gibraltar", name: "Elsewhere" })))
      assert.deepEqual(features.map(({ code, parent, first }) => [code, parent, first]), [["GB-ZZZ", "GB", true]])
    })

    test("files Corsica under the code ISO gives it, and the overseas departements as first-level themselves", () => {
      const { features } = buildStates(
        collection(
          unit({ iso_3166_2: "FR-2A", region_cod: "FR-COR", region: "Corse", name: "Corse-du-Sud" }, square(0, 0)),
          unit({ iso_3166_2: "FR-GF", region_cod: "FR-GUF", region: "Guyane", name: "Guyane" }, square(10, 0)),
          unit({ iso_3166_2: "FR-75", region_cod: "FR-IDF", region: "Île-de-France", name: "Paris" }, square(20, 0))
        )
      )
      assert.equal(byCode(features, "FR-20R").parent, "FR")
      assert.equal(byCode(features, "FR-2A").parent, "FR-20R")
      assert.deepEqual(summary(byCode(features, "FR-GF")), {
        code: "FR-GF",
        parent: "FR",
        first: true,
        listed: true,
        units: ["a1:1"],
        name: "Guyane",
      })
      assert.equal(byCode(features, "FR-75").parent, "FR-IDF")
    })

    test("fails when a region's code is also a unit's code", () => {
      assert.throws(
        () =>
          buildStates(
            collection(
              unit({ iso_3166_2: "IT-62", region_cod: "IT-62", region: "Lazio", name: "Lazio" }, square(0, 0))
            )
          ),
        /admin-1: region IT-62 collides with a unit code/
      )
    })
  })
})
