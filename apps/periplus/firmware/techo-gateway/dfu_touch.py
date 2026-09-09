# Append the 1200-baud touch to the nrfutil upload command.
#
# The nrf52840_dk_adafruit board definition does not request it, so nrfutil
# reports "Touch disabled" and the DFU handshake times out against a board that
# is still running its application firmware.
#
# This cannot be done with `upload_flags` in platformio.ini: PlatformIO does
# env.Prepend(UPLOADERFLAGS=["$UPLOAD_FLAGS"]), which puts the flag *before*
# nrfutil's "dfu serial" subcommand, where its parser rejects it.
Import("env")

env.Append(UPLOADERFLAGS=["--touch", "1200"])
