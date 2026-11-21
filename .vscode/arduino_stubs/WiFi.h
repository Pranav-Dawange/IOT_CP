#pragma once
#include "Arduino.h"
enum wl_status_t { WL_CONNECTED = 3, WL_DISCONNECTED = 6 };
struct WiFiClass {
    void mode(int m) {}
    void begin(const char* ssid, const char* pass) {}
    wl_status_t status() { return WL_CONNECTED; }
    void disconnect() {}
};
extern WiFiClass WiFi;

struct WiFiClient {
    bool connected() { return true; }
};
