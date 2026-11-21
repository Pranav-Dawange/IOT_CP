// ==============================================================================
// Smart Industrial Edge Node - ESP32 Dual-Core FreeRTOS Firmware
// Course Project: Industrial Asset Condition Monitoring & Predictive Safety
// Cutoff Target MCU: ESP-WROOM-32 DevKit V1 (240MHz Xtensa Dual-Core)
//
// SENSOR TOPOLOGY & PIN ALLOCATION:
// - Current Sensor:        ACS712-30A via 10k/15k divider -> GPIO 34 (ADC1_CH6)
// - Spindle Tachometer:    LM393 Optical IR Comparator   -> GPIO 18 (Hardware
// Interrupt RISING)
// - Process Temperature:   DS18B20 1-Wire Thermal Probe   -> GPIO 4  (4.7k
// Pullup)
// - Ambient Air Temp & RH: DHT22 Digital Sensor           -> GPIO 19 (10k
// Pullup)
// - Automated Cutoff:      Songle 5V Optoisolated Relay   -> GPIO 26
// (Active-LOW Trip)
// - Local Display & IMU:   SSD1306 OLED & MPU-6050        -> GPIO 21 (SDA),
// GPIO 22 (SCL)
//
// CONCURRENCY MODEL (Dual-Core FreeRTOS):
// - Core 0: High-frequency ADC sampling, EMA filter, <10ms emergency cutoff.
// - Core 1: Non-blocking sensor polling, USB WebSerial emission, and MQTT
// ingestion.
// ==============================================================================

#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <Wire.h>

// Hardware Pin Definitions
#define PIN_ACS712_ADC 34   // ADC1_CH6 (12-bit Current ADC)
#define PIN_LM393_INT 18    // Hardware Interrupt (Spindle Speed)
#define PIN_DS18B20_DQ 4    // Dallas 1-Wire Stator Temperature
#define PIN_DHT22_DATA 19   // Single-Bus Digital (Ambient Air Temp)
#define PIN_RELAY_CUTOFF 26 // Active-LOW Songle Relay Actuator
#define PIN_I2C_SDA 21      // OLED & MPU-6050 I2C Data
#define PIN_I2C_SCL 22      // OLED & MPU-6050 I2C Clock
#define MPU6050_ADDR 0x68   // MPU-6050 Default I2C Address

// Network & Broker Configuration
const char *WIFI_SSID = "Industrial_IoT_Lab";
const char *WIFI_PASS = "Factory4.0Secure";
const char *MQTT_SERVER = "192.168.1.100";
const int MQTT_PORT = 1883;
const char *MQTT_CLIENT_ID = "ESP32_Asset_01";
const char *TOPIC_TELEMETRY = "factory/line_A/asset_01/telemetry";
const char *TOPIC_COMMAND = "factory/line_A/asset_01/cmd";

// Sensor & Peripheral Drivers
Adafruit_SSD1306 display(128, 64, &Wire, -1);
OneWire oneWire(PIN_DS18B20_DQ);
DallasTemperature tempSensor(&oneWire);
DHT dht(PIN_DHT22_DATA, DHT22);
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Shared Inter-Core State & Synchronization
portMUX_TYPE isrMux = portMUX_INITIALIZER_UNLOCKED;
volatile uint32_t pulseCount = 0;
float filteredCurrent = 0.0f;
float filteredVibrationRms = 0.85f;
const float EMA_ALPHA = 0.30f;
bool relayTripped = false;
float accumulatedWearMin = 0.0f;

// Optical Tachometer ISR (Atomic increment in IRAM)
void IRAM_ATTR onSpindlePulse() {
  portENTER_CRITICAL_ISR(&isrMux);
  pulseCount++;
  portEXIT_CRITICAL_ISR(&isrMux);
}

// Initialize MPU-6050 from low-power sleep mode
void initMPU6050() {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x6B); // PWR_MGMT_1 register
  Wire.write(0x00); // Clear sleep bit to wake sensor
  Wire.endTransmission(true);
}

// Sample 3-axis accelerometer and compute vibration RMS
float readMpuVibrationRms() {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(0x3B); // ACCEL_XOUT_H
  if (Wire.endTransmission(false) != 0) {
    return filteredVibrationRms;
  }
  Wire.requestFrom(MPU6050_ADDR, 6, true);
  if (Wire.available() < 6) {
    return filteredVibrationRms;
  }
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();

  // Convert raw 16-bit to g-units (+-2g full scale = 16384 LSB/g)
  float gx = ax / 16384.0f;
  float gy = ay / 16384.0f;
  float gz = (az / 16384.0f) - 1.0f; // Subtract static 1g gravitational bias

  float instantaneousRms =
      sqrt(gx * gx + gy * gy + gz * gz) * 9.80665f; // m/s^2
  if (instantaneousRms < 0.05f)
    instantaneousRms = 0.05f;
  return instantaneousRms;
}

// Downlink MQTT Command Callback (Closes Cyber-Physical Control Loop)
void onMqttCommand(char *topic, byte *payload, unsigned int length) {
  StaticJsonDocument<256> cmdDoc;
  DeserializationError err = deserializeJson(cmdDoc, payload, length);
  if (err) {
    Serial.println("[CMD_ERROR] Failed to parse command JSON");
    return;
  }

  const char *cmd = cmdDoc["command"] | "";
  if (strcmp(cmd, "TRIP_RELAY") == 0 || strcmp(cmd, "EMERGENCY_STOP") == 0) {
    digitalWrite(PIN_RELAY_CUTOFF, LOW); // Active-LOW open
    relayTripped = true;
    Serial.println("[DOWNLINK] Safety Cutoff Engaged: Relay TRIPPED");
  } else if (strcmp(cmd, "RESUME") == 0) {
    digitalWrite(PIN_RELAY_CUTOFF, HIGH); // Re-arm
    relayTripped = false;
    Serial.println("[DOWNLINK] Spindle Relatch: Relay ARMED");
  } else if (strcmp(cmd, "RESET_BUFFER") == 0) {
    accumulatedWearMin = 0.0f;
    Serial.println("[DOWNLINK] Buffer Reset: Tool wear zeroed");
  }
}

// Wi-Fi Connection Manager
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED)
    return;
  Serial.print("[WIFI] Connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startAttempt) < 6000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\n[WIFI] Connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(
        "\n[WIFI] Connection timeout. Operating in standalone serial mode.");
  }
}

// MQTT Reconnection Manager
void reconnectMqtt() {
  if (WiFi.status() != WL_CONNECTED)
    return;
  if (!mqttClient.connected()) {
    Serial.print("[MQTT] Connecting to broker...");
    if (mqttClient.connect(MQTT_CLIENT_ID)) {
      Serial.println(" connected.");
      mqttClient.subscribe(TOPIC_COMMAND, 1);
    } else {
      Serial.print(" failed, rc=");
      Serial.println(mqttClient.state());
    }
  }
}

// CORE 0 TASK: High-frequency current acquisition & safety cutoff
void TaskSensorAcquisition(void *pvParameters) {
  TickType_t xLastWakeTime = xTaskGetTickCount();
  const TickType_t xFrequency = pdMS_TO_TICKS(10); // 100Hz

  for (;;) {
    // 1. Read ACS712 via voltage divider (ratio = 0.60)
    uint32_t rawAdc = analogRead(PIN_ACS712_ADC);
    float pinVoltage = (rawAdc / 4095.0f) * 3.30f;
    float vout = pinVoltage / 0.60f; // Reconstructed 0-5V sensor output
    float instantCurrent = abs((vout - 2.50f) / 0.066f);

    // 2. Exponential Moving Average (EMA)
    filteredCurrent =
        (EMA_ALPHA * instantCurrent) + ((1.0f - EMA_ALPHA) * filteredCurrent);

    // 3. Fast Overcurrent Cutoff (<10ms reaction)
    if (filteredCurrent > 4.50f && !relayTripped) {
      digitalWrite(PIN_RELAY_CUTOFF, LOW);
      relayTripped = true;
      Serial.println(
          "[ISR_ALERT] Current Overload (>4.5A)! Emergency Cutoff Active.");
    }

    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}

// CORE 1 TASK: Sensor reading, WebSerial formatting, and MQTT transmission
void TaskMqttStreaming(void *pvParameters) {
  static uint32_t sequenceNumber = 1;
  TickType_t xLastWakeTime = xTaskGetTickCount();
  const TickType_t xFrequency = pdMS_TO_TICKS(1000); // 1.0Hz

  for (;;) {
    // Check network connectivity
    if (WiFi.status() == WL_CONNECTED) {
      if (!mqttClient.connected()) {
        reconnectMqtt();
      }
      mqttClient.loop();
    }

    // 1. Spindle RPM calculation
    portENTER_CRITICAL(&isrMux);
    uint32_t count = pulseCount;
    pulseCount = 0;
    portEXIT_CRITICAL(&isrMux);
    float rpm = (count / 8.0f) * 60.0f; // 8-slot encoder disc

    // 2. Spindle torque with motor no-load current offset (I_0 = 0.35A)
    float netCurrent = max(0.0f, filteredCurrent - 0.35f);
    float spindleTorque = netCurrent * 18.5f; // kt_spindle = eta * N * kt_motor

    // 3. Stator temperature (DS18B20 non-blocking)
    float statorC = tempSensor.getTempCByIndex(0);
    tempSensor.requestTemperatures(); // Kick off next conversion

    // 4. Ambient air temperature (DHT22)
    float ambientC = dht.readTemperature();
    float ambientK = isnan(ambientC) ? 298.15f : (ambientC + 273.15f);

    // 5. Vibration RMS from MPU-6050
    float rawVib = readMpuVibrationRms();
    filteredVibrationRms = 0.3f * rawVib + 0.7f * filteredVibrationRms;

    // 6. Tool wear progression
    if (rpm > 100.0f) {
      accumulatedWearMin += (1.0f / 60.0f);
    }

    // 7. Output WebSerial Telemetry Frame for Frontend Dashboard
    // Format: [HW_TELEM] RPM=1680.0 CURR=1.85 TEMP=34.2 VIB=1.22 AIR_TEMP=25.0
    // RELAY=1
    Serial.printf("[HW_TELEM] RPM=%.1f CURR=%.2f TEMP=%.1f VIB=%.2f "
                  "AIR_TEMP=%.1f RELAY=%d\n",
                  rpm, filteredCurrent, statorC > -50 ? statorC : 25.0f,
                  filteredVibrationRms, isnan(ambientC) ? 25.0f : ambientC,
                  relayTripped ? 0 : 1);

    // 8. Publish JSON Payload to MQTT Broker (if online)
    if (mqttClient.connected()) {
      StaticJsonDocument<384> doc;
      doc["asset_id"] = "asset_01";
      doc["sequence_number"] = sequenceNumber++;
      doc["timestamp"] = millis();
      doc["air_temperature"] = ambientK;
      doc["process_temperature"] = statorC > -50 ? (statorC + 273.15f) : 308.5f;
      doc["rotational_speed"] = rpm;
      doc["torque"] = spindleTorque;
      doc["tool_wear"] = accumulatedWearMin;
      doc["current_a"] = filteredCurrent;
      doc["vibration_rms"] = filteredVibrationRms;
      doc["relay_state"] = relayTripped ? "OPEN" : "CLOSED";

      char buffer[384];
      serializeJson(doc, buffer);
      mqttClient.publish(TOPIC_TELEMETRY, buffer);
    }

    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[INIT] Booting Smart Industrial Edge Node...");

  // Output Actuator Setup
  pinMode(PIN_RELAY_CUTOFF, OUTPUT);
  digitalWrite(PIN_RELAY_CUTOFF, HIGH); // Armed (Normal Closed)

  // Spindle Encoder Interrupt Setup
  pinMode(PIN_LM393_INT, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_LM393_INT), onSpindlePulse, RISING);

  // ADC & I2C Configuration
  analogSetPinAttenuation(PIN_ACS712_ADC, ADC_11db);
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  initMPU6050();

  // OLED Display Init
  if (display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("Smart Industrial Node");
    display.println("ESP32 DevKit V1");
    display.display();
  }

  // Temperature Sensors Init
  tempSensor.begin();
  tempSensor.setWaitForConversion(false); // Non-blocking
  tempSensor.requestTemperatures();
  dht.begin();

  // Network & MQTT Setup
  connectWiFi();
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(onMqttCommand);

  // FreeRTOS Task Creation
  xTaskCreatePinnedToCore(TaskSensorAcquisition, "SensorTask", 4096, NULL, 2,
                          NULL, 0);
  xTaskCreatePinnedToCore(TaskMqttStreaming, "MqttTask", 4096, NULL, 1, NULL,
                          1);

  Serial.println("[INIT] Dual-Core FreeRTOS Tasks Started.");
}

void loop() {
  // FreeRTOS preemptive scheduler manages all execution
}
