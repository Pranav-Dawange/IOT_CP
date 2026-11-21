#pragma once
#include "Arduino.h"
struct TwoWire {
    void begin(int sda = -1, int scl = -1) {}
    void beginTransmission(uint8_t addr) {}
    uint8_t endTransmission(bool sendStop = true) { return 0; }
    uint8_t requestFrom(uint8_t addr, uint8_t len, bool stop = true) { return len; }
    size_t write(uint8_t val) { return 1; }
    int available() { return 0; }
    int read() { return 0; }
};
extern TwoWire Wire;
