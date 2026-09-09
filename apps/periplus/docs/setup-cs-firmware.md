# Channel Sounding firmware setup

Building and flashing the two **Seeed XIAO nRF54L15** boards: one gateway, one
tag.

> These are a second class of tracked device. They do not replace the LoRa GPS
> path — both coexist. See `packet-format.md` for how the bridge tells the two
> apart.

## Which board gets which firmware

Both boards enumerate as `VID_2886 PID_0066`. Tell them apart by USB serial:

| USB serial | Port | Firmware | Role |
| --- | --- | --- | --- |
| `F2777FB0` | COM9 | `xiao-cs-gateway` | CS Initiator + RAS client |
| `2EBEE19A` | COM10 | `xiao-cs-tag` | CS Reflector + RAS server |

This assignment is arbitrary — nothing in the firmware depends on it. If you
have physically marked the boards differently, swap them and update this table.
List the serials again with:

```powershell
Get-PnpDevice -PresentOnly | Where-Object {$_.InstanceId -like '*VID_2886*'} |
  Select-Object FriendlyName,InstanceId | Format-List
```

## There is no UF2 bootloader

The XIAO nRF54L15 exposes three USB interfaces:

```
MI_00  HID
MI_01  CMSIS-DAP v2 Adapter     <- onboard debug probe, this is how you flash
MI_02  USB Serial (COM port)    <- console output
```

There is **no mass-storage interface and no removable drive**, so drag-and-drop
`.uf2` flashing is not available on this board, and Zephyr produces no `.uf2`
for it (its runners are openocd / nrfutil / nrfjprog / jlink). Flash over the
onboard CMSIS-DAP probe instead.

The `B` (BOOT) and `R` (RESET) buttons are still useful: hold `B` while tapping
`R` to enter the ROM bootloader if a bad image ever makes the probe unreachable.
Normal flashing does not need them.

## Toolchain (WSL, no sudo required)

Debian's Python has `ensurepip` stripped and this workspace has no root, so the
toolchain is bootstrapped with `uv` (a standalone binary) rather than apt.

```bash
# 1. uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. venv with west, cmake, ninja
export PATH="$HOME/.local/bin:$PATH"
uv venv ~/.venv/ncs --python 3.12
VIRTUAL_ENV=~/.venv/ncs uv pip install west "cmake~=3.31.0" ninja

# cmake is pinned to 3.x on purpose: cmake 4 drops compatibility that Zephyr
# modules still rely on.

# 3. NCS v3.4.0 (v3.0.1 is the floor for qualified Channel Sounding)
export PATH="$HOME/.venv/ncs/bin:$PATH"
west init -m https://github.com/nrfconnect/sdk-nrf --mr v3.4.0 ~/ncs
cd ~/ncs && west update --narrow -o=--depth=1

# 4. Python requirements, then the ARM toolchain
VIRTUAL_ENV=~/.venv/ncs uv pip install -r ~/ncs/zephyr/scripts/requirements.txt
VIRTUAL_ENV=~/.venv/ncs uv pip install -r ~/ncs/nrf/scripts/requirements.txt
export ZEPHYR_BASE=~/ncs/zephyr
west sdk install -t arm-zephyr-eabi
```

Confirm the board target is present before building — do not guess it:

```bash
west boards | grep -i 54l15
# xiao_nrf54l15   <- the one you want
```

## Build

```bash
export PATH="$HOME/.venv/ncs/bin:$HOME/.local/bin:$PATH"
export ZEPHYR_BASE=~/ncs/zephyr
cd ~/ncs

west build -p always -b xiao_nrf54l15/nrf54l15/cpuapp \
  -d /tmp/cs-gw-build  ~/periplus/firmware/xiao-cs-gateway

west build -p always -b xiao_nrf54l15/nrf54l15/cpuapp \
  -d /tmp/cs-tag-build ~/periplus/firmware/xiao-cs-tag
```

Expected footprint (v3.4.0): gateway ~19% flash / 25% RAM, tag ~16% / 21%.

Three build warnings are expected and come from NCS itself:
`Experimental symbol BT_CHANNEL_SOUNDING`, `Experimental symbol BT_CS_DE`, and
`Deprecated symbol NRF_PLATFORM_LUMOS`.

## Flash

WSL cannot see USB devices by default — `ls /dev/ttyACM*` finds nothing, and
`/dev/bus/usb` does not exist. Pick one of the two routes.

### Route A — flash from Windows (no USB forwarding)

The build copies both images to `C:\Users\Rynalde\cs-firmware\`. In **Windows**
PowerShell:

```powershell
pip install pyocd

# gateway  (serial F2777FB0)
pyocd flash -t nrf54l --uid F2777FB0 C:\Users\Rynalde\cs-firmware\xiao-cs-gateway.hex

# tag      (serial 2EBEE19A)
pyocd flash -t nrf54l --uid 2EBEE19A C:\Users\Rynalde\cs-firmware\xiao-cs-tag.hex
```

`nrf54l` is a **built-in** pyOCD target covering the NRF54L15 — no CMSIS pack
install needed. `--uid` targets a specific probe, which matters with two
identical boards attached; drop it if only one is plugged in.

To re-stage images after a rebuild:

```bash
cp /tmp/cs-gw-build/xiao-cs-gateway/zephyr/zephyr.hex /mnt/c/Users/Rynalde/cs-firmware/xiao-cs-gateway.hex
cp /tmp/cs-tag-build/xiao-cs-tag/zephyr/zephyr.hex    /mnt/c/Users/Rynalde/cs-firmware/xiao-cs-tag.hex
```

### Route B — forward USB into WSL

In an **elevated** Windows PowerShell:

```powershell
winget install usbipd
usbipd list                          # note the BUSID of each VID_2886 device
usbipd bind   --busid <busid>
usbipd attach --wsl --busid <busid>  # repeat for the second board
```

Then in WSL the boards appear as `/dev/ttyACM0` / `/dev/ttyACM1` and
`west flash` works directly:

```bash
west flash -d /tmp/cs-gw-build  --runner pyocd
west flash -d /tmp/cs-tag-build --runner pyocd
```

`usbipd bind` needs administrator rights once per device; `attach` must be
repeated after each reboot or unplug.

## Verify each board

Open the board's COM port at **115200** (PuTTY, or `west espressif monitor`-style
tooling; from WSL after Route B, `screen /dev/ttyACM0 115200`).

**Tag** — should print its UID and then advertise:

```
<inf> cs_tag: Starting Channel Sounding tag (fw cs-tag-0.1.0)
<inf> cs_tag: TAG UID: a1b2c3d4e5f60718
<inf> cs_tag: Advertising as uid=a1b2c3d4e5f60718
```

Write that UID down — it is the tag's permanent identity.

**Gateway** — should find the tag and emit JSON:

```
<inf> cs_gateway: Starting Channel Sounding gateway (fw cs-0.1.0)
<inf> cs_gateway: New tag uid=a1b2c3d4e5f60718 rssi=-52
<inf> cs_gateway: Ranging tag uid=a1b2c3d4e5f60718
{"device_id":"CSGW01",...,"payload":{"device_id":"a1b2...","distance_m":1.87,"status":"ok",...}}
```

Move the boards apart — `distance_m` should follow. Absolute accuracy needs
calibration against a known distance; see the note in the gateway README.

## Connect it to Supabase

The CS gateway is its **own** row in `devices` with its own key, because
it is a separate physical device from the T-Echo. Run a second bridge instance
pointed at its port and key:

```bash
cd bridge
SERIAL_PORT=/dev/ttyACM0 \
GATEWAY_KEY=<the CS gateway key> \
SUPABASE_URL=... SUPABASE_ANON_KEY=... \
  bun run src/index.ts
```

The bridge opens exactly one serial port, so the LoRa gateway and the CS gateway
run as two processes with two keys. Nothing in the bridge needed changing for
this — a ranging line is an ordinary relayed reading that happens to carry a
distance instead of a coordinate.
