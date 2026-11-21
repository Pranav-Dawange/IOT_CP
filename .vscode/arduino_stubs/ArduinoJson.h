#pragma once
#include "Arduino.h"
template<size_t CAPACITY>
struct StaticJsonDocument {
    struct Proxy {
        template<typename V>
        Proxy& operator=(const V& val) { return *this; }
    };
    Proxy operator[](const char* key) { return Proxy(); }
};
template<typename TDoc>
inline size_t serializeJson(const TDoc& doc, char* output, size_t maxLen) {
    if (maxLen > 0) output[0] = '\0';
    return 0;
}
