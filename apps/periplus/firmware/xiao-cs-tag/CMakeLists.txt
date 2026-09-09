#
# xiao-cs-tag — Channel Sounding tag for the LoRa GPS Tracker MVP.
#
cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(xiao_cs_tag)

target_sources(app PRIVATE
  src/main.c
)
