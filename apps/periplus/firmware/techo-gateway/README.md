# T-Echo USB serial gateway firmware

Receives raw LoRa P2P packets and prints **one JSON line per packet** over USB
serial for the bridge to consume.

> ⚠️ **Ensure the LoRa antenna is connected before powering on.**

## Board

```
LILYGO T-Echo SX1262
```

Verify before flashing:

* T-Echo vs T-Echo Plus
* SX1262 frequency variant (must match the tag: 868 vs 915)
* Arduino target used
* Upload mode (DFU)

Reference: https://github.com/Xinyuan-LilyGO/T-Echo
Pin table: `../../docs/pinout.md`.

## Toolchain

1. Arduino IDE.
2. Install **Adafruit nRF52** board support (add the Adafruit board manager URL,
   then Boards Manager → "Adafruit nRF52").
3. Install **RadioLib** (Jan Gromes) from Library Manager.
4. Board: **LilyGo T-Echo** (or the matching nRF52840 target).

## Upload (DFU mode)

T-Echo upload normally requires DFU mode:

1. **Double-click** the top-left / reset button to enter the bootloader.
2. The board mounts as a USB drive / serial bootloader.
3. Click Upload in the Arduino IDE.

If upload fails, double-click reset again and retry immediately.

## Configure

```bash
cp config.example.h config.h
```

Set `LORA_FREQUENCY` and the radio params to **exactly match** the T-Beam tag.
`config.h` is gitignored.

## Expected serial output (115200 baud)

```
[BOOT] T-Echo gateway starting
[LORA] init SX1262 ... ok
[LORA] listening...
[LORA] rx len=118 rssi=-82.0 snr=7.5
{"device_id":"GW001","fw":"mvp-0.1.0","received_at_ms":123456,"rssi":-82,"snr":7.5,"payload":{"device_id":"A4CF12345678","seq":1,"status":"fix","lat":38.7223,"lng":-9.1393,"battery_mv":4100,"sats":7,"hdop":1.2,"fw":"mvp-0.1.0"},"raw_payload":"{\"device_id\":\"A4CF12345678\",...}"}
```

Debug lines start with `[...]`; only lines starting with `{` are machine-readable.
The bridge ignores everything that is not a JSON object.

## E-paper status screen

The built-in 1.54" panel shows a live summary, so the gateway can be checked
without a serial console:

```
GW001                 412s
--------------------------
GPS acquiring  sat 00
 --.------
 --.------
--------------------------
RX 128   CRC 0   ERR 0
--------------------------
TAGS
D447A9BBBC2C
  -33dBm 11dB 2s x64
DC43A9BBBC2C
  -86dBm 10dB 5s x63
```

Gateway position, link counters, and the most recent tags with their signal
strength, age and packet count.

### Refresh cost

E-paper updates block the receive loop — the radio hears nothing while the panel
is being written. Measured on this hardware:

| Refresh | Duration |
| --- | --- |
| Partial | 433 ms |
| Full | 4388 ms |

So the screen is redrawn on a timer (`DISPLAY_REFRESH_MS`, default 20 s) rather
than per packet, using partial refreshes. Full refreshes clear the ghosting that
partial updates accumulate, but at 4.4 s of deafness they are kept rare
(`DISPLAY_FULL_EVERY`), and the first one runs during setup **before** the radio
starts listening, where it costs nothing.

Raising the refresh rate trades packet loss for freshness — at 20 s the radio is
deaf about 2% of the time.

## Output format

See `../../docs/packet-format.md` for the full gateway JSON schema.
