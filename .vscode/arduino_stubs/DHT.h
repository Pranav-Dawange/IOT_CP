#pragma once
#include "Arduino.h"
#define DHT22 22
struct DHT {
    DHT(uint8_t pin, uint8_t type) {}
    void begin() {}
    float readTemperature(bool isF = false) { return 25.0f; }
    float readHumidity() { return 50.0f; }
};
