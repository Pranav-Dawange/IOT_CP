#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <math.h>

#define IRAM_ATTR
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
#define HIGH 1
#define LOW 0
#define RISING 1
#define FALLING 2
#define CHANGE 3

typedef uint8_t byte;
typedef bool boolean;

inline void pinMode(uint8_t pin, uint8_t mode) {}
inline void digitalWrite(uint8_t pin, uint8_t val) {}
inline int digitalRead(uint8_t pin) { return 0; }
inline int analogRead(uint8_t pin) { return 0; }
inline void delay(unsigned long ms) {}
inline void delayMicroseconds(unsigned int us) {}
inline unsigned long millis() { return 0; }
inline unsigned long micros() { return 0; }
inline void attachInterrupt(uint8_t pin, void (*userFunc)(void), int mode) {}
inline void detachInterrupt(uint8_t pin) {}

// FreeRTOS ESP32 stubs
typedef int portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED 0
inline void portENTER_CRITICAL_ISR(portMUX_TYPE* mux) {}
inline void portEXIT_CRITICAL_ISR(portMUX_TYPE* mux) {}
inline void portENTER_CRITICAL(portMUX_TYPE* mux) {}
inline void portEXIT_CRITICAL(portMUX_TYPE* mux) {}

typedef void* TaskHandle_t;
typedef void (*TaskFunction_t)(void*);
#define pdMS_TO_TICKS(ms) (ms)
#define portMAX_DELAY 0xFFFFFFFF
inline void vTaskDelay(uint32_t ticks) {}
inline void xTaskCreatePinnedToCore(TaskFunction_t pvTaskCode, const char* pcName, uint32_t usStackDepth, void* pvParameters, uint32_t uxPriority, TaskHandle_t* pvCreatedTask, int xCoreID) {}

struct HardwareSerial {
    void begin(unsigned long baud) {}
    void print(const char* s) {}
    void print(int n) {}
    void print(float f, int p = 2) {}
    void println() {}
    void println(const char* s) {}
    void println(int n) {}
    void println(float f, int p = 2) {}
    void printf(const char* fmt, ...) {}
};
extern HardwareSerial Serial;
