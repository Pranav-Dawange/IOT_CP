#!/bin/bash
# ==============================================================
# Docker Engine + Docker Compose Install Script
# For Ubuntu 24.04 LTS (Noble) x86_64
# Official Docker install method (docker.com/engine)
# ==============================================================

set -e  # Exit on any error

echo ""
echo "=============================================="
echo " Docker Engine Installer for Ubuntu 24.04"
echo "=============================================="
echo ""

# ── Step 1: Remove old conflicting packages ─────────────────
echo "[1/5] Removing any old Docker packages..."
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
  sudo apt-get remove -y "$pkg" 2>/dev/null || true
done
echo "      Done."

# ── Step 2: Install prerequisites ────────────────────────────
echo "[2/5] Installing prerequisites..."
sudo apt-get update -qq
sudo apt-get install -y ca-certificates curl
echo "      Done."

# ── Step 3: Add Docker's official GPG key & repo ─────────────
echo "[3/5] Adding Docker's official GPG key and APT repository..."
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update -qq
echo "      Done."

# ── Step 4: Install Docker Engine + Compose plugin ───────────
echo "[4/5] Installing Docker Engine, CLI, containerd, and Compose plugin..."
sudo apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
echo "      Done."

# ── Step 5: Add current user to docker group (no sudo needed) ─
echo "[5/5] Adding '$USER' to the 'docker' group (so you don't need sudo for docker)..."
sudo usermod -aG docker "$USER"
echo "      Done."

# ── Final verification ────────────────────────────────────────
echo ""
echo "=============================================="
echo " Installation Complete!"
echo "=============================================="
echo ""
echo " Verifying Docker version:"
docker --version
echo ""
echo " Verifying Docker Compose version:"
docker compose version
echo ""
echo "⚠️  IMPORTANT: Log out and log back in (or run 'newgrp docker')"
echo "   so your user gets added to the docker group."
echo ""
echo " Then go to your project and run:"
echo "   cd /home/swaraj/Desktop/IOT_CP"
echo "   docker compose up --build"
echo ""
