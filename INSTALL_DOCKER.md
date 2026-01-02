# Installing Docker and Docker Compose

## Windows Installation

### Option 1: Docker Desktop (Recommended)

Docker Desktop for Windows includes both Docker and Docker Compose:

1. **Download Docker Desktop:**
   - Go to https://www.docker.com/products/docker-desktop/
   - Click "Download for Windows"
   - Download the installer (Docker Desktop Installer.exe)

2. **Install Docker Desktop:**
   - Run the installer
   - Follow the installation wizard
   - Make sure "Use WSL 2 instead of Hyper-V" is checked (if you have WSL 2)
   - Restart your computer when prompted

3. **Verify Installation:**
   ```powershell
   docker --version
   docker compose version
   ```

4. **Start Docker Desktop:**
   - Launch Docker Desktop from the Start menu
   - Wait for it to start (whale icon in system tray)

### Option 2: WSL 2 with Docker Engine

If you prefer using WSL 2:

1. **Install WSL 2:**
   ```powershell
   wsl --install
   ```

2. **Install Docker in WSL:**
   ```bash
   # In WSL terminal
   curl -fsSL https://get.docker.com -o get-docker.sh
   sh get-docker.sh
   ```

3. **Install Docker Compose:**
   ```bash
   sudo apt-get update
   sudo apt-get install docker-compose-plugin
   ```

## Linux Installation

### Ubuntu/Debian

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (optional, to run without sudo)
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo apt-get update
sudo apt-get install docker-compose-plugin

# Verify
docker --version
docker compose version
```

### Fedora/RHEL/CentOS

```bash
# Install Docker
sudo dnf install docker

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group
sudo usermod -aG docker $USER

# Install Docker Compose plugin
sudo dnf install docker-compose-plugin

# Verify
docker --version
docker compose version
```

## macOS Installation

### Option 1: Docker Desktop (Recommended)

1. **Download Docker Desktop:**
   - Go to https://www.docker.com/products/docker-desktop/
   - Download for Mac (Intel or Apple Silicon)

2. **Install:**
   - Open the .dmg file
   - Drag Docker to Applications
   - Launch Docker Desktop
   - Complete the setup wizard

3. **Verify:**
   ```bash
   docker --version
   docker compose version
   ```

### Option 2: Homebrew

```bash
# Install Docker
brew install --cask docker

# Install Docker Compose (if not included)
brew install docker-compose

# Start Docker Desktop
open /Applications/Docker.app
```

## Verify Installation

After installation, verify everything works:

```bash
# Check Docker version
docker --version
# Should output: Docker version 24.x.x or similar

# Check Docker Compose version
docker compose version
# Should output: Docker Compose version v2.x.x or similar

# Test Docker
docker run hello-world
# Should download and run a test container
```

## Troubleshooting

### Windows: "WSL 2 installation is incomplete"

1. Enable WSL 2 feature:
   ```powershell
   dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
   dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
   ```

2. Download and install WSL 2 kernel update:
   - https://aka.ms/wsl2kernel

3. Set WSL 2 as default:
   ```powershell
   wsl --set-default-version 2
   ```

### Docker daemon not running

**Windows:**
- Make sure Docker Desktop is running (check system tray)

**Linux:**
```bash
sudo systemctl start docker
sudo systemctl enable docker
```

**macOS:**
- Make sure Docker Desktop is running

### Permission denied errors (Linux)

Add your user to the docker group:
```bash
sudo usermod -aG docker $USER
# Log out and log back in for changes to take effect
```

## Next Steps

Once Docker is installed, you can build and run PhotoGroup AI:

```bash
# Build the image
docker build -t photogroup-ai .

# Or use docker-compose
docker compose up -d
```

For more information, see [DOCKER.md](./DOCKER.md).


