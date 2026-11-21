#pragma once
#include "Arduino.h"
#include "WiFi.h"
struct PubSubClient {
    PubSubClient() {}
    PubSubClient(WiFiClient& client) {}
    void setServer(const char* domain, uint16_t port) {}
    void setCallback(void (*callback)(char*, uint8_t*, unsigned int)) {}
    bool connect(const char* id) { return true; }
    bool connected() { return true; }
    void disconnect() {}
    bool loop() { return true; }
    bool publish(const char* topic, const char* payload) { return true; }
    bool subscribe(const char* topic, uint8_t qos = 0) { return true; }
};
