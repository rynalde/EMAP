# XIAO nRF54L15 Channel Sounding tag firmware

A tag that **never knows where it is**. It has no GPS and computes nothing — it
acts as a Bluetooth Channel Sounding *Reflector* and RAS server, and only ever
gets ranged by a gateway.

Based on the nRF Connect SDK sample
`nrf/samples/bluetooth/channel_sounding/ras_reflector`.

## Board

```
Seeed Studio XIAO nRF54L15
Zephyr board target: xiao_nrf54l15/nrf54l15/cpuapp
```

Channel Sounding needs a qualified host + controller, which means **nRF Connect
SDK v3.0.1 or newer**. This was built and verified against **v3.4.0**.

## The fixed UID

The tag's identity is the 64-bit `FICR.DEVICEID`, read via Zephyr's `hwinfo`
driver and rendered as **16 lowercase hex characters** (e.g. `a1b2c3d4e5f60718`).

It is programmed at the factory, so it survives a reflash, a full erase and BLE
address randomisation. It is deliberately **not** the BLE MAC — that randomises,
so using it as an identity would make one tag look like an endless stream of new
ones — and it is **not** generated at boot, so it does not change.

It is advertised in manufacturer-specific data so a gateway can tell tags apart
*before* connecting:

```
FF FF FF 01 A1 B2 C3 D4 E5 F6 07 18
|  |___|  |  |_________________|
|   CID  ver     8-byte UID
0xFF = manufacturer-specific AD type
```

`CID` is `0xFFFF`, the Bluetooth SIG identifier reserved for testing — this
project has no assigned company ID. Swap it before any production use and bump
`TAG_ADV_PROTO_VER`.

### Provisioning a new tag

There is nothing to provision. Every tag runs a byte-identical image and derives
its own UID:

1. Flash the image (below).
2. Open the serial console and read the line it prints at boot:
   ```
   TAG UID: a1b2c3d4e5f60718
   ```
3. Record that UID against the physical device.

The tag appears in `public.devices` automatically the first time a gateway
ranges it. To give it a human-readable name:

```sql
update public.devices set label = 'toolbox' where device_id = 'a1b2c3d4e5f60718';
```

If the UID cannot be read, the tag **refuses to advertise** rather than coming up
without an identity — anonymous observations in the database would be worse than
a tag that is visibly dead.

## Build

```bash
export PATH="$HOME/.venv/ncs/bin:$HOME/.local/bin:$PATH"
export ZEPHYR_BASE=~/ncs/zephyr
cd ~/ncs
west build -p always -b xiao_nrf54l15/nrf54l15/cpuapp \
  -d /tmp/cs-tag-build /path/to/firmware/xiao-cs-tag
```

Output: `/tmp/cs-tag-build/xiao-cs-tag/zephyr/zephyr.hex`.

## Flash

The XIAO nRF54L15 has **no UF2 bootloader** — it exposes an onboard **CMSIS-DAP
v2** debug probe instead, so there is no drag-and-drop drive. See
`../../docs/setup-cs-firmware.md` for the exact procedure.

## Configuration

`Kconfig` exposes `CS_TAG_FW_VERSION`. Radio and CS parameters are in
`prj.conf` and `src/main.c`.

The main power knob is the advertising interval
(`TAG_ADV_INTERVAL_MIN`/`MAX` in `src/main.c`, currently 250–350 ms), since
advertising is the tag's only radio activity between ranging sessions. Widen it
to trade discovery latency for battery life.

## Verifying it works

On the serial console at 115200:

```
[00:00:00.xxx] <inf> cs_tag: Starting Channel Sounding tag (fw cs-tag-0.1.0)
[00:00:00.xxx] <inf> cs_tag: TAG UID: a1b2c3d4e5f60718
[00:00:00.xxx] <inf> cs_tag: Advertising as uid=a1b2c3d4e5f60718
```

When a gateway connects you will see `Connected to ...`, then `CS config
created`. On disconnect the tag re-advertises rather than rebooting — a gateway
walking away is routine, not a fault.
