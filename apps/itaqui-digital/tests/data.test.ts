import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePortHtml,
  parsePortDate,
  parsePortLinks,
} from "../src/lib/port-parser";
import { parseAISMessage } from "../src/lib/ais-parser";
const now = Date.parse("2026-09-05T15:00:00Z");
const html = `<div id="atracados"><table><tr><th>Berço</th></tr><tr><td>B103</td><td>1078042</td><td>SYLVANA</td><!-- <td>EXPORTAÇÃO</td> --><td>BORESTE</td><td>229</td><td>82.000</td><td>SOJA</td><td>66.000</td><td>7</td><td>FERTIMPORT</td><td>04/09/26</td></tr></table></div>`;
test("EMAP parser ignores commented cells and maps the correct fields", () => {
  const [v] = parsePortHtml(html, now);
  assert.equal(v.name, "SYLVANA");
  assert.equal(v.cargo, "SOJA");
  assert.equal(v.length, 229);
  assert.equal(v.berth, "103");
  assert.equal(v.positionSource, "berth");
  assert.equal(v.stale, false);
  assert.ok(v.coordinates);
});
test("old EMAP records cannot place a vessel on the map", () => {
  const [v] = parsePortHtml(html.replace("04/09/26", "04/09/25"), now);
  assert.equal(v.stale, true);
  assert.equal(v.coordinates, undefined);
  assert.equal(v.positionSource, "none");
});
test("unknown berth or changed source does not invent a position", () => {
  const [v] = parsePortHtml(html.replace("B103", "B999"), now);
  assert.equal(v.coordinates, undefined);
  assert.deepEqual(parsePortHtml("<html>unavailable</html>", now), []);
  assert.equal(parsePortDate("05/09/26"), "2026-09-05T00:00:00-03:00");
});
const ais = {
  MessageType: "PositionReport",
  MetaData: {
    MMSI: 123456789,
    ShipName: "EXAMPLE@",
    time_utc: "2026-09-05 15:00:00 UTC",
  },
  Message: {
    PositionReport: {
      Latitude: -2.577,
      Longitude: -44.37,
      TrueHeading: 511,
      Cog: 88,
      Sog: 8.2,
      NavigationalStatus: 0,
    },
  },
};
test("AIS normalizes position, UTC timestamp and unavailable true heading", () => {
  const v = parseAISMessage(ais, now);
  assert.ok(v);
  assert.equal(v.name, "EXAMPLE");
  assert.equal(v.heading, 88);
  assert.equal(v.speed, 8.2);
  assert.equal(v.updatedAt, "2026-09-05T15:00:00.000Z");
  assert.equal(v.positionSource, "ais");
  assert.equal(v.status, "navegando");
});
test("AIS rejects expired, invalid and out-of-area reports", () => {
  assert.equal(parseAISMessage(ais, now + 16 * 60000), null);
  assert.equal(
    parseAISMessage(
      {
        ...ais,
        Message: {
          PositionReport: { ...ais.Message.PositionReport, Latitude: 91 },
        },
      },
      now,
    ),
    null,
  );
  assert.equal(
    parseAISMessage(
      {
        ...ais,
        Message: {
          PositionReport: { ...ais.Message.PositionReport, Valid: false },
        },
      },
      now,
    ),
    null,
  );
});
test("AIS sentinel speed is treated as unavailable", () => {
  assert.equal(
    parseAISMessage(
      {
        ...ais,
        Message: {
          PositionReport: { ...ais.Message.PositionReport, Sog: 102.3 },
        },
      },
      now,
    )?.speed,
    undefined,
  );
});
test("only official HTTPS document links are exposed", () => {
  const links = parsePortLinks(
    '<section id="porto-agora"><a href="javascript:alert(1)"><img alt="bad"></a><a href="https://www.portodoitaqui.com/file.pdf"><img alt="Tábua"></a></section>',
  );
  assert.deepEqual(links, [
    { label: "Tábua", url: "https://www.portodoitaqui.com/file.pdf" },
  ]);
});
test("AIS provider microsecond timestamp with UTC offset is parsed without rejuvenating old positions", () => {
  const msg = {
    ...ais,
    MetaData: {
      ...ais.MetaData,
      time_utc: "2026-09-05 14:59:00.123456 +0000 UTC",
    },
  };
  assert.equal(
    parseAISMessage(msg, now)?.updatedAt,
    "2026-09-05T14:59:00.123Z",
  );
  assert.equal(parseAISMessage(msg, now + 16 * 60000), null);
  assert.equal(
    parseAISMessage(
      { ...ais, MetaData: { ...ais.MetaData, time_utc: "invalid date" } },
      now,
    ),
    null,
  );
});
