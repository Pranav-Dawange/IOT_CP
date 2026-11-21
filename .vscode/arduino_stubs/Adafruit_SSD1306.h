#pragma once
#include "Arduino.h"
#include "Wire.h"
#define SSD1306_SWITCHCAPVCC 0x02
#define WHITE 1
struct Adafruit_SSD1306 {
    Adafruit_SSD1306(int w, int h, TwoWire* wire, int rst = -1) {}
    bool begin(uint8_t vcc = SSD1306_SWITCHCAPVCC, uint8_t addr = 0x3C) { return true; }
    void clearDisplay() {}
    void display() {}
    void setTextSize(uint8_t s) {}
    void setTextColor(uint16_t c) {}
    void setCursor(int16_t x, int16_t y) {}
    void print(const char* s) {}
    void print(float f, int p = 2) {}
    void println(const char* s = "") {}
    void println(float f, int p = 2) {}
    void printf(const char* fmt, ...) {}
};
