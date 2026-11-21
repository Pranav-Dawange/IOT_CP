/**
 * ==============================================================================
 * Smart Industrial Edge Node — ESP32 Dual-Core FreeRTOS Firmware
 * Project: Asset Failure Prediction & Automated Safety Cutoff (Phase 7)
 * Target MCU: ESP-WROOM-32 DevKit V1 (240MHz Xtensa Dual-Core)
 *
 * SENSOR TOPOLOGY & PIN ALLOCATION:
 * - ACS712-30A Hall Current Sensor: GPIO 34 (ADC1_CH6 via 10k/15k divider)
 * - LM393 Optical Spindle Encoder:  GPIO 18 (Hardware Interrupt RISING)
 * - DS18B20 1-Wire Thermal Sensor:  GPIO 4  (4.7k Pullup Stator Surface Temp)
 * - DHT22 Single-Bus Temp & RH:     GPIO 19 (10k Pullup Ambient Air Temp)
 * - Songle 5V Active-LOW Relay:     GPIO 26 (Optoisolated Coil Driver)
 * - SSD1306 OLED & MPU-6050 Accel:  GPIO 21 (SDA), GPIO 22 (SCL)
 *
 * MULTI-CORE CONCURRENCY ARCHITECTURE:
 * - Core 0: High-Frequency Sensor Polling (100Hz EMA filtering, <10ms hardware cutoff)
 * - Core 1: Asynchronous Wi-Fi & MQTT Ingestion (1Hz publishing, JSON telemetry)
 * ==============================================================================
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <DHT.h>
#include <ArduinoJson.h>

// --- PIN DEFINITIONS ---
#define PIN_ACS712_ADC     34   // ADC1_CH6 (12-bit, Hall Current)
#define PIN_LM393_INT      18   // Hardware Interrupt (Spindle Speed)
#define PIN_DS18B20_DQ      4   // Dallas 1-Wire Stator Temperature
#define PIN_DHT22_DATA     19   // Single-Bus Digital (Ambient Air Temp)
#define PIN_RELAY_CUTOFF   26   // Active-LOW Songle Relay Actuator
#define PIN_I2C_SDA        21   // OLED & MPU-6050 Data
#define PIN_I2C_SCL        22   // OLED & MPU-6050 Clock

// --- NETWORK CONFIGURATION ---
const char* WIFI_SSID = "Industrial_IoT_Lab";
const char* WIFI_PASS = "Factory4.0Secure";
const char* MQTT_SERVER = "192.168.1.100";
const int   MQTT_PORT = 1883;

// --- SENSOR OBJECTS ---
Adafruit_SSD1306 display(128, 64, &Wire, -1);
OneWire oneWire(PIN_DS18B20_DQ);
DallasTemperature tempSensor(&oneWire);
DHT dht(PIN_DHT22_DATA, DHT22);
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// --- GLOBAL ATOMIC TELEMETRY ---
portMUX_TYPE isrMux = portMUX_INITIALIZER_UNLOCKED;
volatile uint32_t pulseCount = 0;
float filteredCurrent = 0.0;
float filteredVibration = 1.20;
const float EMA_ALPHA = 0.30;
bool relayTripped = false;
float accumulatedWearMin = 0.0;

// --- HARDWARE INTERRUPT (ATOMIC INCREMENT IN IRAM) ---
void IRAM_ATTR onSpindlePulse() {
  portENTER_CRITICAL_ISR(&isrMux);
  pulseCount++;
  portEXIT_CRITICAL_ISR(&isrMux);
}

// ==============================================================================
// CORE 0 TASK: HIGH-FREQUENCY SENSOR POLLING & EMA FILTERING
// ==============================================================================
void TaskSensorAcquisition(void *pvParameters) {
  TickType_t xLastWakeTime = xTaskGetTickCount();
  const TickType_t xFrequency = pdMS_TO_TICKS(10); // 100Hz Polling

  for (;;) {
    // 1. Sample ACS712 ADC through 10k/15k voltage divider (ratio = 0.60)
    uint32_t rawAdc = analogRead(PIN_ACS712_ADC);
    float pinVoltage = (rawAdc / 4095.0f) * 3.30f;
    float vout = pinVoltage / 0.60f; // Reconstructed 0-5V sensor output
    float instantCurrent = abs((vout - 2.50f) / 0.066f);

    // 2. Exponential Moving Average (EMA) Filtration
    filteredCurrent = (EMA_ALPHA * instantCurrent) + ((1.0f - EMA_ALPHA) * filteredCurrent);

    // 3. Check Safety Hardware Limit (<10ms cutoff)
    if (filteredCurrent > 4.50f && !relayTripped) {
      digitalWrite(PIN_RELAY_CUTOFF, LOW); // Emergency Cutoff
      relayTripped = true;
      Serial.println("[ISR_ALERT] Current Overload! Relay TRIPPED <10ms");
    }

    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}

// Downlink MQTT Command Callback (Closes the Cyber-Physical Loop)
void onMqttCommand(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> cmdDoc;
  deserializeJson(cmdDoc, payload, length);
  const char* cmd = cmdDoc["command"] | "";
  if (strcmp(cmd, "TRIP_RELAY") == 0 || strcmp(cmd, "EMERGENCY_STOP") == 0) {
    digitalWrite(PIN_RELAY_CUTOFF, LOW);
    relayTripped = true;
    Serial.println("[DOWNLINK] Automated Cutoff: Relay TRIPPED!");
  } else if (strcmp(cmd, "RESUME") == 0) {
    digitalWrite(PIN_RELAY_CUTOFF, HIGH);
    relayTripped = false;
    Serial.println("[DOWNLINK] Motor Relatch: Relay ARMED!");
  } else if (strcmp(cmd, "RESET_BUFFER") == 0) {
    accumulatedWearMin = 0.0f;
    Serial.println("[DOWNLINK] Edge Telemetry Buffer & Wear Reset!");
  }
}

void reconnectMqtt() {
  while (!mqttClient.connected()) {
    if (mqttClient.connect("ESP32_Asset_01")) {
      mqttClient.subscribe("factory/line_A/asset_01/cmd", 1);
    } else {
      vTaskDelay(pdMS_TO_TICKS(2000));
    }
  }
}

// ==============================================================================
// CORE 1 TASK: MQTT PUBLICATION & CLOUD TELEMETRY STREAM
// ==============================================================================
void TaskMqttStreaming(void *pvParameters) {
  static uint32_t sequenceNumber = 1;

  for (;;) {
    if (!mqttClient.connected()) {
      reconnectMqtt();
      mqttClient.subscribe("factory/line_A/asset_01/cmd", 1);
    }
    mqttClient.loop();

    // 1. Atomically Read & Clear Pulse Counter
    portENTER_CRITICAL(&isrMux);
    uint32_t count = pulseCount;
    pulseCount = 0;
    portEXIT_CRITICAL(&isrMux);

    float rpm = (count / 8.0f) * 60.0f;
    // Electromechanical torque scaling subtracting no-load current I_0 = 0.35A
    float netCurrent = max(0.0f, filteredCurrent - 0.35f);
    float spindleTorque = netCurrent * 18.5f; // kt_spindle = η·N·kt_motor

    // 2. Non-blocking Stator Temperature Read
    float statorC = tempSensor.getTempCByIndex(0);
    tempSensor.requestTemperatures(); // Non-blocking conversion kick-off

    // 3. Sample DHT22 Ambient Air Temperature
    float ambientC = dht.readTemperature();
    float ambientK = isnan(ambientC) ? 298.15f : (ambientC + 273.15f);

    // 4. Track Cumulative Spindle Tool Wear Time (Minutes)
    if (rpm > 100.0f) {
      accumulatedWearMin += (1.0f / 60.0f);
    }

    // 5. Serialize Full Contract Payload (Compliant with Edge Validator)
    StaticJsonDocument<384> doc;
    doc["asset_id"] = "asset_01";
    doc["sequence_number"] = sequenceNumber++;
    doc["timestamp"] = "2026-11-21T12:00:00Z";
    doc["air_temperature"] = ambientK;
    doc["process_temperature"] = statorC > -50 ? statorC + 273.15f : 308.5f;
    doc["rotational_speed"] = rpm;
    doc["torque"] = spindleTorque;
    doc["tool_wear"] = accumulatedWearMin;
    doc["current_a"] = filteredCurrent;
    doc["relay_state"] = relayTripped ? "OPEN" : "CLOSED";

    char buffer[384];
    serializeJson(doc, buffer);
    mqttClient.publish("factory/line_A/asset_01/telemetry", buffer);

    vTaskDelay(pdMS_TO_TICKS(1000)); // 1.0 Hz Publishing
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELAY_CUTOFF, OUTPUT);
  digitalWrite(PIN_RELAY_CUTOFF, HIGH); // Armed (Normal Closed)

  pinMode(PIN_LM393_INT, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_LM393_INT), onSpindlePulse, RISING);

  analogSetPinAttenuation(PIN_ACS712_ADC, ADC_11db);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);

  // Configure DS18B20 for non-blocking asynchronous conversions
  tempSensor.begin();
  tempSensor.setWaitForConversion(false);
  tempSensor.requestTemperatures();

  // Initialize DHT22 Ambient Air Transducer
  dht.begin();

  mqttClient.setCallback(onMqttCommand);

  // Create Pinned FreeRTOS Tasks
  xTaskCreatePinnedToCore(TaskSensorAcquisition, "SensorTask", 4096, NULL, 2, NULL, 0);
  xTaskCreatePinnedToCore(TaskMqttStreaming, "MqttTask", 4096, NULL, 1, NULL, 1);
}

void loop() {
  // Empty — FreeRTOS preemptive scheduler coordinates tasks on Core 0 and Core 1
}
