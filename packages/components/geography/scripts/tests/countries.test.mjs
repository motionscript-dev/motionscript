import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, mock, test } from "node:test"

import { geoArea } from "d3-geo"

import { buildCountries } from "../lib/countries.mjs"

// Clockwise, which is the winding d3 reads as the inside of a small polygon.
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
const feature = (properties, geometry) => ({ type: "Feature", properties, geometry })
const collection = (...features) => ({ type: "FeatureCollection", features })

describe("buildCountries", () => {
  beforeEach(() => {
    mock.method(console, "log", () => undefined)
    mock.method(console, "warn", () => undefined)
  })

  afterEach(() => {
    mock.restoreAll()
  })

  test("the squares these tests use are small polygons, not their complements", () => {
    assert.ok(geoArea(square(0, 0)) < 0.001)
  })

  test("makes one listed country of each ISO code, with a unit of its outline and its English and Dutch names", () => {
    const { units, features } = buildCountries(
      collection(
        feature({ ADM0_A3: "AAA", ISO_A2_EH: "AA", NAME: "Aland", NAME_NL: "Aaland" }, square(0, 0)),
        feature({ ADM0_A3: "BBB", ISO_A2_EH: "BB", NAME: "Bland" }, square(10, 0))
      ),
      collection()
    )

    assert.deepEqual(
      features.map(({ code, name, nameNl, level, parent, first, listed, units: ids }) => ({ code, name, nameNl, level, parent, first, listed, ids })),
      [
        { code: "AA", name: "Aland", nameNl: "Aaland", level: "country", parent: null, first: true, listed: true, ids: ["a0:0"] },
        { code: "BB", name: "Bland", nameNl: "Bland", level: "country", parent: null, first: true, listed: true, ids: ["a0:1"] },
      ]
    )
    assert.deepEqual(units.map(({ id, type }) => [id, type]), [["a0:0", "Feature"], ["a0:1", "Feature"]])
    assert.deepEqual(units[0].geometry, square(0, 0))
    assert.equal("primary" in features[0], false)
  })

  test("gathers every feature of one code into one country, and names it after the largest", () => {
    const { features, units } = buildCountries(
      collection(
        feature({ ADM0_A3: "AAA", ISO_A2_EH: "AA", NAME: "Small part" }, square(0, 0, 1)),
        feature({ ADM0_A3: "AAB", ISO_A2_EH: "AA", NAME: "Large part" }, square(10, 0, 3)),
        feature({ ADM0_A3: "AAC", ISO_A2_EH: "AA", NAME: "Middle part" }, square(20, 0, 2))
      ),
      collection()
    )
    assert.equal(features.length, 1)
    assert.deepEqual(features[0].units, ["a0:0", "a0:1", "a0:2"])
    assert.equal(features[0].name, "Large part")
    assert.equal(units.length, 3)
  })

  test("skips a feature with no geometry, and the ones that are nobody's", () => {
    const { features } = buildCountries(
      collection(
        feature({ ADM0_A3: "AAA", ISO_A2_EH: "AA", NAME: "Aland" }, null),
        ...["BRT", "PGA", "BJN", "SER", "SCR"].map((code) => feature({ ADM0_A3: code, ISO_A2_EH: "ZZ", NAME: code }, square(40, 0))),
        feature({ ADM0_A3: "BBB", ISO_A2_EH: "BB", NAME: "Bland" }, square(10, 0))
      ),
      collection()
    )
    assert.deepEqual(features.map(({ code }) => code), ["BB"])
  })

  test("gives the two own-coded features a user-assigned code and a name of their own, whatever else they carry", () => {
    const { features } = buildCountries(
      collection(
        feature({ ADM0_A3: "SOL", ISO_A2_EH: "-99", NAME: "Somalia part" }, square(0, 0, 3)),
        feature({ ADM0_A3: "CYN", ISO_A2_EH: "-99", NAME: "Cyprus part" }, square(10, 0))
      ),
      collection()
    )
    assert.deepEqual(
      features.map(({ code, name, nameNl }) => [code, name, nameNl]),
      [
        ["XS", "Somaliland", "Somaliland"],
        ["XN", "Northern Cyprus", "Noord-Cyprus"],
      ]
    )
  })

  test("joins a listed codeless fragment to the country the table names", () => {
    const { features } = buildCountries(
      collection(
        feature({ ADM0_A3: "CYP", ISO_A2_EH: "CY", NAME: "Cyprus" }, square(0, 0, 3)),
        feature({ ADM0_A3: "ESB", ISO_A2_EH: "-99", NAME: "Sovereign base" }, square(10, 0))
      ),
      collection()
    )
    assert.equal(features.length, 1)
    assert.equal(features[0].code, "CY")
    assert.deepEqual(features[0].units, ["a0:0", "a0:1"])
  })

  for (const [fragment, code] of [["ESB", "CY"], ["WSB", "CY"], ["USG", "CU"], ["KAS", "IN"], ["SPI", "CL"]]) {
    test(`joins the codeless ${fragment} to ${code}`, () => {
      const { features } = buildCountries(
        collection(feature({ ADM0_A3: fragment, ISO_A2_EH: "-99", NAME: fragment }, square(0, 0))),
        collection()
      )
      assert.deepEqual(features.map(({ code: own, units }) => [own, units]), [[code, ["a0:0"]]])
    })
  }

  test("joins any other codeless feature to the strict-ISO country that contains it", () => {
    const { features } = buildCountries(
      collection(
        feature({ ADM0_A3: "AAA", ISO_A2_EH: "AA", NAME: "Aland" }, square(0, 0, 10)),
        feature({ ADM0_A3: "ZZZ", ISO_A2_EH: "-99", NAME: "Sliver" }, square(4, 4, 1))
      ),
      collection(feature({ ISO_A2_EH: "AA", NAME: "Aland" }, square(0, 0, 10)))
    )
    assert.deepEqual(features.map(({ code, units }) => [code, units]), [["AA", ["a0:0", "a0:1"]]])
  })

  test("drops a codeless feature that no ISO country contains, with a warning", () => {
    const warn = mock.method(console, "warn", () => undefined)
    const { features } = buildCountries(
      collection(
        feature({ ADM0_A3: "AAA", ISO_A2_EH: "AA", NAME: "Aland" }, square(0, 0, 3)),
        feature({ ADM0_A3: "ZZZ", ISO_A2_EH: "-99", NAME: "Nowhere" }, square(50, 50))
      ),
      collection(feature({ ISO_A2_EH: "AA", NAME: "Aland" }, square(0, 0, 3)))
    )
    assert.deepEqual(features.map(({ code }) => code), ["AA"])
    assert.equal(warn.mock.callCount(), 1)
    assert.match(String(warn.mock.calls[0].arguments[0]), /Nowhere \(ZZZ\) has no code and no ISO owner; dropped/)
  })

  test("adds a country the default file folds into a parent from the strict ISO file, as its own", () => {
    const { features, units } = buildCountries(
      collection(feature({ ADM0_A3: "FRA", ISO_A2_EH: "FR", NAME: "France" }, square(0, 0, 5))),
      collection(
        feature({ ISO_A2_EH: "FR", NAME: "France" }, square(0, 0, 5)),
        feature({ ISO_A2_EH: "GF", NAME: "French Guiana" }, square(20, 0, 2)),
        feature({ ISO_A2_EH: "-99", NAME: "Unassigned" }, square(30, 0))
      )
    )
    assert.deepEqual(features.map(({ code }) => code), ["FR", "GF"])
    assert.deepEqual(features[1].units, ["iso:1"])
    assert.equal(features[1].name, "French Guiana")
    assert.equal(units.length, 2)
  })

  test("takes only a two-capital-letter code to be a code", () => {
    const { features } = buildCountries(
      collection(
        feature({ ADM0_A3: "AAA", ISO_A2_EH: "aa", NAME: "Lowercase" }, square(0, 0)),
        feature({ ADM0_A3: "BBB", ISO_A2_EH: "BBB", NAME: "Three letters" }, square(10, 0)),
        feature({ ADM0_A3: "CCC", ISO_A2_EH: "CC", NAME: "Fine" }, square(20, 0))
      ),
      collection()
    )
    assert.deepEqual(features.map(({ code }) => code), ["CC"])
  })
})
