#pragma once
#include "Arduino.h"
#include "OneWire.h"
#define DEVICE_DISCONNECTED_C -127.0f
struct DallasTemperature {
    DallasTemperature(OneWire* ow) {}
    void begin() {}
    void requestTemperatures() {}
    float getTempCByIndex(int idx) { return 25.0f; }
};
